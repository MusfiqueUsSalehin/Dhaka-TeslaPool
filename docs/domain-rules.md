# Domain rules: geography, matching, fares

Every rule here is implemented as a pure function in `server/src/domain/` and has unit
tests that use exactly the numbers below. You should be able to check all of them with a
pencil.

## 1. Geography: a 500 m grid over Dhaka

No map APIs. Each predefined zone has its real latitude/longitude (for display) and a
position on a simple grid, in metres east (`x`) and north (`y`) of **Banani**, rounded to
the nearest 500 m. The grid was derived from the lat/lng once
(`y = Δlat × 110.6 km`, `x = Δlng × 111.32 km × cos 23.79°`) and then frozen.

| Code | Zone | lat | lng | x (m) | y (m) |
|---|---|---|---|---|---|
| `UTTARA` | Uttara | 23.8759 | 90.3795 | -3000 | 9000 |
| `AIRPORT` | Airport | 23.8513 | 90.4086 | 0 | 6500 |
| `BASHUNDHARA` | Bashundhara R/A | 23.8193 | 90.4526 | 4500 | 3000 |
| `MIRPUR` | Mirpur 10 | 23.8069 | 90.3687 | -4000 | 1500 |
| `GULSHAN_2` | Gulshan 2 | 23.7948 | 90.4144 | 1000 | 0 |
| `BANANI` | Banani | 23.7937 | 90.4066 | 0 | 0 |
| `BADDA` | Badda | 23.7806 | 90.4265 | 2000 | -1500 |
| `GULSHAN_1` | Gulshan 1 | 23.7806 | 90.4163 | 1000 | -1500 |
| `MOHAKHALI` | Mohakhali | 23.7781 | 90.4000 | -500 | -1500 |
| `TEJGAON` | Tejgaon | 23.7639 | 90.3930 | -1500 | -3500 |
| `FARMGATE` | Farmgate | 23.7577 | 90.3897 | -1500 | -4000 |
| `DHANMONDI` | Dhanmondi | 23.7461 | 90.3742 | -3500 | -5500 |
| `MOTIJHEEL` | Motijheel | 23.7330 | 90.4172 | 1000 | -6500 |

**Distance** between two zones is the **Manhattan distance** on this grid:
`d(a, b) = |xa − xb| + |ya − yb|`. Dhaka roads are closer to a grid of detours than to a
straight line, and Manhattan distance is easy to compute by hand. Because every coordinate
is a multiple of 500 m, every distance is too.

- Banani → Mohakhali = |0 − (−500)| + |0 − (−1500)| = **2000 m**
- Banani → Gulshan 1 = |0 − 1000| + |0 − (−1500)| = **2500 m**
- Mohakhali → Gulshan 1 = |−500 − 1000| + 0 = **1500 m**

## 2. Matching rule

A ride request **R** may join an existing pool **P** only if **all** of these hold:

1. **Same pickup zone** — `R.pickup = P.pickup`. Everyone boards together, so the Tesla
   makes one pickup stop and *Arrived* / *Start* apply to the whole pool.
2. **Pool is `OPEN`** — the driver has accepted but not yet arrived.
3. **Seats** — `P.seats_taken + R.seats ≤ P.capacity` (Bullet: 3).
4. **Detour rule** — build the drop-off route for all members plus R: drop-offs are visited
   in order of their direct distance from the pickup (ties by zone code). For **every**
   passenger, the distance they actually ride (pickup → … → their drop-off along that route)
   must be at most **1.5 ×** their direct distance **and** at most **2000 m** more than it.
   No passenger's trip may become more than 50 % longer, or more than 2 km longer, because
   of pooling. (The absolute cap matters for long trips: without it, an Uttara passenger with
   a 12 km trip would "tolerate" a 3 km detour to Mohakhali.)

### Worked example: Nusrat and Rafiq

- Nusrat: Banani → Mohakhali, direct 2000 m.
- Rafiq: Banani → Gulshan 1, direct 2500 m.
- Same pickup (Banani) ✔, pool is open ✔, seats 1 + 1 ≤ 3 ✔.
- Route: Mohakhali (2000 m from Banani) comes before Gulshan 1 (2500 m).
  - Nusrat rides 2000 m. Limit 1.5 × 2000 = 3000, extra 0 m ✔
  - Rafiq rides 2000 + 1500 = 3500 m. Limit 1.5 × 2500 = 3750, extra 1000 m ≤ 2000 ✔
- **They share Bullet.**

### Counter-example: a rider for Gulshan 2

Banani → Gulshan 2 is 1000 m, so Gulshan 2 would be dropped first, then Mohakhali is
|−500 − 1000| + |−1500 − 0| = 3000 m further. Nusrat would ride 4000 m against a limit of
3000 m ✘. Gulshan 2 is *near* Banani but in the *opposite direction* from Mohakhali, so this
rider does not join Nusrat's pool.

### Shirin and the last seat

Shirin requests Banani → Gulshan 1 (same as Rafiq, compatible). If Bullet already carries
Nusrat and Rafiq, she takes seat 3. If Rafiq had booked 2 seats, only one seat is left and
Nusrat and Shirin compete for it — see *Consistency* in [architecture.md](architecture.md).

### When is matching attempted?

- **When a passenger requests:** the service tries every `OPEN` pool in the same pickup
  zone with enough free seats, oldest first, and joins the first one that passes the
  rule (after locking it). Otherwise the ride waits as `REQUESTED`.
- **When a driver accepts a waiting request:** if Bullet already has an `OPEN` pool, the
  request must pass the same rule to join it. If Bullet has no active pool, a new pool is
  opened at the request's pickup zone.

### What a driver sees ("relevant requests")

- Offline, or pool already arrived/started: nothing.
- Online with an `OPEN` pool: waiting requests that would pass the matching rule for it.
- Online without a pool: waiting requests whose pickup is within **4000 m** of the
  Tesla's current zone and whose seats fit its capacity, nearest first, then oldest.
  After a trip, the Tesla's current zone becomes its last drop-off zone.

## 3. Fare model

All amounts are integer **paisa** (৳1 = 100 paisa).

```
distanceCharge = distance_m × 2                       (৳20 per km = 2 paisa per metre)
poolDiscount   = round(distanceCharge × 25 / 100)     if the ride is pooled, else 0
farePerSeat    = baseFare + distanceCharge − poolDiscount
passengerFare  = farePerSeat × seats
baseFare       = 3000                                 (৳30)
```

- **Distance** is the passenger's **direct** distance, not the detour they sat through:
  you pay for your trip, not for other people's drop-offs. The detour rule caps how much
  worse pooling can make the trip.
- **Pooled** means the pool had **2 or more ride requests on board when the trip
  started**. A passenger who books 2 seats alone is not pooling.
- **When is it final?** It is **locked when the driver taps Start** and stored on the ride
  (`fare_base_paisa`, `fare_distance_paisa`, `fare_discount_paisa`, `fare_total_paisa`,
  `pooled`). Before that, the API returns a live estimate, recalculated from the current pool.
- Rounding: half-up on the discount. With 500 m distances the discount is always exact.

### Worked example (the numbers the tests use)

| Passenger | Direct distance | Base | Distance charge | Pool discount | **Fare** |
|---|---|---|---|---|---|
| Nusrat, Banani → Mohakhali, solo | 2000 m | ৳30.00 | ৳40.00 | ৳0.00 | **৳70.00** |
| Nusrat, pooled | 2000 m | ৳30.00 | ৳40.00 | ৳10.00 | **৳60.00** |
| Rafiq, Banani → Gulshan 1, solo | 2500 m | ৳30.00 | ৳50.00 | ৳0.00 | **৳80.00** |
| Rafiq, pooled | 2500 m | ৳30.00 | ৳50.00 | ৳12.50 | **৳67.50** |
| Shirin, Banani → Gulshan 1, pooled | 2500 m | ৳30.00 | ৳50.00 | ৳12.50 | **৳67.50** |

Jashim's full Bullet (Nusrat + Rafiq + Shirin) earns ৳60.00 + ৳67.50 + ৳67.50 = **৳195.00**,
versus at most ৳80 for a single solo passenger on the same road.

## 4. Payment

- **Cash:** the ride is marked `PAID` when the driver confirms drop-off (he collected it).
- **TeslaPay (simulated wallet):** at request time the passenger's balance must cover the
  *solo* fare estimate (the maximum they could owe). At drop-off, the final fare is debited
  from the passenger and credited to the driver in the same transaction, with a ledger row
  for each. The debit is guarded (`balance >= fare`) and the ledger's unique
  `(ride_id, type)` makes it idempotent. Wallet top-ups are simulated (max ৳5,000 each).
- Seed balances: Nusrat ৳500, Rafiq ৳300, Shirin ৳150, Jashim ৳0.
