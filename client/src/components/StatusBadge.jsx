import { POOL_STATUS_LABEL, RIDE_STATUS_LABEL } from '../lib/format.js';

const TONE = {
  REQUESTED: 'bg-amber-100 text-amber-800 ring-amber-200',
  OPEN: 'bg-amber-100 text-amber-800 ring-amber-200',
  MATCHED: 'bg-sky-100 text-sky-800 ring-sky-200',
  DRIVER_ARRIVED: 'bg-violet-100 text-violet-800 ring-violet-200',
  STARTED: 'bg-brand-100 text-brand-700 ring-brand-100',
  COMPLETED: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  CANCELLED: 'bg-stone-200 text-stone-700 ring-stone-300',
};

export function StatusBadge({ status, kind = 'ride' }) {
  const label = (kind === 'pool' ? POOL_STATUS_LABEL : RIDE_STATUS_LABEL)[status] ?? status;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONE[status] ?? TONE.CANCELLED}`}>
      {label}
    </span>
  );
}
