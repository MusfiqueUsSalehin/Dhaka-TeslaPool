import { useQuery } from '@tanstack/react-query';
import { metaApi } from '../api/endpoints.js';

const LABEL = {
  BANANI: [-330, 130, 'end'],
  GULSHAN_2: [330, -120, 'start'],
  MOHAKHALI: [-330, 130, 'end'],
  GULSHAN_1: [0, 650, 'middle'],
  BADDA: [330, 130, 'start'],
  BASHUNDHARA: [-330, 130, 'end'],
  TEJGAON: [330, -60, 'start'],
  FARMGATE: [330, 380, 'start'],
};
const DEFAULT_LABEL = [330, 130, 'start'];

/**
 * A schematic Dhaka map drawn from the same 500 m grid the fare and matching rules use
 * (no map API). Routes are drawn as L-shaped Manhattan paths, which is exactly how
 * distance is measured.
 *
 * @param {string}   pickup   zone code
 * @param {string[]} stops    drop-off zone codes in route order
 */
export function ZoneMap({ pickup, stops = [], className = '' }) {
  const { data: zones } = useQuery({ queryKey: ['zones'], queryFn: metaApi.zones, staleTime: Infinity });
  if (!zones) return <div className={`rounded-xl bg-stone-50 ${className}`} />;

  const byCode = Object.fromEntries(zones.map((z) => [z.code, z]));
  const pt = (code) => ({ x: byCode[code].gridX, y: -byCode[code].gridY });
  const route = pickup && stops.length ? [pickup, ...stops].filter((c) => byCode[c]) : [];
  const path = route
    .map((code, i) => {
      const p = pt(code);
      return i === 0 ? `M ${p.x} ${p.y}` : `H ${p.x} V ${p.y}`;
    })
    .join(' ');
  const dropSet = new Set(stops);

  return (
    <svg
      viewBox="-5400 -10200 11200 17900"
      className={`w-full rounded-xl bg-stone-50 ${className}`}
      role="img"
      aria-label={pickup ? `Map from ${byCode[pickup]?.name} to ${stops.map((s) => byCode[s]?.name).join(', ')}` : 'Map of Dhaka zones'}
    >
      {Array.from({ length: 12 }, (_, i) => -5000 + i * 1000).map((x) => (
        <line key={`v${x}`} x1={x} x2={x} y1={-10000} y2={7500} stroke="#e7e5e4" strokeWidth={30} />
      ))}
      {Array.from({ length: 18 }, (_, i) => -10000 + i * 1000).map((y) => (
        <line key={`h${y}`} y1={y} y2={y} x1={-5200} x2={5600} stroke="#e7e5e4" strokeWidth={30} />
      ))}
      {path && <path d={path} fill="none" stroke="#c8102e" strokeWidth={140} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />}
      {zones.map((z) => {
        const p = pt(z.code);
        const isPickup = z.code === pickup;
        const isDrop = dropSet.has(z.code);
        const active = isPickup || isDrop;
        const [dx, dy, anchor] = LABEL[z.code] ?? DEFAULT_LABEL;
        return (
          <g key={z.code}>
            <circle cx={p.x} cy={p.y} r={active ? 260 : 150} fill={isPickup ? '#059669' : isDrop ? '#c8102e' : '#a8a29e'} stroke="white" strokeWidth={60} />
            <text
              x={p.x + dx}
              y={p.y + dy}
              textAnchor={anchor}
              paintOrder="stroke"
              stroke="#fafaf9"
              strokeWidth={90}
              fontSize={active ? 440 : 360}
              fontWeight={active ? 700 : 500}
              fill={active ? '#1c1917' : '#78716c'}
            >
              {z.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}