import { expect, test } from 'vitest';
import { invitedFamilyFixture } from '../support/family-fixtures';
import { runTask04Checks } from '../cloud/task04-client-checks';

test('the_normal_sdk_check_sequence_exercises_actual_membership_services_and_returns_only_safe_results', async () => {
  const f = await invitedFamilyFixture(); let id = 0;
  const results = await runTask04Checks(f.owner, f.member, async () => `sdk-check-membership-${++id}`);
  expect(results.map(row => row.scenario)).toEqual(['owner-cannot-leave', 'member-forbidden', 'transfer-normal', 'remove-old-token', 'replay-after-rejoin', 'stale-first-delivery', 'owner-aba-invitations', 'leave-old-token']);
  expect(results.every(row => row.passed)).toBe(true);
  expect(results.every(row => Object.keys(row).every(key => ['scenario', 'passed', 'errorCode'].includes(key)))).toBe(true);
});
test('the_sdk_checks_refuse_to_mutate_unrelated_or_unprepared_accounts', async () => {
  const f = await invitedFamilyFixture(); let randomCalls = 0;
  const before = await f.owner.family.current();
  expect(await runTask04Checks(f.owner, f.outsider, async () => { randomCalls++; return 'must-not-generate'; })).toEqual([{ scenario: 'prepared-isolated-family', passed: false, errorCode: 'INVALID_INPUT' }]);
  expect(randomCalls).toBe(0); expect(await f.owner.family.current()).toEqual(before);
});
