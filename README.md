# Yakka

**Share the yakka.** An account-less household chore tracker. Chores are
completed by scanning a QR code or NFC tag stuck where the job happens, or via
the API and webhooks.

Yakka is a simpler take on [DoneTick](https://github.com/donetick/donetick),
built on the access model of [Spliit](https://github.com/spliit-app/spliit):
no sign-up, groups are shared by link, and your identity in each group is
remembered by your browser.

> Status: early scaffolding. Nothing works yet.

## Development

Requires Node.js 20+ and Docker (for a local Postgres).

```sh
cp .env.example .env      # then adjust if needed
docker compose up -d      # start Postgres
npm install               # also generates the Prisma client
npm run db:migrate        # create the database tables
npm run dev               # http://localhost:3000
```

## Docs

- [Architecture](docs/ARCHITECTURE.md): data model, tap-to-complete flow,
  identity in the browser, API and webhooks, scheduling and deployment.
- [Naming](docs/NAMING.md): how the name was chosen.

## Stack

Next.js (App Router), TypeScript, Tailwind CSS, Prisma with PostgreSQL.
