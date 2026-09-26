import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ridesApi } from '../../api/endpoints.js';
import { EmptyState, ErrorState, Spinner } from '../../components/States.jsx';
import { FareBreakdown } from '../../components/FareBreakdown.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { dateTime } from '../../lib/format.js';

export function HistoryPage() {
  const rides = useQuery({ queryKey: ['rides'], queryFn: ridesApi.list });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Your rides</h1>
      {rides.isLoading && <Spinner />}
      {rides.isError && <ErrorState error={rides.error} onRetry={rides.refetch} />}
      {rides.data?.length === 0 && (
        <EmptyState
          title="No rides yet"
          action={
            <Link to="/ride" className="btn-primary">
              Request your first Tesla
            </Link>
          }
        >
          Your trips, fares and receipts will show up here.
        </EmptyState>
      )}
      {rides.data?.length > 0 && (
        <ul className="space-y-2">
          {rides.data.map((r) => (
            <li key={r.id}>
              <Link to={`/rides/${r.id}`} className="card flex items-center justify-between gap-4 p-4 hover:border-brand-600">
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {r.pickup.name} → {r.dropoff.name}
                  </p>
                  <p className="text-xs text-stone-500">
                    {dateTime(r.timestamps.requestedAt)} · {r.seats} seat{r.seats > 1 ? 's' : ''}
                    {r.pool?.otherBookings > 0 ? ` · shared with ${r.pool.otherBookings}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge status={r.status} />
                  <FareBreakdown fare={r.fare} compact={r.fare.status !== 'NOT_CHARGED'} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
