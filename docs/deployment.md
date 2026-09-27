# Deployment (free tier only)

The app is one Docker image (API + built React app) plus a PostgreSQL database.
Everything below is free, with no credit card needed for Neon. Render may ask for one
to verify the account, but the free plan is not charged.

| Piece | Host | Free-tier constraint | What it means for the demo |
|---|---|---|---|
| App container | **Render** web service (Docker, free plan) | Sleeps after ~15 min idle; the first request takes ~30–60 s to wake up | Open the URL a minute before the demo |
| Database | **Neon** Postgres (free) | 0.5 GB storage, compute scales to zero | More than enough; first query after idle is a bit slower |

Why not Render's own free Postgres: it is deleted 30 days after creation, which would
break the deployment link before evaluation finishes.

## Steps

1. **Database:** create a project at neon.tech. Copy the connection string
   (`postgresql://…neon.tech/neondb?sslmode=require`).
2. **App:** push the repo to GitHub. In Render choose **New → Blueprint** and pick the repo.
   Render reads `render.yaml`, builds the `Dockerfile` and asks for `DATABASE_URL`.
   Paste the Neon string. `JWT_SECRET` is generated for you.
3. On start the container runs migrations and seeds the story cast (`SEED_ON_START=true`,
   idempotent), then serves the app. Render polls `/api/health`.
4. Open `https://<service>.onrender.com` and sign in as Nusrat or Jashim from the login screen.

Production settings: `COOKIE_SECURE=true` (HTTPS only), `DATABASE_SSL=true` (certificate
verified), JSON logs at `info`, container runs as the non-root `node` user.

## If free hosting is not available

The same image runs anywhere Docker runs:

```bash
docker compose up --build        # app on :4000, Postgres on :5432
```

## Continuous integration

`.github/workflows/ci.yml` runs on every push. It runs the API tests against a real
PostgreSQL 16 service container, builds the client, then builds the Docker image and does a
`docker compose up --wait` smoke test (health check + demo login).
