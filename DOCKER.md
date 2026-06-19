# Running BitBalance with Docker

Packages the whole stack — the Express app (which serves `/api` + the built Vue
SPA + uploads on one origin) and **MariaDB** — into containers managed by
`docker compose`. This also sidesteps the host's Node version: the SPA is built
inside a pinned `node:20` image, so a too-new host Node (e.g. 26, which breaks
Vite 5) no longer matters.

## Layout

| File | Role |
|---|---|
| `Dockerfile` | Multi-stage: build the SPA on `node:20-slim`, then run the server. |
| `docker-compose.yml` | `app` + `db` services (+ optional `ngrok` under a profile). |
| `.env.docker.example` | Copy to `.env`; holds DB creds + app config. |
| `deploy/db-init/` | Drop a `*.sql` dump here to seed the DB on first run. |

## Prerequisites (on the box — needs sudo)

```bash
sudo pacman -S --needed docker docker-compose   # CachyOS / Arch
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # then re-login, or prefix commands with sudo
```

## 1. Configure

```bash
cp .env.docker.example .env
# Edit .env: set SESSION_SECRET (openssl rand -hex 32), DB_PASSWORD,
# DB_ROOT_PASSWORD, and any AI/Google keys.
```

## 2. (Optional) migrate existing data

To bring your current database over, dump it into `deploy/db-init/` — MariaDB
imports it automatically on the **first** `up` (empty volume only):

```bash
mysqldump -u bituser -p --single-transaction --no-tablespaces --no-create-db bitbalance \
  > deploy/db-init/bitbalance.sql
```

> Dump a single database only — **no** `--databases`, `--add-drop-database`, or
> `GRANT`/`CREATE USER` lines. The container creates the DB + `bituser` itself;
> a dump that carries its own grants can strip `bituser`'s privileges and the app
> will crash-loop on its first `sessions`-table creation.

To carry existing uploaded images over, after the stack is up:

```bash
docker run --rm -v bitbalance-app_uploads:/v -v "$PWD/server/uploads":/src busybox \
  sh -c 'cp -an /src/. /v/'
```

(Skip both for a fresh, empty install.)

## 3. Run

```bash
docker compose up -d --build
docker compose logs -f app          # watch startup
curl http://localhost:3000/api/health
```

The app listens on host `:3000` (so an existing ngrok host service or a LAN
`ufw` rule keeps working unchanged).

> If the old systemd `node` service is still running, stop it first so two things
> don't fight over `:3000`:  `systemctl --user disable --now bitbalance`

## Manage

```bash
docker compose ps                   # status
docker compose logs -f app          # logs
git pull && docker compose up -d --build   # update to latest
docker compose restart app          # restart just the app
docker compose down                 # stop (KEEPS db_data + uploads volumes)
docker compose down -v              # stop and DELETE volumes (wipes the DB!)
```

`restart: unless-stopped` + an enabled Docker service means the stack comes back
after a reboot.

## Public tunnel (optional)

The repo's existing **host** ngrok systemd service already tunnels `:3000` — keep
using it and ignore this section. To instead run ngrok *inside* compose, set
**both** `NGROK_AUTHTOKEN` and `NGROK_DOMAIN` in `.env` (the compose passes
`--domain`, so a domain is required — leaving it blank makes ngrok error out),
disable the host ngrok service (free plan allows one tunnel), then:

```bash
docker compose --profile tunnel up -d
```

## Notes

- **Secrets** live in `.env` (git-ignored), never in the image.
- **Persistence**: `db_data` (database) and `uploads` (images) are named volumes;
  they survive `up --build` and reboots. Only `down -v` deletes them.
- **DB host**: compose points the app at the `db` service automatically; the
  `DB_HOST`/`DB_PORT` in `.env` are ignored for the container.
- **Build arch**: `sharp` ships a prebuilt binary per CPU arch. Build the image
  on the box (`docker compose up --build` there) so it matches. If you build on an
  Apple-Silicon Mac for an x86_64 box, add `--platform linux/amd64`.
