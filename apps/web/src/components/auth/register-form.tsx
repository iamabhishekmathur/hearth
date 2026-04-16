import { useState, type FormEvent } from 'react';

interface RegisterFormProps {
  onSubmit: (email: string, password: string, name: string) => Promise<void>;
  onSwitchToLogin: () => void;
}

export function RegisterForm({ onSubmit, onSwitchToLogin }: RegisterFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onSubmit(email, password, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
          Name
        </label>
        <input
          id="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm outline-none transition-colors focus:border-hearth-400 focus:ring-2 focus:ring-hearth-100"
          placeholder="Your name"
        />
      </div>

      <div>
        <label htmlFor="reg-email" className="block text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="reg-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm outline-none transition-colors focus:border-hearth-400 focus:ring-2 focus:ring-hearth-100"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label htmlFor="reg-password" className="block text-sm font-medium text-gray-700">
          Password
        </label>
        <input
          id="reg-password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm outline-none transition-colors focus:border-hearth-400 focus:ring-2 focus:ring-hearth-100"
          placeholder="Minimum 8 characters"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-hearth-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-hearth-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? 'Creating account...' : 'Create account'}
      </button>

      <p className="text-center text-sm text-gray-500">
        Already have an account?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="font-medium text-hearth-600 hover:text-hearth-700"
        >
          Sign in
        </button>
      </p>
    </form>
  );
}
