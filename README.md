# Dhaka Tesla Pool

> Share a seat. Split the fare. Survive Dhaka traffic.

A ride-pooling MVP for Dhaka's three-seat battery "Teslas". Nusrat, Rafiq and Shirin request
rides from Banani. When their routes are compatible they share Jashim's Tesla, **Bullet**, and
each pays their own, smaller fare. Jashim sees who is on board and moves the trip through its
lifecycle. Every step is recorded, so the system can explain what happened afterwards.

| | |
|---|---|
| 🎥 **Demo video (≤ 6 min)** | **https://drive.google.com/file/d/1s7BmNqX90WHkIy2uSkl5kUoK6D_3DIYF/view?usp=sharing** |
| 🌐 **Live deployment** | **https://dhaka-tesla-pool-i4yp.onrender.com/** (free tier: first load after idle takes ~30–60 s) · see [docs/deployment.md](docs/deployment.md) |
| 🔑 **Demo login** | Tap a name on the sign-in screen, or use the phone numbers below with password `tesla1234` |


---

## Contents

1. [Problem](#1-problem) · 2. [Features](#2-features-implemented) · 3. [Screenshots](#3-screenshots) ·
4. [Architecture](#4-architecture) · 5. [Database / ERD](#5-database-design-erd) ·
6. [Domain rules](#6-lifecycle-matching-and-fares) · 7. [Concurrency](#7-consistency-and-the-last-seat-race) ·
8. [Tech stack & justification](#8-tech-stack-and-why) · 9. [Project structure](#9-project-structure) ·
10. [Running it](#10-running-it) · 11. [Tests](#11-tests) · 12. [API](#12-api-overview) ·
13. [Decisions & trade-offs](#13-key-decisions-and-trade-offs) · 14. [Assumptions](#14-assumptions) ·
15. [Limitations & next steps](#15-known-limitations-and-next-improvements) · 16. [Git workflow](#16-git-workflow) ·
17. [AI usage](#17-ai-usage) · 18. [Scaling bonus](#18-bonus-if-oi-tesla-goes-viral)

---

## 1. Problem

It is 8:41 AM on Banani Road 11. Nusrat wants to go to Mohakhali. Two minutes later Rafiq
wants to go to Gulshan 1: overlapping, but not the same trip. Jashim's Tesla has three seats.
The system has to:

- decide, in about a second, whether two strangers can **share** a Tesla (and when they shouldn't);
- make sure Bullet's **three seats are never oversold**, even when Nusrat and Shirin grab the
  last seat at the same instant;
- give each passenger **their own fare and status**, and never show them anyone else's;
- let the driver see **who is assigned and what stage** the trip is at;
- keep enough **history** to explain afterwards exactly what happened, and who did it.

Real routing is out of scope. Geography is a predefined list of Dhaka zones on a 500 m grid.

## 2. Features implemented

**Passenger (Nusrat, Rafiq, Shirin)**
- Sign up / sign in with a Bangladeshi mobile number (passenger self-signup; drivers are onboarded by ops).
- Request a ride: pickup zone, destination zone, seats (1–3), Cash or **TeslaPay**.
- See the estimated fare before booking: solo vs. shared.
- Automatically **join a Tesla already heading the same way**, or wait for a driver to accept.
- Live status: `Waiting → Matched → Driver arrived → On the way → Completed` (or Cancelled), with
  driver, Tesla, seat usage and "sharing with N other bookings". Other passengers are never named.
- Live fare estimate that updates as people join or leave, then **locks when the trip starts**.
- Cancel while the ride is still waiting or matched.
- Ride history, a per-ride timeline from the audit log, and a TeslaPay wallet (simulated top-ups, ledger).

**Driver (Jashim[Bullet])**
- Sign in; go online in a zone or go offline (blocked while carrying passengers).
- See **relevant requests**: waiting passengers within 4 km, nearest first. While filling a
  pool, only requests that pass the matching rule are shown.
- Accept a request (opens a pool) or add compatible passengers to the current pool.
- Pool-wide **Arrived** and **Start**, per-passenger **Drop off** (the next stop in route order is the main button; anyone can be dropped early), **No-show**.
- See passengers, seats (●●○), each passenger's fare and payment method, the drop-off route
  and the trip log. Trip history and TeslaPay earnings.

**Pool / ride split**
- Multiple requests share one Tesla; **occupied seats never exceed capacity** (enforced by a
  row lock, a conditional update and a database CHECK constraint).
- Each passenger gets an **individual fare** from a documented, hand-checkable formula.
- Two explicit state machines (pool and ride), invalid transitions rejected with `409`.
- Append-only `ride_events` audit trail; idempotent TeslaPay settlement through a ledger.

## 3. Screenshots

| | |
|---|---|
| ![Sign-in with the demo cast](docs/screenshots/01-login-demo-cast.png) Sign-in with one-tap demo cast | ![Request form with fare estimate](docs/screenshots/02-request-fare-estimate.png) Rafiq's request: ৳67.50 if shared, ৳80.00 solo |
| ![Nusrat sharing with Rafiq](docs/screenshots/03-nusrat-sharing-with-rafiq.png) Nusrat after Rafiq joins: estimate drops to ৳60.00 | ![Bullet full](docs/screenshots/04-jashim-bullet-full.png) Jashim: Bullet full (3/3) after Shirin takes the last seat |
| ![Trip started](docs/screenshots/05-trip-started-fares-locked.png) Trip started, fares locked, drop-off order | ![Ride timeline](docs/screenshots/06-rafiq-ride-timeline.png) Rafiq's receipt and timeline |
| ![Trip log](docs/screenshots/07-jashim-trip-log.png) Jashim's trip log: ৳195.00 for one full Bullet | ![Mobile](docs/screenshots/08-mobile-request.png) Mobile layout |

## 4. Architecture

Full write-up with sequence diagrams: **[docs/architecture.md](docs/architecture.md)**.

```mermaid
flowchart LR
    B["Browser<br/>React SPA (Vite)"] -- "HTTPS JSON /api/*<br/>httpOnly JWT cookie" --> E
    subgraph C["Node.js container"]
      E["Express<br/>helmet · pino-http · rate limit<br/>auth · zod validation"] --> S["Services<br/>one DB transaction per command<br/>row locks · audit events"]
      S --> D["Pure domain<br/>fare · matching · state machines"]
      E -. "serves built SPA" .-> B
    end
    S -- "Knex / pg" --> P[("PostgreSQL 16<br/>CHECK · partial UNIQUE · FK")]
```

- **One container** serves the API and the built React app, so the browser sees one origin.
  That keeps cookies simple and secure, needs no CORS, and fits in one free-tier service.
  In development, Vite proxies `/api` to Express, so the topology is the same.
- **Layers:** routes (HTTP only) → services (transactions, locks, events) → pure domain
  functions (unit-tested with the PRD's numbers). Invariants are also enforced by the database.
- **No Redis, queues or microservices.** Nothing at this scale needs them. [docs/scaling.md](docs/scaling.md) explains when they would.

## 5. Database design (ERD)

```mermaid
erDiagram
    users ||--o| vehicles : "drives"
    users ||--o{ rides : "requests"
    vehicles ||--o{ pools : "runs"
    pools ||--o{ rides : "membership (rides.pool_id)"
    zones ||--o{ rides : "pickup/dropoff"
    zones ||--o{ pools : "pickup"
    rides ||--o{ ride_events : "audit"
    pools ||--o{ ride_events : "audit"
    users ||--o{ wallet_transactions : "ledger"
    rides ||--o{ wallet_transactions : "settles"
```

| Table | Purpose | Key constraints |
|---|---|---|
| `zones` | Predefined Dhaka areas + grid coordinates | FK target for pickups/drop-offs |
| `users` | Passengers & drivers (`role` enum), TeslaPay balance | unique phone, BD mobile CHECK, `wallet_balance_paisa >= 0` |
| `vehicles` | Bullet: fixed `capacity`, `is_online`, `current_zone` | one Tesla per driver, capacity 1..6 |
| `pools` | One Tesla trip: pickup zone, `seats_taken`, lifecycle | **`CHECK (seats_taken BETWEEN 0 AND capacity)`**, one active pool per vehicle (partial unique) |
| `rides` | A passenger's booking **and** pool membership; own status and own fare | one active ride per passenger (partial unique); `REQUESTED ⇔ no pool`; fare present ⇔ started; fare parts add up |
| `ride_events` | Append-only audit trail (who, what, from → to, when) | indexed by ride and pool |
| `wallet_transactions` | TeslaPay ledger (balance = sum of ledger) | unique `(ride_id, type)` → a ride is charged once |

Every column and index is explained in [docs/architecture.md §3](docs/architecture.md#3-database-design-erd).
Migrations live in [`server/migrations`](server/migrations).

**Money** is stored as integer **paisa** (`bigint`). Rafiq's pooled fare is ৳67.50. Floats
cannot represent every decimal exactly, and `numeric` arrives in Node as a string that invites
float math. Integers are exact and easy to sum. Formatting to `৳67.50` happens only at the edges.

## 6. Lifecycle, matching and fares

Details and worked examples: **[docs/domain-rules.md](docs/domain-rules.md)**.

**Lifecycle: two state machines instead of one.** The PRD suggests
`REQUESTED → MATCHED → DRIVER_ARRIVED → STARTED → COMPLETED (+ CANCELLED)`. The names are kept,
but the **pool** (the Tesla) and each **ride** (a passenger) have separate lifecycles, because
Nusrat gets off at Mohakhali while Rafiq is still riding to Gulshan 1.
Ride: REQUESTED → MATCHED → DRIVER_ARRIVED → STARTED → COMPLETED (per passenger drop-off)
└─────────┴── CANCELLED (passenger) └── CANCELLED (driver: no-show)
Pool: OPEN → DRIVER_ARRIVED → STARTED → COMPLETED (last drop-off)
└──────────┴── CANCELLED (last member left before start)


- **Arrive** and **Start** are pool-wide, since everyone boards in the same zone. **Drop off** is per passenger.
- New passengers can join only while the pool is `OPEN`. Joins close once Jashim arrives.
- **Fares lock at Start**, because only then do we know whether the trip is actually shared.
- **Cancellation:** passengers can cancel while `REQUESTED`/`MATCHED`. After the driver arrives,
  only the driver can release them (no-show). Nobody cancels a started ride.
- Transitions are **named commands** (`POST /api/pools/:id/start`), never `PATCH {status}`.

**Geography.** 13 zones with real lat/lng, placed on a 500 m grid measured from Banani.
Distance is Manhattan distance on the grid. Banani → Mohakhali is **2000 m** and Banani → Gulshan 1 is **2500 m**.

**Matching rule.** A request joins a pool only if (1) it has the **same pickup zone**, (2) the pool is
`OPEN`, (3) there are **enough free seats**, and (4) the **detour rule** holds for every passenger:
drop-offs are visited nearest-first, and nobody rides more than **1.5× their direct distance or
2 km extra**.
- Nusrat + Rafiq: Mohakhali first (2000 m), then Gulshan 1. Rafiq rides 3500 m ≤ min(3750, 2500+2000) ✔ **They share.**
- A Gulshan 2 rider is near Banani but in the opposite direction. Nusrat would ride 4000 m > 3000 m ✘.

**Fare** (integer paisa):
passengerFare = (৳30 base + distance_km × ৳20 − poolDiscount) × seats
poolDiscount = 25% of the distance charge, only if ≥ 2 bookings are on board at Start


| | Distance | Solo | Pooled |
|---|---|---|---|
| Nusrat, Banani → Mohakhali | 2.0 km | 30 + 40 = **৳70.00** | 30 + 40 − 10 = **৳60.00** |
| Rafiq, Banani → Gulshan 1 | 2.5 km | 30 + 50 = **৳80.00** | 30 + 50 − 12.50 = **৳67.50** |

Passengers pay for their **direct** distance, not for other people's detours (the detour
rule caps those). **Payment:** Cash (marked paid at drop-off) or TeslaPay. For TeslaPay the
wallet must cover the solo fare at request time; at drop-off the passenger is debited and the
driver credited in the same transaction.

## 7. Consistency and the last-seat race

*Bullet has one seat left. Nusrat and Shirin both request at the same instant and both see one seat free.*

1. Each request runs in **one transaction**, and the candidate pool row is locked with
   `SELECT … FOR UPDATE`. The second transaction waits, then re-reads `seats_taken = 3`.
2. All checks (status, seats, detour) run **after** the lock, against current data.
3. The seat update is conditional (`WHERE seats_taken + n <= capacity`), and the table has
   `CHECK (seats_taken <= capacity)`. A future bug gets an error, not an overbooked Tesla.
4. The loser is not failed. Her ride simply stays `REQUESTED` for another Tesla.

Locks are always taken in the order **vehicle → pool → ride** to avoid deadlocks. The
transaction helper retries `40001`/`40P01` up to three times. The same approach covers
double-tapped accepts, cancel-vs-accept races, double drop-offs (the ledger has a unique key) and
two open requests from two tabs (partial unique index).

The test `concurrency: Nusrat and Shirin race for the last seat` runs the race 8 times against a
real Postgres. **I checked that it catches the bug:** with the row lock and conditional update
removed, 7 of 8 rounds failed.

**At larger scale:** single-writer matching per zone partition, idempotency keys, `SKIP LOCKED`
(see [docs/scaling.md](docs/scaling.md)).

## 8. Tech stack and why

| Concern | Choice | Realistic alternatives | Why it fits a ride-pooling MVP | What would make me switch |
|---|---|---|---|---|
| Frontend | **React 19 + Vite + React Router** | Next.js (App Router) | Every screen is behind a login and live-updating, so SSR/SEO buys nothing. A static SPA served by Express keeps one origin and one container. | Public, SEO-relevant pages (landing, pricing) or needing server components. |
| Server state | **TanStack Query** | Redux Toolkit, SWR, hand-rolled `useEffect` | Polling (`refetchInterval`), cache and invalidation after commands, plus loading/error states, without writing that plumbing myself. | Moving to WebSockets (I'd keep it and push updates into its cache). |
| Styling | **Tailwind CSS v4** | CSS Modules, MUI | Fast, consistent spacing and colour without a component library's look or weight. | A design system with a dedicated component library. |
| Backend | **Node.js 22 + Express 4** | NestJS, Fastify | Small API with a clear routes → services → domain split; everyone on the team knows Express. NestJS's DI and decorators would be ceremony here. | Many teams/modules (NestJS structure) or raw throughput needs (Fastify). |
| API style | **REST + JSON** | GraphQL, tRPC | A few resources plus explicit commands (`/pools/:id/start`). Easy to authorise per endpoint and test with curl. | Many clients needing different data shapes. |
| Database | **PostgreSQL 16** | MongoDB, MySQL, SQLite | The core problem is **integrity under concurrency**: row locks, CHECK constraints, partial unique indexes, FKs, multi-row transactions. (See [AI usage](#17-ai-usage): I started from MERN and switched on purpose.) | Almost nothing at this scale; see scaling doc for replicas/partitioning. |
| DB access | **Knex** (query builder + migrations + seeds) | Prisma, Sequelize, raw `pg` | Close to SQL, so `FOR UPDATE` and conditional updates are explicit and reviewable. Migrations and seeds are built in. No codegen or engine binary. | Larger schema where generated types (Prisma/Drizzle) pay off. |
| Validation | **zod** | Joi, express-validator | One schema gives parsing, coercion and field-level error messages, shared by all routes. | — |
| Auth | **JWT in an httpOnly, SameSite=Lax cookie + bcrypt** | Server sessions table, Auth0/Clerk | Stateless across instances. httpOnly blocks token theft via XSS, SameSite blocks CSRF on POSTs, and same-origin serving avoids CORS/third-party-cookie problems. Rate-limited login. | Needing revocation/"log out everywhere" (sessions or refresh-token rotation) or social login. |
| Logging | **pino / pino-http** | winston, morgan | Structured JSON with request IDs in production, pretty in dev, secrets redacted. `LOG_LEVEL=debug` shows every matching decision. | — |
| Tests | **Vitest + Supertest against real PostgreSQL** | Jest, SQLite in-memory, mocks | The risky behaviour (locks, constraints, races) only exists in the real database, so mocks would test nothing. | — |
| Hosting | **Render (Docker, free) + Neon (Postgres, free)** | Railway, Fly.io, Render Postgres | Free, deploys the same Dockerfile, health checks. Neon's free DB doesn't expire (Render's does after 30 days). | Paid tier to avoid cold starts. |
| CI | **GitHub Actions** | — | Runs API tests on Postgres, the client build, and a `docker compose up --wait` smoke test. | — |

## 9. Project structure

```.
├── client/                 # React SPA (Vite)
│   └── src/
│       ├── api/            # fetch wrapper + one function per endpoint
│       ├── auth/           # session context (GET /api/auth/me)
│       ├── components/     # StatusBadge, FareBreakdown, SeatBar, Timeline, ZoneMap, states
│       └── pages/          # passenger/ (request, live ride, history, detail) · driver/ · wallet
├── server/                 # Express API
│   ├── src/
│   │   ├── config/         # env parsing (fails fast)
│   │   ├── db/             # knex, transaction helper with retry, migrate/seed CLI
│   │   ├── domain/         # PURE: zones, fare, matching, state machines
│   │   ├── services/       # commands: rides, driver, pools, payments, wallet, events
│   │   ├── routes/         # HTTP only + zod schemas
│   │   ├── middleware/     # auth, validation, error handler
│   │   └── lib/            # logger, errors, money formatting
│   ├── migrations/         # 3 migrations (schema, constraints, indexes)
│   ├── seeds/              # story cast: Jashim + Bullet, Nusrat, Rafiq, Shirin
│   └── tests/              # unit/ (domain) + integration (HTTP + Postgres)
├── docs/                   # architecture, domain rules, deployment, scaling, screenshots
├── Dockerfile              # multi-stage: build client → prod deps → runtime (non-root)
├── docker-compose.yml      # app + postgres with health checks
└── render.yaml             # free-tier deployment blueprint```

## 10. Running it

### Prerequisites
- **Docker** (with Compose v2), *or*
- **Node.js ≥ 22.9** and **PostgreSQL 16** for running without Docker.

### Environment variables

Copy [`.env.example`](.env.example) to `.env` (never commit `.env`).

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | – (required) | `postgres://user:pass@host:5432/db` |
| `DATABASE_SSL` | `false` | `true` for hosted Postgres (Neon); the certificate is verified |
| `JWT_SECRET` | – (required, ≥16 chars) | signs session tokens |
| `JWT_EXPIRES_IN` | `7d` | session lifetime |
| `COOKIE_SECURE` | `false` | `true` behind HTTPS |
| `PORT` | `4000` | API port |
| `LOG_LEVEL` | `info` | `debug` shows matching decisions and state changes |
| `SEED_ON_START` | `false` (compose: `true`) | container seeds the story cast on start (idempotent) |
| `NODE_ENV` | `development` | `production` in the container |
| `POSTGRES_USER/PASSWORD/DB` | `tesla/tesla/tesla_pool` | used by docker compose only |

### Option A: Docker (one command)

```bash
docker compose up --build
# open http://localhost:4000 and tap "Nusrat" or "Jashim"
```

The app container waits for a healthy Postgres, runs migrations, seeds the cast and starts.
It has its own health check (`/api/health`). Reset everything with `docker compose down -v`.

### Option B: Local development

```bash
cp .env.example .env                 # then set JWT_SECRET
# create the databases (or: docker compose up -d db)
createdb tesla_pool && createdb tesla_pool_test

cd server && npm install
npm run migrate                      # apply migrations
npm run seed                         # Jashim, Bullet, Nusrat, Rafiq, Shirin (idempotent)
npm run dev                          # API on :4000 (auto-reload)

cd ../client && npm install
npm run dev                          # UI on http://localhost:5173 (proxies /api)
```

Other DB commands: `npm run migrate:rollback`, `npm run db:reset` (rollback all → migrate → seed).

### Demo credentials (password `tesla1234` for all)

| Who | Phone | Role |
|---|---|---|
| Jashim | `01711000001` | Driver of **Bullet** (`DHAKA-TESLA-11`, 3 seats) |
| Nusrat | `01711000002` | Passenger, TeslaPay ৳500 |
| Rafiq | `01711000003` | Passenger, TeslaPay ৳300 |
| Shirin | `01711000004` | Passenger, TeslaPay ৳150 |

### Replaying the story (4 browser windows / profiles)

1. **Jashim:** go online in Banani.  2. **Nusrat:** request Banani → Mohakhali.
3. **Jashim:** accept Nusrat (a pool opens).  4. **Rafiq:** request Banani → Gulshan 1. He joins automatically and both estimates drop.
5. **Shirin:** request Banani → Gulshan 1 (last seat, Bullet 3/3).  6. **Jashim:** Arrived → Start (fares lock) → drop off in route order.

## 11. Tests

```bash
cd server && npm test        # needs Postgres; uses TEST_DATABASE_URL or postgres://tesla:tesla@localhost:5432/tesla_pool_test
```

**92 tests** (unit tests for pure domain functions, integration tests over HTTP against a real,
freshly migrated PostgreSQL). They map to the PRD's list:

| PRD requirement | Where |
|---|---|
| Bullet's capacity can never be exceeded | `tests/pooling.test.js` → *Bullet's capacity…* (API + direct DB write rejected by CHECK), `tests/unit/matching.test.js` |
| Invalid state transitions are rejected | `tests/unit/stateMachine.test.js`, `tests/driver.test.js` → *invalid transitions* |
| Nusrat's and Rafiq's pooled fares are correct | `tests/unit/fare.test.js` (৳60.00 / ৳67.50), `tests/pooling.test.js` → *the Banani rush-hour story* (end to end) |
| Users can't modify another user's ride | `tests/rides.test.js` → *Rafiq can neither see nor cancel Nusrat's ride* |
| Cancellation rules hold | `tests/unit/stateMachine.test.js`, `tests/rides.test.js`, `tests/driver.test.js` → *cancellation rules* |
| Two concurrent requests can't corrupt capacity | `tests/pooling.test.js` → *concurrency: Nusrat and Shirin race for the last seat* (×8), double-accept, cancel-vs-accept |
| (extra) Another driver can't act on Jashim's pool; driver commands can't deadlock | tests/driver.test.js, tests/pooling.test.js → *never deadlocks* |
| (extra) Money is exact and charged once | `tests/wallet.test.js` (ledger = balance, unique settlement, cash fallback) |

CI runs the same suite on every push ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## 12. API overview

REST + JSON. Success: `{ "data": … }`. Error: `{ "error": { "code", "message", "details?" } }`.
Codes that matter: `400 VALIDATION_ERROR`, `401`, `403` (wrong role), `404` (also for other
people's rides), `409` (`INVALID_TRANSITION`, `CANNOT_CANCEL`, `ACTIVE_RIDE_EXISTS`,
`NOT_ENOUGH_SEATS`, `DETOUR_TOO_LONG`, `INSUFFICIENT_BALANCE`, …), `503` (DB busy after retries).

| Endpoint | Who | What |
|---|---|---|
| `POST /api/auth/signup` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` | – | session (httpOnly cookie; `Authorization: Bearer` also accepted) |
| `GET /api/zones` · `GET /api/fares/estimate?pickup&dropoff&seats` | public | zones, solo vs pooled quote |
| `POST /api/rides` | passenger | request (auto-joins a compatible open pool) |
| `GET /api/rides` · `/api/rides/active` · `/api/rides/:id` | passenger | history, live ride, detail + timeline |
| `POST /api/rides/:id/cancel` | passenger | cancel while valid |
| `GET /api/driver/me` · `POST /api/driver/online {zone}` · `POST /api/driver/offline` | driver | dashboard, availability |
| `GET /api/driver/requests` · `POST /api/driver/requests/:rideId/accept` | driver | relevant requests, accept |
| `POST /api/pools/:id/arrive` · `/start` · `/rides/:rideId/dropoff` · `/rides/:rideId/no-show` | driver | lifecycle commands |
| `GET /api/pools` · `GET /api/pools/:id` | driver | trip history, pool detail + trip log |
| `GET /api/wallet` · `POST /api/wallet/topup {amountPaisa}` | any / passenger | TeslaPay |
| `GET /api/health` | public | liveness + DB check |

```bash
# example: Rafiq asks for a quote, then books
curl 'localhost:4000/api/fares/estimate?pickup=BANANI&dropoff=GULSHAN_1&seats=1'
curl -c jar -H 'content-type: application/json' -d '{"phone":"01711000003","password":"tesla1234"}' localhost:4000/api/auth/login
curl -b jar -H 'content-type: application/json' -d '{"pickup":"BANANI","dropoff":"GULSHAN_1","seats":1,"paymentMethod":"TESLAPAY"}' localhost:4000/api/rides
```

## 13. Key decisions and trade-offs

- **PostgreSQL over MongoDB.** The one hard invariant (seats ≤ capacity under concurrent
  claims across several rows) is what relational databases are built for. *Trade-off:* SQL and
  migrations instead of the MERN stack I know best.
- **Two state machines.** More states to explain, but per-passenger drop-off and fare
  locking become natural instead of special cases.
- **Pessimistic row lock per pool** (plus conditional update plus CHECK). *Trade-off:* requests for
  the same pool queue briefly. With 3 seats per pool the lock is held for milliseconds. Optimistic
  versioning would need client retries for little gain.
- **Ride row = pool membership** (`rides.pool_id`), no separate `pool_members` table. One place for
  seats, so no drift. History of changes lives in `ride_events`.
- **Fare locked at Start, estimate before.** Honest pricing when people join or cancel. *Trade-off:*
  the passenger sees an estimate, not a promise, until the trip starts.
- **Polling every 3 s instead of WebSockets.** Simple and robust on flaky mobile networks, and
  no extra infrastructure. *Trade-off:* up to 3 s delay and more requests. WebSockets or SSE are the first thing to change at scale.
- **Single container for UI + API.** Same-origin cookies, one free service. *Trade-off:* UI and API deploy together.
- **Zones on a grid, Manhattan distance.** Hand-checkable and good enough to show pooling
  logic. *Trade-off:* not real road distance.

## 14. Assumptions

- Everyone in a pool **boards in the same zone**. Different pickups would need a pickup route and per-passenger arrival.
- A **booking** is one passenger account, and it may reserve 1–3 seats (bringing friends). A single booking of 2 seats is *not* pooling.
- Drivers are **onboarded by operations** (seeded), not self-registered, since that would need KYC and vehicle checks.
- A driver has **one Tesla**, a Tesla has **one active pool**, a passenger has **one active ride**.
- Relevant requests for an idle driver are those **within 4 km** of the Tesla's current zone.
  After a trip, the Tesla is where it made its last drop-off.
- The fare is for the passenger's **direct** distance; the detour cap protects them from paying for pooling detours.
- Cash is collected by the driver at drop-off and recorded as paid. Nothing is rounded to whole taka in the ledger.
- TeslaPay is simulated: top-ups are free (max ৳5,000 each) and no real gateway is involved.
- Times are stored in UTC (`timestamptz`) and shown in the browser's local time (Asia/Dhaka for the demo).

## 15. Known limitations and next improvements

**Limitations**
- No real maps or ETAs; 13 fixed zones; a single pickup zone per pool.
- Status updates arrive by polling (up to 3 s delay).
- A driver cannot abandon an accepted pool before arrival (e.g. Bullet's battery dies). An ops action would be needed.
- No late-cancellation fee, ratings, receipts by SMS, or request expiry (a request waits until cancelled).
- Sessions cannot be revoked server-side before expiry (stateless JWT).
- The free tier sleeps: the first request after idle takes 30–60 s.

**Next improvements**
1. WebSocket/SSE push for ride and pool updates.
2. Driver "release pool" that returns passengers to `REQUESTED` for re-matching.
3. Late-cancellation fee after `DRIVER_ARRIVED`, and request expiry after N minutes.
4. Idempotency keys on all POST commands.
5. H3 cells and real road distances; multiple pickups per pool.
6. Refresh-token rotation and a sessions table for revocation.
7. Playwright E2E test of the story in CI (the flow is already scripted for the screenshots).

## 16. Git workflow

- `master`: integration branch. Every feature arrives through a `--no-ff` merge of a `feature/*` branch.
- `feature/*`: one logical change each, with incremental commits:
  `architecture-docs → api-foundation → passenger-auth → fare-and-matching → ride-requests →
  driver-flow → tesla-pooling → teslapay-wallet → passenger-ui → driver-ui → docker-setup`.
- `pre-release`: cut from `master` once the MVP was integrated. It holds integration fixes found in the
  end-to-end run, docs, screenshots and deployment checks.
- `release/v1.0.0`: cut from `pre-release`, the version shown in the video and deployment (tag `v1.0.0`).
- Commit messages follow `<type>(<scope>): <description>` with types feat/fix/refactor/test/docs/chore/build.

```bash
git log --oneline --graph --all     # see the journey
```

## 17. AI usage

AAI was used openly as an engineering tool, as the brief allows. I have reviewed the code and can explain, change and debug any part of it. I used Claude AI for the entire project build and fixing bugs in every step, and Gemini AI for resolving Git issues.

- **Tools:** Claude (Anthropic), Gemini (Google). 
- **What for:** turning the PRD into an architecture and schema proposal; generating most of the implementation, tests, Docker/CI setup and this README; running the test suite and a scripted browser walkthrough to find integration bugs; producing screenshots; resolving repository and git merge issues.
- **One accepted suggestion:** model pool membership as `rides.pool_id` instead of a separate
  `pool_members` table, and split the lifecycle into a pool machine and a per-passenger ride machine.
  It removed a second copy of seat counts and made per-passenger drop-off and fare locking natural.
- **One rejected / changed suggestion:** the plan was **MongoDB (MERN)**, the stack I know best.
  I chose **PostgreSQL** instead. Seat capacity is a cross-row invariant under concurrent writes, and the
  PRD recommends a relational store for exactly that. It also let us test the real race against a real
  database. *Also changed:* the first matching rule was ratio-only (≤ 1.5× direct distance). A test showed
  it would let a 12 km Uttara trip accept a 3 km opposite-direction detour, so an absolute +2 km cap was added.
- **How I verified it:** 92 automated tests against real Postgres; a mutation check showing the
  race test fails without the row lock; an end-to-end browser run of the whole story.


## 18. Bonus: "If Oi Tesla goes viral"

Reasoning for 1M passengers and 100k drivers (load balancing, replicas, geospatial search,
queues, realtime, rate limiting, idempotency, observability, contention, matching, failure
handling, security, deployment) with a diagram: **[docs/scaling.md](docs/scaling.md)**.