import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import { Layout } from './components/Layout.jsx';
import { ErrorState, Spinner } from './components/States.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { SignupPage } from './pages/SignupPage.jsx';
import { WalletPage } from './pages/WalletPage.jsx';
import { RidePage } from './pages/passenger/RidePage.jsx';
import { HistoryPage } from './pages/passenger/HistoryPage.jsx';
import { RideDetailPage } from './pages/passenger/RideDetailPage.jsx';

const HOME = { PASSENGER: '/ride', DRIVER: '/driver' };

/** Only render children for the given role; send everyone else to their own home. */
function RequireRole({ role, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={HOME[user.role]} replace />;
  return children;
}

export default function App() {
  const { user, isLoading, error } = useAuth();

  if (isLoading) return <Spinner label="Starting up…" />;
  if (error)
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorState error={error} title="Cannot reach Dhaka Tesla Pool" onRetry={() => window.location.reload()} />
      </div>
    );

  if (!user) {
    return (
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/ride" element={<RequireRole role="PASSENGER"><RidePage /></RequireRole>} />
        <Route path="/history" element={<RequireRole role="PASSENGER"><HistoryPage /></RequireRole>} />
        <Route path="/rides/:rideId" element={<RequireRole role="PASSENGER"><RideDetailPage /></RequireRole>} />
        <Route path="/wallet" element={<RequireRole role="PASSENGER"><WalletPage /></RequireRole>} />
      </Route>
      <Route path="*" element={<Navigate to={HOME[user.role] ?? '/login'} replace />} />
    </Routes>
  );
}