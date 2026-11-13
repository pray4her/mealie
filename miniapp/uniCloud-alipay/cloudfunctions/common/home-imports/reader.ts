import { request as httpsRequest } from 'node:https';
import { ImportFailure } from './provider';
import type { ValidatedSource } from './urls';

export interface UrlReaderPort { read(source: ValidatedSource): Promise<{ sourceUrl: string; read: boolean; content: string | null }> }
export type ReaderRequest = (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>;

export const jinaRequest: ReaderRequest = (url, headers) => new Promise((resolve, reject) => {
  const req = httpsRequest(url, { method: 'GET', headers }, response => {
    const chunks: Buffer[] = []; let bytes = 0;
    response.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 262144) { req.destroy(new ImportFailure('SOURCE_UNREADABLE')); return; }
      chunks.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
  });
  const timer = setTimeout(() => req.destroy(new Error('timeout')), 25000);
  req.on('close', () => clearTimeout(timer)); req.on('error', reject); req.end();
});

const retryableStatus = (status: number) => status === 429 || status >= 500 && status <= 599 && ![501, 505].includes(status);

export function createJinaReader(options: { apiKey(): string | undefined; request?: ReaderRequest }): UrlReaderPort {
  return { async read(source) {
    const key = options.apiKey();
    if (key && /[\r\n]/.test(key)) throw new ImportFailure('SOURCE_UNREADABLE');
    // X-Max-Tokens trims long pages; X-Token-Budget would reject readable recipes outright.
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Timeout': '20', 'X-Retain-Images': 'none', 'X-Max-Tokens': '8000', 'X-Base': 'final', 'X-Assert-Status-Code': '200' };
    if (key) headers.Authorization = 'Bearer ' + key;
    let response: Awaited<ReturnType<ReaderRequest>>;
    // r.jinaai.cn: Jina official China transition domain (jina-ai/reader#1237, jina.ai DNS-polluted in CN).
    try { response = await (options.request ?? jinaRequest)('https://r.jinaai.cn/' + source.url, headers); }
    catch (error) { if (error instanceof ImportFailure) throw error; throw new ImportFailure('SOURCE_UNREADABLE', true); }
    if (response.status !== 200) throw new ImportFailure('SOURCE_UNREADABLE', retryableStatus(response.status));
    try {
      if (Buffer.byteLength(response.body) > 262144) throw new Error();
      const raw = JSON.parse(response.body) as Record<string, unknown>;
      if (!raw || typeof raw !== 'object' || raw.code !== 200) throw new Error();
      const data = raw.data as Record<string, unknown>;
      if (!data || typeof data !== 'object' || typeof data.url !== 'string' || !/^https?:\/\//.test(data.url)) throw new Error();
      if (typeof data.warning === 'string' && /Target URL returned error \d{3}/i.test(data.warning)) throw new Error();
      const content = typeof data.content === 'string' && data.content.trim() ? data.content : null;
      return { sourceUrl: data.url, read: content !== null, content };
    } catch (error) { if (error instanceof ImportFailure) throw error; throw new ImportFailure('SOURCE_UNREADABLE'); }
  } };
}
