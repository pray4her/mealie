import { expect, test, vi } from 'vitest';

const dns = vi.hoisted(() => ({ resolve4: vi.fn(), resolve6: vi.fn() }));
vi.mock('node:dns/promises', () => dns);

import { dnsResolver, isPublicAddress, normalizePublicUrl, validatePublicSource } from '../../uniCloud-alipay/cloudfunctions/common/home-imports/urls';
import { createJinaReader } from '../../uniCloud-alipay/cloudfunctions/common/home-imports/reader';
import { createHarness } from '../support/harness';
import { defaultConfig } from '../../uniCloud-alipay/cloudfunctions/common/home-imports/model';
import type { ImportConfig, Job } from '../../uniCloud-alipay/cloudfunctions/common/home-imports/model';
import { ImportFailure } from '../../uniCloud-alipay/cloudfunctions/common/home-imports/provider';
import type { Provider } from '../../uniCloud-alipay/cloudfunctions/common/home-imports/provider';
import type { Resolver } from '../../uniCloud-alipay/cloudfunctions/common/home-imports/urls';
import urlFixtures from '../fixtures/ai-url.json';

function invalid(fn: () => unknown) {
  try { fn(); } catch (error) { expect(error).toMatchObject({ code: 'INVALID_INPUT' }); return; }
  throw new Error('expected INVALID_INPUT');
}

test.each([
  'http://169.254.169.254/', 'http://127.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://10.0.0.1/', 'http://172.16.0.1/', 'http://192.168.1.1/',
  'http://100.64.0.1/', 'http://0.0.0.0/', 'http://224.0.0.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://127.1/', 'http://0177.0.0.1/',
  'http://localhost/', 'http://foo.localhost/', 'http://printer.local/', 'http://nas.internal/', 'http://router.lan/', 'http://x.home.arpa/', 'http://server.corp/',
  'http://metadata.google.internal/', 'ftp://example.com/', 'https://user:pass@example.com/', 'https://example.com:8080/', 'http://intranet/',
  '', '   ', 'not a url', 'https://' + 'a'.repeat(2048) + '.com/',
])('rejects_private_and_metadata_urls %#', url => { invalid(() => normalizePublicUrl(url)); });

test('normalizes_scheme_host_default_port_and_fragment_but_preserves_path_and_query', () => {
  expect(normalizePublicUrl('HTTPS://Example.COM:443/Recipe?id=1#frag')).toBe('https://example.com/Recipe?id=1');
  expect(normalizePublicUrl('http://example.com:80/x')).toBe('http://example.com/x');
  expect(normalizePublicUrl('https://example.com/a/')).toBe('https://example.com/a/');
  expect(normalizePublicUrl('https://93.184.216.34/x')).toBe('https://93.184.216.34/x');
  expect(normalizePublicUrl('https://[2606:4700:4700::1111]/x')).toBe('https://[2606:4700:4700::1111]/x');
});

test.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'])('is_public_address_accepts_public %#', ip => {
  expect(isPublicAddress(ip)).toBe(true);
});
test.each([
  '0.0.0.0', '10.1.2.3', '100.64.1.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.0.0.1', '192.0.2.1', '192.168.0.1', '198.18.0.1', '198.51.100.1',
  '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1', '2001:0:1::1',
  '2002:7f00:1::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::127.0.0.1', 'not-an-ip',
])('is_public_address_rejects_private_or_reserved %#', ip => {
  expect(isPublicAddress(ip)).toBe(false);
});

test('validate_public_source_requires_all_dns_answers_public_and_nonempty', async () => {
  const resolve = vi.fn(async () => ['93.184.216.34', '2606:4700:4700::1111']);
  await expect(validatePublicSource('https://example.com/recipe', resolve)).resolves.toEqual({ url: 'https://example.com/recipe', hostname: 'example.com', addresses: ['93.184.216.34', '2606:4700:4700::1111'] });
  await expect(validatePublicSource('https://example.com/', async () => ['127.0.0.1'])).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(validatePublicSource('https://example.com/', async () => ['93.184.216.34', '10.0.0.1'])).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(validatePublicSource('https://example.com/', async () => [])).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});

test('validate_public_source_skips_dns_for_ip_literals', async () => {
  const resolve = vi.fn(async () => ['1.2.3.4']);
  await expect(validatePublicSource('https://93.184.216.34/x', resolve)).resolves.toMatchObject({ addresses: ['93.184.216.34'] });
  expect(resolve).not.toHaveBeenCalled();
});

test('dns_rebinding_to_private_address_is_rejected_on_revalidation', async () => {
  let answers = ['93.184.216.34'];
  const resolve = async () => answers;
  await validatePublicSource('https://example.com/', resolve);
  answers = ['169.254.169.254'];
  await expect(validatePublicSource('https://example.com/', resolve)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});

test('dns_resolver_merges_families_and_classifies_notfound_vs_transient', async () => {
  dns.resolve4.mockResolvedValueOnce(['93.184.216.34']);
  dns.resolve6.mockRejectedValueOnce(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
  await expect(dnsResolver('example.com')).resolves.toEqual(['93.184.216.34']);
  dns.resolve4.mockRejectedValueOnce(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
  dns.resolve6.mockRejectedValueOnce(Object.assign(new Error('ENODATA'), { code: 'ENODATA' }));
  await expect(dnsResolver('missing.example')).resolves.toEqual([]);
  dns.resolve4.mockRejectedValueOnce(Object.assign(new Error('SERVFAIL'), { code: 'SERVFAIL' }));
  dns.resolve6.mockRejectedValueOnce(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
  await expect(dnsResolver('flaky.example')).rejects.toMatchObject({ code: 'SERVFAIL' });
});

const urlSource = { url: 'https://example.com/recipe', hostname: 'example.com', addresses: ['93.184.216.34'] };
const readerOk = (data: Record<string, unknown>) => JSON.stringify({ code: 200, status: 20000, data });

test('jina_reader_requests_json_with_trim_budget_headers_and_returns_final_url_and_content', async () => {
  const request = vi.fn(async () => ({ status: 200, body: readerOk({ url: 'https://example.com/final', title: '菜', content: '盐汤做法' }) }));
  await expect(createJinaReader({ apiKey: () => undefined, request }).read(urlSource)).resolves.toEqual({ sourceUrl: 'https://example.com/final', read: true, content: '盐汤做法' });
  expect(request).toHaveBeenCalledWith('https://r.jinaai.cn/https://example.com/recipe', { Accept: 'application/json', 'X-Timeout': '20', 'X-Retain-Images': 'none', 'X-Max-Tokens': '8000', 'X-Base': 'final', 'X-Assert-Status-Code': '200' });
});

test('jina_reader_sends_bearer_key_only_when_present_and_rejects_header_injection', async () => {
  const request = vi.fn(async () => ({ status: 200, body: readerOk({ url: urlSource.url, content: 'x' }) }));
  await createJinaReader({ apiKey: () => 'jina-key', request }).read(urlSource);
  expect(request).toHaveBeenCalledWith('https://r.jinaai.cn/' + urlSource.url, expect.objectContaining({ Authorization: 'Bearer jina-key' }));
  await expect(createJinaReader({ apiKey: () => 'bad\r\nkey', request }).read(urlSource)).rejects.toMatchObject({ code: 'SOURCE_UNREADABLE', retryable: false });
  expect(request).toHaveBeenCalledTimes(1);
});

test.each(['', '   ', null, undefined])('jina_reader_reports_unreadable_for_blank_or_missing_content %#', async content => {
  const request = vi.fn(async () => ({ status: 200, body: readerOk({ url: urlSource.url, title: 't', content }) }));
  await expect(createJinaReader({ apiKey: () => undefined, request }).read(urlSource)).resolves.toEqual({ sourceUrl: urlSource.url, read: false, content: null });
});

test('jina_reader_rejects_target_http_error_body_even_when_api_returns_200', async () => {
  const request = vi.fn(async () => ({ status: 200, body: readerOk({ url: urlSource.url, content: 'Not found', warning: 'Target URL returned error 404: Not Found' }) }));
  await expect(createJinaReader({ apiKey: () => undefined, request }).read(urlSource)).rejects.toMatchObject({ code: 'SOURCE_UNREADABLE', retryable: false });
});

test.each([[429, true], [500, true], [503, true], [501, false], [505, false], [403, false], [404, false]])('jina_reader_classifies_http_%#_as_retryable_%s', async (status, retryable) => {
  const request = vi.fn(async () => ({ status: status as number, body: '' }));
  await expect(createJinaReader({ apiKey: () => undefined, request }).read(urlSource)).rejects.toMatchObject({ code: 'SOURCE_UNREADABLE', retryable });
});

test('jina_reader_network_failure_is_retryable_and_malformed_output_is_terminal', async () => {
  const failing = vi.fn(async () => { throw new Error('timeout'); });
  await expect(createJinaReader({ apiKey: () => undefined, request: failing }).read(urlSource)).rejects.toMatchObject({ code: 'SOURCE_UNREADABLE', retryable: true });
  for (const body of ['not json', JSON.stringify({ code: 403, status: 40300, data: null }), readerOk({ url: 'ftp://x', content: 'x' }), readerOk({ content: 'x' }), 'x'.repeat(262145), JSON.stringify({ code: 200, status: 20000 })]) {
    const request = vi.fn(async () => ({ status: 200, body }));
    await expect(createJinaReader({ apiKey: () => undefined, request }).read(urlSource)).rejects.toMatchObject({ code: 'SOURCE_UNREADABLE', retryable: false });
  }
});

const publicResolver: Resolver = async () => ['93.184.216.34'];
const recipeResult = () => ({ recipe: { title: '盐汤', description: null, baseServings: null, prepMinutes: null, cookMinutes: null,
  ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['加水煮开。'], tags: [] },
usage: { inputTokens: 20, outputTokens: 40, costUsd: 0.001, providerRequestId: 'fixture-request' } });

function readerFrom(responses: { status: number; body: unknown }[]) {
  const calls: string[] = []; let index = 0;
  const reader = createJinaReader({ apiKey: () => undefined, request: async url => {
    calls.push(url); const response = responses[Math.min(index++, responses.length - 1)];
    return { status: response.status, body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body) };
  } });
  return { reader, calls };
}

async function urlSetup(options: { responses?: { status: number; body: unknown }[]; provider?: Provider; config?: () => ImportConfig; resolver?: Resolver } = {}) {
  const { reader, calls } = readerFrom(options.responses ?? [urlFixtures.readable]);
  const h = createHarness({ importsConfig: options.config ?? (() => ({ ...defaultConfig(), enabled: true, urlEnabled: true })),
    importsReader: reader, importsResolver: options.resolver ?? publicResolver, importsProvider: options.provider });
  await h.seedIdentity({ uid: 'alice' }); const client = h.client('alice');
  const home = await client.family.create({ requestId: 'imports-home-create-01', name: '家' });
  const input = (requestId = 'imports-submit-url-0001', url = 'https://example.com/recipe') => ({ requestId, familyId: home.familyId, generation: home.generation, source: { kind: 'url' as const, url } });
  return { h, client, home, input, calls, submit: (requestId?: string, url?: string) => client.imports.submit(input(requestId, url)) };
}

test('url_import_reads_page_and_saves_recipe_with_submitted_url_provenance', async () => {
  const f = await urlSetup(); const job = await f.submit();
  expect(job).toMatchObject({ state: 'queued', attempts: 0 });
  await f.h.runImports();
  const result = await f.client.imports.get(job.id);
  expect(result).toMatchObject({ state: 'succeeded', attempts: 1, error: null });
  expect(await f.h.rows('recipes')).toHaveLength(1);
  expect(await f.client.recipes.get(result.recipeId!)).toMatchObject({ source: { kind: 'url', url: 'https://example.com/recipe', importJobId: job.id, warnings: [] } });
  expect(f.calls).toEqual(['https://r.jinaai.cn/https://example.com/recipe']);
  expect(await f.h.rows('ai_usage')).toMatchObject([{ costUsd: 0.001, settled: true }]);
  expect((await f.h.rows<Job>('import_jobs'))[0]).toMatchObject({ sourceText: null, sourceUrl: null });
});

test.each(['blank', 'blocked'] as const)('unreadable_source_cannot_succeed %#', async key => {
  const f = await urlSetup({ responses: [urlFixtures[key]] }); const job = await f.submit();
  await f.h.runImports();
  expect(await f.client.imports.get(job.id)).toMatchObject({ state: 'failed', error: 'SOURCE_UNREADABLE', attempts: 1 });
  expect(await f.h.rows('recipes')).toHaveLength(0);
});

test('reader_failure_releases_provider_budget_without_calling_provider', async () => {
  const provider = { parse: vi.fn(async () => recipeResult()) };
  const f = await urlSetup({ responses: [urlFixtures.blocked], provider,
    config: () => ({ ...defaultConfig(), enabled: true, urlEnabled: true, reserveUsd: 1, userUsd: 1 }) });
  await f.submit(); await f.h.runImports();
  expect(provider.parse).not.toHaveBeenCalled();
  expect(await f.h.rows('ai_usage')).toMatchObject([{ costUsd: 0, settled: true }]);
  expect(await f.h.rows('quota_buckets')).toEqual(expect.arrayContaining([expect.objectContaining({ heldUsd: 0, spentUsd: 0 })]));
  await f.submit('imports-submit-url-0002'); await f.h.runImports();
  expect(await f.h.rows('ai_usage')).toHaveLength(2);
});

test('redirect_to_private_address_is_rejected', async () => {
  const f = await urlSetup({ responses: [urlFixtures.redirectPrivate] }); const job = await f.submit();
  await f.h.runImports();
  expect(await f.client.imports.get(job.id)).toMatchObject({ state: 'failed', error: 'SOURCE_UNREADABLE' });
  expect(await f.h.rows('recipes')).toHaveLength(0);
});

test('private_dns_resolution_fails_before_reader_call', async () => {
  const f = await urlSetup({ resolver: async () => ['10.0.0.1'] }); const job = await f.submit();
  await f.h.runImports();
  expect(await f.client.imports.get(job.id)).toMatchObject({ state: 'failed', error: 'SOURCE_UNREADABLE', attempts: 1 });
  expect(f.calls).toHaveLength(0);
  expect(await f.h.rows('recipes')).toHaveLength(0);
});

test('url_submit_rejects_private_literal_without_job_or_quota', async () => {
  const f = await urlSetup();
  await expect(f.submit('imports-submit-url-0002', 'http://169.254.169.254/')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(await f.h.rows('import_jobs')).toHaveLength(0);
  expect(await f.h.rows('quota_buckets')).toHaveLength(0);
});

test('url_capability_switch_blocks_submit_and_claim', async () => {
  let urlEnabled = true;
  const f = await urlSetup({ config: () => ({ ...defaultConfig(), enabled: true, urlEnabled }) });
  const job = await f.submit(); urlEnabled = false;
  await expect(f.submit('imports-submit-url-0002')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  await f.h.runImports();
  expect((await f.client.imports.get(job.id)).attempts).toBe(0);
  expect(f.calls).toHaveLength(0);
  urlEnabled = true; await f.h.runImports();
  expect((await f.client.imports.get(job.id)).state).toBe('succeeded');
});

test('url_replay_is_idempotent_and_changed_url_conflicts', async () => {
  const f = await urlSetup(); const job = await f.submit();
  expect(await f.submit()).toEqual(job);
  await expect(f.submit('imports-submit-url-0001', 'https://example.com/other')).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await f.h.rows('import_jobs')).toHaveLength(1);
});

test('reader_rate_limit_requeues_with_backoff_then_succeeds', async () => {
  const f = await urlSetup({ responses: [urlFixtures.rateLimited, urlFixtures.readable] }); const job = await f.submit();
  await f.h.runImports();
  expect(await f.client.imports.get(job.id)).toMatchObject({ state: 'queued', attempts: 1 });
  f.h.advance(59999); await f.h.runImports();
  expect((await f.client.imports.get(job.id)).attempts).toBe(1);
  f.h.advance(1); await f.h.runImports();
  expect(await f.client.imports.get(job.id)).toMatchObject({ state: 'succeeded', attempts: 2 });
  expect(f.calls).toHaveLength(2);
});

test('provider_retry_reuses_checkpointed_reader_content', async () => {
  let parses = 0;
  const f = await urlSetup({ provider: { async parse() { if (++parses === 1) throw new ImportFailure('PROVIDER_UNAVAILABLE', true); return recipeResult(); } } });
  const job = await f.submit();
  await f.h.runImports();
  expect(await f.client.imports.get(job.id)).toMatchObject({ state: 'queued', attempts: 1 });
  f.h.advance(60000); await f.h.runImports();
  expect(await f.client.imports.get(job.id)).toMatchObject({ state: 'succeeded', attempts: 2 });
  expect(f.calls).toHaveLength(1);
});

test('long_page_content_is_truncated_to_16kib_with_warning', async () => {
  const f = await urlSetup({ responses: [{ status: 200, body: { code: 200, status: 20000, data: { url: 'https://example.com/recipe', title: '盐汤', content: '字'.repeat(6000) } } }] });
  const job = await f.submit(); await f.h.runImports();
  const result = await f.client.imports.get(job.id);
  expect(result.state).toBe('succeeded');
  const recipe = await f.client.recipes.get(result.recipeId!);
  expect(recipe.source.warnings.some(warning => warning.includes('截断'))).toBe(true);
});

test('reader_final_url_difference_is_recorded_as_warning', async () => {
  const f = await urlSetup({ responses: [urlFixtures.moved] }); const job = await f.submit(); await f.h.runImports();
  const result = await f.client.imports.get(job.id);
  expect(result.state).toBe('succeeded');
  const recipe = await f.client.recipes.get(result.recipeId!);
  expect(recipe.source).toMatchObject({ kind: 'url', url: 'https://example.com/recipe' });
  expect(recipe.source.warnings.some(warning => warning.includes('实际读取地址'))).toBe(true);
});

test('cancel_clears_url_source_material', async () => {
  const f = await urlSetup(); const job = await f.submit();
  await f.client.imports.cancel({ requestId: 'imports-cancel-url-0001', familyId: f.home.familyId, generation: f.home.generation, id: job.id });
  expect((await f.h.rows<Job>('import_jobs'))[0]).toMatchObject({ state: 'cancelled', sourceText: null, sourceUrl: null });
});

test('expired_url_job_fails_and_clears_source', async () => {
  const f = await urlSetup(); const job = await f.submit();
  f.h.advance(7 * 86400000); await f.h.runImports();
  expect((await f.h.rows<Job>('import_jobs'))[0]).toMatchObject({ _id: job.id, state: 'failed', error: 'INPUT_EXPIRED', sourceText: null, sourceUrl: null });
});
