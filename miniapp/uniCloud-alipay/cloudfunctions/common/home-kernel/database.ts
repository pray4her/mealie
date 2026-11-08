export type CollectionName = 'families' | 'family_members' | 'family_invitations' | 'mutation_receipts' | 'request_limits';

export interface TransactionPort {
  get<T>(collection: CollectionName, id: string): Promise<T | null>;
  insert<T>(collection: CollectionName, id: string, value: T): Promise<void>;
  /** Update an existing fixed-shape record, retaining platform merge semantics.
   * Callers supply all mutable fields; omitted fields are preserved, never removed.
   * The value must retain the same _id, and a missing record is never inserted.
   */
  replace<T>(collection: CollectionName, id: string, value: T): Promise<void>;
  remove(collection: CollectionName, id: string): Promise<void>;
}

export interface DatabasePort {
  transaction<T>(fn: (tx: TransactionPort) => Promise<T>): Promise<T>;
}

export class DatabaseFault extends Error {
  constructor(public readonly kind: 'conflict' | 'commit-unknown' | 'unavailable', options?: ErrorOptions) {
    super(`Database ${kind}`, options);
    this.name = 'DatabaseFault';
  }
}

export async function retryDatabaseTransaction<T>(operation: () => Promise<T>, options: { maxAttempts: number; backoff: (attempt: number) => Promise<void> }): Promise<T> {
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 3) throw new DatabaseFault('unavailable');
  for (let attempt = 1; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (!(error instanceof DatabaseFault) || error.kind !== 'conflict' || attempt >= options.maxAttempts) throw error;
      await options.backoff(attempt);
    }
  }
}

export function databaseRecord(value: unknown, id: string): Record<string, unknown> & { _id: string } {
  if (!id || !value || typeof value !== 'object' || Array.isArray(value) || !('_id' in value) || value._id !== id) {
    throw new DatabaseFault('unavailable');
  }
  return value as Record<string, unknown> & { _id: string };
}
