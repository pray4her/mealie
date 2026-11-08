export type ErrorCode = 'AUTH_REQUIRED' | 'FAMILY_REQUIRED' | 'ALREADY_IN_FAMILY' | 'CONFLICT' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_INPUT' | 'INVITATION_INVALID' | 'QUOTA_EXCEEDED' | 'UNAVAILABLE';
export class AppError extends Error {
  constructor(public readonly code: ErrorCode) { super(code); this.name = 'AppError'; }
}
export function safeError(error: unknown): AppError {
  return error instanceof AppError ? error : new AppError('UNAVAILABLE');
}
