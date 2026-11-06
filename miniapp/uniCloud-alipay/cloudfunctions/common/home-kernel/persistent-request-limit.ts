import type { DatabasePort } from './database';
import { AppError } from './errors';
import { requestLimitBucketId } from './idempotency';

interface RequestLimit {
  _id: string; subject: string; operation: string; windowStart: number; count: number; expiresAt: number;
}

export async function consumeRequestLimit(database: DatabasePort, input: { subject: string; operation: string; now: number; max: number }): Promise<void> {
  const { subject, operation, now, max } = input;
  if (!subject || !operation || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(max) || max < 1) throw new AppError('UNAVAILABLE');
  const id = requestLimitBucketId(subject, operation); const windowStart = Math.floor(now / 60_000) * 60_000;
  await database.transaction(async tx => {
    const previous = await tx.get<RequestLimit>('request_limits', id);
    if (previous && (typeof previous !== 'object' || Array.isArray(previous) || Object.keys(previous).length !== 6
      || !['_id', 'subject', 'operation', 'windowStart', 'count', 'expiresAt'].every(key => Object.hasOwn(previous, key))
      || previous._id !== id || previous.subject !== subject || previous.operation !== operation
      || !Number.isSafeInteger(previous.windowStart) || previous.windowStart < 0 || previous.windowStart % 60_000 !== 0
      || !Number.isSafeInteger(previous.count) || previous.count < 0 || previous.expiresAt !== previous.windowStart + 60_000)) throw new AppError('UNAVAILABLE');
    if (previous && (windowStart < previous.windowStart || (windowStart === previous.windowStart && previous.count >= max))) throw new AppError('QUOTA_EXCEEDED');
    const next: RequestLimit = { _id: id, subject, operation, windowStart, count: previous?.windowStart === windowStart ? previous.count + 1 : 1, expiresAt: windowStart + 60_000 };
    if (previous) await tx.replace('request_limits', id, next); else await tx.insert('request_limits', id, next);
  });
}
