import type { AuthController } from '../features/auth/use-auth';
import type { createFamilyController } from '../features/family/use-family';
export function createRouteGuard(auth: AuthController, navigate: (url: string) => void, family?: ReturnType<typeof createFamilyController>) {
  return { async ensureAuthenticated(): Promise<boolean> {
    const confirmed = await auth.restore();
    if (!confirmed && auth.phase.value === 'anonymous') navigate('/pages/account/login');
    return confirmed;
  }, async ensureFamily(destination: 'onboarding' | 'home'): Promise<boolean> {
    if (!family) return false;
    try { await family.load(); } catch { /* A failed query never confirms absence. */ }
    if (auth.phase.value === 'anonymous') navigate('/pages/account/login');
    if (auth.phase.value !== 'authenticated' || family.phase.value !== 'ready') return false;
    const actual = family.view.value ? 'home' : 'onboarding';
    if (actual !== destination) { navigate(`/pages/family/${actual}`); return false; }
    return true;
  } };
}
