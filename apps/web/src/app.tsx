import { useState, useEffect, useCallback, lazy, Suspense, Component, type ReactNode } from 'react';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { AppShell } from '@/components/layout/app-shell';
import { LoginPage } from '@/pages/login';
import { RegisterPage } from '@/pages/register';
import { SetupWizard } from '@/pages/setup-wizard';
import { api } from '@/lib/api-client';
import { findExtensionRoute } from '@/extensions/register';

// Lazy-load heavy pages for code-splitting
const ChatPage = lazy(() => import('@/pages/chat').then((m) => ({ default: m.ChatPage })));
const SettingsPage = lazy(() => import('@/pages/settings').then((m) => ({ default: m.SettingsPage })));
const SkillsPage = lazy(() => import('@/pages/skills').then((m) => ({ default: m.SkillsPage })));
const MemoryPage = lazy(() => import('@/pages/memory').then((m) => ({ default: m.MemoryPage })));
const TasksPage = lazy(() => import('@/pages/tasks').then((m) => ({ default: m.TasksPage })));
const SharedSessionPage = lazy(() => import('@/pages/shared-session').then((m) => ({ default: m.SharedSessionPage })));
const RoutinesPage = lazy(() => import('@/pages/routines').then((m) => ({ default: m.RoutinesPage })));
const ActivityPage = lazy(() => import('@/pages/activity').then((m) => ({ default: m.ActivityPage })));
const DecisionsPage = lazy(() => import('@/pages/decisions').then((m) => ({ default: m.DecisionsPage })));

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-hearth-text-faint">Loading...</p>
    </div>
  );
}

class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="text-sm font-medium text-hearth-err">Failed to load page</p>
            <p className="mt-1 text-xs text-hearth-text-muted">{this.state.error.message}</p>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="mt-3 rounded-md bg-hearth-text px-3 py-1.5 text-xs font-semibold text-hearth-text-inverse hover:opacity-90"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function getHashRoute(): string {
  const hash = window.location.hash.slice(1); // remove '#'
  return hash || '/';
}

function Router() {
  const { user, loading } = useAuth();
  const [route, setRoute] = useState(getHashRoute);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    function handleHashChange() {
      setRoute(getHashRoute());
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    api.get<{ data: { needsSetup: boolean } }>('/admin/setup/status')
      .then((res) => setNeedsSetup(res.data.needsSetup))
      .catch(() => setNeedsSetup(false));
  }, []);

  const navigate = useCallback((path: string) => {
    window.location.hash = path;
  }, []);

  // Loading state
  if (loading || needsSetup === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-hearth-bg">
        <div className="text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl text-white font-display font-medium text-[28px]" style={{ background: 'var(--hearth-accent-grad)', letterSpacing: -0.8 }}>H</div>
          <p className="mt-4 text-sm text-hearth-text-faint">Loading...</p>
        </div>
      </div>
    );
  }

  // First-run setup wizard (no users exist yet)
  if (needsSetup) {
    return <SetupWizard onComplete={() => setNeedsSetup(false)} />;
  }

  // Public shared session page (no auth required)
  if (route.startsWith('/shared/')) {
    const token = route.replace('/shared/', '');
    return (
      <PageErrorBoundary>
        <Suspense fallback={<PageFallback />}>
          <SharedSessionPage token={token} />
        </Suspense>
      </PageErrorBoundary>
    );
  }

  // Not authenticated — show auth pages
  if (!user) {
    if (route === '/register') {
      return <RegisterPage onNavigate={navigate} />;
    }
    return <LoginPage onNavigate={navigate} />;
  }

  // Redirect to /chat if on auth pages or root
  if (route === '/' || route === '/login' || route === '/register') {
    window.location.hash = '/chat';
    return null;
  }

  // Top-level segment drives entrance animation — deep-link changes within
  // /chat/:id or /settings/:tab should NOT re-trigger the page fade.
  const routeKey = '/' + (route.split('/')[1] || '');

  // Cloud (or any other downstream) can register routes via the extension
  // hook. Check that registry first; if a registered route matches, render
  // it instead of an OSS page. Lets cloud add /admin, /billing, etc.
  // without modifying this file.
  const extensionRoute = findExtensionRoute(route);

  // Authenticated — show app shell with lazy-loaded pages
  return (
    <AppShell currentRoute={route} onNavigate={navigate}>
      <PageErrorBoundary>
        <Suspense fallback={<PageFallback />}>
          <div key={routeKey} className="h-full animate-fade-in">
            {extensionRoute ? (
              extensionRoute.render()
            ) : (
              <>
                {route.startsWith('/chat') && <ChatPage />}
                {route === '/tasks' && <TasksPage />}
                {route === '/memory' && <MemoryPage />}
                {route === '/skills' && <SkillsPage />}
                {route === '/routines' && <RoutinesPage />}
                {route === '/activity' && <ActivityPage />}
                {route === '/decisions' && <DecisionsPage />}
                {route.startsWith('/settings') && <SettingsPage initialTab={route.split('/')[2]} />}
              </>
            )}
          </div>
        </Suspense>
      </PageErrorBoundary>
    </AppShell>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
