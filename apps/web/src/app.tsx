import { useState, useEffect, useCallback, lazy, Suspense, Component, type ReactNode } from 'react';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { AppShell } from '@/components/layout/app-shell';
import { LoginPage } from '@/pages/login';
import { RegisterPage } from '@/pages/register';

// Lazy-load heavy pages for code-splitting
const ChatPage = lazy(() => import('@/pages/chat').then((m) => ({ default: m.ChatPage })));
const SettingsPage = lazy(() => import('@/pages/settings').then((m) => ({ default: m.SettingsPage })));
const SkillsPage = lazy(() => import('@/pages/skills').then((m) => ({ default: m.SkillsPage })));
const MemoryPage = lazy(() => import('@/pages/memory').then((m) => ({ default: m.MemoryPage })));
const WorkspacePage = lazy(() => import('@/pages/workspace').then((m) => ({ default: m.WorkspacePage })));
const SharedSessionPage = lazy(() => import('@/pages/shared-session').then((m) => ({ default: m.SharedSessionPage })));
const RoutinesPage = lazy(() => import('@/pages/routines').then((m) => ({ default: m.RoutinesPage })));
const ActivityPage = lazy(() => import('@/pages/activity').then((m) => ({ default: m.ActivityPage })));
const DecisionsPage = lazy(() => import('@/pages/decisions').then((m) => ({ default: m.DecisionsPage })));

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-gray-400">Loading...</p>
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
            <p className="text-sm font-medium text-red-600">Failed to load page</p>
            <p className="mt-1 text-xs text-gray-500">{this.state.error.message}</p>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="mt-3 rounded bg-hearth-600 px-3 py-1 text-xs text-white hover:bg-hearth-700"
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

  useEffect(() => {
    function handleHashChange() {
      setRoute(getHashRoute());
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = useCallback((path: string) => {
    window.location.hash = path;
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-hearth-600">Hearth</h1>
          <p className="mt-2 text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
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

  // Authenticated — show app shell with lazy-loaded pages
  return (
    <AppShell currentRoute={route} onNavigate={navigate}>
      <PageErrorBoundary>
        <Suspense fallback={<PageFallback />}>
          {route.startsWith('/chat') && <ChatPage />}
          {route === '/workspace' && <WorkspacePage />}
          {route === '/memory' && <MemoryPage />}
          {route === '/skills' && <SkillsPage />}
          {route === '/routines' && <RoutinesPage />}
          {route === '/activity' && <ActivityPage />}
          {route === '/decisions' && <DecisionsPage />}
          {route.startsWith('/settings') && <SettingsPage initialTab={route.split('/')[2]} />}
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
