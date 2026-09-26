import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

const NAV = {
  PASSENGER: [
    { to: '/ride', label: 'Ride' },
    { to: '/history', label: 'History' },
    { to: '/wallet', label: 'TeslaPay' },
  ],
  DRIVER: [
    { to: '/driver', label: 'Dashboard', end: true },
    { to: '/driver/history', label: 'Trips' },
    { to: '/driver/wallet', label: 'Earnings' },
  ],
};

export function Layout() {
  const { user, logout } = useAuth();
  const links = NAV[user.role] ?? [];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <img src="/bullet.png" alt="" className="h-8 w-12 rounded object-cover" />
            <div className="leading-tight">
              <p className="text-sm font-bold">Dhaka Tesla Pool</p>
              <p className="text-[11px] text-stone-500">{user.role === 'DRIVER' ? 'Driver' : 'Passenger'} · {user.name}</p>
            </div>
          </div>
          <nav className="ml-auto hidden gap-1 sm:flex">
            {links.map((l) => (
              <NavItem key={l.to} {...l} />
            ))}
          </nav>
          <button type="button" className="btn-secondary ml-auto px-3 py-1.5 text-xs sm:ml-2" onClick={() => logout.mutate()}>
            Sign out
          </button>
        </div>
        <nav className="flex gap-1 border-t border-stone-100 px-2 py-1.5 sm:hidden">
          {links.map((l) => (
            <NavItem key={l.to} {...l} />
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({ to, label, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex-1 rounded-lg px-3 py-1.5 text-center text-sm font-medium sm:flex-none ${isActive ? 'bg-brand-50 text-brand-700' : 'text-stone-600 hover:bg-stone-100'}`
      }
    >
      {label}
    </NavLink>
  );
}
