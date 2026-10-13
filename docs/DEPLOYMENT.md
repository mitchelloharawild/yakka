# Deploying Yakka

Yakka is a single Next.js app: the UI, the API, the cron endpoints and the
service worker all come from one deployable. It needs a database (Postgres or
SQLite) and, for the PWA features, **HTTPS**.

| Option | Database | Cron | Good for |
|---|---|---|---|
| [Vercel](#vercel) | Hosted Postgres (Neon, Supabase, ...) | Vercel Cron → `/api/cron/tick` | Zero-ops |
| [Docker + Postgres](#docker--postgres) | Postgres container | In-process (`node-cron`) | VPS, several users |
| [Docker + SQLite](#docker--sqlite) | File in a volume | In-process | Homelab, one container |

## HTTPS is required

Service workers (offline use, the offline queue), Web Push and Web NFC only
work in a **secure context**. `http://localhost` counts as one; nothing else
does. Put Yakka behind a reverse proxy that terminates TLS. For example, with
Caddy:

```
yakka.example.com {
  reverse_proxy localhost:3000
}
```

Set `BASE_URL=https://yakka.example.com` so tag and group links point at the
public origin. The proxy should append to `X-Forwarded-For` (Caddy, nginx
with `proxy_add_x_forwarded_for` and Traefik do); rate limiting reads the
client IP from it, or from the header named in `RATE_LIMIT_IP_HEADER` (see
[Rate limiting](#rate-limiting)). On iOS, push notifications only work after
"Add to Home Screen" (iOS 16.4+), and NFC/QR scans always open Safari rather
than the installed app (ARCHITECTURE §3).

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | Docker: `file:/data/yakka.db` | `postgresql://...` or `file:/path/to.db` |
| `DATABASE_PROVIDER` | inferred | `sqlite` forces SQLite; otherwise a `file:` URL means SQLite |
| `BASE_URL` | `http://localhost:3000` | Public origin, no trailing slash |
| `CRON_SECRET` | | `Authorization: Bearer` for `/api/cron/*`. Vercel sends it automatically |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | | Web Push. Without the keys, push is off and the toggle says so |
| `PUSH_ALLOWED_HOSTS` | | Extra Web Push service hosts (comma-separated, `*.` for subdomains). FCM, Mozilla, Apple and WNS are always allowed; see [VAPID keys](#vapid-keys) |
| `ENABLE_INTERNAL_CRON` | `false` (image: `true`) | Run the 5-minute tick in-process. Ignored on Vercel |
| `ENABLE_GROUP_DELETION` | `true` | |
| `ALLOW_JOIN_FROM_TAG_DEFAULT` | `true` | Default `joinFromTag` for new groups |
| `ANALYTICS_PROVIDER` | | See [Analytics](#analytics) |
| `WEBHOOK_ALLOW_PRIVATE_NETWORKS` | `true`; **`false` on Vercel** | Outbound webhooks to LAN/loopback addresses. Set `false` on any instance strangers can use ([API.md](API.md#allowed-urls-ssrf)) |
| `NTFY_URL` / `NTFY_TOKEN` | | **Single-household instances only.** Sends every group's due/overdue notices (group name, chore title, group link) to one ntfy topic. Off unless set |
| `APPRISE_URL` | | Same, to an Apprise API notify URL. **Single-household instances only** |
| `RATE_LIMIT_ENABLED` | `true` | |
| `RATE_LIMIT_IP_HEADER` | `x-forwarded-for` (Vercel: `x-vercel-forwarded-for`) | Which header holds the client IP: `x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`, `x-vercel-forwarded-for` or `none`. See [Rate limiting](#rate-limiting) |
| `RATE_LIMIT_PROXY_HOPS` | `1` | With `x-forwarded-for`: trusted proxies that append to it |
| `SKIP_MIGRATIONS` | `false` | Docker only: skip `prisma migrate deploy` on start |
| `PORT` / `HOSTNAME` | `3000` / `0.0.0.0` | Docker only |

### VAPID keys

```sh
npx web-push generate-vapid-keys
```

Put the public key in `VAPID_PUBLIC_KEY`, the private key in
`VAPID_PRIVATE_KEY`, and a contact (`mailto:you@example.com` or an https URL)
in `VAPID_SUBJECT`. Keep the keys: changing them invalidates every existing
subscription, and members have to turn notifications on again.

A browser sends its push subscription's endpoint URL, and the cron job POSTs
to it. To stop that being used to make the server call arbitrary URLs,
subscriptions are only accepted for the push services browsers use:
`fcm.googleapis.com` (Chrome, Edge, Samsung Internet), `*.push.services.mozilla.com`
(Firefox), `*.push.apple.com` (Safari) and `*.notify.windows.com`, over https
on the default port. Add others with `PUSH_ALLOWED_HOSTS`. Saved
subscriptions on other hosts are deleted instead of being sent to.

## Vercel

1. Create a Postgres database (Vercel Marketplace: Neon or Supabase) and set
   `DATABASE_URL` to its connection string.
2. Import the repo in Vercel and set `BASE_URL`, `CRON_SECRET` and the VAPID
   variables. Leave `ENABLE_INTERNAL_CRON` unset.
3. Set the build command to `npx prisma migrate deploy && npm run build`
   (or run `migrate deploy` from CI).
4. `vercel.json` schedules `/api/cron/tick` every 5 minutes. **The Hobby plan
   only runs cron jobs once a day**; use Pro, or call
   `curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/cron/tick`
   from an external scheduler.

SQLite doesn't work on Vercel (no persistent disk), and the in-memory rate
limits are per function instance there.

## Docker

The image `ghcr.io/mitchelloharawild/yakka` (built by
`.github/workflows/docker.yml` on every push to `main` and on `v*` tags, for
amd64 and arm64) serves both databases. At start-up it runs
`prisma migrate deploy` for whichever database `DATABASE_URL` points at, then
starts the standalone server as a non-root user (uid 1001). It sets
`ENABLE_INTERNAL_CRON=true`, and its `HEALTHCHECK` polls
`/api/health/liveness`.

Build it yourself with `docker build -t yakka .`.

### Docker + Postgres

```sh
cp .env.example .env   # set BASE_URL, CRON_SECRET, VAPID_*, POSTGRES_PASSWORD
docker compose -f compose.prod.yaml up -d
```

The compose project is named `yakka-prod`, so it doesn't clash with the
development `compose.yaml` (which only runs Postgres on :5432).

With several app replicas, every replica runs the cron tick. The jobs are
idempotent, so this only costs duplicate work; you can also set
`ENABLE_INTERNAL_CRON=false` on all but one. Use `SKIP_MIGRATIONS=true` if you
migrate separately.

### Docker + SQLite

```sh
docker compose -f compose.sqlite.yaml up -d
# or simply
docker run -d -p 3000:3000 -v yakka-data:/data ghcr.io/mitchelloharawild/yakka
```

Without `DATABASE_URL` the image uses `file:/data/yakka.db`. Back up by
copying the volume while the container is stopped, or with
`sqlite3 yakka.db ".backup backup.db"` while it runs. The app turns on WAL
mode at start-up.

## Health checks

- `GET /api/health/liveness`: always `200 {"status":"ok"}` while the process
  is up. It never touches the database.
- `GET /api/health/readiness`: `200 {"status":"ok","database":"sqlite"|"postgresql"}`
  when a `SELECT 1` succeeds within 3 s, otherwise `503`.

Both send `Cache-Control: no-store`.

## SQLite: how it works and trade-offs

Prisma 7 bakes the database provider into the generated client. So:

- `prisma/sqlite/schema.prisma` is **generated** from `prisma/schema.prisma`
  by `npm run db:sqlite:schema` (it swaps the provider and the client output
  path). A unit test fails if it falls out of sync. The main schema stays
  portable: no scalar lists, no `@db.*` types.
- SQLite has its **own migrations** in `prisma/sqlite/migrations`.
  `prisma.config.ts` picks the schema and the migrations directory from
  `DATABASE_PROVIDER` / `DATABASE_URL`. After changing the schema, create
  both migrations:

  ```sh
  npm run db:migrate                                              # Postgres
  npm run db:sqlite:schema
  DATABASE_URL=file:./data/yakka.db npx prisma migrate dev --name <same-name>  # SQLite
  ```

- `npm install` generates **both** clients (`src/generated/prisma` and
  `src/generated/prisma-sqlite`). `src/lib/db.ts` picks one at runtime
  (`PrismaPg` or `PrismaBetterSqlite3`), so one build and one image serve
  either database. The app keeps importing types from
  `@/generated/prisma/client`. The model types are identical, and the error
  classes come from the shared Prisma runtime.

Trade-offs:

- Postgres-only query options (`mode: "insensitive"`, for example)
  type-check but fail at runtime on SQLite. Don't use them.
- SQLite allows one writer at a time. Fine for a household, not for many
  replicas: SQLite means **one container**.
- Two migration histories have to be kept in step by hand.
- `DateTime` is stored as text/integer, and `Json` as text. Prisma hides this.

## Rate limiting

`src/proxy.ts` applies a sliding-window limit per client IP:

| Paths | Limit |
|---|---|
| `/t/*` and tag tRPC calls (`/api/trpc/tags.*`) | 30 / min |
| `/api/hooks/*` | 30 / min |
| `/api/offline/*` | 30 / min |
| `/api/v1/*` | 120 / min |

Batched tRPC requests count once per `tags.*` procedure in the batch, and
the tRPC endpoint refuses batches of more than 10 calls, so batching can't
multiply the limit.

When a client goes over, it gets `429` with `Retry-After` (and
`RateLimit-Limit` / `RateLimit-Remaining`). The counters are **in memory, per
process**. With N instances the effective limit is N times higher, and a
restart resets them. That's enough to make guessing a 12-character tag token
hopeless, but use a shared store if you need exact limits.

### Settings PIN attempts

Wrong settings PINs (group settings, Integrations, tag management) are limited
separately, per group: after **5 wrong PINs from one client** that client is
locked out of the group's PIN for 30 s, doubling with each further wrong PIN;
after **20 wrong PINs from all clients together** the whole group's PIN is
locked for 1 min, doubling likewise (both capped at 1 h, and forgotten after
6 h without failures). While locked, the API answers `TOO_MANY_REQUESTS` with
reason `PIN_LOCKED` and `retryAfterSeconds`, without checking the PIN. The
trade-off: someone hammering a group's PIN can keep its members out of the
settings for a while. These counters are also in memory and per instance.

### Where the client IP comes from

Next.js 16 doesn't give the proxy the socket address (`NextRequest.ip` was
removed in 15), so the client IP has to come from a header, and only from the
one header your deployment controls. Set `RATE_LIMIT_IP_HEADER` to match:

| Deployment | `RATE_LIMIT_IP_HEADER` | Notes |
|---|---|---|
| Behind Caddy, nginx, Traefik, a load balancer | `x-forwarded-for` (default) | Set `RATE_LIMIT_PROXY_HOPS` to the number of proxies that append to it. The `hops`-th address from the right is used, so a client-sent value is ignored |
| Proxy that sets `X-Real-IP` (and overwrites a client-sent one) | `x-real-ip` | |
| Behind Cloudflare | `cf-connecting-ip` | Only if the origin is reachable through Cloudflare alone |
| Vercel | `x-vercel-forwarded-for` (default there) | Set by Vercel's edge |
| No reverse proxy | `x-forwarded-for` | `next start` fills `X-Forwarded-For` with the socket address, but keeps one the client sent, which makes the limit easy to dodge. Fine on a LAN; put a proxy in front of anything public |
| Can't trust any header | `none` | Every client shares one bucket |

A request without the configured header counts against one shared
`unknown` bucket. Never pick a header that clients can set and your proxy
passes through unchanged.

## Analytics

Group ids and tag tokens are secrets. If you set `ANALYTICS_PROVIDER`, report
paths through `stripIdsFromPath()` from `src/lib/analytics.ts`
(`/groups/Xk3…/chores/cm…?as=…` becomes `/groups/[groupId]/chores/[id]`), and
never send the query string. No provider script is bundled yet.

## Service worker

`src/app/sw.ts` (Serwist) is served at `/sw.js` by the route handler
`src/app/sw.js/route.ts`, which `next build` **prerenders**, so the service
worker is an ordinary static build output on every target:

1. `npm run build` first runs `scripts/build-sw.mjs`, which bundles
   `src/app/sw.ts` with esbuild into `.sw/sw.js` (gitignored), leaving a
   placeholder for the precache manifest.
2. `next build` compiles the app (writing the hashed `.next/static` files),
   then prerenders `/sw.js`: the handler reads `.sw/sw.js` and injects the
   precache manifest (`src/lib/sw-manifest.ts`: the `.next/static` JS, CSS
   and fonts, the icons in `public/`, `/offline` and the web manifest).

Why not write `public/sw.js` after `next build`? Deployment adapters,
including Vercel's, collect the build outputs (static files included) when
`next build` finishes, so a file added to `public/` afterwards may not be
deployed. A prerendered route is part of those outputs; it also ends up in the
Docker image's standalone server without any extra copying. Nothing reads
`.sw/` at runtime.

We don't use `@serwist/turbopack`/`@serwist/next`: they depend on
`@swc/core`, whose native binary won't load when `~/.cache` is
group-writable. `/sw.js` is served with `Cache-Control: no-cache, no-store,
must-revalidate` and `Service-Worker-Allowed: /` (set by the route and in
`next.config.ts`).

The service worker is only registered in production builds. To try it with
`next dev`, run `npm run sw:build -- --dev` and set
`NEXT_PUBLIC_ENABLE_SW=true` (in dev the precache manifest is empty).
