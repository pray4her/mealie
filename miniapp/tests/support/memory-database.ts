import type { CollectionName, DatabasePort } from '../../uniCloud-alipay/cloudfunctions/common/home-kernel/database';
import { DatabaseFault, databaseRecord, retryDatabaseTransaction } from '../../uniCloud-alipay/cloudfunctions/common/home-kernel/database';

type Row = Record<string, unknown> & { _id: string };
type FailureStage = `${'insert' | 'replace' | 'remove'}:${CollectionName}` | 'commit' | 'after-commit';
const keyOf = (collection: CollectionName, id: string) => JSON.stringify([collection, id]);

export function createMemoryDatabase() {
  const records = new Map<string, Row>();
  const versions = new Map<string, number>();
  let nextBarrier: { entered: () => void; wait: Promise<void> } | null = null;
  let failure: { stage: FailureStage; error: Error } | null = null;
  const failAt = (stage: FailureStage) => {
    if (failure?.stage === stage) { const error = failure.error; failure = null; throw error; }
  };
  const database: DatabasePort = {
    async transaction(fn) {
      const barrier = nextBarrier; nextBarrier = null;
      let firstAttempt = true;
      return retryDatabaseTransaction(async () => {
        const snapshot = new Map([...records].map(([key, row]) => [key, structuredClone(row)]));
        const snapshotVersions = new Map(versions);
        const changes = new Map<string, Row | null>();
        const reads = new Set<string>();
        const result = await fn({
          async get<T>(collection: CollectionName, id: string): Promise<T | null> {
            const key = keyOf(collection, id);
            reads.add(key);
            return structuredClone(changes.has(key) ? changes.get(key) : snapshot.get(key) ?? null) as T | null;
          },
          async insert(collection, id, value) {
            failAt(`insert:${collection}`);
            const key = keyOf(collection, id);
            if (changes.has(key) ? changes.get(key) !== null : snapshot.has(key)) throw new DatabaseFault('conflict');
            changes.set(key, structuredClone(databaseRecord(value, id)));
          },
          async replace(collection, id, value) {
            failAt(`replace:${collection}`);
            const key = keyOf(collection, id);
            const previous = changes.has(key) ? changes.get(key) : snapshot.get(key);
            if (!previous) throw new DatabaseFault('conflict');
            changes.set(key, { ...previous, ...structuredClone(databaseRecord(value, id)) });
          },
          async remove(collection, id) { failAt(`remove:${collection}`); changes.set(keyOf(collection, id), null); },
        });
        if (firstAttempt && barrier) { firstAttempt = false; barrier.entered(); await barrier.wait; }
        // Comparison and application deliberately have no await between them.
        for (const key of new Set([...reads, ...changes.keys()])) {
          if (versions.get(key) !== snapshotVersions.get(key)) throw new DatabaseFault('conflict');
        }
        failAt('commit');
        for (const [key, row] of changes) {
          if (row === null) records.delete(key); else records.set(key, row);
          versions.set(key, (versions.get(key) ?? 0) + 1);
        }
        failAt('after-commit');
        return result;
      }, { maxAttempts: 3, backoff: async () => {} });
    },
  };
  return {
    database,
    failNext(stage: FailureStage, error = new DatabaseFault(stage === 'after-commit' ? 'commit-unknown' : 'unavailable')): void { failure = { stage, error }; },
    seed<T>(collection: CollectionName, id: string, row: T): void {
      const key = keyOf(collection, id); records.set(key, structuredClone(databaseRecord(row, id)));
      versions.set(key, (versions.get(key) ?? 0) + 1);
    },
    barrierNextCommit() {
      let entered!: () => void; let release!: () => void;
      const reached = new Promise<void>(resolve => { entered = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      if (nextBarrier) throw new Error('Commit barrier already scheduled');
      nextBarrier = { entered, wait };
      return { reached, release };
    },
    async rows<T = Row>(collection: CollectionName): Promise<T[]> {
      return [...records].filter(([key]) => JSON.parse(key)[0] === collection).map(([, row]) => structuredClone(row) as T);
    },
  };
}
