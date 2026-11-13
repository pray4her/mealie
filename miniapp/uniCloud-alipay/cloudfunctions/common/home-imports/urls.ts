import { isIP } from 'node:net';
import { resolve4, resolve6 } from 'node:dns/promises';
import { AppError } from 'home-kernel';

export type ValidatedSource = { url: string; hostname: string; addresses: string[] };
export type Resolver = (hostname: string) => Promise<string[]>;

function ipv4Public(a: number, b: number, c: number): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function expand6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const embedded = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embedded) {
    const octets = embedded[1].split('.').map(Number);
    if (octets.some(n => n > 255)) return null;
    addr = addr.slice(0, -embedded[1].length) + ((octets[0] << 8) | octets[1]).toString(16) + ':' + ((octets[2] << 8) | octets[3]).toString(16);
  }
  const dc = addr.indexOf('::');
  if (dc !== -1 && addr.indexOf('::', dc + 1) !== -1) return null;
  const head = dc === -1 ? addr.split(':') : addr.slice(0, dc).split(':').filter(Boolean);
  const rest = dc === -1 ? [] : addr.slice(dc + 2).split(':').filter(Boolean);
  if (head.length + rest.length > 8 || (dc === -1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest];
  if (groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map(g => parseInt(g, 16));
}

function ipv6Public(g: number[]): boolean {
  const [a, b, c] = g;
  if (g.every(x => x === 0)) return false;
  if (a === 0 && b === 0 && c === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 && g[6] === 0 && g[7] === 1) return false;
  if ((a & 0xfe00) === 0xfc00 || (a & 0xffc0) === 0xfe80 || (a & 0xff00) === 0xff00) return false;
  if (a === 0x2001 && (b === 0x0db8 || b === 0)) return false;
  if (a === 0x2002) return false;
  if (a === 0 && b === 0 && c === 0 && g[3] === 0 && g[4] === 0 && (g[5] === 0xffff || g[5] === 0)) return ipv4Public(g[6] >> 8, g[6] & 255, g[7] >> 8);
  return true;
}

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) { const [a, b, c] = ip.split('.').map(Number); return ipv4Public(a, b, c); }
  if (family === 6) { const groups = expand6(ip); return groups !== null && ipv6Public(groups); }
  return false;
}

export function normalizePublicUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048 || !raw.trim()) throw new AppError('INVALID_INPUT');
  let parsed: URL;
  try { parsed = new URL(raw.trim()); } catch { throw new AppError('INVALID_INPUT'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new AppError('INVALID_INPUT');
  if (parsed.username || parsed.password || parsed.port) throw new AppError('INVALID_INPUT');
  const hostname = parsed.hostname;
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare) !== 0) { if (!isPublicAddress(bare)) throw new AppError('INVALID_INPUT'); }
  else {
    if (hostname === 'localhost' || hostname === 'metadata.google.internal' || /\.(localhost|local|internal|lan|home\.arpa|corp)$/.test(hostname)) throw new AppError('INVALID_INPUT');
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(hostname)) throw new AppError('INVALID_INPUT');
  }
  const url = parsed.origin + parsed.pathname + parsed.search;
  if (url.length > 2048) throw new AppError('INVALID_INPUT');
  return url;
}

// The hosted reader resolves independently, so checking every answer is a policy gate, not a socket pin.
export const dnsResolver: Resolver = async hostname => {
  const results = await Promise.allSettled([resolve4(hostname), resolve6(hostname)]);
  const addresses = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  if (addresses.length) return addresses;
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.every(result => ['ENOTFOUND', 'ENODATA'].includes((result.reason as NodeJS.ErrnoException)?.code ?? ''))) return [];
  throw failures[0].reason;
};

export async function validatePublicSource(url: string, resolve: Resolver = dnsResolver): Promise<ValidatedSource> {
  const normalized = normalizePublicUrl(url);
  const hostname = new URL(normalized).hostname;
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare) !== 0) return { url: normalized, hostname, addresses: [bare] };
  const addresses = await resolve(hostname);
  if (!addresses.length || addresses.some(address => !isPublicAddress(address))) throw new AppError('INVALID_INPUT');
  return { url: normalized, hostname, addresses };
}