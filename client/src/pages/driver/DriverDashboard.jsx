import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { driverApi, metaApi } from '../../api/endpoints.js';
import { ErrorBanner, ErrorState, Spinner } from '../../components/States.jsx';
import { PoolPanel } from './PoolPanel.jsx';
import { RequestFeed } from './RequestFeed.jsx';

export function DriverDashboard() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['driver', 'me'], queryFn: driverApi.me, refetchInterval: 3000 });
  const zones = useQuery({ queryKey: ['zones'], queryFn: metaApi.zones, staleTime: Infinity });
  const [zone, setZone] = useState('');

  // Follow the Tesla: after a trip Bullet is parked at its last drop-off, so the selector
  // must move with it (it used to stay on the old zone and offer a pointless "Move here").
  const serverZone = me.data?.vehicle.currentZone?.code;
  useEffect(() => {
    if (serverZone) setZone(serverZone);
  }, [serverZone]);

  const availability = useMutation({
    mutationFn: (online) => (online ? driverApi.online(zone) : driverApi.offline()),
    onSuccess: (data) => qc.setQueryData(['driver', 'me'], data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['driver'] }),
  });

  if (me.isLoading) return <Spinner />;
  if (me.isError) return <ErrorState error={me.error} onRetry={me.refetch} />;
  const { vehicle, activePool, stats } = me.data;

  return (
    <div className="space-y-6">
      <section className="card flex flex-wrap items-center gap-4">
        <img src="/bullet.png" alt="" className="h-14 w-20 rounded-lg object-cover" />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold">
            {vehicle.name} <span className="text-sm font-normal text-stone-500">· {vehicle.plate} · {vehicle.capacity} seats</span>
          </p>
          <p className="text-sm text-stone-600">
            <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${vehicle.isOnline ? 'bg-emerald-500' : 'bg-stone-400'}`} />
            {vehicle.isOnline ? `Online in ${vehicle.currentZone?.name}` : 'Offline'} · {stats.completedRides} rides · earned {stats.earned}
          </p>
        </div>
        {!activePool && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="zone">
              Current zone
            </label>
            <select id="zone" className="input w-auto" value={zone} onChange={(e) => setZone(e.target.value)} disabled={!zones.data}>
              {zones.data?.map((z) => (
                <option key={z.code} value={z.code}>
                  {z.name}
                </option>
              ))}
            </select>
            {vehicle.isOnline ? (
              <>
                <button type="button" className="btn-secondary" disabled={availability.isPending || zone === vehicle.currentZone?.code} onClick={() => availability.mutate(true)}>
                  Move here
                </button>
                <button type="button" className="btn-secondary" disabled={availability.isPending} onClick={() => availability.mutate(false)}>
                  Go offline
                </button>
              </>
            ) : (
              <button type="button" className="btn-primary" disabled={availability.isPending || !zone} onClick={() => availability.mutate(true)}>
                Go online
              </button>
            )}
          </div>
        )}
      </section>
      <ErrorBanner error={availability.error} />

      {!vehicle.isOnline && !activePool && (
        <div className="card text-center">
          <p className="font-semibold">You're offline</p>
          <p className="muted">Pick the zone you're in and go online to see nearby passengers.</p>
        </div>
      )}

      {activePool && <PoolPanel pool={activePool} />}
      {vehicle.isOnline && (!activePool || activePool.status === 'OPEN') && <RequestFeed vehicle={vehicle} seatsFree={activePool?.seatsFree} />}
    </div>
  );
}