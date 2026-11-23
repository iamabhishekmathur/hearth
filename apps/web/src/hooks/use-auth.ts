import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { createElement } from 'react';
import { api, ApiError } from '@/lib/api-client';
import { identify, reset } from '@/lib/analytics';
import { trackEvent, AnalyticsEvent } from '@/lib/analytics-events';
import type { AuthResponse, SessionUser } from '@hearth/shared';

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-fetch the current user (e.g. after the setup wizard establishes a session). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Associate analytics events with the signed-in user. No-op without a PostHog key. */
function identifyUser(u: SessionUser): void {
  identify(u.id, {
    email: u.email,
    name: u.name,
    role: u.role,
    org_id: u.orgId ?? undefined,
    team_id: u.teamId ?? undefined,
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<AuthResponse>('/auth/me')
      .then((res) => {
        if (res.data) {
          const u = res.data as SessionUser;
          setUser(u);
          identifyUser(u);
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          // Not authenticated — expected
        } else {
          // Auth check failed — user will see login page
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await api.post<AuthResponse>('/auth/login', { email, password });
    // Login response only has { id } — fetch full profile
    const me = await api.get<AuthResponse>('/auth/me');
    if (me.data) {
      const u = me.data as SessionUser;
      setUser(u);
      identifyUser(u);
    }
  }, []);

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      await api.post<AuthResponse>('/auth/register', {
        email,
        password,
        name,
      });
      // Fetch full profile after registration
      const me = await api.get<AuthResponse>('/auth/me');
      if (me.data) {
        const u = me.data as SessionUser;
        setUser(u);
        identifyUser(u);
        trackEvent(AnalyticsEvent.USER_SIGNED_UP, { method: 'register' });
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
    reset();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<AuthResponse>('/auth/me');
      if (me.data) {
        const u = me.data as SessionUser;
        setUser(u);
        identifyUser(u);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }, []);

  return createElement(
    AuthContext.Provider,
    { value: { user, loading, login, register, logout, refresh } },
    children,
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
