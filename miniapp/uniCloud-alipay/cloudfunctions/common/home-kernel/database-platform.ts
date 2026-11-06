import type { CollectionName, DatabasePort, TransactionPort } from './database';
import { DatabaseFault, databaseRecord, retryDatabaseTransaction } from './database';

interface PlatformDocument {
  get(): Promise<unknown>;
  update(value: Record<string, unknown>): Promise<unknown>;
  remove(): Promise<unknown>;
}
interface PlatformTransaction {
  collection(name: CollectionName): { doc(id: string): PlatformDocument; add(value: Record<string, unknown>): Promise<unknown> };
  commit(): Promise<unknown>;
  rollback(): Promise<unknown>;
}
export interface DatabasePlatform {
  collection(name: CollectionName): { doc(id: string): { get(): Promise<unknown> } };
  startTransaction(): Promise<PlatformTransaction>;
}
export interface DatabaseOptions {
  maxAttempts: number;
  backoff: (attempt: number) => Promise<void>;
  /** Exact SDK codes verified for this provider. Empty until cloud acceptance supplies evidence. */
  conflictCodes?: readonly (string | number)[];
}

function resultObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DatabaseFault('unavailable');
  if ('errCode' in value && value.errCode !== 0) throw new DatabaseFault('unavailable');
  return value as Record<string, unknown>;
}

function pointResult<T>(value: unknown, id: string, mode: 'ordinary' | 'transaction'): T | null {
  const result = resultObject(value);
  if (!('data' in result)) throw new DatabaseFault('unavailable');
  if (mode === 'ordinary') {
    if (!Array.isArray(result.data) || result.data.length > 1) throw new DatabaseFault('unavailable');
    return result.data.length === 0 ? null : databaseRecord(result.data[0], id) as T;
  }
  return result.data === null ? null : databaseRecord(result.data, id) as T;
}

export async function readDatabaseRecord<T>(platform: DatabasePlatform, collection: CollectionName, id: string): Promise<T | null> {
  try { return pointResult<T>(await platform.collection(collection).doc(id).get(), id, 'ordinary'); }
  catch (error) { throw error instanceof DatabaseFault ? error : new DatabaseFault('unavailable', { cause: error }); }
}

export function createDatabasePort(platform: DatabasePlatform, options: DatabaseOptions): DatabasePort {
  const isConflict = (error: unknown): boolean => {
    if (error instanceof DatabaseFault) return error.kind === 'conflict';
    if (!error || typeof error !== 'object') return false;
    const code = 'code' in error ? error.code : 'errCode' in error ? error.errCode : undefined;
    return options.conflictCodes?.some(known => known === code) ?? false;
  };
  async function sdk<T>(call: () => Promise<T>): Promise<T> {
    try { return await call(); }
    catch (error) { throw new DatabaseFault(isConflict(error) ? 'conflict' : 'unavailable', { cause: error }); }
  }
  return {
    transaction: fn => retryDatabaseTransaction(async () => {
      let transaction: PlatformTransaction;
      try { transaction = await platform.startTransaction(); }
      catch (error) { throw new DatabaseFault(isConflict(error) ? 'conflict' : 'unavailable', { cause: error }); }
      let committing = false;
      try {
        const tx: TransactionPort = {
          async get<T>(collection: CollectionName, id: string): Promise<T | null> {
            return pointResult<T>(await sdk(() => transaction.collection(collection).doc(id).get()), id, 'transaction');
          },
          async insert(collection, id, value) {
            const row = databaseRecord(value, id);
            const result = resultObject(await sdk(() => transaction.collection(collection).add({ ...row })));
            if (result.id !== id) throw new DatabaseFault('unavailable');
          },
          async replace(collection, id, value) {
            const { _id: _id, ...fields } = databaseRecord(value, id);
            const result = resultObject(await sdk(() => transaction.collection(collection).doc(id).update(fields)));
            if (result.updated === 0) throw new DatabaseFault('conflict');
            if (result.updated !== 1) throw new DatabaseFault('unavailable');
          },
          async remove(collection, id) {
            const result = resultObject(await sdk(() => transaction.collection(collection).doc(id).remove()));
            if (result.deleted !== 0 && result.deleted !== 1) throw new DatabaseFault('unavailable');
          },
        };
        const result = await fn(tx);
        committing = true;
        const acknowledgement = await transaction.commit();
        // alipay validates success and resolves Promise<void>; validate any returned acknowledgement.
        if (acknowledgement !== undefined) resultObject(acknowledgement);
        return result;
      } catch (error) {
        // A rollback acknowledgement cannot prove that a previously attempted commit did not happen.
        try { await transaction.rollback(); } catch { /* Preserve the original failure. */ }
        if (isConflict(error)) throw new DatabaseFault('conflict', { cause: error });
        if (committing) throw new DatabaseFault('commit-unknown', { cause: error });
        throw error;
      }
    }, options),
  };
}
