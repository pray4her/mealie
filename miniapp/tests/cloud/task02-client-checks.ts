import type { AppClient, FamilyView, Mutation } from 'home-contracts';

export type SafeCheckResult = { scenario: string; passed: boolean; errorCode?: string; counts?: { families: number; members: number; receipts: number } };
type Input = Mutation & { name: string };
const knownCodes = ['AUTH_REQUIRED', 'FAMILY_REQUIRED', 'ALREADY_IN_FAMILY', 'CONFLICT', 'NOT_FOUND', 'FORBIDDEN', 'INVALID_INPUT', 'QUOTA_EXCEEDED', 'UNAVAILABLE'];
export function safeCheckError(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = 'code' in error ? error.code : 'errCode' in error ? error.errCode : undefined;
    if (typeof code === 'string' && knownCodes.includes(code)) return code;
  }
  return 'UNAVAILABLE';
}
const equal = (a: FamilyView, b: FamilyView) => ['uid', 'familyId', 'role', 'generation', 'name'].every(key => a[key as keyof FamilyView] === b[key as keyof FamilyView]);

async function fresh(client: AppClient): Promise<string | null> {
  try {
    const identity = await client.account.session();
    if (!identity.uid || await client.family.current() !== null) return 'FRESH_STATE_REQUIRED';
    return null;
  } catch (error) { return safeCheckError(error); }
}

/** Same-ID race and sequential recovery. This does not claim a different-ID race or DB counts. */
export async function runTask02Checks(client: AppClient, inputs: { sameRequest: Input; otherRequest: Input }): Promise<SafeCheckResult[]> {
  const errorCode = await fresh(client);
  if (errorCode) return [{ scenario: 'B-fresh-account', passed: false, errorCode }];
  if (inputs.sameRequest.requestId === inputs.otherRequest.requestId) return [{ scenario: 'B-inputs', passed: false, errorCode: 'INVALID_INPUT' }];
  const outputs: SafeCheckResult[] = [];
  const race = await Promise.allSettled([client.family.create(inputs.sameRequest), client.family.create(inputs.sameRequest)]);
  const first = race[0]; const second = race[1];
  outputs.push({ scenario: 'B-same-request', passed: first.status === 'fulfilled' && second.status === 'fulfilled' && equal(first.value, second.value),
    ...((first.status === 'rejected' || second.status === 'rejected') ? { errorCode: safeCheckError(first.status === 'rejected' ? first.reason : second.status === 'rejected' ? second.reason : undefined) } : {}) });
  if (first.status !== 'fulfilled' || second.status !== 'fulfilled') return outputs;
  try { outputs.push({ scenario: 'B-replay', passed: equal(first.value, await client.family.create(inputs.sameRequest)) }); }
  catch (error) { outputs.push({ scenario: 'B-replay', passed: false, errorCode: safeCheckError(error) }); }
  try { await client.family.create(inputs.otherRequest); outputs.push({ scenario: 'B-other-request-after-create', passed: false }); }
  catch (error) { const code = safeCheckError(error); outputs.push({ scenario: 'B-other-request-after-create', passed: code === 'ALREADY_IN_FAMILY', errorCode: code }); }
  try { const current = await client.family.current(); outputs.push({ scenario: 'E-current-consistent', passed: current !== null && equal(first.value, current) }); }
  catch (error) { outputs.push({ scenario: 'E-current-consistent', passed: false, errorCode: safeCheckError(error) }); }
  return outputs;
}

/** Each invocation needs a separate, already logged-in, confirmed no-family state. Never cleans data. */
export async function checkTask02Race(client: AppClient, inputs: readonly [Input, Input], kind: 'different-request' | 'conflicting-payload'): Promise<SafeCheckResult> {
  const scenario = `B-${kind}`;
  const errorCode = await fresh(client);
  if (errorCode) return { scenario, passed: false, errorCode };
  if ((kind === 'different-request' && inputs[0].requestId === inputs[1].requestId)
    || (kind === 'conflicting-payload' && (inputs[0].requestId !== inputs[1].requestId || inputs[0].name.trim() === inputs[1].name.trim()))) return { scenario, passed: false, errorCode: 'INVALID_INPUT' };
  const results = await Promise.allSettled(inputs.map(input => client.family.create(input)));
  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  const code = rejected.length === 1 ? safeCheckError(rejected[0].reason) : undefined;
  const expected = kind === 'different-request' ? 'ALREADY_IN_FAMILY' : 'CONFLICT';
  let consistent = false;
  if (fulfilled.length === 1) {
    try { const current = await client.family.current(); consistent = current !== null && equal(fulfilled[0].value, current); }
    catch { /* An unconfirmed read cannot pass this check. */ }
  }
  return { scenario, passed: fulfilled.length === 1 && rejected.length === 1 && code === expected && consistent, ...(code ? { errorCode: code } : {}) };
}
