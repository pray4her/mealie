import { AppError } from './errors';
export function createRequestLimiter(options: { now: () => number; windowMs: number; maxPerWindow: number; maxKeys: number }) {
  const buckets = new Map<string, { until: number; count: number }>();
  return { consume(key: string): void {
    const now = options.now();
    for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= options.maxKeys) throw new AppError('QUOTA_EXCEEDED');
      bucket = { until: now + options.windowMs, count: 0 }; buckets.set(key, bucket);
    }
    if (bucket.count >= options.maxPerWindow) throw new AppError('QUOTA_EXCEEDED');
    bucket.count++;
  } };
}
