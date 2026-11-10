import type { AuthController } from '../features/auth/use-auth';
import type { createFamilyController } from '../features/family/use-family';
export function createRouteGuard(auth: AuthController, navigate: (url: string) => void, family?: ReturnType<typeof createFamilyController>, membership?: { resume(): Promise<boolean> }, isCurrent: () => boolean = () => true) {
  return { async ensureAuthenticated(): Promise<boolean> {
    const confirmed = await auth.restore();
    if (!isCurrent()) return false;
    if (!confirmed && auth.phase.value === 'anonymous') navigate('/pages/account/login');
    return confirmed;
  }, async ensureFamily(destination: 'onboarding' | 'home'): Promise<boolean> {
    if (!family || !isCurrent()) return false;
    try {
      await family.load();
      if (!isCurrent()) return false;
      if (auth.phase.value === 'authenticated' && family.phase.value === 'ready' && membership) {
        const resumed = await membership.resume();
        if (!isCurrent()) return false;
        if (resumed) await family.load();
      }
    } catch { if (isCurrent() && auth.phase.value === 'anonymous') navigate('/pages/account/login'); return false; }
    if (!isCurrent()) return false;
    if (auth.phase.value === 'anonymous') navigate('/pages/account/login');
    if (auth.phase.value !== 'authenticated' || family.phase.value !== 'ready') return false;
    const actual = family.view.value ? 'home' : 'onboarding';
    if (actual !== destination) { navigate(actual === 'home' ? '/pages/recipes/index' : '/pages/family/onboarding'); return false; }
    return true;
  } };
}
