import type { FamilyView } from 'home-contracts';
import { createHarness } from './harness';

export async function familyFixture() {
  const h = createHarness();
  await h.seedIdentity({ uid: 'owner' });
  await h.seedIdentity({ uid: 'member' });
  await h.seedIdentity({ uid: 'outsider' });
  const family = { _id: 'home', name: '我家', ownerUid: 'owner', status: 'active', version: 1, createdAt: 1_800_000_000_000, updatedAt: 1_800_000_000_000 };
  const owner = { _id: 'owner', familyId: 'home', role: 'owner', generation: 'owner-generation', mutationSeq: 0, joinedAt: family.createdAt, updatedAt: family.createdAt };
  const member = { ...owner, _id: 'member', role: 'member', generation: 'member-generation' };
  h.memory.seed('families', 'home', family);
  h.memory.seed('family_members', 'owner', owner);
  h.memory.seed('family_members', 'member', member);
  const ownerView: FamilyView = { uid: 'owner', familyId: 'home', role: 'owner', generation: 'owner-generation', name: '我家' };
  const memberView: FamilyView = { ...ownerView, uid: 'member', role: 'member', generation: 'member-generation' };
  return {
    h, familyId: 'home', family,
    owner: h.client('owner'), member: h.client('member'), outsider: h.client('outsider'),
    ownerRecord: owner, memberRecord: member, ownerView, memberView,
  };
}

// Normal-flow fixture uses real create/invite/join; the seed fixture above also tests corrupt relationships.
export async function invitedFamilyFixture() {
  const h = createHarness();
  for (const uid of ['owner', 'member', 'outsider']) await h.seedIdentity({ uid });
  const owner = h.client('owner'); const member = h.client('member'); const outsider = h.client('outsider');
  const family = await owner.family.create({ requestId: 'fixture-create-00001', name: '我家' });
  const invitation = await owner.family.invite({ requestId: 'fixture-invite-00001' });
  await member.family.join({ requestId: 'fixture-member-00001', token: invitation.token });
  return { h, owner, member, outsider, familyId: family.familyId };
}
