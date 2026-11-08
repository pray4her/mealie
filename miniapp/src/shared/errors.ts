export type ErrorCode = 'AUTH_REQUIRED' | 'FAMILY_REQUIRED' | 'ALREADY_IN_FAMILY' | 'CONFLICT' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_INPUT' | 'INVITATION_INVALID' | 'QUOTA_EXCEEDED' | 'UNAVAILABLE';
export class AppError extends Error {
  constructor(public readonly code: ErrorCode) { super(code); this.name = 'AppError'; }
}
export function errorCode(error: unknown): ErrorCode {
  if (error && typeof error === 'object') {
    const code = 'code' in error ? error.code : 'errCode' in error ? error.errCode : null;
    if (['AUTH_REQUIRED', 'FAMILY_REQUIRED', 'ALREADY_IN_FAMILY', 'CONFLICT', 'NOT_FOUND', 'FORBIDDEN', 'INVALID_INPUT', 'INVITATION_INVALID', 'QUOTA_EXCEEDED', 'UNAVAILABLE'].includes(String(code))) return code as ErrorCode;
  }
  return 'UNAVAILABLE';
}
