<img src="public/icons/icon.svg" alt="Yakka logo" width="96" height="96" align="right">

# Yakka

*Yakka* (from Yagara *yaga*, "work") is Australian slang for work, and hard yakka gets done together.

**Share the yakka.** An account-less household chore tracker. Chores are
completed by scanning a QR code or NFC tag stuck where the job happens, or via
the API and webhooks.

Yakka is a simpler take on [DoneTick](https://github.com/donetick/donetick),
built on the access model of [Spliit](https://github.com/spliit-app/spliit):
no sign-up, groups are shared by link, and your identity in each group is
remembered by your browser.

It's built for the phone in your hand. Scan a tag on the bin, the dishwasher or
the dog's lead and the chore is done before you've put your phone away: no app
to find, no login, no menu to dig through. A big tick confirms it, with the
next due date and an undo button in case it was the wrong tag. In the app, each
chore has a one-tap tick, and the layout is designed for small screens first.

<p align="center">
  <img src="docs/images/desktop.png" alt="Annotated desktop screenshots: the chore list with a weekly tally, overdue status, whose turn it is and one-tap done; the activity feed; adaptive schedules and rotating turns; QR and NFC tags; and signed webhooks" width="100%">
</p>
<p align="center">
  <img src="docs/images/mobile.png" alt="Annotated phone screenshots: picking your name with no sign-up, a chore ticked off by scanning a tag with an undo button, and the chore list in dark mode with the theme toggle" width="100%">
</p>

**Try it at [yakka.nectric.com.au](https://yakka.nectric.com.au/)**: create a
group, share the link with your household and start ticking things off. No
account needed. Or [host your own](#self-hosting).

## Features

- **No accounts.** Groups are shared by link, and you pick your name once per
  browser. An optional PIN guards the group settings.
- **Recurring chores** with due and overdue status. Schedules can be fixed or
  adaptive, learning when a chore really gets done from past completions.
- **Whose turn is it?** Assign chores to anyone, a fixed member, or a
  round-robin rotation.
- **Tap to complete.** Print QR codes or write NFC tags, stick them where the
  job happens, and scan to tick the chore off, with undo for mistaken taps.
  First-time scanners just tap their name.
- **Mobile-first.** Big touch targets, a one-tap tick on every chore,
  compact tabs that fit a phone screen, and notifications at the bottom of the
  screen within reach of your thumb.
- **Activity feed and weekly tally** of who did what.
- **Reminders** by Web Push, plus ntfy or Apprise on self-hosted instances.
- **Automation.** A REST API, inbound hooks that complete a chore (handy for
  Home Assistant), and signed outbound webhooks for completed, due and overdue
  chores.
- **Portable data.** Export a group (settings, members, chores, tags and full
  history) as a JSON file and import it on any Yakka instance, whether to back
  it up or to move between the public instance and your own server.
- **Installable app** (PWA) that works offline and queues completions until
  you're back online. Light and dark themes. English only for now.

## Self-hosting

Yakka runs as a single Docker container. All you need is a machine with
[Docker](https://docs.docker.com/get-docker/) installed. Pick one of the two
ready-made compose files:

- **[`compose.sqlite.yaml`](compose.sqlite.yaml)**: one container that keeps
  everything in a SQLite file. The simplest choice for a homelab or a single
  household.
- **[`compose.prod.yaml`](compose.prod.yaml)**: Yakka plus a Postgres
  database. Better if lots of groups will share your server.

1. Make a folder for Yakka and download your chosen file into it:

   ```sh
   mkdir yakka && cd yakka
   curl -o compose.yaml https://raw.githubusercontent.com/mitchelloharawild/yakka/main/compose.sqlite.yaml
   ```

2. Create a `.env` file next to it with the address people will use to reach
   Yakka (tag and share links point here):

   ```sh
   BASE_URL=https://yakka.example.com
   # Postgres only: choose a database password
   POSTGRES_PASSWORD=change-me
   ```

3. Start it:

   ```sh
   docker compose up -d
   ```

   Yakka is now running on port 3000. Database setup and the reminder
   schedule happen automatically.

4. Put it behind HTTPS. The installable app, push notifications and NFC
   only work over HTTPS, so use a reverse proxy such as
   [Caddy](https://caddyserver.com/), which fetches certificates for you:

   ```
   yakka.example.com {
     reverse_proxy localhost:3000
   }
   ```

To update, run `docker compose pull && docker compose up -d`. Your data lives
in a Docker volume and survives updates.

Push notifications need a VAPID key pair (`npx web-push generate-vapid-keys`)
in `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. See
[Deployment](docs/DEPLOYMENT.md) for these and every other setting, as well as
deploying to Vercel.

## Docs

The docs are also on the website, at [yakka.nectric.com.au/docs](https://yakka.nectric.com.au/docs)
(or `/docs` on your own instance).

- [Architecture](docs/ARCHITECTURE.md): data model, tap-to-complete flow,
  identity in the browser, API and webhooks, scheduling and deployment.
- [Development](docs/DEVELOPMENT.md): code layout, conventions and
  Next.js 16 gotchas.
- [Deployment](docs/DEPLOYMENT.md): Vercel, Docker (Postgres or SQLite),
  environment variables, HTTPS, VAPID keys, rate limiting.
- [API](docs/API.md): REST API, inbound hooks, outbound webhooks and
  signature verification.
- [Naming](docs/NAMING.md): how the name was chosen.

## Development

Requires Node.js 20+ and Docker (for a local Postgres).

```sh
cp .env.example .env      # then adjust if needed
docker compose up -d      # start Postgres
npm install               # also generates the Prisma client
npm run db:migrate        # create the database tables
npm run db:seed           # optional: demo group (prints its URL)
npm run dev               # http://localhost:3000
```

SQLite instead of Postgres: set `DATABASE_URL="file:./data/yakka.db"` in
`.env`, then `npm run db:deploy`. `npm run build` also bundles the service
worker (served at `/sw.js`). The service worker is only registered in production
builds (`npm run build && npm start`).

## Stack

Next.js 16 (App Router, Cache Components), TypeScript, tRPC + TanStack Query,
Tailwind CSS v4 + shadcn/ui, next-intl, Prisma 7 with PostgreSQL or SQLite, Serwist service worker.

## Acknowledgements

Yakka was coded with the help of
[Claude Code](https://claude.com/claude-code), Anthropic's coding agent.
