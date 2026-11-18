# Groceries

A tiny web app so she doesn't have to think in the grocery store.

Three tabs, one job each, plus a profile page:

| Screen | When | What she does |
| --- | --- | --- |
| **Shop** — *What to buy* | before and during a trip | pick a store, see what she liked there and what it cost; tap **+** to add it to her trip in two taps |
| **Trip** | in the aisle | say which store she's at (once), then add things as they go in the trolley; a basket shows the running total |
| **Rate** | at home, after eating it | one item at a time, big photo: **Skip it** or **Buy again**, with Back and "Ask me later" |
| **Profile** (tap the avatar) | any time | photo, name and email, stats about her shopping, where she shops, exports, change password, sign out. No tab bar here: Back is the only way out |

The date is filled in by the backend. Nothing else is asked of her.

### Why it's shaped this way

- **Shop is answering a question**, "I'm at Safeway, what do I usually get and what
  does it cost?", not showing a log. The store chips filter to what she bought there,
  at the price she paid there, and flag anything cheaper elsewhere.
- **Trip** puts the store first because it's the one thing that doesn't change
  mid-shop. A trip is whatever was bought at that store in the last 8 hours. It uses
  the clock, not the server's "today" label, which is in UTC and would flip to
  "yesterday" mid-afternoon on the US west coast.
- **Rate** is one item at a time because it's a yes/no question: scrolling a list to
  find the right row's buttons was the hard part.
- Things waiting for a rating are never a bucket on the Shop screen. A banner points
  to the Rate tab instead, so there's one place to do it.

## Stack

- **FastAPI** — the API
- **PostgreSQL** (Neon) — the database, via `psycopg` with hand-written SQL (no ORM)
- **React + Vite + TypeScript** — the frontend
- **Inline SVG icons** — hand-drawn in `components/Icon.tsx`; no icon library, no font
- **Pillow** — shrinks phone photos, which are then stored in Postgres
- **`hashlib.scrypt`** — password hashing, from the standard library
- **Docker + Render** (API), **Netlify** (frontend) — see [Deployment](#deployment)

No Redis, no LLM, no object storage. The only paid-for-nothing services are the
three free tiers above.

## Running it

You need a Postgres database to run against, locally too. Put its connection string
in `backend/.env` (gitignored):

```
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

**Use a separate database for development**, e.g. a second Neon branch. If you reuse
the production string, your local testing writes to the live data.

Install once:

```bash
cd backend && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
```

Then `./dev.sh` from the project root runs both servers, or by hand:

```bash
cd backend && ./.venv/bin/uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend && npm install && npm run dev
```

Open http://localhost:5173. Vite proxies `/api` and `/photos` to port 8000, so the
frontend never needs to know the backend's address.

### On her phone

The deployed site is the normal way to use it — see [Deployment](#deployment).

For hot reload while testing on the phone, run `./dev.sh` and open
`http://aayushs-macbook-air.local:5173` — `vite --host` binds to the LAN already,
and its proxy keeps the API same-origin so the session cookie works.

Two iOS details are handled in the code: every input is at least 16px, because
Safari force-zooms the page on anything smaller, and the layout is a `100dvh` flex
column with `env(safe-area-inset-bottom)`, so the tab bar tracks Safari's
collapsing toolbar instead of covering the submit button.

## Accounts

Email and password, one account per person, each with their own items, trips and
history. There is no shared list — two accounts can't see each other's data.

What's deliberately absent: no email verification, no password-reset links, no
OAuth. All three need a mail service.

How passwords are stored, in [`backend/app/auth.py`](backend/app/auth.py):

- **`hashlib.scrypt`** with a random 16-byte salt per user, `n=2^14, r=8, p=1`
  (~16MB per hash). Memory-hard, so offline cracking is expensive.
- Stored as `scrypt$n$r$p$salt$hash`. The parameters live in the string, so you can
  raise the cost later without breaking existing logins.
- Compared with `secrets.compare_digest`, so response timing doesn't leak the hash.
- Login says "wrong email or password" either way — naming which one was wrong
  tells an attacker which emails are registered.
- 10 failed attempts from one address triggers a 15-minute lockout.

The session is a random 32-byte token in an **`HttpOnly`**, `SameSite=Lax` cookie
(also `Secure` when `GROCERY_HTTPS=1`, as it is in production), valid 180 days, with
the sessions themselves in the database so a restart — which a free host does
whenever it likes — doesn't sign anyone out mid-shop. `HttpOnly` means page
JavaScript can't read it, so an XSS bug can't steal it.

### Resetting a forgotten password

No reset emails, so you do it by hand. This runs against whichever database
`backend/.env` points at — **the live one, if that's the production string**:

```bash
cd backend && ./.venv/bin/python -c "
from app.auth import hash_password
from app.db import connect
with connect() as c:
    c.execute('UPDATE users SET password_hash = %s WHERE email_key = %s',
              (hash_password('the-new-password'), 'her@example.com'))
"
```

## The database

PostgreSQL on Neon. The tables are created on startup from `schema.sql`, and the
connection string comes from `DATABASE_URL` — never from the repo. Open a SQL shell
with:

```bash
psql "$DATABASE_URL"
```

(Neon's dashboard also has a SQL editor.) Then `\dt`, `\d items`, or:

```sql
SELECT u.email, i.name, h.store, p.price_cents, p.liked
FROM purchases p
JOIN items i ON i.id = p.item_id
JOIN hauls h ON h.id = p.haul_id
JOIN users u ON u.id = p.user_id
ORDER BY p.purchased_at DESC;
```

Schema lives in [`backend/app/schema.sql`](backend/app/schema.sql) — six tables:

- **users** — email, display name, password hash.
- **sessions** — active logins, one row per signed-in device.
- **photos** — the resized JPEG bytes, owned by a user. Stored in the database
  because the host's disk is wiped on every deploy.
- **items** — "the thing", once, per person. Strawberries are one row forever.
- **hauls** — one shopping trip. Created automatically per store per day, so nobody
  has to tap "start a trip".
- **purchases** — bought *this thing*, on *this trip*, for *this much*, and later
  liked it or didn't.

Two schema decisions worth knowing:

**Store and price live on `purchases`, not `items`.** That's what lets the app say
*"strawberries — $4.99 at Trader Joe's, $6.49 at Safeway."* If they lived on the
item, you'd only ever have one price and one store.

**Every table carries `user_id`, and every query filters on it.** That filter is
the only thing separating two accounts, so it isn't optional anywhere — including
in `UPDATE ... WHERE id = ? AND user_id = ?`, which is what stops someone rating
another account's purchases by guessing an id.

## The messy-data problem

Item names are typed by hand, so the real risk isn't bad store data — it's her own
entries drifting into `milk` / `Milk 2%` / `whole milk`, none of which build up
enough history to be useful. Three defences, mostly in
[`backend/app/text.py`](backend/app/text.py):

1. **Normalisation** — `name_key` is lowercased, de-punctuated, de-pluralised and
   de-possessived, with a `UNIQUE (user_id, name_key)` index. So `Strawberries` and
   `strawberries.` collapse to one item, and `Trader Joe's` and `trader joes` to one
   store.
2. **Autocomplete** — `/api/suggest/items` offers her own history first, then a list
   of ~100 common groceries, ranked prefix → substring → fuzzy (`difflib`, stdlib).
   Tapping an existing entry is less work than typing a new one, so most duplicates
   never get created.
3. **Merge** — `POST /api/items/{a}/merge-into/{b}` folds one item into another,
   moving its history across. Prevention isn't perfect, so cleanup exists.

Prices are stored as **integer cents**, never floats.

## API

Everything except the four auth routes requires a session cookie and returns 401
without one.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | `{email, password, display_name?}` |
| `POST` | `/api/auth/login` | `{email, password}` |
| `POST` | `/api/auth/logout` | drops the session |
| `GET` | `/api/auth/me` | current user, or `null` — never 401s |
| `PATCH` | `/api/auth/me` | `{display_name}`, rename yourself |
| `POST` | `/api/auth/avatar` | profile photo (multipart `photo`), centre-cropped square |
| `DELETE` | `/api/auth/avatar` | remove it |
| `POST` | `/api/auth/password` | `{current_password, new_password}`, signs out your other devices |
| `POST` | `/api/purchases` | log one item (multipart: name, store, price, photo) |
| `GET` | `/api/suggest/items?q=` | autocomplete item names |
| `GET` | `/api/suggest/stores?q=` | autocomplete store names |
| `GET` | `/api/purchases/recent?limit=` | last few logged, for the delete list |
| `GET` | `/api/rate/pending` | everything awaiting a thumbs up or down |
| `POST` | `/api/purchases/{id}/rate` | `{"liked": true}` |
| `POST` | `/api/purchases/{id}/unrate` | undo a rating |
| `DELETE` | `/api/purchases/{id}` | remove a mis-logged purchase |
| `GET` | `/api/shopping-list` | liked / unrated / disliked, with per-store prices |
| `GET` | `/api/hauls` | trips, with totals and how many still need rating |
| `POST` | `/api/items/{a}/merge-into/{b}` | fix a duplicate |
| `PATCH` | `/api/items/{id}` | rename or recategorise |
| `GET` | `/photos/{filename}` | a photo, if it belongs to you |

Interactive docs at http://localhost:8000/docs while the backend is running.

## Not built yet

Deliberately left out:

- **No merge UI.** The endpoint works; there's no button for it. Duplicates need a
  `curl` for now.
- **No password reset or email verification.** Both need a mail service — see the
  by-hand reset above.
- **No account deletion in the app.** There's no endpoint; removing an account is a
  `DELETE FROM users WHERE email_key = …` in SQL, and the cascade clears the rest.
- **No "how often does she rebuy this"** — no cadence, no reordering by urgency.
  The list is sorted by how much she liked something. Once there are a few months of
  history, that's the obvious next step.
- **No photo recognition.** The photo is a memory aid so "did you like this?" is
  answerable a week later. Naming the item is still manual.
- **No sharing between accounts.** If you and she both want to see one list, you'd
  add a `households` table and scope by that instead of `user_id`.

## Deployment

It's live, in three pieces:

```
phone ──► Netlify (React app) ──► Render (FastAPI, in Docker) ──► Neon (Postgres)
          static files + proxy     the API                         data and photos
```

| Piece | What it does | Configured by |
| --- | --- | --- |
| **Netlify** | Serves the built React app and forwards `/api/*` and `/photos/*` to Render | [`netlify.toml`](netlify.toml) |
| **Render** | Runs the API from [`backend/Dockerfile`](backend/Dockerfile) | environment variables (below) |
| **Neon** | Postgres: all the rows, and the photos as `BYTEA` | `DATABASE_URL` |

Everything redeploys on `git push` to `main`.

### Why it's shaped this way

**The host's disk is ephemeral.** Render's filesystem is wiped on every deploy and
restart, so nothing can live in a file. That's why the database is Postgres on Neon
and why photos are stored *in* it (see the comment on the `photos` table in
[`schema.sql`](backend/app/schema.sql) for why that beats object storage at this
size, and when it stops being true).

**Netlify proxies the API instead of the browser calling Render directly.** The
rewrites in `netlify.toml` use `status = 200`, so Netlify fetches from Render
server-side and answers as itself. The browser only ever talks to one origin. That
matters for login: a direct call to another domain makes the session cookie
third-party, and Safari blocks those by default — which would break sign-in on
exactly the phone this is for. With the proxy there's also no CORS to maintain.

The `/*` → `/index.html` rule must stay **last** in `netlify.toml`. Netlify applies
the first match, so a catch-all above the others would serve `index.html` for API
calls.

### Render setup

New → Web Service, connect the repo, then:

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Runtime | Docker |
| Health check path | `/healthz` |
| `DATABASE_URL` | your Neon connection string |
| `GROCERY_HTTPS` | `1` |

`GROCERY_HTTPS=1` marks the session cookie `Secure`. **Don't forget it:** without it
the cookie is weaker than it should be. (The reverse mistake — setting it on plain
`http://` — silently drops the cookie, and login appears to do nothing. That's why
it's off by default and only meant for hosts with TLS.)

`DATABASE_URL` is a secret. It lives only in Render's environment settings and in
the gitignored `backend/.env`. It must never be committed.

`GROCERY_ALLOWED_ORIGINS` (comma-separated) is available if you ever call the API
from another origin without the proxy. It isn't needed today.

### Netlify setup

Add new site → import the repo. Leave the build settings alone: `netlify.toml`
supplies base `frontend`, command `npm run build`, publish `dist` and Node 22. Leave
the Functions directory empty — there are none.

If Render's URL ever changes, update it in the two `[[redirects]]` rules.

### The free-tier catch: cold starts

Render's free plan sleeps after ~15 minutes idle, and the next request takes 30–60
seconds to wake it. That's a bad thing to meet standing in an aisle. Two ways around
it: point a free uptime monitor (UptimeRobot, cron-job.org) at
`https://<your-service>.onrender.com/healthz` every 10 minutes, or move to a paid
always-on instance. Free tiers change often, so check current terms.

### Checking a deployment

```bash
curl https://<your-service>.onrender.com/healthz          # {"ok":true}
curl https://<your-site>.netlify.app/api/auth/me          # {"user":null} → proxy works
```

For login, sign up in the browser and reload: you should stay signed in. In dev
tools the `groceries_session` cookie should be on the Netlify domain, `Secure` and
`HttpOnly`.

### Running from your Mac instead

Still supported, and it's the same code. [`serve.sh`](serve.sh) builds the frontend
and serves everything from one uvicorn process wrapped in `caffeinate`, and
[`tunnel.sh`](tunnel.sh) puts a temporary public URL on it with Cloudflare Tunnel.
[`com.groceries.server.plist`](com.groceries.server.plist) is a LaunchAgent that
starts it at login. Note that it uses whatever `DATABASE_URL` is in `backend/.env`,
so unless you point that elsewhere you're talking to the **live** database. A Mac
sleeps when you close the lid, which is why this is the fallback and not the plan.

## Housekeeping

**Backups.** The data is in Neon, not on your machine, so nothing here is a backup
you control. Use the app's own export — **ZIP** (or `/api/export.zip`) bundles the
history and photos. Check Neon's current backup and restore terms for your plan.

**Photos clean themselves up.** They're rows with `ON DELETE CASCADE`, so deleting a
purchase or a whole account removes them. There are no orphaned files to sweep.

**The old SQLite file.** [`migrate_sqlite_to_postgres.py`](backend/migrate_sqlite_to_postgres.py)
was a one-off. `backend/data/` is the pre-migration copy; it's gitignored and safe
to delete once you're sure you won't need to roll back.

## Scaling, when it matters

It won't for a long time. The queries are plain SQL with `user_id` on every table,
and FastAPI won't be the limit. What will run out first is the free Postgres size,
and photos are the bulk of it. When that happens, move them to object storage (R2 or
B2) — the photo code in [`photos.py`](backend/app/photos.py) is the only place that
changes.

### Downloads on a phone

The exports (PDF, CSV, ZIP) are fetched by the app and handed to the phone's **share
sheet** (Save to Files, AirDrop, ...), not linked with `<a download>`. In an app added to
the iPhone Home Screen iOS ignores `download`: a PDF would open in a viewer with no way
back, and a ZIP would have nowhere to go. Where there's no share sheet (desktop), it's a
normal download. If Safari refuses to open the sheet because the file took too long to
build, the row switches to "Ready. Tap to save it" and a second tap opens it.

