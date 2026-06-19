# DB seed (first run only)

Any `*.sql` file in this directory is run by the MariaDB container **once**, when
the `db_data` volume is first created (empty). Use it to migrate your existing
data into the containerised database.

To copy your current host MariaDB into the container on first `up`:

```bash
# On the box (or wherever the live DB is), dump SCHEMA + DATA for the one
# database — no CREATE DATABASE, no users/grants (the container's entrypoint
# already creates the DB + bituser with the right privileges):
mysqldump -u bituser -p --single-transaction --no-tablespaces --no-create-db bitbalance \
  > deploy/db-init/bitbalance.sql

docker compose up -d --build      # imports the dump on the db's first init
```

> IMPORTANT: do NOT dump with `--databases`, `--add-drop-database`, or any
> `GRANT` / `CREATE USER` statements. Those can drop or override `bituser`'s
> privileges, after which the app fails to create its `sessions` table on boot
> and `restart: unless-stopped` turns that into a crash loop. A plain
> single-database dump (as above) is safe.

Notes:
- Dumps are git-ignored (`deploy/db-init/*.sql`) — they contain user data.
- This runs **only** on an empty volume. To re-seed, you must remove the volume
  first: `docker compose down -v` (this DELETES the DB volume — be sure).
- Uploaded images live in the `uploads` volume, not the DB. To carry existing
  images over, copy `server/uploads/*` into that volume (see DOCKER.md).
