import { readonly, ref, watch } from 'vue';
import type { ImportInput, ImportSubmit, ImportsApi, JobView } from 'home-contracts';
import type { AuthController } from '../auth/use-auth';
import type { createFamilyController } from '../family/use-family';
import type { SessionStorage } from '../../shared/session-boundary';
import { AppError, errorCode } from '../../shared/errors';
import { object, validId } from '../recipes/validation';
import { importSource, parseJob, submitInput } from './api';

type Recovery = { kind: 'pending'; input: ImportSubmit; savedAt: number } | { kind: 'job'; id: string };
export function createImportsController({ api, auth, family, storage, newRequestId }: {
  api: ImportsApi; auth: AuthController; family: ReturnType<typeof createFamilyController>; storage: SessionStorage; newRequestId(): Promise<string>;
}) {
  const recovery = ref<Recovery | null>(null); const job = ref<JobView | null>(null);
  let epoch = 0; let disposed = false;
  let flight: Promise<JobView> | null = null; let queryFlight: Promise<unknown> | null = null;
  const key = (uid: string, familyId: string, generation: string) => 'home.imports.latest.v1:' + [uid, familyId, generation].map(encodeURIComponent).join(':');
  function clear() { epoch++; job.value = null; recovery.value = null; flight = null; }
  const stop = watch([auth.phase, () => auth.identity.value?.uid, family.phase, family.view], clear, { flush: 'sync' });
  function current() {
    const view = family.view.value;
    if (disposed || auth.phase.value !== 'authenticated' || family.phase.value !== 'ready' || !view || auth.identity.value?.uid !== view.uid) throw new AppError('FAMILY_REQUIRED');
    return { uid: view.uid, familyId: view.familyId, generation: view.generation, key: key(view.uid, view.familyId, view.generation), epoch };
  }
  function sameScope(ctx: ReturnType<typeof current>) {
    return !disposed && auth.phase.value === 'authenticated' && auth.identity.value?.uid === ctx.uid && family.phase.value === 'ready'
      && family.view.value?.familyId === ctx.familyId && family.view.value.generation === ctx.generation;
  }
  const active = (ctx: ReturnType<typeof current>) => ctx.epoch === epoch && sameScope(ctx);
  function restore(): Recovery | null {
    const ctx = current(); const raw = storage.get(ctx.key); recovery.value = null;
    if (raw === undefined || raw === null || raw === '') return null;
    try {
      const row = object(raw, ['kind'], ['input', 'savedAt', 'id']);
      let value: Recovery;
      if (row.kind === 'job') { object(raw, ['kind', 'id']); value = { kind: 'job', id: validId(row.id) }; }
      else {
        object(raw, ['kind', 'input', 'savedAt']); if (row.kind !== 'pending' || typeof row.savedAt !== 'number' || !Number.isSafeInteger(row.savedAt) || row.savedAt > Date.now() || Date.now() - row.savedAt >= 7 * 86400000) throw new Error();
        const input = submitInput(row.input); if (input.familyId !== ctx.familyId || input.generation !== ctx.generation) throw new Error(); value = { kind: 'pending', input, savedAt: row.savedAt };
      }
      recovery.value = value; return value;
    } catch { storage.remove(ctx.key); throw new AppError('UNAVAILABLE'); }
  }
  function submit(source: ImportInput): Promise<JobView> {
    if (flight) return flight;
    const ctx = current(); const previous = restore(); const validated = previous?.kind === 'pending' ? null : importSource(source);
    const promise = Promise.resolve().then(async () => {
      const intent: Recovery = previous?.kind === 'pending' ? previous : { kind: 'pending', savedAt: Date.now(), input: { requestId: await newRequestId(), familyId: ctx.familyId, generation: ctx.generation, source: validated! } };
      if (!active(ctx)) throw new AppError('FAMILY_REQUIRED'); storage.set(ctx.key, intent); recovery.value = intent;
      try {
        const result = parseJob(await api.submit(intent.input));
        if (!active(ctx)) {
          if (sameScope(ctx)) {
            const saved = storage.get(ctx.key);
            if (saved && typeof saved === 'object' && 'kind' in saved && saved.kind === 'pending' && 'input' in saved && submitInput(saved.input).requestId === intent.input.requestId) {
              const acknowledged: Recovery = { kind: 'job', id: result.id }; storage.set(ctx.key, acknowledged);
              if (recovery.value?.kind === 'pending' && recovery.value.input.requestId === intent.input.requestId) recovery.value = acknowledged;
            }
          }
          throw new AppError('FAMILY_REQUIRED');
        }
        // Acknowledgment removes the original text; only the scoped recovery ID remains.
        const saved: Recovery = { kind: 'job', id: result.id }; storage.set(ctx.key, saved); recovery.value = saved; job.value = result; return result;
      } catch (error) {
        if (active(ctx) && ['CONFLICT', 'INVALID_INPUT'].includes(errorCode(error))) { storage.remove(ctx.key); recovery.value = null; } throw error;
      }
    }).finally(() => { if (flight === promise) flight = null; });
    flight = promise; return promise;
  }
  async function get(id: string): Promise<JobView | null> {
    const ctx = current(); validId(id);
    while (queryFlight) { await queryFlight.catch(() => {}); if (!active(ctx)) return null; }
    const promise = api.get(id); queryFlight = promise;
    try {
      const result = parseJob(await promise); if (!active(ctx)) return null; if (result.id !== id) throw new AppError('UNAVAILABLE');
      job.value = result;
      if (restore()?.kind !== 'pending') { const saved: Recovery = { kind: 'job', id }; storage.set(ctx.key, saved); recovery.value = saved; }
      return result;
    } finally { if (queryFlight === promise) queryFlight = null; }
  }
  return { recovery: readonly(recovery), job: readonly(job), restore, submit, get, clear,
    async cancel(id: string) {
      const ctx = current(); const requestId = await newRequestId(); if (!active(ctx)) return null;
      const result = parseJob(await api.cancel({ requestId, familyId: ctx.familyId, generation: ctx.generation, id: validId(id) }));
      if (!active(ctx)) return null; if (result.id !== id) throw new AppError('UNAVAILABLE'); job.value = result; return result;
    },
    dispose() { disposed = true; stop(); clear(); },
  };
}
