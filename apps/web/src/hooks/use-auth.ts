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
import type { AuthResponse, SessionUser } from '@hearth/shared';

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<AuthResponse>('/auth/me')
      .then((res) => {
        if (res.data) {
          setUser(res.data as SessionUser);
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
      setUser(me.data as SessionUser);
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
        setUser(me.data as SessionUser);
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  return createElement(
    AuthContext.Provider,
    { value: { user, loading, login, register, logout } },
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
