import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { driverApi } from '../../api/endpoints.js';
import { EmptyState, ErrorState, Spinner } from '../../components/States.jsx';
import { FareBreakdown } from '../../components/FareBreakdown.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { Timeline } from '../../components/Timeline.jsx';
import { dateTime } from '../../lib/format.js';

export function DriverHistory() {
  const pools = useQuery({ queryKey: ['driver', 'pools'], queryFn: driverApi.pools });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Trips</h1>
      {pools.isLoading && <Spinner />}
      {pools.isError && <ErrorState error={pools.error} onRetry={pools.refetch} />}
      {pools.data?.length === 0 && <EmptyState title="No trips yet">Accepted rides and pooled trips will be listed here.</EmptyState>}
      <ul className="space-y-2">
        {pools.data?.map((p) => (
          <li key={p.id}>
            <Link to={`/driver/pools/${p.id}`} className="card flex items-center justify-between gap-4 p-4 hover:border-brand-600">
              <div className="min-w-0">
                <p className="font-semibold">
                  From {p.pickup.name} · {p.members.length} booking{p.members.length === 1 ? '' : 's'}
                </p>
                <p className="truncate text-xs text-stone-500">
                  {dateTime(p.timestamps.createdAt)} · {p.members.map((m) => `${m.passenger.name} → ${m.dropoff.name}`).join(', ')}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StatusBadge status={p.status} kind="pool" />
                <span className="text-sm font-semibold tabular-nums">{p.earned}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DriverPoolDetail() {
  const { poolId } = useParams();
  const pool = useQuery({ queryKey: ['driver', 'pool', poolId], queryFn: () => driverApi.pool(poolId) });

  if (pool.isLoading) return <Spinner />;
  if (pool.isError) return <ErrorState error={pool.error} />;
  const p = pool.data;

  return (
    <div className="space-y-4">
      <Link to="/driver/history" className="text-sm font-medium text-brand-700 hover:underline">
        ← All trips
      </Link>
      <section className="card">
        <StatusBadge status={p.status} kind="pool" />
        <h1 className="mt-2 text-xl font-bold">Pickup in {p.pickup.name}</h1>
        <p className="muted">
          {dateTime(p.timestamps.createdAt)} · earned {p.earned}
        </p>
        <ul className="mt-4 divide-y divide-stone-100">
          {p.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="font-medium">
                  {m.passenger.name} → {m.dropoff.name}
                </p>
                <p className="text-xs text-stone-500">
                  {m.seats} seat{m.seats > 1 ? 's' : ''} · {m.paymentMethod === 'TESLAPAY' ? 'TeslaPay' : 'Cash'}
                  {m.cancelReason ? ` · ${m.cancelReason}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={m.status} />
                <FareBreakdown fare={m.fare} compact={m.fare.status !== 'NOT_CHARGED'} />
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2 className="mb-4 font-semibold">Trip log</h2>
        <Timeline events={p.timeline} />
      </section>
    </div>
  );
}
