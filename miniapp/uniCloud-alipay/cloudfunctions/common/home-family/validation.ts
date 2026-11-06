import type { Mutation } from 'home-contracts';
import { AppError } from 'home-kernel';

export function validateCreationInput(value: unknown): Mutation & { name: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'requestId') || !Object.hasOwn(value, 'name')
    || !('requestId' in value) || typeof value.requestId !== 'string' || value.requestId.length < 16 || value.requestId.length > 128
    || /[^A-Za-z0-9_-]/.test(value.requestId) || !('name' in value) || typeof value.name !== 'string') throw new AppError('INVALID_INPUT');
  const name = value.name.trim();
  if (!name || [...name].length > 40 || /\p{Cc}/u.test(name)) throw new AppError('INVALID_INPUT');
  return { requestId: value.requestId, name };
}
