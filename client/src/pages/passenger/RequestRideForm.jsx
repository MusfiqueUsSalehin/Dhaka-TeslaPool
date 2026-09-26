import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { metaApi, ridesApi, walletApi } from '../../api/endpoints.js';
import { ErrorBanner } from '../../components/States.jsx';
import { ZoneMap } from '../../components/ZoneMap.jsx';
import { km, taka } from '../../lib/format.js';

export function RequestRideForm() {
  const qc = useQueryClient();
  const [pickup, setPickup] = useState('BANANI');
  const [dropoff, setDropoff] = useState('');
  const [seats, setSeats] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('CASH');

  const zones = useQuery({ queryKey: ['zones'], queryFn: metaApi.zones, staleTime: Infinity });
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: walletApi.get });
  const validTrip = pickup && dropoff && pickup !== dropoff;
  const estimate = useQuery({
    queryKey: ['estimate', pickup, dropoff, seats],
    queryFn: () => metaApi.estimate({ pickup, dropoff, seats }),
    enabled: Boolean(validTrip),
  });

  const request = useMutation({
    mutationFn: ridesApi.request,
    onSuccess: (ride) => {
      qc.setQueryData(['ride', 'active'], ride);
      qc.invalidateQueries({ queryKey: ['rides'] });
    },
  });

  const soloPaisa = estimate.data?.solo.totalPaisa;
  const walletShort = paymentMethod === 'TESLAPAY' && wallet.data && soloPaisa && wallet.data.balancePaisa < soloPaisa;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <form
        className="card space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          request.mutate({ pickup, dropoff, seats, paymentMethod });
        }}
      >
        <div>
          <h1 className="text-xl font-bold">Where to?</h1>
          <p className="muted">If a Tesla is already collecting passengers going your way, you'll share it and pay less.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ZoneSelect id="pickup" label="Pickup" value={pickup} onChange={setPickup} zones={zones.data} />
          <ZoneSelect id="dropoff" label="Destination" value={dropoff} onChange={setDropoff} zones={zones.data} exclude={pickup} placeholder="Choose destination" />
        </div>

        <fieldset>
          <legend className="field-label">Seats</legend>
          <div className="inline-flex rounded-xl border border-stone-300 p-1">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={seats === n}
                onClick={() => setSeats(n)}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${seats === n ? 'bg-brand-600 text-white' : 'text-stone-700 hover:bg-stone-100'}`}
              >
                {n}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="field-label">Payment</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <PayOption checked={paymentMethod === 'CASH'} onChange={() => setPaymentMethod('CASH')} title="Cash" hint="Pay Jashim at drop-off" />
            <PayOption
              checked={paymentMethod === 'TESLAPAY'}
              onChange={() => setPaymentMethod('TESLAPAY')}
              title="TeslaPay"
              hint={wallet.data ? `Balance ${wallet.data.balance}` : 'Loading balance…'}
            />
          </div>
        </fieldset>

        {validTrip && (
          <div className="rounded-xl bg-stone-50 p-4" aria-live="polite">
            {estimate.isLoading && <p className="muted">Calculating fare…</p>}
            {estimate.isError && <ErrorBanner error={estimate.error} />}
            {estimate.data && (
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Estimated fare · {km(estimate.data.distanceM)}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    {taka(estimate.data.pooled.totalPaisa)} <span className="text-base font-medium text-stone-500">if shared</span>
                  </p>
                  <p className="text-sm text-stone-600">{taka(estimate.data.solo.totalPaisa)} if nobody joins you</p>
                </div>
                <p className="max-w-[14rem] text-xs text-stone-500">
                  ৳30 base + ৳20/km. Sharing takes 25% off the distance part. Final price locks when the trip starts.
                </p>
              </div>
            )}
          </div>
        )}

        {walletShort && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Your TeslaPay balance ({wallet.data.balance}) can't cover the solo fare ({taka(soloPaisa)}). Top up or pay cash.
          </p>
        )}
        <ErrorBanner error={request.error} />

        <button type="submit" className="btn-primary w-full py-3 text-base" disabled={!validTrip || request.isPending || walletShort}>
          {request.isPending ? 'Requesting…' : 'Request Tesla'}
        </button>
      </form>

      <div className="card p-3">
        <ZoneMap pickup={pickup} stops={dropoff && dropoff !== pickup ? [dropoff] : []} className="max-h-[520px]" />
        <p className="mt-2 px-1 text-xs text-stone-500">Distances follow Dhaka's grid of roads (500 m blocks), not a straight line.</p>
      </div>
    </div>
  );
}

function ZoneSelect({ id, label, value, onChange, zones, exclude, placeholder }) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} required disabled={!zones}>
        {placeholder && (
          <option value="" disabled>
            {zones ? placeholder : 'Loading zones…'}
          </option>
        )}
        {zones?.map((z) => (
          <option key={z.code} value={z.code} disabled={z.code === exclude}>
            {z.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function PayOption({ checked, onChange, title, hint }) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${checked ? 'border-brand-600 bg-brand-50' : 'border-stone-300 bg-white'}`}>
      <input type="radio" name="payment" className="accent-brand-600" checked={checked} onChange={onChange} />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-stone-500">{hint}</span>
      </span>
    </label>
  );
}
