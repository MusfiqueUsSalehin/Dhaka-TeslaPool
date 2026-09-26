import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { walletApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { EmptyState, ErrorBanner, ErrorState, Spinner } from '../components/States.jsx';
import { dateTime } from '../lib/format.js';

const TYPE_LABEL = { TOPUP: 'Top-up', RIDE_PAYMENT: 'Ride payment', RIDE_EARNING: 'Ride earning' };
const QUICK_TOPUPS = [10000, 20000, 50000]; // ৳100, ৳200, ৳500

/** TeslaPay: passengers top up and pay; Jashim sees what TeslaPay rides earned him. */
export function WalletPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: walletApi.get });
  const topUp = useMutation({ mutationFn: walletApi.topUp, onSuccess: (data) => qc.setQueryData(['wallet'], data) });
  const isDriver = user.role === 'DRIVER';

  if (wallet.isLoading) return <Spinner />;
  if (wallet.isError) return <ErrorState error={wallet.error} onRetry={wallet.refetch} />;
  const w = wallet.data;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <section className="card bg-gradient-to-br from-brand-600 to-brand-700 text-white">
        <p className="text-sm opacity-80">{isDriver ? 'TeslaPay earnings' : 'TeslaPay balance'}</p>
        <p className="mt-1 text-4xl font-bold tabular-nums">{w.balance}</p>
        <p className="mt-2 text-xs opacity-80">Simulated wallet — no real money moves. Cash rides are not shown here.</p>
        {!isDriver && (
          <div className="mt-4 flex flex-wrap gap-2">
            {QUICK_TOPUPS.map((amt) => (
              <button
                key={amt}
                type="button"
                className="btn bg-white/15 text-white hover:bg-white/25"
                disabled={topUp.isPending}
                onClick={() => topUp.mutate(amt)}
              >
                + ৳{amt / 100}
              </button>
            ))}
          </div>
        )}
      </section>
      <ErrorBanner error={topUp.error} />

      <section>
        <h2 className="mb-2 font-semibold">Transactions</h2>
        {w.transactions.length === 0 ? (
          <EmptyState title="No transactions yet">{isDriver ? 'TeslaPay fares you collect will appear here.' : 'Top up to pay for rides with TeslaPay.'}</EmptyState>
        ) : (
          <ul className="card divide-y divide-stone-100 p-0">
            {w.transactions.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {TYPE_LABEL[t.type]}
                    {t.trip && <span className="text-stone-500"> · {t.trip.pickup.name} → {t.trip.dropoff.name}</span>}
                  </p>
                  <p className="text-xs text-stone-500">
                    {dateTime(t.at)} · balance after {t.balanceAfter}
                  </p>
                </div>
                <span className={`font-semibold tabular-nums ${t.amountPaisa > 0 ? 'text-emerald-700' : 'text-stone-800'}`}>
                  {t.amountPaisa > 0 ? '+' : ''}
                  {t.amount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
