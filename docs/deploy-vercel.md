# Deploy on Vercel

Alat runs on Vercel as static files (the site) plus one Node function (the API,
the relayer and the Telegram webhook). `vercel.json` and
`scripts/vercel-build.mjs` set this up; there is nothing to configure in the
build settings.

## 1. Import the repository

1. Go to <https://vercel.com/new>, import `ahmardchain/alat`.
2. Leave **Framework Preset**, **Root Directory**, **Build** and **Install** as
   they are (they come from `vercel.json`).
3. Production branch: `main`.

## 2. Add the database

In the project: **Storage → Create Database → Neon (Postgres) → Connect**, for
Production and Preview. This sets `DATABASE_URL`. Alat creates its tables on
first use.

## 3. Environment variables

Project → **Settings → Environment Variables**, type **Sensitive**, for
Production (and Preview if you want previews to work):

| Name | Value |
| --- | --- |
| `ALAT_ID_SALT` | from your `.env` (never change it once accounts are linked) |
| `ALAT_RELAYER_MNEMONIC` | from your `.env` |
| `ALAT_DEMO_OWNER_MNEMONIC` | from your `.env` |
| `ALAT_PUBLIC_URL` | the production URL, e.g. `https://alat-silk.vercel.app` (no trailing slash) |
| `BOT_TOKEN` | from @BotFather |
| `ALAT_VIDEO_URL` | optional, once the video is public |

Then **Deployments → Redeploy** so the function picks them up.

## 4. Check it

- `https://<your-url>/api/info` returns the registry address.
- `https://<your-url>/judge` runs the demo (the first run links `@alat_demo`, about 20 seconds).
- In Telegram, send `/start` to the bot. On its first request the function
  points the bot's webhook at `https://<your-url>/api/tg/<secret>` by itself.

## 5. Expiry

Checks close after 15 minutes. The Hobby plan runs Vercel cron jobs at most
once a day, so `.github/workflows/expire.yml` calls `/api/cron/expire` every
5 minutes. If your URL is not `https://alat-silk.vercel.app`, set the repository
variable `ALAT_URL` (GitHub → Settings → Secrets and variables → Actions →
Variables). Checks also close whenever anyone uses the site or the bot.

## Notes

- Relayer transactions run one at a time across all function instances, through
  a lease row in the database.
- Locally, without `DATABASE_URL`, the server uses PGlite (Postgres in process)
  in `data/pglite`, and the bot uses long polling.
