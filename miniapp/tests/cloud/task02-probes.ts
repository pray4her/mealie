// Test-only runner. Stage outside the formal cloud root; imports resolve to the SAME deployed modules.
import type { Identity } from 'home-contracts';
import type { CollectionName, ContentPort, DatabasePort } from 'home-kernel';
import { AppError, DatabaseFault, consumeRequestLimit, familyCreateReceiptId, requestLimitBucketId } from 'home-kernel';
import { createFamilyService, readFamily } from 'home-family';
import type { SafeCheckResult } from './task02-client-checks';
import { safeCheckError } from './task02-client-checks';

export interface ProbeScope {
  uid: string; familyIds: string[]; generationIds: string[]; requestIds: string[]; name: string; allowCleanup: boolean;
}
interface Options {
  database: DatabasePort; identity: Identity; scope: ProbeScope; content: ContentPort;
  revalidateIdentity: () => Promise<void>; now: () => number;
}
type Row = Record<string, unknown>;

/** scope is fixed trusted server configuration, NEVER a client payload. UID is verified before constructing. */
export function createTask02Probes(options: Options) {
  const { database, identity, scope } = options;
  if (!identity.uid || scope.uid !== identity.uid || !scope.familyIds.length || !scope.generationIds.length || !scope.requestIds.length
    || [scope.familyIds, scope.generationIds, scope.requestIds].some(ids => ids.length > 20 || new Set(ids).size !== ids.length || ids.some(id => !/^[A-Za-z0-9_-]{16,128}$/.test(id)))
    || !scope.name.trim() || [...scope.name.trim()].length > 40 || /\p{Cc}/u.test(scope.name)) throw new AppError('FORBIDDEN');
  const receiptIds = scope.requestIds.map(requestId => familyCreateReceiptId(identity.uid, requestId));
  async function counts() {
    return database.transaction(async tx => ({
      families: (await Promise.all(scope.familyIds.map(id => tx.get('families', id)))).filter(Boolean).length,
      members: await tx.get('family_members', identity.uid) ? 1 : 0,
      receipts: (await Promise.all(receiptIds.map(id => tx.get('mutation_receipts', id)))).filter(Boolean).length,
    }));
  }
  async function fresh() {
    await options.revalidateIdentity();
    const before = await counts();
    if (Object.values(before).some(Boolean)) throw new AppError('CONFLICT');
  }
  const zero = (value: Awaited<ReturnType<typeof counts>>) => value.families === 0 && value.members === 0 && value.receipts === 0;
  return {
    counts,
    async failure(stage: 'family' | 'member' | 'receipt' | 'commit-ack-lost'): Promise<SafeCheckResult> {
      const scenario = stage === 'commit-ack-lost' ? 'C-commit-ack-lost' : `C-rollback-${stage}`;
      try {
        await fresh();
        let injected = false;
        const collection: CollectionName = stage === 'family' ? 'families' : stage === 'member' ? 'family_members' : 'mutation_receipts';
        const wrapped: DatabasePort = { async transaction(fn) {
          let wroteFamily = false;
          const result = await database.transaction(tx => fn({
            ...tx,
            async insert<T>(name: CollectionName, id: string, value: T) {
              await tx.insert(name, id, value);
              if (name === 'families') wroteFamily = true;
              if (!injected && stage !== 'commit-ack-lost' && name === collection) { injected = true; throw new AppError('UNAVAILABLE'); }
            },
          }));
          if (!injected && stage === 'commit-ack-lost' && wroteFamily) { injected = true; throw new DatabaseFault('commit-unknown'); }
          return result;
        } };
        let index = 0;
        const ids = [scope.familyIds[0], scope.generationIds[0]];
        const service = createFamilyService({ ...options, database: wrapped, newId() { const id = ids[index++]; if (!id) throw new AppError('UNAVAILABLE'); return id; } }, identity);
        let code: string | undefined;
        let committed = false;
        try { const result = await service.create({ requestId: scope.requestIds[0], name: scope.name }); committed = result.familyId === ids[0] && result.uid === identity.uid; }
        catch (error) { code = safeCheckError(error); }
        const after = await counts();
        return { scenario, passed: injected && (stage === 'commit-ack-lost' ? committed && after.families === 1 && after.members === 1 && after.receipts === 1 : code === 'UNAVAILABLE' && zero(after)), ...(code ? { errorCode: code } : {}), counts: after };
      } catch (error) { return { scenario, passed: false, errorCode: safeCheckError(error) }; }
    },
    async primaryKey(): Promise<SafeCheckResult> {
      const scenario = 'C-primary-key';
      try {
        await fresh();
        const row = { _id: scope.familyIds[0], name: scope.name, ownerUid: identity.uid, status: 'active', version: 1, createdAt: options.now(), updatedAt: options.now() };
        await database.transaction(tx => tx.insert('families', row._id, row));
        let rejected = false;
        try { await database.transaction(tx => tx.insert('families', row._id, { ...row, version: 2 })); } catch { rejected = true; }
        const saved = await database.transaction(tx => tx.get<Row>('families', row._id));
        const unchanged = saved !== null && Object.keys(saved).length === Object.keys(row).length && Object.entries(row).every(([key, value]) => saved[key] === value);
        return { scenario, passed: rejected && unchanged, counts: await counts() };
      } catch (error) { return { scenario, passed: false, errorCode: safeCheckError(error) }; }
    },
    async consumeCurrent(): Promise<SafeCheckResult> {
      try {
        await options.revalidateIdentity();
        await consumeRequestLimit(database, { subject: `uid:${identity.uid}`, operation: 'family:current', now: options.now(), max: 60 });
        return { scenario: 'D-cross-instance-consume', passed: true };
      } catch (error) { return { scenario: 'D-cross-instance-consume', passed: false, errorCode: safeCheckError(error) }; }
    },
    async prefillFamilyCurrent(): Promise<SafeCheckResult> {
      try {
        await options.revalidateIdentity();
        await database.transaction(async tx => {
          const current = await readFamily(tx, identity.uid);
          if (!current || current.role !== 'owner' || !scope.familyIds.includes(current.familyId)) throw new AppError('FORBIDDEN');
          const subject = `family:${current.familyId}`; const operation = 'family:current';
          const id = requestLimitBucketId(subject, operation); const windowStart = Math.floor(options.now() / 60_000) * 60_000;
          const row = { _id: id, subject, operation, windowStart, count: 299, expiresAt: windowStart + 60_000 };
          if (await tx.get('request_limits', id)) await tx.replace('request_limits', id, row); else await tx.insert('request_limits', id, row);
        });
        return { scenario: 'D-family-bucket-prefill', passed: true };
      } catch (error) { return { scenario: 'D-family-bucket-prefill', passed: false, errorCode: safeCheckError(error) }; }
    },
    async cleanup(): Promise<SafeCheckResult> {
      const scenario = 'E-scoped-record-cleanup';
      try {
        if (!scope.allowCleanup) throw new AppError('FORBIDDEN');
        await options.revalidateIdentity();
        await database.transaction(async tx => {
          const removals: [CollectionName, string][] = [];
          async function checked(collection: CollectionName, id: string, predicate: (row: Row) => boolean) {
            const row = await tx.get<Row>(collection, id);
            if (row) { if (!predicate(row)) throw new AppError('FORBIDDEN'); removals.push([collection, id]); }
          }
          for (const id of scope.familyIds) await checked('families', id, row => row.ownerUid === identity.uid);
          await checked('family_members', identity.uid, row => typeof row.familyId === 'string' && scope.familyIds.includes(row.familyId) && scope.generationIds.includes(String(row.generation)));
          for (let index = 0; index < receiptIds.length; index++) await checked('mutation_receipts', receiptIds[index], row => row.uid === identity.uid && row.requestId === scope.requestIds[index]
            && row.operation === 'family-create-v1' && !!row.result && typeof row.result === 'object' && (row.result as Row).uid === identity.uid
            && scope.familyIds.includes(String((row.result as Row).familyId)) && scope.generationIds.includes(String((row.result as Row).generation)));
          for (const [subject, operation] of [[`uid:${identity.uid}`, 'family:create'], [`uid:${identity.uid}`, 'family:current'], ...scope.familyIds.map(id => [`family:${id}`, 'family:current'])]) {
            await checked('request_limits', requestLimitBucketId(subject, operation), row => row.subject === subject && row.operation === operation);
          }
          // Validate every owner/generation first. All removals are exact document IDs in this transaction.
          for (const [collection, id] of removals) await tx.remove(collection, id);
        });
        const after = await counts();
        return { scenario, passed: zero(after), counts: after };
      } catch (error) { return { scenario, passed: false, errorCode: safeCheckError(error) }; }
    },
  };
}

export type Task02Probes = ReturnType<typeof createTask02Probes>;
