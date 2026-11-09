import type { AppClient, FamilyContext, MembershipMutation, MemberMutation } from 'home-contracts';
import { errorCode } from '../../src/shared/errors';

type CheckResult = { scenario: string; passed: boolean; errorCode?: string };
/** Destructive membership checks for a dedicated isolated test family only. Never logs identity or credentials. */
export async function runTask04Checks(owner: AppClient, member: AppClient, newRequestId: () => Promise<string>): Promise<CheckResult[]> {
  const results: CheckResult[] = []; let scenario = 'prepared-isolated-family';
  const input = async (ctx: FamilyContext): Promise<MembershipMutation> => ({ requestId: await newRequestId(), familyId: ctx.familyId, generation: ctx.generation });
  const target = async (ctx: FamilyContext, other: FamilyContext): Promise<MemberMutation> => ({ ...await input(ctx), uid: other.uid, targetGeneration: other.generation });
  async function denied(action: () => Promise<unknown>, code: string) { try { await action(); return false; } catch (error) { return errorCode(error) === code; } }
  function verify(name: string, passed: boolean) { scenario = name; if (!passed) throw new Error(); results.push({ scenario: name, passed }); }
  try {
    const beforeOwner = await owner.family.current(); const beforeMember = await member.family.current();
    if (!beforeOwner || !beforeMember || beforeOwner.uid === beforeMember.uid || beforeOwner.role !== 'owner' || beforeMember.role !== 'member'
      || beforeOwner.familyId !== beforeMember.familyId) return [{ scenario, passed: false, errorCode: 'INVALID_INPUT' }];
    scenario = 'owner-cannot-leave';
    verify(scenario, await denied(async () => owner.family.leave(await input(beforeOwner)), 'FORBIDDEN'));
    scenario = 'member-forbidden';
    verify(scenario, await denied(async () => member.family.removeMember(await target(beforeMember, beforeOwner)), 'FORBIDDEN'));
    scenario = 'transfer-normal';
    const oldInvite = await owner.family.invite({ requestId: await newRequestId() });
    const transfer = await target(beforeOwner, beforeMember); const previousOwner = await owner.family.transferOwner(transfer);
    const nextOwner = (await member.family.current())!;
    const rows = await member.family.members();
    verify(scenario, previousOwner.role === 'member' && previousOwner.generation !== beforeOwner.generation && nextOwner.role === 'owner'
      && nextOwner.generation !== beforeMember.generation && rows.filter(row => row.role === 'owner').length === 1
      && (await owner.family.transferOwner(transfer)).generation === previousOwner.generation);
    scenario = 'remove-old-token';
    const removal = await target(nextOwner, previousOwner); await member.family.removeMember(removal);
    verify(scenario, (await owner.account.session()).uid === beforeOwner.uid && await owner.family.current() === null
      && await denied(() => owner.family.members(), 'FAMILY_REQUIRED'));
    scenario = 'replay-after-rejoin';
    const invitation = await member.family.invite({ requestId: await newRequestId() });
    const rejoined = await owner.family.join({ requestId: await newRequestId(), token: invitation.token });
    await member.family.removeMember(removal);
    verify(scenario, rejoined.generation !== previousOwner.generation && (await owner.family.current())?.generation === rejoined.generation);
    scenario = 'stale-first-delivery';
    verify(scenario, await denied(async () => member.family.removeMember({ ...removal, requestId: await newRequestId() }), 'CONFLICT'));
    scenario = 'owner-aba-invitations';
    await member.family.transferOwner(await target(nextOwner, rejoined));
    const returnedMember = (await member.family.current())!;
    await member.family.leave(await input(returnedMember));
    verify(scenario, await denied(async () => member.family.join({ requestId: await newRequestId(), token: oldInvite.token }), 'INVITATION_INVALID'));
    scenario = 'leave-old-token';
    verify(scenario, (await member.account.session()).uid === beforeMember.uid && await member.family.current() === null
      && await denied(() => member.family.members(), 'FAMILY_REQUIRED'));
  } catch (error) { results.push({ scenario, passed: false, errorCode: errorCode(error) }); }
  return results;
}
