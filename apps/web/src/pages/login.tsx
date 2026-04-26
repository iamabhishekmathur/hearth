import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { LoginForm } from '@/components/auth/login-form';
import { api } from '@/lib/api-client';
import { HButton, HInput, HEyebrow, HAvatar, HToolPill } from '@/components/ui/primitives';

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
      const res = await api.get<{ data: { enabled: boolean; type: string | null } }>(`/auth/sso/check/${ssoSlug}`);
      if (res.data.enabled) {
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
    <div className="grid min-h-screen font-sans text-hearth-text" style={{ gridTemplateColumns: '1.05fr 1fr' }}>
      {/* Brand pane */}
      <div
        className="flex flex-col gap-9 overflow-hidden relative"
        style={{ background: 'linear-gradient(160deg, var(--hearth-accent-soft), var(--hearth-accent-soft-2) 60%)', padding: '56px' }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="grid place-items-center rounded-md text-white font-display font-semibold"
            style={{ width: 40, height: 40, background: 'var(--hearth-accent-grad)', fontSize: 20, letterSpacing: -0.5 }}
          >H</div>
          <div className="font-display text-[20px] font-medium" style={{ letterSpacing: -0.3 }}>Hearth</div>
        </div>

        <div className="mt-auto">
          <div className="font-display font-medium" style={{ fontSize: 44, letterSpacing: -1.3, lineHeight: 1.05 }}>
            The team's shared<br/>AI teammate<span style={{ color: 'var(--hearth-accent)' }}>.</span>
          </div>
          <p className="text-[15px] text-hearth-text-muted leading-relaxed mt-3.5 max-w-[420px]">
            Chat, skills, routines, and memory — one surface where your work compounds.
          </p>
        </div>

        {/* Sample card */}
        <div className="bg-hearth-card rounded-lg p-5 shadow-hearth-3 max-w-[440px]">
          <div className="flex items-start gap-3">
            <HAvatar kind="agent" size={32} />
            <div className="flex-1">
              <p className="text-[13.5px] leading-[1.55]">
                Q3 costs came in at <b>$2.48M</b>, up <span className="font-semibold" style={{ color: 'var(--hearth-accent)' }}>7.3%</span> QoQ. I caught a reclass on Aug 14 that flipped your Q2 comparison.
              </p>
              <div className="flex gap-1.5 mt-2">
                <HToolPill state="done">snowflake</HToolPill>
                <HToolPill state="done">memory</HToolPill>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Form pane */}
      <div className="flex flex-col gap-5 justify-center" style={{ padding: '64px 72px' }}>
        {!ssoMode ? (
          <>
            <div>
              <HEyebrow>Sign in</HEyebrow>
              <div className="font-display font-medium mt-1" style={{ fontSize: 36, letterSpacing: -1, lineHeight: 1.1 }}>
                Welcome back<span style={{ color: 'var(--hearth-accent)' }}>.</span>
              </div>
            </div>

            <div className="bg-hearth-card rounded-lg p-6 border border-hearth-border">
              <LoginForm
                onSubmit={login}
                onSwitchToRegister={() => onNavigate('/register')}
              />
            </div>

            <div className="flex items-center gap-2.5 text-[12px] text-hearth-text-faint">
              <div className="flex-1 h-px bg-hearth-border" />
              <span className="tracking-wider uppercase">or</span>
              <div className="flex-1 h-px bg-hearth-border" />
            </div>

            <HButton onClick={() => setSsoMode(true)} full>Sign in with SSO</HButton>

            <p className="text-[12.5px] text-hearth-text-muted text-center">
              By continuing you agree to the <span className="text-hearth-text font-medium">Terms</span> and <span className="text-hearth-text font-medium">Privacy Policy</span>.
            </p>

            <p className="text-[13px] text-hearth-text-muted text-center mt-auto">
              New to Hearth? <span className="font-semibold cursor-pointer" style={{ color: 'var(--hearth-accent)' }} onClick={() => onNavigate('/register')}>Request access →</span>
            </p>
          </>
        ) : (
          <>
            <div>
              <HEyebrow>SSO Login</HEyebrow>
              <div className="font-display font-medium mt-1" style={{ fontSize: 36, letterSpacing: -1, lineHeight: 1.1 }}>
                Organization sign-in<span style={{ color: 'var(--hearth-accent)' }}>.</span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <HInput
                label="Organization slug"
                placeholder="your-org"
                value={ssoSlug}
                onChange={(e) => setSsoSlug(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSSOCheck()}
                autoFocus
              />

              {ssoError && <p className="text-sm text-hearth-text-muted">{ssoError}</p>}

              <HButton variant="primary" onClick={handleSSOCheck} disabled={ssoChecking} iconRight="arrow-right" full>
                {ssoChecking ? 'Checking...' : 'Continue with SSO'}
              </HButton>

              <button
                type="button"
                onClick={() => { setSsoMode(false); setSsoError(null); }}
                className="text-sm text-hearth-text-muted hover:text-hearth-text"
              >
                Back to email login
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
