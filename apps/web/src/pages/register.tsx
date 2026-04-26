import { useAuth } from '@/hooks/use-auth';
import { RegisterForm } from '@/components/auth/register-form';
import { HEyebrow, HCard } from '@/components/ui/primitives';

interface RegisterPageProps {
  onNavigate: (route: string) => void;
}

export function RegisterPage({ onNavigate }: RegisterPageProps) {
  const { register } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-hearth-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-md text-white font-display font-semibold"
            style={{ background: 'var(--hearth-accent-grad)', fontSize: 20, letterSpacing: -0.5 }}
          >
            H
          </div>
          <h1 className="font-display text-[30px] font-medium" style={{ letterSpacing: '-0.8px', lineHeight: 1.1 }}>
            Hearth<span style={{ color: 'var(--hearth-accent)' }}>.</span>
          </h1>
          <p className="mt-2 text-sm text-hearth-text-muted">
            AI Productivity Platform for Teams
          </p>
        </div>

        <HCard className="p-6 shadow-hearth-1">
          <HEyebrow className="mb-1">Get Started</HEyebrow>
          <h2 className="mb-5 font-display text-lg font-medium text-hearth-text" style={{ letterSpacing: '-0.3px' }}>
            Create account<span style={{ color: 'var(--hearth-accent)' }}>.</span>
          </h2>
          <RegisterForm
            onSubmit={register}
            onSwitchToLogin={() => onNavigate('/login')}
          />
        </HCard>
      </div>
    </div>
  );
}
