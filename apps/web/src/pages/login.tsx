import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { LoginForm } from '@/components/auth/login-form';
import { api } from '@/lib/api-client';

interface LoginPageProps {
  onNavigate: (route: string) => void;
}

export function LoginPage({ onNavigate }: LoginPageProps) {
  const { login } = useAuth();
  const [ssoSlug, setSsoSlug] = useState('');
  const [ssoMode, setSsoMode] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [ssoChecking, setSsoChecking] = useState(false);

  const handleSSOCheck = useCallback(async () => {
    if (!ssoSlug.trim()) return;
    setSsoChecking(true);
    setSsoError(null);
    try {
      const res = await api.get<{ data: { enabled: boolean; type: string | null } }>(
        `/auth/sso/check/${ssoSlug}`,
      );
      if (res.data.enabled) {
        // In a real implementation, this would redirect to the IdP
        // For now, show a message indicating SSO is configured
        setSsoError(`SSO (${res.data.type}) is configured for "${ssoSlug}". IdP redirect would happen here.`);
      } else {
        setSsoError('SSO is not configured for this organization.');
      }
    } catch {
      setSsoError('Failed to check SSO configuration.');
    } finally {
      setSsoChecking(false);
    }
  }, [ssoSlug]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-hearth-600">Hearth</h1>
          <p className="mt-2 text-sm text-gray-500">
            AI Productivity Platform for Teams
          </p>
        </div>

        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          {!ssoMode ? (
            <>
              <h2 className="mb-5 text-lg font-semibold text-gray-900">Sign in</h2>
              <LoginForm
                onSubmit={login}
                onSwitchToRegister={() => onNavigate('/register')}
              />

              <div className="mt-4 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={() => setSsoMode(true)}
                  className="w-full rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Sign in with SSO
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="mb-5 text-lg font-semibold text-gray-900">SSO Login</h2>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Organization slug
                  </label>
                  <input
                    type="text"
                    value={ssoSlug}
                    onChange={(e) => setSsoSlug(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSSOCheck()}
                    placeholder="your-org"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-hearth-500 focus:outline-none focus:ring-1 focus:ring-hearth-500"
                    autoFocus
                  />
                </div>

                {ssoError && (
                  <p className="text-sm text-gray-600">{ssoError}</p>
                )}

                <button
                  type="button"
                  onClick={handleSSOCheck}
                  disabled={ssoChecking}
                  className="w-full rounded-lg bg-hearth-600 py-2 text-sm font-medium text-white hover:bg-hearth-700 disabled:opacity-50"
                >
                  {ssoChecking ? 'Checking...' : 'Continue with SSO'}
                </button>

                <button
                  type="button"
                  onClick={() => { setSsoMode(false); setSsoError(null); }}
                  className="w-full text-sm text-gray-500 hover:text-gray-700"
                >
                  Back to email login
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
