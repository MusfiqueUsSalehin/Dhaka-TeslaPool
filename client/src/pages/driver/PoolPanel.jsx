import { useMutation, useQueryClient } from '@tanstack/react-query';
import { driverApi } from '../../api/endpoints.js';
import { ErrorBanner } from '../../components/States.jsx';
import { FareBreakdown } from '../../components/FareBreakdown.jsx';
import { SeatBar } from '../../components/SeatBar.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { ZoneMap } from '../../components/ZoneMap.jsx';

/**
 * Jashim's view of the current trip: who is assigned, seats, each passenger's fare and
 * status, and the one action that moves the trip forward.
 */
export function PoolPanel({ pool }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['driver'] });
  const action = useMutation({ mutationFn: (fn) => fn(), onSettled: refresh });

  const waitingOrOnBoard = pool.members.filter((m) => ['MATCHED', 'DRIVER_ARRIVED', 'STARTED'].includes(m.status));
  const nextStop = pool.status === 'STARTED' ? pool.nextStops[0] : null;

  const primary = {
    OPEN: { label: `I've arrived in ${pool.pickup.name}`, run: () => driverApi.arrive(pool.id), hint: 'Passengers going your way can still join until you arrive.' },
    DRIVER_ARRIVED: { label: `Start trip with ${waitingOrOnBoard.length} booking${waitingOrOnBoard.length === 1 ? '' : 's'}`, run: () => driverApi.start(pool.id), hint: 'Fares lock when you start. Mark anyone who did not show up first.' },
    STARTED: nextStop && { label: `Drop off ${nextStop.passenger} at ${nextStop.dropoff.name}`, run: () => driverApi.dropOff(pool.id, nextStop.rideId), hint: 'Drop-offs follow the route order.' },
  }[pool.status];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="card space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <StatusBadge status={pool.status} kind="pool" />
            <h2 className="mt-2 text-lg font-bold">Pickup: {pool.pickup.name}</h2>
          </div>
          <SeatBar capacity={pool.capacity} taken={pool.seatsTaken} />
        </div>

        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200">
          {pool.members.map((m) => {
            const isNext = nextStop?.rideId === m.id;
            return (
              <li key={m.id} className={`flex flex-wrap items-center gap-3 p-3 ${isNext ? 'bg-brand-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {m.passenger.name}
                    <span className="ml-2 text-xs font-normal text-stone-500">
                      {m.seats} seat{m.seats > 1 ? 's' : ''} · → {m.dropoff.name}
                    </span>
                  </p>
                  <p className="text-xs text-stone-500">
                    {m.paymentMethod === 'TESLAPAY' ? 'TeslaPay' : 'Collect cash'} · <FareBreakdown fare={m.fare} compact={m.fare.status !== 'NOT_CHARGED'} />
                  </p>
                </div>
                <StatusBadge status={m.status} />
                {m.status === 'DRIVER_ARRIVED' && (
                  <button type="button" className="btn-danger px-3 py-1.5 text-xs" disabled={action.isPending} onClick={() => action.mutate(() => driverApi.noShow(pool.id, m.id))}>
                    No-show
                  </button>
                )}
                {m.status === 'STARTED' && !isNext && (
                  <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={action.isPending} onClick={() => action.mutate(() => driverApi.dropOff(pool.id, m.id))}>
                    Drop off
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {primary && (
          <div>
            <button type="button" className="btn-primary w-full py-3 text-base" disabled={action.isPending} onClick={() => action.mutate(primary.run)}>
              {action.isPending ? 'Updating…' : primary.label}
            </button>
            <p className="mt-2 text-center text-xs text-stone-500">{primary.hint}</p>
          </div>
        )}
        <ErrorBanner error={action.error} />

        {pool.earnedPaisa > 0 && <p className="text-sm text-stone-600">Collected on this trip so far: <strong>{pool.earned}</strong></p>}
      </section>

      <div className="card h-fit p-3">
        <ZoneMap pickup={pool.pickup.code} stops={pool.nextStops.map((s) => s.dropoff.code)} className="max-h-[480px]" />
        {pool.nextStops.length > 0 && (
          <ol className="mt-2 space-y-1 px-1 text-xs text-stone-600">
            {pool.nextStops.map((s, i) => (
              <li key={s.rideId}>
                {i + 1}. {s.dropoff.name} — {s.passenger} ({(s.atM / 1000).toFixed(1)} km from pickup)
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
