# Development guide

Conventions for working on Yakka. Read [ARCHITECTURE.md](ARCHITECTURE.md) first
for the design. This file covers how the code is laid out, who built what, and
the Next.js 16 / Prisma 7 traps we have already hit.

## Setup

```sh
cp .env.example .env
docker compose up -d        # Postgres 17 on :5432
npm install                 # postinstall runs `prisma generate` (client in src/generated/prisma, gitignored)
npm run db:deploy           # or db:migrate in development
npm run db:seed             # demo group; prints the group URL and a tag URL
npm run dev                 # http://localhost:3000
```

**Git worktrees** don't share `node_modules` or `src/generated/prisma`. Run
`npm ci` in a new worktree; that also generates the Prisma client. All
worktrees share the same Postgres database.

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js (Turbopack) |
| `npm test` | vitest, run once (`npm run test:watch` to watch) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | `tsx prisma/seed.ts` |

All four of `typecheck`, `lint`, `test` and `build` must pass before you
commit.

## Directory layout and ownership

The parallel build phase (four agents, one area each) is over, so any change
may touch any area. The table records who built what and is still a good map
of where things live; the "frozen"/"don't change" notes are guidance now, not
rules (schema changes need both a Postgres and a SQLite migration).

| Path | Built by | Notes |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/` | foundation (frozen) | **Don't change the schema.** Ask first if you must |
| `package.json`, `package-lock.json` | foundation (frozen) | Every dependency is already installed (list below) |
| `src/lib/{db,env,ids,errors,schedule,assignee,activity,events}.ts` | foundation | Shared domain library. Bug fixes are fine; keep the APIs stable |
| `src/lib/services/{groups,members,chores,completions}.ts` | foundation, extended by A | Business logic for the tRPC routers |
| `src/lib/client/local-groups.ts` | foundation | Browser identity store, used by A and B |
| `src/components/identity-picker.tsx` | integration | The one "Who are you?" picker, used by the group shell and `/t/{token}` |
| `src/trpc/init.ts`, `src/trpc/routers/_app.ts`, `src/trpc/{client,server,query-client}.tsx?` | foundation | Shouldn't need edits |
| `src/app/layout.tsx`, `src/components/{providers,app-header,theme-toggle}.tsx` | foundation | A may restyle the header |
| `src/components/ui/*` | shared (shadcn) | Add components with `npx shadcn@latest add <name>`; don't hand-edit existing ones |
| **A: group UI** | | |
| `src/trpc/routers/groups.ts` | A | |
| `src/app/page.tsx`, `src/app/groups/**` | A | Home, create group, group dashboard, settings, activity |
| `src/components/group/**` | A | |
| `messages/en/group.json` | A | |
| **B: tags + tap-to-complete** | | |
| `src/trpc/routers/tags.ts`, `src/lib/services/tags.ts` | B | |
| `src/app/t/**`, `src/app/groups/[groupId]/tags/**` (QR sheet etc.) | B | Coordinate the group-side tag pages with A via links only |
| `src/components/tag/**`, `messages/en/tag.json` | B | |
| **C: REST API, webhooks, cron, push sending** | | |
| `src/trpc/routers/integrations.ts`, `src/lib/integrations/**` | C | Webhook delivery and signing, push sending, cron jobs |
| `src/app/api/v1/**`, `src/app/api/hooks/**`, `src/app/api/cron/**` | C | |
| `src/components/integrations/**`, `messages/en/integrations.json` | C | |
| **D: PWA + deployment** | | |
| `src/trpc/routers/push.ts` | D | Push subscription save/delete |
| `src/app/manifest.ts`, `src/app/sw.ts`, `src/app/api/health/**`, `public/**` | D | |
| `src/lib/client/offline-queue.ts`, `src/components/pwa/**`, `messages/en/pwa.json` | D | |
| `Dockerfile`, `compose*.yaml`, SQLite support in `src/lib/db.ts` | D | |
| `src/proxy.ts` | D (rate limiting); C may add to it | Next 16's name for middleware |

## Installed dependencies

tRPC v11 (`@trpc/server`, `@trpc/client`, `@trpc/tanstack-react-query`),
`@tanstack/react-query` v5, `zod` v4, `superjson`, `next-intl` v4, shadcn/ui
(radix base, `radix-ui`, `cn`, `class-variance-authority`, `tw-animate-css`,
`cmdk`, `react-day-picker`, `input-otp`), `lucide-react`, `sonner`,
`next-themes`, `react-hook-form` + `@hookform/resolvers`, `rrule`, `date-fns` +
`@date-fns/tz`, `qrcode`, `web-push`, `serwist` + `@serwist/next` +
`@serwist/turbopack` (+ `@serwist/cli`, `esbuild`), `idb`, `node-cron` (ships
its own types), `@prisma/adapter-pg`, `@prisma/adapter-better-sqlite3` +
`better-sqlite3`, `nanoid`, `server-only`/`client-only`, and for development
`vitest`, `@vitest/coverage-v8` and `tsx`.

## Data model notes

- The schema must stay **portable between Postgres and SQLite**: no scalar
  lists, no `@db.*` native types. `Webhook.events` is a **comma-separated
  string**. Always use `parseWebhookEvents` / `serializeWebhookEvents` from
  `src/lib/events.ts`.
- Group id = access secret (22 base62 characters). Tag token = narrower
  secret (12 characters from a no-lookalike alphabet). Generate them with
  `src/lib/ids.ts`. Never use cuid for these.
- Never send `Group.settingsPin` to a client. Wrap groups in
  `toPublicGroup()`, which replaces it with `hasSettingsPin`.
- **What the settings PIN gates** (when a group has one): group settings,
  setting/clearing the PIN, deleting the group, everything that hands out or
  withdraws a credential (API tokens, inbound hooks including revealing a
  hook URL, webhooks including revealing/rotating the secret and "Send
  test") and creating, replacing or revoking tags. Use
  `groupPinProcedure` from `@/trpc/init` (input `pin`). Everyday actions stay
  ungated on purpose: completing and undoing, adding, editing and archiving
  members and chores, editing a tag's label or QR / NFC toggles. Reads never return secrets: hook
  URLs are listed masked (`maskedUrl`), webhook secrets as a hint.
- Check PINs only with `assertSettingsPin(group, pin, { client: ctx.clientIp })`.
  It applies the in-memory attempt limiter (`src/lib/pin-limiter.ts`) and
  throws `TOO_MANY_REQUESTS` / `PIN_LOCKED` with `retryAfterSeconds` (exposed
  as `error.data.retryAfterSeconds`; `useErrorMessage()` formats it).
- Nothing is hard-deleted from the UI. Groups are soft-deleted (`deletedAt`,
  purged by cron), and members and chores are archived (`archivedAt`).
  Completions are undone (`undoneAt`), never deleted.
- `SystemState` is a tiny instance-wide key/value table (`key`, `value`,
  `updatedAt`); the cron job keeps its last tick time there.
- `WebhookDelivery` is the outbound queue (see Events). `ChoreNotice` makes
  the due/overdue cron idempotent, through its unique key
  `(choreId, kind, dueAt)`.
- `Completion.completedAt` is when the chore was done, which may be backdated
  for offline replays. `Completion.createdAt` is when the server recorded it;
  the undo window counts from `createdAt`.

## Domain library (src/lib)

Everything that isn't UI goes in `src/lib`. Services take plain inputs, check
them with zod and throw `DomainError(code, reason)` (`src/lib/errors.ts`). The
tRPC layer turns these into `TRPCError`s, and clients read the reason from
`error.data.reason` (e.g. `"UNDO_WINDOW_EXPIRED"`). Every write logs an
Activity row via `logActivity(tx, …)` inside the same transaction.

### Schedule status (`src/lib/schedule.ts`)

The next due date is **never stored**. Work it out on read:

```ts
import { computeSchedule } from "@/lib/schedule";
const s = computeSchedule({ chore, timezone: group.timezone, lastCompletion, previousCompletions, completeHistory, now });
// s: { status: "upcoming"|"due"|"overdue"|"done"|"unscheduled", nextDueAt, overdueAt,
//      dueToday, recurring, missedCount, lastCompletion }
```

In most code you won't call this directly. `listChores()` and `getChoreView()`
in `src/lib/services/chores.ts` return a `ChoreView`: the chore plus
`schedule` and `currentAssigneeId`, sorted by urgency.

The rules:

- `rrule` holds the RRULE body without DTSTART, e.g. `FREQ=WEEKLY;BYDAY=MO`,
  checked on write with `validateRRule`. It's evaluated as **wall-clock time in
  the group timezone**, so "09:00 every day" stays 09:00 across DST changes.
  A time that doesn't exist (inside a DST gap) moves forward.
- DTSTART is `chore.startsAt`. If that's null, it's local midnight on the day
  the chore was created, so the chore is due at 00:00. Combine that with
  `graceMinutes = 1440` to mean "any time that day". The UI should normally
  ask for a time.
- `anchor = DUE_DATE`: a completion satisfies the **earliest occurrence not
  yet satisfied**. With P the latest occurrence at or before the completion
  and N the next one:
  - P not satisfied yet (it was missed): a late completion of P, so N is
    next. Weekly Monday chore, Monday 5 Oct missed, done Friday 9 Oct: next
    due Monday 12 Oct. Exception: within the **early window** before N (a
    quarter of the interval, at most 12 h; Sunday evening for a Monday
    chore) it counts for N instead.
  - P already satisfied: in the second half of the interval it's an early
    completion of N (done Saturday for Monday); in the first half it's an
    extra completion and changes nothing.
  - Before the first occurrence: an early completion of it if within the
    early window, otherwise an extra completion that changes nothing (so a
    stray tap days ahead can't skip the first due date).
  This needs a little history, so pass `previousCompletions` (the
  `SCHEDULE_HISTORY` = 10 non-undone completions before the last, newest
  first; DUE_DATE only looks at 3 of them) and `completeHistory` (true if
  there are no older ones).
  `toChoreView()` and the cron job do. Without history, whether P was
  satisfied is unknown and the plain midpoint rule applies.
- `anchor = COMPLETION`: the next due date is counted from the completion's
  local date, at DTSTART's time of day. For HOURLY rules and finer, it's
  counted from the exact completion time.
- `anchor = ADAPTIVE` (an **adaptive schedule**): the interval is learnt from
  the gaps between the last `ADAPTIVE_WINDOW` + 1 = 11 completions. With at
  least `ADAPTIVE_MIN_GAPS` = 3 gaps, the chore is due at the last completion
  plus the **median** gap and overdue at the last completion plus the **80th
  percentile** gap (linear interpolation; `graceMinutes` is ignored). Until
  then the `rrule`, if any, is a starting guess evaluated like the
  COMPLETION anchor, with `graceMinutes`; with no `rrule` it's `unscheduled`
  while it learns. A learnt chore never rolls forward (`missedCount` is 0).
  `schedule.adaptive` reports `{ gaps, learned, dueAfterMs, overdueAfterMs }`
  (null for other anchors).
- A neglected recurring chore rolls forward: `nextDueAt` is the latest
  occurrence that has started, and `missedCount` says how many were skipped.
  A chore with missed occurrences is `overdue`. Missed occurrences are never
  owed: one completion catches the chore up.
- One-off chore (`rrule` null, `startsAt` set): it's due at `startsAt`, then
  `done` after any completion. With both null, it's `unscheduled`.
- `overdueAt = nextDueAt + graceMinutes` (except learnt ADAPTIVE chores). With grace 0, a chore goes straight
  from `upcoming` to `overdue`.

Other helpers: `describeRRule` (English text), `upcomingOccurrences` (editor
preview), `toWallClock`/`fromWallClock`/`startOfLocalDay`/`sameLocalDay`,
`isValidTimezone` and `compareSchedules`.

**Cron:** `scheduleTransitions({ chore, timezone, lastCompletion, previousCompletions, completeHistory, since, now })`
returns `[{ kind: "due"|"overdue", dueAt, overdueAt, at }]` for each threshold crossed in
`(since, now]`. For each transition, insert a `ChoreNotice` (catch the unique
violation) and only notify if the insert succeeded.

### Assignee (`src/lib/assignee.ts`)

`currentAssigneeId({ chore, members, lastCompletedBy })` works like this:

- `ANYONE`: always null.
- `FIXED`: `assigneeId`, or null if that member is archived.
- `ROUND_ROBIN`: the next non-archived member (ordered by `createdAt`) after
  whoever did the last completion. An archived last completer keeps their
  place in the order, so the turn passes to the next active member after
  them rather than resetting. With no completion (or an automation one) it
  starts at `assigneeId`, or at the first member. Pass **all** members,
  archived included.

### Completions (`src/lib/services/completions.ts`)

```ts
completeChore({ choreId, groupId?, memberId?, source: "TAG"|"MANUAL"|"API"|"WEBHOOK",
                tagId?, deviceId?, note?, completedAt?, now? })
  → { completion, deduplicated: boolean, chore: ChoreView }
undoCompletion({ completionId, groupId, actor?, enforceWindow: boolean, now? })
  → { completion, alreadyUndone: boolean, chore: ChoreView }
listCompletions({ groupId, choreId?, memberId?, includeUndone?, limit?, cursor? })
completionTallies(groupId, since?)
```

- **Debounce.** If a non-undone completion of the same chore exists within
  `group.debounceMinutes` (default 5) of `completedAt`, that one is returned
  with `deduplicated: true`. This runs in a serializable transaction with
  retries, so even concurrent double-taps produce exactly one row (tested).
  This also makes offline replays idempotent.
- **Undo.** The tag page uses `enforceWindow: true`, which allows undo for
  `group.undoSeconds` after `createdAt`. The group UI uses
  `enforceWindow: false`, with no time limit: anyone with the group link has
  full access anyway. Undo is idempotent, also under concurrency: it is a
  conditional update (`undoneAt: null`), and only the request that wins it
  logs `completion.undone` and emits `chore.undone` (the loser gets
  `alreadyUndone: true`).
- If you pass `tagId`, it must belong to the chore and must not be revoked
  (otherwise you get `TAG_REVOKED`). Using a tag updates `tag.lastUsedAt`.
- `completedAt` may be backdated by up to 14 days, or set up to 5 minutes in
  the future.

### Events (`src/lib/events.ts`)

```ts
emitEvent(type, { group: { id, name, timezone }, data }, db?) → { event, deliveries }
onEvent(type | "*", listener) → unsubscribe
```

Event types are `chore.completed`, `chore.undone`, `chore.due` and
`chore.overdue`. Payload types are in `EventPayloads`, and the POST body is
`EventEnvelope` (`{ id, type, createdAt, group: { name, timezone }, data }`).
The group id is deliberately left out of payloads.

`completeChore` and `undoCompletion` already emit events. `emitEvent` inserts
one `WebhookDelivery` row per enabled webhook that subscribes to the type,
then calls the in-process listeners. Listener errors are logged and
swallowed. **Agent C** owns the delivery worker: pick due rows
(`deliveredAt`/`failedAt` null, `nextAttemptAt <= now`), sign them, POST them,
apply backoff, and set `Webhook.failCount`/`disabledAt`. C can register an
`onEvent("*")` listener to kick off delivery straight away. The cron job
emits `chore.due` and `chore.overdue`.

### Integrations (`src/lib/integrations/`, Agent C)

- `webhooks.ts` is the delivery worker. `processDueDeliveries({ groupId?, now? })`
  claims each row with a conditional update, so concurrent workers never
  double-send. The claim lease (2 min) starts when the row is claimed, not
  when the sweep started. Requests go through `node:http(s)` with
  `guardedLookup()` from `url-safety.ts` as the socket's DNS lookup, so the
  SSRF check applies to the address actually connected to. It retries on the schedule in `backoff.ts` and auto-disables a
  webhook after 15 consecutive failed attempts. `listeners.ts` registers an
  `onEvent("*")` listener that delivers straight away via `after()`. The
  integrations tRPC router and the REST routes import it, so it's active in
  every server bundle that emits events.
- `cron.ts` exports **`runCronTick(opts?: { now?: Date; since?: Date }): Promise<CronTickResult>`**.
  Agent D calls it from node-cron every 5 minutes in Docker. It runs due/overdue
  detection (ChoreNotice), Web Push, ntfy/Apprise, webhook delivery and the
  purge. `since` defaults to the last successful tick, stored in the
  database (`SystemState` key `cron.lastTickAt`, written once detection has
  finished), clamped to between 15 minutes and 24 hours ago. So a cold start
  or an infrequent external scheduler doesn't miss transitions, and a first
  run doesn't flood. Overlap is harmless.
- REST and webhook payloads are documented in [API.md](API.md).

### Push payload

`sendPushToGroup(groupId, payload, { memberIds? })` in
`src/lib/integrations/push.ts` sends this JSON as the push message body. The
service worker (`src/app/sw.ts`, Agent D) parses it and shows a notification:

```ts
interface PushPayload {
  title: string;  // e.g. "🐈 Feed the cat"
  body: string;   // e.g. "Overdue — Sam's turn"
  url: string;    // same-origin path to open on click, e.g. "/groups/{groupId}"
  tag?: string;   // "chore-{choreId}": a later notice for the same chore replaces the earlier one
}
```

Without VAPID keys it does nothing (and logs once). Endpoints must be on a
known push service (`isAllowedPushEndpoint` in `url-safety.ts`, extended by
`PUSH_ALLOWED_HOSTS`): `push.subscribe` refuses others, and sending deletes
any saved row that doesn't match. Push services answering
404 or 410 cause the `PushSub` to be deleted. Other failures increment
`failCount`, and the subscription is deleted after 5 of them.

### Other

- `src/lib/env.ts`: call `env()` for a typed, lazily parsed environment
  (`BASE_URL` defaults to `http://localhost:3000`; booleans accept
  `true/1/yes/on`). It never throws for optional values, so `next build`
  works without them. Also exports `isPushConfigured()`.
- `src/lib/ids.ts`: `newGroupId`, `newTagToken`, `newApiToken()` (returns
  `{ token, hash, prefix }`, `yk_…`), `hashToken` (SHA-256 hex),
  `newHookSecret`, `newWebhookSecret` (`whsec_…`), `safeEqual`,
  `hashPin`/`verifyPin` (scrypt), `isPlausibleGroupId`/`isPlausibleTagToken`.
- `src/lib/activity.ts`: `ACTIVITY_TYPES` (add new ones here),
  `logActivity(db, …)`, `listActivity(db, …)`.

## tRPC

- Root router: `src/trpc/routers/_app.ts` mounts `groups`, `tags`,
  `integrations` and `push`. **Don't edit it.** Add procedures to your
  sub-router file.
- Builders come from `@/trpc/init`:
  - `baseProcedure`: no access check.
  - `groupProcedure`: its input always includes
    `{ groupId: string; actor?: { memberId?, deviceId? } }`. It loads the
    non-deleted group into `ctx.group` (or throws NOT_FOUND) and puts the
    actor in `ctx.actor`. Chain `.input(z.object({...}))` to add fields
    (tRPC merges the objects).
  - Tag-token procedures (B) should be `baseProcedure` with `{ token }` input
    that resolves the tag themselves. A tag token must never grant group
    access beyond its own chore.
- Adding a procedure:

  ```ts
  // src/trpc/routers/tags.ts
  export const tagsRouter = createTRPCRouter({
    resolve: baseProcedure.input(z.object({ token: z.string() })).query(({ input }) => resolveTag(input.token)),
  });
  ```

  Put the logic in `src/lib/services/<area>.ts` and keep the router thin.
  Throw `DomainError` for expected failures.
- **Client** (`"use client"`):

  ```ts
  import { useTRPC } from "@/trpc/client";
  const trpc = useTRPC();
  const { data } = useQuery(trpc.groups.chores.list.queryOptions({ groupId }));
  const complete = useMutation(trpc.groups.chores.complete.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.groups.chores.list.queryKey({ groupId }) }),
  }));
  complete.mutate({ groupId, choreId, actor: getActor(groupId) });
  ```

  The QueryClient refetches on window focus, with a 30 s stale time. Dates
  survive the round trip as `Date` objects (superjson).
- **RSC** (`src/trpc/server.tsx`): `await prefetch(trpc.x.y.queryOptions(...))`
  plus `<HydrateClient>`, with `useSuspenseQuery` in the client component.
  Or use `const api = await caller()` for direct calls. Both must be used
  inside `<Suspense>` (see below).
- Batches are capped at `TRPC_MAX_BATCH` (10, `src/trpc/limits.ts`) on both
  the server (`maxBatchSize`) and the client (`maxItems`), and the proxy
  counts every `tags.*` call in a batch against the tag rate limit.
- `ctx.clientIp` is the client IP per `RATE_LIMIT_IP_HEADER`
  (`requestClientIp()` in `src/lib/rate-limit.ts`; `"unknown"` for RSC calls).
- HTTP: `/api/trpc/<path>`. To call it from curl:
  `GET /api/trpc/groups.get?input={"json":{"groupId":"…"}}` (URL-encoded).

## Identity in the browser (`src/lib/client/local-groups.ts`)

The localStorage layout follows [ARCHITECTURE §4](ARCHITECTURE.md#4-identity-in-the-browser):
`groups = [{ id, name, memberId, starred, lastOpened }]` and a lazily created
`deviceId`.

- Hooks: `useLocalGroups()`, `useLocalGroup(id)`,
  `useIdentity(groupId) → { memberId, setMemberId(id|null, groupName?), hydrated }`,
  `useDeviceId()` and `useHydrated()`. These are built on
  `useSyncExternalStore`, return empty values on the server and during
  hydration, and stay in sync across tabs. Don't show "Who are you?" until
  `hydrated` is true.
- Functions: `getLocalGroups`, `getLocalGroup`, `sortLocalGroups` (starred
  first, then most recent), `touchGroup({id,name})` (call this on every group
  visit), `renameLocalGroup`, `getIdentity`, `setIdentity(groupId, memberId,
  name?)`, `setStarred`, `removeLocalGroup`, `getDeviceId()`,
  `getActor(groupId)` (gives `{memberId, deviceId}` for tRPC `actor`), and
  `exportLocalData()` / `importLocalData(json, "merge"|"replace")`.
- Tag pages that don't know the group id store the picked identity in
  `tagIdentities = { [groupFingerprint]: { memberId, savedAt } }`
  (`getTagIdentity` / `setTagIdentity`). When the group link is opened, the
  group shell calls `adoptTagIdentity(groupId, name, isActiveMember)`, which
  moves a matching entry into `groups`. Export/import include
  `tagIdentities` as an optional field of the version 1 format.
- It's safe to import from SSR code. Corrupt or blocked storage falls back
  to memory.

## i18n

next-intl is set up **without locale prefixes or middleware**. Messages are
one file per namespace in `messages/<locale>/<ns>.json`, merged by
`src/i18n/request.ts` into `{ common, group, tag, integrations, pwa }`.

- Use `useTranslations("group")` (or `getTranslations("group")` on the
  server). Keys are type-checked against the English files
  (`src/i18n/messages.d.ts`). Add a key to your JSON file and it's
  available immediately.
- Edit only your own namespace file. Shared strings (status names, common
  actions) live in `common.json`. Ask before changing it.
- Only English exists, so the request config reads neither cookies nor
  headers, and pages can be prerendered. Adding a locale is a change to
  `src/i18n/config.ts` (`locales`); detection then uses the NEXT_LOCALE
  cookie and Accept-Language (`resolveLocale`), and the layout needs
  Suspense.
- We don't use `createNextIntlPlugin`. It eagerly loads `@swc/core`, whose
  native binary refuses to load when `~/.cache` is group-writable (true on
  the dev machine). `next.config.ts` sets the `next-intl/config` alias by
  hand instead. **Agent D: `@serwist/turbopack` also depends on `@swc/core`**,
  so check that it works here, or set `SWC_NATIVE_BINDING_CACHE` to a
  directory with mode 0700 and no group-writable parents.

## Next.js 16 gotchas (verified here)

- **`cacheComponents: true`** (plus `partialPrefetching: true`). Data is
  dynamic by default, and every route is prerendered to a static shell.
  Anything uncached or request-time **must be inside `<Suspense>`**:
  `await params`, `searchParams`, `cookies()`, `headers()`, DB queries and
  tRPC calls. Otherwise `next build` fails with "blocking-route". This is the
  pattern we verified for a dynamic page:

  ```tsx
  export default function Page({ params }: PageProps<"/groups/[groupId]">) {
    return <Suspense fallback={<Skeleton />}><GroupPage params={params} /></Suspense>;
  }
  async function GroupPage({ params }: { params: PageProps<"/groups/[groupId]">["params"] }) {
    const { groupId } = await params;
    await prefetch(trpc.groups.get.queryOptions({ groupId }));
    return <HydrateClient><GroupView groupId={groupId} /></HydrateClient>;
  }
  ```

- **`Date.now()`, `new Date()`, `Math.random()` and `crypto.randomUUID()` in
  server render code** fail prerendering ("blocking-prerender-current-time").
  This includes TanStack Query internals and `computeSchedule()`. Before
  them, call `await io()` (from `next/cache`; new in 16.3, preferred) or
  `await connection()` (from `next/server`). `caller()` and `prefetch()`
  already do this. In client components, compute times in effects or event
  handlers, or use `use(io())`.
- **`params` and `searchParams` are Promises** in pages, layouts and route
  handlers. Use the global helper types: `PageProps<"/groups/[groupId]">`,
  `LayoutProps<"/">` and `RouteContext<"/api/v1/groups/[gid]/chores/[cid]/complete">`
  (`const { gid } = await ctx.params`). These types are generated by
  `next dev`, `next build` or `next typegen`. `tsc` also checks `.next/types`, so after
  deleting or renaming a route, run `npx next typegen` (or build) or
  `typecheck` will report stale errors.
- **Middleware is now `proxy.ts`** (`export function proxy(req)`), in `src/`.
  It runs on Node.js, and you can't set `runtime` in it.
- **Route handlers:** a `GET` that doesn't read the request is prerendered at
  build time. Read `request` (or call `connection()`) to make it per-request.
  POST is never cached. `use cache` can't go directly in a handler body.
- With cacheComponents, navigation keeps previous routes mounted inside React
  `<Activity>` (hidden). Effects clean up and re-run, but state persists, so
  close dialogs and reset forms explicitly when that matters.
- `turbopack.root` is pinned in `next.config.ts` because a stray
  `package-lock.json` in a parent directory confuses root detection.
- The Next docs are in `node_modules/next/dist/docs/`. Read them before
  guessing at an API.

## Prisma 7

- The generator is `prisma-client`. Import from `@/generated/prisma/client`
  (types, enums, `Prisma` namespace), and import the client instance from
  `@/lib/db` (`prisma`; `Db` = client or transaction).
- A driver adapter is required (`@prisma/adapter-pg`). The config lives in
  `prisma.config.ts` (datasource URL, migrations path, seed command).
- `prisma migrate reset` refuses to run from an AI agent without explicit
  user consent. Don't try to work around this. Add a new migration instead.
- Use `satisfies Prisma.ChoreInclude` (not `as const`) for reusable
  `include` objects, because `orderBy` arrays must be mutable.

## Testing

- vitest (`vitest.config.mts`, node environment, `@` alias). Tests sit next
  to the code as `*.test.ts`. Pure logic (schedule, assignee, ids, events
  parsing, local-groups with a stubbed `window`) is covered.
- Always pass `now` explicitly in schedule tests, because recurring chores
  roll forward to the real current date.
- Database-backed services mostly aren't covered by unit tests. Where a
  race or write pattern matters, mock `@/lib/db` with `vi.mock` (see
  `src/lib/services/completions.test.ts`). Otherwise smoke-test them with a
  `tsx` script against the dev database (see `prisma/seed.ts` for the
  imports and dotenv setup).
