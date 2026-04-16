import { useState, type FormEvent } from 'react';

interface LoginFormProps {
  onSubmit: (email: string, password: string) => Promise<void>;
  onSwitchToRegister: () => void;
}

export function LoginForm({ onSubmit, onSwitchToRegister }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onSubmit(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
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
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm outline-none transition-colors focus:border-hearth-400 focus:ring-2 focus:ring-hearth-100"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm outline-none transition-colors focus:border-hearth-400 focus:ring-2 focus:ring-hearth-100"
          placeholder="Enter your password"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-hearth-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-hearth-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? 'Signing in...' : 'Sign in'}
      </button>

      <p className="text-center text-sm text-gray-500">
        Don't have an account?{' '}
        <button
          type="button"
          onClick={onSwitchToRegister}
          className="font-medium text-hearth-600 hover:text-hearth-700"
        >
          Create one
        </button>
      </p>
    </form>
  );
}
