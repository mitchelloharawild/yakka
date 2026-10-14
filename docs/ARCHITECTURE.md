# Yakka architecture

An account-less household chore tracker: a simpler take on
[DoneTick](https://github.com/donetick/donetick), built on the access model of
[Spliit](https://github.com/spliit-app/spliit). Chores are completed by scanning a
QR code or NFC tag, or via API / webhooks. Scanning opens the PWA (or the website)
and records the completion instantly when the browser already knows who you are.

## 1. What we take from Spliit

Spliit has no accounts. Two things replace them:

- **An unguessable group ID in the URL** (nanoid, `/groups/Xk3…`). Having the link
  means having access. A group has a list of members, which are just names.
- **localStorage**: the list of recent and starred groups, and which member "you"
  are in each group. It asks "who are you?" the first time you open a group.

| Layer | Spliit | Here |
|---|---|---|
| App | Next.js (App Router) with tRPC | Keep: one deployable serving the UI, API and cron endpoints |
| UI | Tailwind, shadcn/ui, next-intl | Keep |
| DB | Prisma with Postgres | Keep Prisma; also support **SQLite** for single-container homelab installs |
| Files | S3, optional (receipts) | Drop for now; add back for photo proof later if wanted |
| Cron | `/api/cron/purge-deleted-groups` behind `CRON_SECRET` | Expand: due/overdue checks, notifications, outbound webhooks |
| Deploy | Vercel one-click, or Docker image plus Postgres compose | Keep both, plus health endpoints |
| PWA | Basic manifest | Much stronger: Serwist service worker, offline queue, Web Push |

**Left out of DoneTick:** the Go backend, accounts, OIDC and MFA, circles and roles,
natural-language input, "Things", subtasks, and points (simple tallies per member are
enough).

## 2. Data model (Prisma)

```
Group        id (nanoid, the secret), name, timezone,
             settings (joinFromTag, undoWindowSeconds, settingsPin?)
Member       id, groupId, name, colour, archivedAt
Chore        id, groupId, title, icon, rrule, anchor (due-date | completion-date | adaptive),
             assigneeMode (anyone | fixed | round-robin), assigneeId?, graceMinutes
Tag          id, token (separate short secret), groupId, choreId,
             qr, nfc (what the printed label offers), label, revokedAt
Completion   id, choreId, memberId?, source (tag | manual | api | webhook),
             tagId?, deviceId, completedAt, undoneAt
ApiToken     id, groupId, name, hash, lastUsedAt
InboundHook  id, groupId, choreId, secret, defaultMemberId?
Webhook      id, groupId, url, secret, events[], failCount, disabledAt
PushSub      id, memberId, deviceId, endpoint, keys
Activity     audit log (like Spliit's Activity tab)
SystemState  key, value (instance-wide, e.g. the cron job's last tick)
```

Don't store the next due date. Work it out when a chore is read, from the `rrule`
plus the last completion that wasn't undone. The dashboard then doesn't depend on a
background job.

## 3. Tap-to-complete flow

The tag holds `https://<host>/t/{tagToken}` (an NDEF URI record on NFC tags, or the
same URL in a QR code).

1. `/t/{token}` is a **page, never a GET with side effects**. Link previewers, the iOS
   QR preview and NFC readers that prefetch would otherwise complete chores by
   accident.
2. The server works out the token's group and chore and renders a shell. Client JS
   reads localStorage:
   - **Identity known for this group:** send a POST to complete the chore immediately.
     Show a large ✓, the next due date, and **Undo** for about 10 s.
   - **No identity yet:** show "Who are you?" as member chips plus "I'm new". Save the
     choice, complete the chore, and add the group to the recent groups.
3. **Server-side debounce:** a repeat completion of the same chore within N minutes
   returns the existing completion. This absorbs NFC double-reads.
4. **Offline:** queue the POST in IndexedDB and replay it with Background Sync. iOS has
   no Background Sync, so also retry on the next app open.

### Two secrets, not one

In Spliit the group URL gives full access. A QR code on a shared door shouldn't. A
**tag token can complete its own chore and nothing else**. The group setting
`joinFromTag` decides whether an unknown device may pick an identity from a tag, or
must open the full group link first. Tag tokens can be revoked and rotated when a
code leaks.

### Platform caveats

- **iOS:** scanning a QR code or NFC tag always opens **Safari**, never the installed
  home-screen PWA, and the PWA's storage is **separate** from Safari's. A user who
  picked an identity in the PWA is asked once more on their first scan. Keep that
  step to one tap.
- **Android (Chrome):** links inside the PWA's scope can open in the installed app.
  Set `scope` and `launch_handler` in the manifest.
- **Web NFC** (`NDEFReader`) only works in Chrome on Android. Use it for a "Write this
  tag" button. On iOS, write tags with a third-party app (e.g. NFC Tools).
- **Printable QR sheet:** a page of server-generated SVG QR codes laid out as labels.

## 4. Identity in the browser

```ts
localStorage["groups"]   = [{ id, name, memberId, starred, lastOpened }]
localStorage["deviceId"] = crypto.randomUUID() // attached to completions for the audit log
```

- **Move to another device:** show a QR code of `group URL + ?as={memberId}`.
- **Export / import** of the local data, as in Spliit.
- **Accepted trade-off (same as Spliit):** anyone with the group link can act as any
  member. Mitigations are the audit log with device IDs, undo, and an optional PIN for
  group settings.

## 5. API and webhooks without accounts

Everything is scoped to the group with secrets, not users:

- **REST:** `POST /api/v1/groups/{gid}/chores/{cid}/complete`, body `{ member }`,
  header `Authorization: Bearer <group API token>`. Only the token hash is stored.
- **Inbound hook URLs:** `POST /api/hooks/{secret}`, one per chore. Any body is
  accepted, so it works with Home Assistant, iOS Shortcuts, Zigbee buttons or IFTTT.
  Recorded as "Automation" unless a default member is set.
- **Outbound webhooks:** events `chore.completed`, `chore.due`, `chore.overdue`. Signed
  with HMAC (`X-Signature`); retried with backoff; disabled after repeated failures.

## 6. Scheduling and notifications

The main addition to Spliit's infrastructure:

- A **cron endpoint** runs every 5 minutes (Vercel Cron, or in-process `node-cron` /
  a sidecar in Docker). It finds chores that just became due or overdue, then sends
  **Web Push** (VAPID) and outbound webhooks.
- iOS Web Push only works for an installed PWA (iOS 16.4+), so say so during
  onboarding.
- Optional ntfy or Apprise URLs for self-hosters.
- No realtime layer needed: TanStack Query refetch on focus is enough. Add SSE later
  if wanted.

## 7. Deployment

One image (`ghcr.io/mitchelloharawild/yakka`) plus Postgres or SQLite. Environment variables
follow Spliit's pattern:

```
DATABASE_URL            BASE_URL               CRON_SECRET
VAPID_PUBLIC_KEY        VAPID_PRIVATE_KEY      VAPID_SUBJECT
ENABLE_GROUP_DELETION   ALLOW_JOIN_FROM_TAG_DEFAULT
ANALYTICS_PROVIDER      # strip IDs from paths, like Spliit
```

Also:

- Rate-limit `/t/*` and `/api/hooks/*` by IP to stop token guessing.
- Soft-delete groups and purge them with a cron job (Spliit's approach).
- Health endpoints: `/api/health/readiness` and `/api/health/liveness`.

## Prior art

- [DoneTick](https://github.com/donetick/donetick): Go and React, accounts, NFC,
  webhooks, adaptive recurrence.
- [Spliit](https://github.com/spliit-app/spliit): account-less groups, identity kept in
  localStorage.
- Chorecast: a self-hosted NFC chore app built around dedicated reader hardware, with
  Home Assistant integration.
