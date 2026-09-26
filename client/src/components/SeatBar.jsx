/** Bullet's seats at a glance: filled = taken. */
export function SeatBar({ capacity, taken, label = true }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: capacity }, (_, i) => (
          <span
            key={i}
            className={`h-5 w-5 rounded-md border-2 ${i < taken ? 'border-brand-600 bg-brand-600' : 'border-stone-300 bg-white'}`}
          />
        ))}
      </div>
      {label && (
        <span className="text-sm text-stone-600">
          {taken}/{capacity} seats taken
        </span>
      )}
    </div>
  );
}
