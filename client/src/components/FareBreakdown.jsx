import { taka } from '../lib/format.js';

/**
 * Renders the fare object from the API:
 *  ESTIMATE    live price (changes as people join/leave the pool until the trip starts)
 *  FINAL       locked at trip start, with the full breakdown
 *  NOT_CHARGED cancelled before starting
 */
export function FareBreakdown({ fare, compact = false }) {
  if (!fare) return null;
  if (fare.status === 'NOT_CHARGED') {
    return <p className="text-sm font-medium text-stone-500">Not charged</p>;
  }

  const f = fare.current;
  const isFinal = fare.status === 'FINAL';

  if (compact) {
    return (
      <span className="font-semibold tabular-nums">
        {taka(f.totalPaisa)}
        {!isFinal && <span className="ml-1 text-xs font-normal text-stone-500">est.</span>}
      </span>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-stone-600">{isFinal ? 'Your fare' : 'Estimated fare'}</span>
        <span className="text-2xl font-bold tabular-nums">{taka(f.totalPaisa)}</span>
      </div>
      <dl className="mt-3 space-y-1 text-sm">
        <Row label={`Base fare${f.seats > 1 ? ` × ${f.seats} seats` : ''}`} value={taka(f.basePaisa)} />
        <Row label={`Distance (${(f.distanceM / 1000).toFixed(1)} km × ৳20${f.seats > 1 ? ` × ${f.seats}` : ''})`} value={taka(f.distancePaisa)} />
        {f.discountPaisa > 0 && <Row label="Pool discount (25% of distance)" value={`− ${taka(f.discountPaisa)}`} accent />}
      </dl>
      {!isFinal && fare.solo && (
        <p className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
          Solo {taka(fare.solo.totalPaisa)} · Shared {taka(fare.pooled.totalPaisa)}. The price locks when the trip starts, based on
          whether someone is sharing your Tesla.
        </p>
      )}
      {isFinal && (
        <p className="mt-3 text-xs text-stone-500">{f.pooled ? 'Pooled trip — you shared the Tesla.' : 'Solo trip — nobody else joined.'}</p>
      )}
    </div>
  );
}

function Row({ label, value, accent }) {
  return (
    <div className="flex justify-between">
      <dt className="text-stone-500">{label}</dt>
      <dd className={`tabular-nums ${accent ? 'font-medium text-emerald-700' : 'text-stone-800'}`}>{value}</dd>
    </div>
  );
}