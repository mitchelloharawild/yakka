# Yakka API, hooks and webhooks

Yakka has no user accounts, so every integration is scoped to **one group** by a
secret. Manage them all on the group's **Integrations** page
(`/groups/{groupId}/integrations`). If the group has a settings PIN, creating,
revoking or revealing anything there needs the PIN. Repeated wrong PINs lock
the PIN for a while (see DEPLOYMENT.md, "Settings PIN attempts").

There are three ways in and out:

| | Direction | Secret | Grants |
|---|---|---|---|
| [REST API](#rest-api) | in | API token (`yk_…`), sent as a Bearer header | Read chores and members, complete chores and undo completions in one group |
| [Inbound hooks](#inbound-hooks) | in | Secret in the URL | Completing **one** chore |
| [Outbound webhooks](#outbound-webhooks) | out | HMAC signing secret (`whsec_…`) | Nothing: you use it to verify that requests come from Yakka |

In the examples below, `https://yakka.example` is your `BASE_URL`, `$GID` is the
group id and `$TOKEN` is an API token.

## REST API

Base URL: `https://yakka.example/api/v1/groups/{gid}`

### Authentication

```
Authorization: Bearer yk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Create tokens on the Integrations page. The full token is **shown once**; Yakka
stores only its SHA-256 hash and a short prefix (e.g. `yk_5VdXCO`) so you can
tell tokens apart. Each request updates the token's "last used" time. Revoking a
token takes effect immediately.

A token belongs to one group, and the `{gid}` in the path must be that group:

| Situation | Status | `error.code` |
|---|---|---|
| No `Authorization` header, or it isn't `Bearer` | 401 | `TOKEN_MISSING` |
| Unknown or revoked token, or a deleted group | 401 | `TOKEN_INVALID` |
| A valid token for a different group | 403 | `TOKEN_GROUP_MISMATCH` |

### Errors

Every error has the same shape:

```json
{ "error": { "code": "MEMBER_NOT_FOUND", "message": "No member with that id or name." } }
```

| Status | Codes |
|---|---|
| 400 | `INVALID_JSON`, `VALIDATION_FAILED`, `CHORE_ARCHIVED`, `MEMBER_ARCHIVED`, `MEMBER_AMBIGUOUS`, `COMPLETED_AT_OUT_OF_RANGE` |
| 401 / 403 | See [Authentication](#authentication) |
| 404 | `CHORE_NOT_FOUND`, `MEMBER_NOT_FOUND`, `COMPLETION_NOT_FOUND`, `HOOK_NOT_FOUND` |
| 405 | `METHOD_NOT_ALLOWED` |
| 409 | `COMPLETION_CONFLICT` (rare; retry) |
| 429 | Rate limited (by the proxy) |
| 500 | `INTERNAL_ERROR` |

All responses are JSON, sent with `Cache-Control: no-store`. Timestamps are ISO
8601 strings in UTC.

### `POST /chores/{cid}/complete`

Marks a chore as done. It's recorded with source `API`.

Request body (optional; an empty body is fine):

```json
{
  "member": "Alex",
  "completedAt": "2026-03-01T09:30:00Z",
  "note": "Used the new bin bags"
}
```

- `member`: a member **id**, or a member **name** (case-insensitive). Ids are
  matched first. Names only match active members, and if several have that name
  the request fails with `MEMBER_AMBIGUOUS`. Leave it out (or send `null`) to
  record the completion as "Automation".
- `completedAt`: optional, may be backdated by up to 14 days.
- `note`: optional, up to 500 characters.

Response: `201 Created`, or `200 OK` when deduplicated.

```json
{
  "completion": {
    "id": "cm…", "choreId": "cm…", "source": "API",
    "completedAt": "…", "createdAt": "…", "undoneAt": null, "note": null,
    "member": { "id": "cm…", "name": "Alex" }
  },
  "deduplicated": false,
  "nextDueAt": "2026-03-08T09:00:00.000Z",
  "chore": { "…": "same shape as GET /chores/{cid}" }
}
```

**Debounce.** If the chore was already completed within the group's debounce
window (5 minutes by default), Yakka creates nothing and returns the existing
completion with `"deduplicated": true`. Retrying is therefore safe.

```sh
curl -X POST https://yakka.example/api/v1/groups/$GID/chores/$CID/complete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"member": "Alex"}'
```

### `GET /chores`

Lists the group's chores with their status worked out at request time, most
urgent first. Add `?archived=true` to include archived chores.

```json
{
  "chores": [
    {
      "id": "cm…", "title": "Feed the cat", "description": null, "icon": "🐈",
      "rrule": "FREQ=DAILY", "startsAt": "…", "anchor": "DUE_DATE", "graceMinutes": 90,
      "assigneeMode": "ANYONE", "currentAssigneeId": null, "archived": false,
      "status": "overdue", "nextDueAt": "…", "overdueAt": "…", "dueToday": true, "missedCount": 0,
      "lastCompletion": { "…": "completion object or null" }
    }
  ]
}
```

`status` is one of `upcoming`, `due`, `overdue`, `done` (a one-off chore that has
been completed) or `unscheduled`.

### `GET /chores/{cid}`

Returns `{ "chore": { … } }` for a single chore, in the same shape as above.

### `GET /members`

Returns `{ "members": [{ "id", "name", "colour", "archived" }] }`, oldest first.
Add `?archived=true` to include archived members.

### `POST /completions/{id}/undo`

Undoes a completion. There is no time limit, and undoing twice is harmless: the
second call returns `"alreadyUndone": true`. Response:
`{ completion, alreadyUndone, nextDueAt, chore }`.

## Inbound hooks

An inbound hook is a secret URL that completes **one chore**:

```
POST https://yakka.example/api/hooks/{secret}
```

Create hooks on the Integrations page. Pick the chore and, optionally, a
default member to record completions as. Without a default member, completions
are recorded as "Automation". The list shows a masked URL; **Show URL**
reveals the full one again at any time (with the settings PIN, if the group
has one).
Completions from hooks have source `WEBHOOK` and are debounced in the same way
as API completions.

- **Any body is accepted.** Yakka ignores the body, unless it is a JSON object
  (or a form body) with a `member` field. That field is a member id or name and
  overrides the default member, e.g. `{"member": "Sam"}`. An unknown member
  returns 404 `MEMBER_NOT_FOUND`.
- Success returns `201` (or `200` with `"deduplicated": true`) and
  `{ ok, deduplicated, completion, chore: { id, title, status, nextDueAt } }`.
- An unknown or revoked secret returns `404 HOOK_NOT_FOUND`.
- **Only POST works.** `GET` always returns `405` without looking up the secret.
  Chat apps, link previewers, browser prefetching and crawlers send GET
  requests to every URL they see. If GET completed the chore, pasting the hook
  URL into a chat would tick it off. Wherever you configure the hook, choose
  POST.

```sh
curl -X POST https://yakka.example/api/hooks/$SECRET
curl -X POST https://yakka.example/api/hooks/$SECRET -H 'Content-Type: application/json' -d '{"member":"Sam"}'
```

Anyone with the URL can complete that chore. If a hook URL leaks, revoke it and
create a new one.

## Outbound webhooks

Yakka POSTs a JSON event to your URL when one of these happens:

| Event | When |
|---|---|
| `chore.completed` | A completion is recorded (from any source; deduplicated repeats don't count) |
| `chore.undone` | A completion is undone |
| `chore.due` | A scheduled chore reaches its due time (checked by the cron job every 5 minutes) |
| `chore.overdue` | A scheduled chore passes its due time plus the grace period |

Each webhook subscribes to a subset of these events. The Integrations page also
has a **Send test** button, which sends a `ping` event straight away and
reports the HTTP status it got back. On an instance with
`WEBHOOK_ALLOW_PRIVATE_NETWORKS=false` it only reports "delivered" or
"failed", so it can't be used to probe hosts and ports.

### Request

```
POST /your/endpoint
Content-Type: application/json
User-Agent: Yakka-Webhooks/1
X-Yakka-Event: chore.completed
X-Yakka-Delivery: cm…            (unique per delivery; the same value on retries)
X-Yakka-Timestamp: 1772357400    (Unix seconds when this attempt was signed)
X-Signature: sha256=5d41402abc4b2a76b9719d911017c592…
```

The body is an envelope:

```json
{
  "id": "evt_3kTq…",
  "type": "chore.completed",
  "createdAt": "2026-03-01T09:30:00.123Z",
  "group": { "name": "Demo household", "timezone": "Australia/Melbourne" },
  "data": { }
}
```

The envelope never includes the group id, because the group id is the group's
access secret. Use the event `id` to deduplicate (retries resend the same
`id`). The `data` field depends on the event type:

```jsonc
// chore.completed
{ "chore": { "id", "title", "icon" },
  "completion": { "id", "source": "TAG|MANUAL|API|WEBHOOK", "completedAt", "member": { "id", "name" } | null, "tagId" },
  "nextDueAt": "…" | null }
// chore.undone
{ "chore": { … }, "completion": { "id", "completedAt", "undoneAt", "member": … | null }, "nextDueAt": … }
// chore.due and chore.overdue
{ "chore": { … }, "dueAt": "…", "overdueAt": "…", "assignee": { "id", "name" } | null }
// ping (test button)
{ "message": "Test delivery from Yakka", "webhook": { "id", "name" } }
```

A chore with a grace period of 0 sends `chore.due` and `chore.overdue` at the
same moment.

### Verifying signatures

`X-Signature` is an HMAC-SHA256 of the string `"{X-Yakka-Timestamp}.{raw body}"`,
keyed with the webhook's signing secret (`whsec_…`) and hex-encoded. To verify a
request:

1. Compute the HMAC over the **raw** request bytes, not over re-serialised JSON.
2. Compare it with the header in constant time.
3. Reject timestamps more than about 5 minutes from your clock.

The timestamp is part of the signed string, so a replayed request can't be
given a fresh timestamp. Step 3 limits how long a captured request stays usable.

The signing secret is shown once when you create the webhook. You can view it
again on the Integrations page (PIN-protected), or rotate it.

**Node.js** (Express shown, but any framework works if it gives you the raw body):

```js
import crypto from "node:crypto";
import express from "express";

const SECRET = process.env.YAKKA_WEBHOOK_SECRET; // whsec_…
const app = express();

app.post("/yakka", express.raw({ type: "application/json" }), (req, res) => {
  const ts = req.get("X-Yakka-Timestamp");
  const sig = req.get("X-Signature") ?? "";
  const expected =
    "sha256=" + crypto.createHmac("sha256", SECRET).update(`${ts}.${req.body}`).digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
  const valid =
    sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!fresh || !valid) return res.sendStatus(401);

  const event = JSON.parse(req.body);
  console.log(event.type, event.data.chore.title);
  res.sendStatus(204);
});
app.listen(3001);
```

**Python** (Flask):

```python
import hashlib, hmac, os, time
from flask import Flask, request, abort

SECRET = os.environ["YAKKA_WEBHOOK_SECRET"].encode()
app = Flask(__name__)

@app.post("/yakka")
def yakka():
    ts = request.headers.get("X-Yakka-Timestamp", "")
    sig = request.headers.get("X-Signature", "")
    body = request.get_data()  # raw bytes
    expected = "sha256=" + hmac.new(SECRET, ts.encode() + b"." + body, hashlib.sha256).hexdigest()
    if not ts.isdigit() or abs(time.time() - int(ts)) > 300 or not hmac.compare_digest(sig, expected):
        abort(401)
    event = request.get_json()
    print(event["type"], event["data"]["chore"]["title"])
    return "", 204
```

### Delivery, retries and auto-disable

- Any **2xx** response counts as delivered. Yakka doesn't follow redirects, so
  a 3xx counts as a failure, as do timeouts (10 seconds) and connection errors.
- Delivery is attempted straight after the event. Failed attempts are retried
  after **1 min, 5 min, 30 min, 2 h and 12 h**: 6 attempts in total, after
  which that delivery is marked failed. The cron job (every 5 minutes) sends the
  retries, so they can arrive up to about 5 minutes later than scheduled.
- Each failed attempt increases the webhook's failure count, and any success
  resets it. After **15 consecutive failed attempts** the webhook is
  **disabled**, and its pending deliveries are dropped. Re-enable it on the
  Integrations page once your receiver is fixed, which also resets the count.
  You can also disable a webhook by hand.
- The Integrations page shows each webhook's last 5 deliveries and its last
  error. Finished deliveries are pruned after 30 days.
- Delivery is at-least-once. Deduplicate on the event `id` or on
  `X-Yakka-Delivery`.

### Allowed URLs (SSRF)

Webhook URLs must be `http://` or `https://`, with no username or password in
them. Whether they may point at private and LAN addresses depends on
`WEBHOOK_ALLOW_PRIVATE_NETWORKS`:

- **Self-hosted (Docker, `next start`): allowed by default**, so a homelab
  instance can call Home Assistant at `http://192.168.1.20:8123`. This means
  anyone who can open a group on your instance can make it send POST
  requests into your network. That's fine for a household; if you expose a
  self-hosted instance to people you don't trust, set
  `WEBHOOK_ALLOW_PRIVATE_NETWORKS=false`.
- **Vercel: refused by default** (`VERCEL` is set). Setting the variable
  explicitly overrides the default either way.

When private addresses are refused, every address the host resolves to is
checked inside the connection's own DNS lookup, and the request goes to the
address that was checked, so DNS rebinding between "check" and "connect"
doesn't work. Refused: loopback, RFC 1918, link-local (including cloud
metadata addresses), CGNAT, documentation and benchmarking ranges,
multicast and reserved space, IPv6 unique-local, link-local, site-local and
multicast, and IPv4 addresses wrapped in IPv6 (IPv4-mapped such as
`[::ffff:7f00:1]`, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`; Teredo
`2001::/32` is refused outright). `localhost` names are refused too.
Redirects are never followed.

## Cron

`GET` or `POST /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` runs
the scheduled jobs:

- Find chores that became due or overdue since the last successful run (its
  time is stored in the database; the window is at least 15 minutes and at
  most 24 hours, so transitions older than a day are skipped after a long
  outage). Each due and
  overdue moment is recorded once as a `ChoreNotice`, so overlapping runs never
  notify twice. For each new one, Yakka sends `chore.due` or `chore.overdue`
  webhooks and Web Push. The push goes to the assignee for fixed and
  round-robin chores, and to every member otherwise. If `NTFY_URL` or
  `APPRISE_URL` is set, the notice goes there too, titled
  "{group name}: {chore}". These are **instance-wide**: every group's
  notices, with links containing the group id, go to the one topic. Only set
  them on a self-hosted instance used by a single household.
- Send due webhook deliveries (retries included).
- Purge groups that were soft-deleted more than 30 days ago (also available on
  its own at `/api/cron/purge-deleted-groups`).

Without `CRON_SECRET` the endpoints return 503.

- **Vercel:** `vercel.json` schedules `/api/cron/tick` every 5 minutes, and
  Vercel Cron sends the `CRON_SECRET` header automatically. The Hobby plan only
  runs cron jobs once a day (and not at a precise time), so due and overdue
  notices would arrive late and retries would bunch up. Use Pro, or call the
  endpoint from an external scheduler such as GitHub Actions or cron-job.org.
- **Docker / self-hosting:** the image calls `runCronTick()` in-process every
  5 minutes, or you can `curl` the endpoint from a host cron job.

## Home Assistant

**Tick a chore off from an automation**, e.g. when the dishwasher's power draw
drops, or when a Zigbee button is pressed. Use a `rest_command` that calls an
inbound hook:

```yaml
# configuration.yaml
rest_command:
  yakka_dishes_done:
    url: "https://yakka.example/api/hooks/REPLACE_WITH_HOOK_SECRET"
    method: post
    content_type: "application/json"
    # Optional: an empty "member" falls back to the hook's default member.
    payload: '{"member": "{{ who }}"}'
```

```yaml
# automations.yaml
- alias: "Dishwasher finished → Yakka"
  trigger:
    - platform: numeric_state
      entity_id: sensor.dishwasher_power
      below: 3
      for: "00:05:00"
  action:
    - service: rest_command.yakka_dishes_done
```

To call the REST API with a token instead, for example to record which person
pressed the button:

```yaml
rest_command:
  yakka_complete:
    url: "https://yakka.example/api/v1/groups/REPLACE_GID/chores/{{ chore }}/complete"
    method: post
    headers:
      Authorization: !secret yakka_token   # "Bearer yk_…"
    content_type: "application/json"
    payload: '{"member": "{{ member }}"}'
```

**React to Yakka events in Home Assistant**, e.g. flash a light when the bins
are overdue. Create an outbound webhook pointing at a Home Assistant webhook
trigger, such as `http://homeassistant.local:8123/api/webhook/yakka-events`,
and subscribe it to `chore.overdue`:

```yaml
- alias: "Yakka chore overdue"
  trigger:
    - platform: webhook
      webhook_id: yakka-events
      allowed_methods: [POST]
      local_only: true
  condition:
    - condition: template
      value_template: "{{ trigger.json.type == 'chore.overdue' }}"
  action:
    - service: notify.mobile_app_phone
      data:
        message: "{{ trigger.json.data.chore.title }} is overdue"
```

Home Assistant's webhook trigger doesn't check `X-Signature`. Keep the webhook
id unguessable, and use `local_only: true` when both run on your LAN.
