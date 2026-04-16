import { useAuth } from '@/hooks/use-auth';
import { RegisterForm } from '@/components/auth/register-form';

interface RegisterPageProps {
  onNavigate: (route: string) => void;
}

export function RegisterPage({ onNavigate }: RegisterPageProps) {
  const { register } = useAuth();

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
          <h2 className="mb-5 text-lg font-semibold text-gray-900">
            Create account
          </h2>
          <RegisterForm
            onSubmit={register}
            onSwitchToLogin={() => onNavigate('/login')}
          />
        </div>
      </div>
    </div>
  );
}
