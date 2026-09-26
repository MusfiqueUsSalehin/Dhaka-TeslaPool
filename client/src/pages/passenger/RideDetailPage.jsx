import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ridesApi } from '../../api/endpoints.js';
import { ErrorState, Spinner } from '../../components/States.jsx';
import { FareBreakdown } from '../../components/FareBreakdown.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { Timeline } from '../../components/Timeline.jsx';
import { ZoneMap } from '../../components/ZoneMap.jsx';
import { dateTime, km } from '../../lib/format.js';

const ACTIVE = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED'];

export function RideDetailPage() {
  const { rideId } = useParams();
  const ride = useQuery({
    queryKey: ['ride', rideId],
    queryFn: () => ridesApi.get(rideId),
    refetchInterval: (q) => (ACTIVE.includes(q.state.data?.status) ? 3000 : false),
  });

  if (ride.isLoading) return <Spinner />;
  if (ride.isError) return <ErrorState error={ride.error} title={ride.error.status === 404 ? 'Ride not found' : undefined} />;
  const r = ride.data;

  return (
    <div className="space-y-4">
      <Link to="/history" className="text-sm font-medium text-brand-700 hover:underline">
        ← All rides
      </Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <section className="card">
            <StatusBadge status={r.status} />
            <h1 className="mt-2 text-xl font-bold">
              {r.pickup.name} → {r.dropoff.name}
            </h1>
            <p className="muted">
              {dateTime(r.timestamps.requestedAt)} · {km(r.distanceM)} · {r.seats} seat{r.seats > 1 ? 's' : ''} ·{' '}
              {r.paymentMethod === 'TESLAPAY' ? 'TeslaPay' : 'Cash'} ({r.paymentStatus.toLowerCase().replace('_', ' ')})
            </p>
            {r.pool && (
              <p className="mt-2 text-sm text-stone-600">
                {r.pool.vehicle.name} ({r.pool.vehicle.plate}) with {r.pool.driver.name}
                {r.pool.otherBookings > 0 ? ` · shared with ${r.pool.otherBookings} other booking${r.pool.otherBookings > 1 ? 's' : ''}` : ''}
              </p>
            )}
          </section>
          <section className="card">
            <FareBreakdown fare={r.fare} />
          </section>
          <section className="card">
            <h2 className="mb-4 font-semibold">What happened</h2>
            <Timeline events={r.timeline} />
          </section>
        </div>
        <div className="card h-fit p-3">
          <ZoneMap pickup={r.pickup.code} stops={[r.dropoff.code]} className="max-h-[520px]" />
        </div>
      </div>
    </div>
  );
}
