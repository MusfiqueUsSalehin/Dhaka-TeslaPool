import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { ErrorBanner } from '../components/States.jsx';

// The story cast from the seed data — one tap to sign in as anyone during a demo.
const DEMO = [
  { name: 'Nusrat', phone: '01711000002', hint: 'Passenger · Banani → Mohakhali' },
  { name: 'Rafiq', phone: '01711000003', hint: 'Passenger · Banani → Gulshan 1' },
  { name: 'Shirin', phone: '01711000004', hint: 'Passenger · wants the last seat' },
  { name: 'Jashim', phone: '01711000001', hint: 'Driver · Tesla "Bullet", 3 seats' },
];
const DEMO_PASSWORD = 'tesla1234';

export function LoginPage() {
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e) => {
    e.preventDefault();
    login.mutate({ phone, password });
  };

  return (
    <AuthShell title="Sign in" subtitle="Share a seat. Split the fare. Survive Dhaka traffic.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="field-label" htmlFor="phone">
            Mobile number
          </label>
          <input id="phone" className="input" inputMode="tel" autoComplete="username" placeholder="01711000002" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="password">
            Password
          </label>
          <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <ErrorBanner error={login.error} />
        <button type="submit" className="btn-primary w-full" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="mt-6">
        <p className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">Demo accounts (password {DEMO_PASSWORD})</p>
        <div className="grid grid-cols-2 gap-2">
          {DEMO.map((d) => (
            <button
              key={d.phone}
              type="button"
              className="rounded-xl border border-stone-200 bg-stone-50 p-2.5 text-left hover:border-brand-600 hover:bg-brand-50 disabled:opacity-50"
              disabled={login.isPending}
              onClick={() => login.mutate({ phone: d.phone, password: DEMO_PASSWORD })}
            >
              <span className="block text-sm font-semibold">{d.name}</span>
              <span className="block text-[11px] leading-tight text-stone-500">{d.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-stone-600">
        New passenger?{' '}
        <Link to="/signup" className="font-semibold text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

export function AuthShell({ title, subtitle, children }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <img src="/bullet.png" alt="Bullet, a three-seat battery Tesla" className="h-14 w-20 rounded-lg object-cover shadow" />
          <div>
            <h1 className="text-xl font-bold">Dhaka Tesla Pool</h1>
            <p className="muted">{subtitle}</p>
          </div>
        </div>
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}
