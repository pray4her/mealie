import { expect, test } from 'vitest';
import { createHarness } from '../support/harness';
import { runTask05Checks } from '../cloud/task05-client-checks';
test('SDK_check_helper_exercises_real_recipe_domain_without_returning_identity_or_content', async () => {
  const h = createHarness(); let sequence = 0; const request = async () => 'task05-sdk-request-' + String(++sequence).padStart(4, '0');
  for (const uid of ['private-owner', 'private-member', 'private-outsider']) await h.seedIdentity({ uid });
  const owner = h.client('private-owner'); const member = h.client('private-member'); const outsider = h.client('private-outsider');
  await owner.family.create({ requestId: await request(), name: '家' });
  const invite = await owner.family.invite({ requestId: await request() }); await member.family.join({ requestId: await request(), token: invite.token });
  await outsider.family.create({ requestId: await request(), name: '别家' });
  const results = await runTask05Checks(owner, member, outsider, request);
  expect(results).toHaveLength(8); expect(results.every(row => row.status === 'passed')).toBe(true);
  const output = JSON.stringify(results); for (const privateText of ['private-owner', 'private-member', 'private-outsider', '盐适量', invite.token]) expect(output).not.toContain(privateText);
  expect(await h.rows('recipes')).toHaveLength(1);
  expect((await h.rows<{ version: number }>('recipes'))[0].version).toBe(3);
});
