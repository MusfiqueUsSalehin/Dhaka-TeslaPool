import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ridesApi } from '../../api/endpoints.js';
import { ErrorBanner } from '../../components/States.jsx';
import { FareBreakdown } from '../../components/FareBreakdown.jsx';
import { SeatBar } from '../../components/SeatBar.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { ZoneMap } from '../../components/ZoneMap.jsx';
import { time } from '../../lib/format.js';

const STEPS = [
  { key: 'REQUESTED', label: 'Requested' },
  { key: 'MATCHED', label: 'Matched' },
  { key: 'DRIVER_ARRIVED', label: 'Driver here' },
  { key: 'STARTED', label: 'On the way' },
  { key: 'COMPLETED', label: 'Arrived' },
];

function headline(ride) {
  const p = ride.pool;
  switch (ride.status) {
    case 'REQUESTED':
      return { title: `Looking for a Tesla in ${ride.pickup.name}…`, sub: 'A nearby driver will accept you, or you will join a Tesla already heading your way.' };
    case 'MATCHED':
      return { title: `${p.driver.name} is coming to ${ride.pickup.name}`, sub: `${p.vehicle.name} · ${p.vehicle.plate}` };
    case 'DRIVER_ARRIVED':
      return { title: `${p.driver.name} is waiting in ${ride.pickup.name}`, sub: `Look for ${p.vehicle.name} (${p.vehicle.plate}). Please board now.` };
    case 'STARTED':
      return { title: `On the way to ${ride.dropoff.name}`, sub: `Riding in ${p.vehicle.name} with ${p.driver.name}` };
    default:
      return { title: ride.status, sub: '' };
  }
}

export function RideTracker({ ride, onCancelled }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const cancel = useMutation({
    mutationFn: () => ridesApi.cancel(ride.id),
    onSuccess: () => {
      onCancelled?.();
      qc.setQueryData(['ride', 'active'], null);
      qc.invalidateQueries({ queryKey: ['rides'] });
    },
  });

  const stepIndex = STEPS.findIndex((s) => s.key === ride.status);
  const h = headline(ride);
  const canCancel = ride.status === 'REQUESTED' || ride.status === 'MATCHED';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <section className="card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <StatusBadge status={ride.status} />
              <h1 className="mt-2 text-xl font-bold">{h.title}</h1>
              <p className="muted">{h.sub}</p>
            </div>
            {ride.status === 'REQUESTED' && <span className="mt-1 h-3 w-3 animate-ping rounded-full bg-amber-500" aria-hidden="true" />}
          </div>

          <ol className="mt-5 grid grid-cols-5 gap-1" aria-label="Ride progress">
            {STEPS.map((s, i) => (
              <li key={s.key} className="text-center">
                <div className={`h-1.5 rounded-full ${i <= stepIndex ? 'bg-brand-600' : 'bg-stone-200'}`} />
                <span className={`mt-1 block text-[11px] ${i === stepIndex ? 'font-semibold text-stone-900' : 'text-stone-500'}`}>{s.label}</span>
              </li>
            ))}
          </ol>

          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <Info label="From" value={ride.pickup.name} />
            <Info label="To" value={ride.dropoff.name} />
            <Info label="Seats" value={ride.seats} />
            <Info label="Payment" value={ride.paymentMethod === 'TESLAPAY' ? 'TeslaPay' : 'Cash'} />
          </dl>
        </section>

        {ride.pool && (
          <section className="card">
            <h2 className="font-semibold">Your Tesla</h2>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <SeatBar capacity={ride.pool.capacity} taken={ride.pool.seatsTaken} />
              <p className="text-sm text-stone-600">
                {ride.pool.otherBookings > 0
                  ? `Sharing with ${ride.pool.otherBookings} other ${ride.pool.otherBookings === 1 ? 'booking' : 'bookings'}`
                  : ride.pool.status === 'OPEN'
                    ? 'Nobody else yet — others going your way may join'
                    : 'Just you this time'}
              </p>
            </div>
            <p className="mt-2 text-xs text-stone-500">
              Driver {ride.pool.driver.name} · {ride.pool.driver.phone} · matched at {time(ride.timestamps.matchedAt)}
            </p>
          </section>
        )}

        <section className="card">
          <FareBreakdown fare={ride.fare} />
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <Link to={`/rides/${ride.id}`} className="btn-secondary">
            View timeline
          </Link>
          {canCancel && !confirming && (
            <button type="button" className="btn-danger" onClick={() => setConfirming(true)}>
              Cancel ride
            </button>
          )}
          {canCancel && confirming && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
              <span className="text-sm text-red-800">Cancel this ride?</span>
              <button type="button" className="btn-danger px-3 py-1" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                {cancel.isPending ? 'Cancelling…' : 'Yes, cancel'}
              </button>
              <button type="button" className="btn-secondary px-3 py-1" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </div>
          )}
          {ride.status === 'DRIVER_ARRIVED' && <p className="muted">The driver is waiting — cancellation is no longer available.</p>}
        </div>
        <ErrorBanner error={cancel.error} />
      </div>

      <div className="card p-3">
        <ZoneMap pickup={ride.pickup.code} stops={[ride.dropoff.code]} className="max-h-[520px]" />
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
