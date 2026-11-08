import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from 'home-kernel';

export interface InvitationTokens {
  currentVersion(): string;
  derive(version: string, id: string): string;
  verify(token: string): { version: string; id: string };
}
export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
export function parseInvitationToken(token: unknown): { version: string; id: string } {
  if (typeof token !== 'string' || !/^v1\.[A-Za-z0-9_-]{1,32}\.[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError('INVITATION_INVALID');
  const [, version, id] = token.split('.');
  return { version, id };
}
export function createInvitationTokens(environment: () => { FAMILY_INVITATION_KEY_VERSION?: string; FAMILY_INVITATION_KEYS?: string }): InvitationTokens {
  function config() {
    try {
      const env = environment(); const keys: unknown = JSON.parse(env.FAMILY_INVITATION_KEYS ?? 'null');
      if (!keys || typeof keys !== 'object' || Array.isArray(keys) || !env.FAMILY_INVITATION_KEY_VERSION
        || !/^[A-Za-z0-9_-]{1,32}$/.test(env.FAMILY_INVITATION_KEY_VERSION)) throw new Error();
      return { version: env.FAMILY_INVITATION_KEY_VERSION, keys: keys as Record<string, unknown> };
    } catch { throw new AppError('UNAVAILABLE'); }
  }
  function derive(version: string, id: string): string {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(version) || !/^[a-f0-9]{32}$/.test(id)) throw new AppError('UNAVAILABLE');
    const value = config().keys[version];
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new AppError('UNAVAILABLE');
    const mac = createHmac('sha256', Buffer.from(value, 'hex')).update(JSON.stringify(['family-invitation-v1', version, id])).digest('base64url');
    return `v1.${version}.${id}.${mac}`;
  }
  return {
    currentVersion() { const version = config().version; derive(version, '0'.repeat(32)); return version; },
    derive,
    verify(token) {
      const parsed = parseInvitationToken(token); const expected = derive(parsed.version, parsed.id);
      if (!timingSafeEqual(Buffer.from(expected), Buffer.from(token))) throw new AppError('INVITATION_INVALID');
      return parsed;
    },
  };
}
