# Groceries

A tiny web app so she doesn't have to think in the grocery store.

Three screens, one job each:

| Screen | When | What she does |
| --- | --- | --- |
| **Log** | in the aisle | name, store, rough price, photo → one tap (and delete, for typos) |
| **Rate** | at home, after eating it | thumbs up or thumbs down |
| **Shop** | next trip | reads the list of things she liked, with prices |

The date is filled in by the backend. Nothing else is asked of her.

## Stack

- **FastAPI** — the API
- **SQLite** — the database, via Python's built-in `sqlite3` with hand-written SQL (no ORM)
- **React + Vite + TypeScript** — the frontend
- **Inline SVG icons** — hand-drawn in `components/Icon.tsx`; no icon library, no font
- **Pillow** — shrinks phone photos
- **`hashlib.scrypt`** — password hashing, also standard library

No Docker, no Redis, no LLM, no cloud account, no paid services. It's one Python
process and one file on disk.

## Running it

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

`dev.sh` is for developing. To actually serve the app, use `./serve.sh` — see
[Hosting](#hosting) for the full setup, including keeping the Mac awake and
starting on login.

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

The session is a random 32-byte token in an **`HttpOnly`**, `SameSite=Lax` cookie,
valid 180 days, with the sessions themselves in the database so restarting the
server doesn't sign anyone out mid-shop. `HttpOnly` means page JavaScript can't
read it, so an XSS bug can't steal it.

### Resetting a forgotten password

No reset emails, so you do it by hand:

```bash
cd backend && ./.venv/bin/python -c "
from app.auth import hash_password
from app.db import connect
with connect() as c:
    c.execute('UPDATE users SET password_hash = ? WHERE email_key = ?',
              (hash_password('the-new-password'), 'her@example.com'))
"
```

## The database

Everything lives in one file: `backend/data/groceries.db`. Copy it to back up,
delete it to start over. It's gitignored, so real data never enters the repo.

```bash
sqlite3 backend/data/groceries.db
```

Then `.tables`, `.schema items`, or:

```sql
SELECT u.email, i.name, h.store, p.price_cents, p.liked
FROM purchases p
JOIN items i ON i.id = p.item_id
JOIN hauls h ON h.id = p.haul_id
JOIN users u ON u.id = p.user_id
ORDER BY p.purchased_at DESC;
```

[DB Browser for SQLite](https://sqlitebrowser.org) is a good free GUI if you'd
rather click than type.

Schema lives in [`backend/app/schema.sql`](backend/app/schema.sql) — five tables:

- **users** — email, display name, password hash.
- **sessions** — active logins, one row per signed-in device.
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
- **No HTTPS on the LAN setup.** The session cookie is `HttpOnly` and
  `SameSite=Lax`. It is only marked `Secure` when you set `GROCERY_HTTPS=1`, which
  you should do the moment it's behind TLS — see Hosting below.
- **No "how often does she rebuy this"** — no cadence, no reordering by urgency.
  The list is sorted by how much she liked something. Once there are a few months of
  history, that's the obvious next step.
- **No photo recognition.** The photo is a memory aid so "did you like this?" is
  answerable a week later. Naming the item is still manual.
- **No sharing between accounts.** If you and she both want to see one list, you'd
  add a `households` table and scope by that instead of `user_id`.

## Hosting

Free tiers change constantly, so check current terms before committing. What
matters for *this* app is one thing: **it keeps state in files.** The SQLite
database and the photos both live on disk, so any host without a persistent disk
will silently lose her data on the next restart or deploy.

### Now: run it on your Mac

For two people this is the best option, not a compromise. One command:

```bash
./serve.sh
```

That builds the frontend, serves everything from one uvicorn process, and prints
the URLs. Then on her phone:

```
http://aayushs-macbook-air.local:8000
```

Use the `.local` name, not the IP. Your router hands out `192.168.1.234` by DHCP
and it will change eventually; the `.local` name is advertised over Bonjour and
iPhones resolve it natively, so it keeps working. No router configuration.

#### Keeping it awake

This is the real problem with a laptop as a server. Your Mac is set to sleep after
1 minute idle, and `Wake for network access` is off — so once it sleeps, her phone
gets nothing.

`serve.sh` wraps uvicorn in **`caffeinate -si`**, which holds off idle and system
sleep for exactly as long as the server runs. Quit the server and normal power
behaviour returns immediately. No `sudo`, nothing permanent to remember you
changed. Confirm it's working with:

```bash
pmset -g assertions | grep -i caffeinate
```

What `caffeinate` can't fix: **closing the lid still sleeps a MacBook.** Leave it
open and on the power adapter. (An external display and power lets it run in
clamshell, and `sudo pmset -a disablesleep 1` disables lid sleep entirely, but
that's a permanent system change and worth avoiding unless you want it.)

#### Starting it automatically

[`com.groceries.server.plist`](com.groceries.server.plist) is a LaunchAgent that
starts the server at login and restarts it if it crashes:

```bash
cp com.groceries.server.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.groceries.server.plist
```

To stop and remove it:

```bash
launchctl unload ~/Library/LaunchAgents/com.groceries.server.plist && rm ~/Library/LaunchAgents/com.groceries.server.plist
```

Logs go to `~/Library/Logs/groceries-server.log`. It starts at *login*, not boot,
so after a restart you have to log in once. It runs uvicorn directly rather than
`serve.sh`, so it doesn't depend on npm being on launchd's PATH — run `./serve.sh`
by hand after frontend changes to rebuild `frontend/dist`.

#### Reaching it when she's not on your wifi

See [Reaching it from anywhere](#reaching-it-from-anywhere-cloudflare-tunnel)
below — `./tunnel.sh`.

#### The honest trade-off

Your Mac has to be awake and on your network. That's fine for "she checks the list
before shopping", and annoying if you close the lid on the way out the door. A
Raspberry Pi solves it precisely because it's always on — but if you don't want to
run one, the Mac is genuinely fine. Nothing about this setup is throwaway: moving
to a Pi later is copying the folder and `data/groceries.db` across.

### Reaching it from anywhere (Cloudflare Tunnel)

`.local` only resolves on your own wifi. To reach the app on cellular data,
`cloudflared` makes an **outbound** connection from this Mac to Cloudflare, which
then serves a public HTTPS URL. No router ports are opened, so nothing on the
internet can reach this Mac directly — the only thing exposed is the app itself.

```bash
brew install cloudflared
```

Then, with `./serve.sh` already running in another terminal:

```bash
./tunnel.sh
```

It prints a `https://….trycloudflare.com` URL. Open it on her phone — works on
cellular, nothing for her to install.

#### The catch: that URL is temporary

With no domain configured, `cloudflared` gives you a **quick tunnel**: the
hostname is random and changes every time the tunnel restarts. Fine for testing,
useless as a bookmark. Cloudflare also treats quick tunnels as best-effort, so
they aren't meant to be relied on.

A permanent URL needs a domain in your Cloudflare account. There's no free tier
for this — a domain is roughly $10/year, and Cloudflare Registrar sells at
wholesale with no markup. Once you own one:

```bash
cloudflared tunnel login
cloudflared tunnel create groceries
cloudflared tunnel route dns groceries groceries.yourdomain.com
cloudflared tunnel run --url http://localhost:8000 groceries
```

That hostname then stays put. `brew services start cloudflared` (or a LaunchAgent
like the server's) keeps it running across reboots.

**Once you're on a stable HTTPS hostname, set `GROCERY_HTTPS=1`.** That marks the
session cookie `Secure`. Leave it off while you're still using the plain-http LAN
URL, because a `Secure` cookie is silently dropped over http and login just
appears to do nothing.

Note that traffic through the tunnel is encrypted either way — the `Secure` flag
only stops the browser from ever sending the cookie over an unencrypted
connection. It's defence in depth, not the encryption itself.

If you'd rather nothing be publicly reachable at all, [Tailscale](https://tailscale.com)
is the alternative: a private network between just your devices, free, also with no
open ports. The trade-off is that she'd need the app installed and an invite.

### If you want it public

**Serve both halves from one host.** FastAPI already serves `frontend/dist`, so
you don't need Netlify yet — and splitting them means cross-origin cookies and a
CORS list to maintain for no benefit at this size. Netlify is excellent, but it
only hosts the static half; you'd still need somewhere for Python.

Two shapes, depending on whether you keep SQLite:

**Keep SQLite — needs a persistent disk.**
- **Oracle Cloud Always Free** is the most generous: always-on VMs plus a lot of
  block storage, free indefinitely. It's a plain Linux box, so it's the most setup.
- **Fly.io** with a volume is the easiest deploy that keeps a real disk. Note their
  free allowance has shrunk over the years — expect a small monthly bill, not zero.

**Move off SQLite — then almost any free tier works.**
- Database → **Neon** or **Supabase** (both free Postgres, a few hundred MB).
- Photos → **Cloudflare R2** or **Backblaze B2** (both ~10GB free; R2 has no egress
  fees). This is the change that actually matters — 10GB is thousands of photos at
  our ~4KB-to-200KB each.
- Then the API can live anywhere, including **Render**'s free tier.

The catch with free PaaS tiers is **cold starts**: Render's free plan sleeps after
~15 minutes idle and takes 30–60s to wake. That is a bad thing to discover while
standing in an aisle holding strawberries. Anything always-on avoids it.

### Whatever you pick

Set `GROCERY_HTTPS=1` in the environment once TLS is on. That marks the session
cookie `Secure` so the browser will refuse to send it over plain http. It's off by
default because a `Secure` cookie is silently dropped on the http:// LAN setup,
which looks exactly like "login does nothing".

## Housekeeping

Deleting a purchase removes its photo, but a cascade (deleting a whole account)
leaves the image files behind. To sweep them:

```bash
cd backend && ./.venv/bin/python prune_photos.py
```

It lists what it would remove; add `--delete` to actually do it. It never touches
a file that any row still references.

## Scaling, when it matters

It won't for a long time. SQLite handles this comfortably into the hundreds of
thousands of rows with a single writer. When that stops being true, swap the
connection in [`db.py`](backend/app/db.py) for Postgres — the queries are plain SQL
and mostly portable, and `user_id` is already on every table. FastAPI itself won't
be the limit.

The one thing that would need real work is photos: they're on local disk, so a
second server means object storage.
