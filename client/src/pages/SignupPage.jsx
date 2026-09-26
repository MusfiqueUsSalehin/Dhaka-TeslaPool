import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { ErrorBanner } from '../components/States.jsx';
import { AuthShell } from './LoginPage.jsx';

export function SignupPage() {
  const { signup } = useAuth();
  const [form, setForm] = useState({ name: '', phone: '', password: '' });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <AuthShell title="Create a passenger account" subtitle="Drivers are onboarded by our operations team.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          signup.mutate(form);
        }}
      >
        <div>
          <label className="field-label" htmlFor="name">
            Name
          </label>
          <input id="name" className="input" autoComplete="name" value={form.name} onChange={set('name')} required minLength={2} />
        </div>
        <div>
          <label className="field-label" htmlFor="phone">
            Mobile number
          </label>
          <input id="phone" className="input" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" value={form.phone} onChange={set('phone')} required />
        </div>
        <div>
          <label className="field-label" htmlFor="password">
            Password
          </label>
          <input id="password" type="password" className="input" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={8} />
          <p className="mt-1 text-xs text-stone-500">At least 8 characters.</p>
        </div>
        <ErrorBanner error={signup.error} />
        <button type="submit" className="btn-primary w-full" disabled={signup.isPending}>
          {signup.isPending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-stone-600">
        Already registered?{' '}
        <Link to="/login" className="font-semibold text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
