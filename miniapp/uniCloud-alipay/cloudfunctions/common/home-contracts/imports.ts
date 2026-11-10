import type { MembershipMutation } from './family';

export type ImportInput = { kind: 'text'; text: string } | { kind: 'image'; fileId: string } | { kind: 'url'; url: string };
export type ImportState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ImportError = 'UNRECOGNIZED' | 'MULTIPLE_RECIPES' | 'INVALID_OUTPUT' | 'TRUNCATED' | 'PROVIDER_UNAVAILABLE' | 'AUDIT_REJECTED' | 'AUDIT_UNAVAILABLE' | 'AUDIT_VISIT_REQUIRED' | 'MEMBERSHIP_CHANGED' | 'BUDGET_EXCEEDED' | 'INPUT_EXPIRED';
export type JobView = { id: string; state: ImportState; attempts: number; recipeId: string | null; createdAt: number; updatedAt: number; error: ImportError | null };
export type ImportSubmit = MembershipMutation & { source: ImportInput };
export interface ImportsApi {
  submit(input: ImportSubmit): Promise<JobView>;
  get(id: string): Promise<JobView>;
  cancel(input: MembershipMutation & { id: string }): Promise<JobView>;
}
