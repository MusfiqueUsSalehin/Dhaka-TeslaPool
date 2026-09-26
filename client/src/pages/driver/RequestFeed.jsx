import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { driverApi } from '../../api/endpoints.js';
import { EmptyState, ErrorBanner, ErrorState, Spinner } from '../../components/States.jsx';
import { km, time } from '../../lib/format.js';

/** Waiting ride requests relevant to Bullet right now (rules: docs/domain-rules.md §2). */
export function RequestFeed({ vehicle, seatsFree }) {
  const qc = useQueryClient();
  const feed = useQuery({ queryKey: ['driver', 'requests'], queryFn: driverApi.requests, refetchInterval: 3000 });
  const accept = useMutation({
    mutationFn: driverApi.accept,
    onSettled: () => qc.invalidateQueries({ queryKey: ['driver'] }),
  });

  if (feed.isLoading) return <Spinner label="Looking for passengers…" />;
  if (feed.isError) return <ErrorState error={feed.error} onRetry={feed.refetch} />;

  const { mode, requests } = feed.data;
  if (mode === 'BUSY' || mode === 'OFFLINE') return null;
  const filling = mode === 'FILLING_POOL';
  if (filling && seatsFree === 0) {
    return (
      <div className="card text-center">
        <p className="font-semibold">{vehicle.name} is full</p>
        <p className="muted">All {vehicle.capacity} seats are taken — head to the pickup.</p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold">{filling ? 'Passengers you can add' : 'Ride requests near you'}</h2>
        <p className="muted">
          {filling
            ? 'Same pickup, on your route, and fits your free seats.'
            : `Waiting passengers within 4 km of ${vehicle.currentZone?.name}, nearest first.`}
        </p>
      </div>
      <ErrorBanner error={accept.error} />
      {requests.length === 0 ? (
        <EmptyState title={filling ? 'Nobody else going your way yet' : 'No requests nearby'}>
          {filling ? 'You can head to the pickup now — people can still join until you arrive.' : 'New requests appear here automatically.'}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {requests.map((r) => (
            <li key={r.id} className="card flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{r.passenger.name}</p>
                  <p className="text-sm text-stone-600">
                    {r.pickup.name} → {r.dropoff.name}
                  </p>
                  <p className="text-xs text-stone-500">
                    {km(r.distanceM)} trip · {r.seats} seat{r.seats > 1 ? 's' : ''} · {r.paymentMethod === 'TESLAPAY' ? 'TeslaPay' : 'Cash'} · requested {time(r.requestedAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold tabular-nums">{filling ? r.estimate.pooled : r.estimate.solo}</p>
                  <p className="text-[11px] text-stone-500">{r.pickupDistanceM === 0 ? 'right here' : `${km(r.pickupDistanceM)} away`}</p>
                </div>
              </div>
              <button type="button" className="btn-primary" disabled={accept.isPending} onClick={() => accept.mutate(r.id)}>
                {filling ? `Add ${r.passenger.name} to this trip` : `Accept ${r.passenger.name}`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
