import type { AuthController } from '../features/auth/use-auth';
export function createRouteGuard(auth: AuthController, navigate: (url: string) => void) {
  return { async ensureAuthenticated(): Promise<boolean> {
    const confirmed = await auth.restore();
    if (!confirmed && auth.phase.value === 'anonymous') navigate('/pages/account/login');
    return confirmed;
  } };
}
