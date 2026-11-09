import type { AppClient, RecipeInput } from 'home-contracts';
type Check = { scenario: string; status: 'passed' | 'failed' };
const code = (error: unknown) => error && typeof error === 'object' ? ('code' in error ? error.code : 'errCode' in error ? error.errCode : null) : null;
/** Explicit SDK checks for dedicated isolated-space accounts; never auto-run or log recipe/identity data. */
export async function runTask05Checks(owner: AppClient, member: AppClient, outsider: AppClient, newRequestId: () => Promise<string>): Promise<Check[]> {
  const a = await owner.family.current(); const b = await member.family.current(); const c = await outsider.family.current();
  if (!a || !b || !c || a.familyId !== b.familyId || a.familyId === c.familyId) throw new Error('Dedicated two-family accounts required');
  const recipe: RecipeInput = { title: '验收菜谱', description: null, baseServings: null, prepMinutes: 0, cookMinutes: null,
    ingredients: [{ raw: '盐适量', name: '盐', quantity: null, unit: null, note: null }], steps: ['将食材煮熟。'], tags: [] };
  const input = { requestId: await newRequestId(), familyId: a.familyId, generation: a.generation, recipe };
  const created = await owner.recipes.create(input); const read = await member.recipes.get(created.id);
  const edit = { requestId: await newRequestId(), familyId: b.familyId, generation: b.generation, id: created.id, version: created.version, recipe: { ...recipe, title: '共同修改后的验收菜谱' } };
  const updated = await member.recipes.update(edit);
  const checks: Check[] = [
    { scenario: 'create-read-update', status: read.id === created.id && updated.version === created.version + 1 && updated.createdBy === created.createdBy ? 'passed' : 'failed' },
    { scenario: 'unknown-quantity', status: updated.ingredients[0]?.raw === '盐适量' && updated.ingredients[0]?.quantity === null ? 'passed' : 'failed' },
  ];
  async function rejects(scenario: string, expected: string, action: () => Promise<unknown>) {
    try { await action(); checks.push({ scenario, status: 'failed' }); }
    catch (error) { checks.push({ scenario, status: code(error) === expected ? 'passed' : 'failed' }); }
  }
  await rejects('cross-family', 'NOT_FOUND', () => outsider.recipes.get(created.id));
  await rejects('forged-ownership', 'CONFLICT', () => owner.recipes.create({ ...input, requestId: input.requestId, familyId: c.familyId }));
  await rejects('stale-edit', 'CONFLICT', async () => member.recipes.update({ ...edit, requestId: await newRequestId() }));
  const replay = await owner.recipes.create(input);
  checks.push({ scenario: 'same-request', status: replay.id === created.id && (await owner.recipes.get(created.id)).version === updated.version ? 'passed' : 'failed' });
  await rejects('conflicting-payload', 'CONFLICT', () => owner.recipes.create({ ...input, recipe: { ...recipe, title: '更改原请求' } }));
  const requests = [await newRequestId(), await newRequestId()];
  const race = await Promise.allSettled([
    owner.recipes.update({ requestId: requests[0], familyId: a.familyId, generation: a.generation, id: created.id, version: updated.version, recipe: { ...recipe, title: '所有者的并发编辑' } }),
    member.recipes.update({ ...edit, requestId: requests[1], version: updated.version, recipe: { ...recipe, title: '成员的并发编辑' } }),
  ]);
  checks.push({ scenario: 'same-version-race', status: race.filter(result => result.status === 'fulfilled').length === 1
    && race.some(result => result.status === 'rejected' && code(result.reason) === 'CONFLICT') ? 'passed' : 'failed' });
  return checks;
}
