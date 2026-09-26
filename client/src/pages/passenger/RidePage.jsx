import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ridesApi } from '../../api/endpoints.js';
import { ErrorState, Spinner } from '../../components/States.jsx';
import { FareBreakdown } from '../../components/FareBreakdown.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { RequestRideForm } from './RequestRideForm.jsx';
import { RideTracker } from './RideTracker.jsx';

const POLL_MS = 3000;

/**
 * The passenger's home screen. Polls the active ride every 3 s (no websockets in the
 * MVP — see README). When the active ride disappears because the driver completed or
 * no-showed it, we keep showing its outcome until the passenger dismisses it.
 */
export function RidePage() {
  const active = useQuery({ queryKey: ['ride', 'active'], queryFn: ridesApi.active, refetchInterval: POLL_MS });
  const lastActiveId = useRef(null);
  const selfCancelled = useRef(false);
  const [finishedId, setFinishedId] = useState(null);

  useEffect(() => {
    if (active.data) {
      lastActiveId.current = active.data.id;
      setFinishedId(null);
    } else if (active.data === null && lastActiveId.current) {
      if (!selfCancelled.current) setFinishedId(lastActiveId.current);
      lastActiveId.current = null;
      selfCancelled.current = false;
    }
  }, [active.data]);

  if (active.isLoading) return <Spinner label="Checking your rides…" />;
  if (active.isError) return <ErrorState error={active.error} onRetry={active.refetch} />;
  if (active.data) return <RideTracker ride={active.data} onCancelled={() => (selfCancelled.current = true)} />;
  if (finishedId) return <RideOutcome id={finishedId} onDone={() => setFinishedId(null)} />;
  return <RequestRideForm />;
}

function RideOutcome({ id, onDone }) {
  const ride = useQuery({ queryKey: ['ride', id], queryFn: () => ridesApi.get(id) });
  if (ride.isLoading) return <Spinner />;
  if (ride.isError) return <ErrorState error={ride.error} onRetry={ride.refetch} />;
  const r = ride.data;
  const completed = r.status === 'COMPLETED';

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <section className="card text-center">
        <StatusBadge status={r.status} />
        <h1 className="mt-3 text-2xl font-bold">{completed ? `You've arrived in ${r.dropoff.name}` : 'This ride was cancelled'}</h1>
        <p className="muted mt-1">
          {completed
            ? `${r.paymentMethod === 'TESLAPAY' ? 'Paid with TeslaPay' : 'Paid in cash'} · ${r.fare.current?.pooled ? 'shared ride' : 'solo ride'}`
            : r.cancelReason}
        </p>
      </section>
      {completed && (
        <section className="card">
          <FareBreakdown fare={r.fare} />
        </section>
      )}
      <div className="flex gap-3">
        <button type="button" className="btn-primary flex-1" onClick={onDone}>
          Book another ride
        </button>
        <Link to={`/rides/${r.id}`} className="btn-secondary">
          Details
        </Link>
      </div>
    </div>
  );
}
