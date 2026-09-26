import { EVENT_LABEL, time } from '../lib/format.js';

/** The audit trail from ride_events — "what exactly happened, and who did it". */
export function Timeline({ events }) {
  if (!events?.length) return <p className="muted">No history yet.</p>;
  return (
    <ol className="relative space-y-4 border-l border-stone-200 pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full bg-brand-600 ring-4 ring-white" />
          <p className="text-sm font-medium text-stone-800">{EVENT_LABEL[e.type] ?? e.type}</p>
          <p className="text-xs text-stone-500">
            {time(e.at)} · {e.actor.name}
            {e.details?.reason ? ` · ${e.details.reason}` : ''}
            {e.details?.via === 'AUTO_JOIN' ? ' · joined a Tesla already heading your way' : ''}
            {e.details?.method ? ` · ${e.details.method === 'TESLAPAY' ? 'TeslaPay' : 'Cash'}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}