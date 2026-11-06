import { createHash } from 'node:crypto';

const digest = (parts: readonly string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export function familyCreateReceiptId(uid: string, requestId: string): string { return digest(['family-create-v1', uid, requestId]); }
export function familyCreatePayloadHash(name: string): string { return digest(['family-create-v1', name]); }
export function requestLimitBucketId(subject: string, operation: string): string { return digest(['request-limit-v1', subject, operation]); }
