-- The whole database. SQLite runs this on every startup; the IF NOT EXISTS
-- guards make it safe to re-run, so there is no migration tool to learn yet.

-- Accounts. Email + password hash, nothing else -- no verification, no reset
-- tokens, no third-party email service to pay for.
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL,
    -- Lowercased, trimmed email. UNIQUE lives here so "A@b.com" and "a@b.com "
    -- can't both sign up.
    email_key     TEXT NOT NULL UNIQUE,
    display_name  TEXT,
    -- Never the password itself. Format: scrypt$n$r$p$salt_hex$hash_hex
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

-- Login sessions. In the database rather than in memory so restarting the
-- server doesn't sign her out mid-shop.
CREATE TABLE IF NOT EXISTS sessions (
    token        TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- "The thing", once, per person. Strawberries are one row no matter how many
-- times or how many stores they're bought from. Keeping this separate from
-- purchases is what lets us say "you liked strawberries: $4.99 at Trader Joe's,
-- $6.49 at Safeway".
CREATE TABLE IF NOT EXISTS items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    -- Lowercased, de-pluralised, de-punctuated name. The UNIQUE index is on
    -- (user_id, name_key), so "Milk" and "milk " can't both exist for one
    -- person, but two people can each have their own Milk.
    name_key   TEXT    NOT NULL,
    category   TEXT    NOT NULL DEFAULT 'other',
    -- Most recent photo of this item, for display. Copied from the newest
    -- purchase that had one, so listing items never needs a join.
    photo      TEXT,
    created_at TEXT    NOT NULL,   -- ISO-8601, always UTC
    UNIQUE (user_id, name_key)
);

CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);

-- One shopping trip. Created automatically the first time something is logged
-- from a given store on a given day, so nobody has to tap "start a trip".
CREATE TABLE IF NOT EXISTS hauls (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store      TEXT NOT NULL,
    store_key  TEXT NOT NULL,   -- lowercased, for matching
    shopped_on TEXT NOT NULL,   -- YYYY-MM-DD, local calendar day
    created_at TEXT NOT NULL,
    UNIQUE (user_id, store_key, shopped_on)
);

CREATE INDEX IF NOT EXISTS idx_hauls_user ON hauls(user_id);

-- "She bought this thing, here, for this much, on this day." Then later: did she
-- like it? This table is the entire memory of the app.
CREATE TABLE IF NOT EXISTS purchases (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Derivable from item_id, but stored so every query can filter by owner
    -- directly instead of joining to find out who a row belongs to.
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    haul_id      INTEGER NOT NULL REFERENCES hauls(id) ON DELETE CASCADE,
    -- Money as whole cents. Never floats: 0.1 + 0.2 != 0.3 and prices add up.
    -- NULL is allowed -- "roughly" is fine, blank is fine.
    price_cents  INTEGER,
    photo        TEXT,          -- the photo taken on this trip
    purchased_at TEXT NOT NULL, -- ISO-8601 UTC, filled in by the backend
    liked        INTEGER,       -- NULL = not rated yet, 0 = disliked, 1 = liked
    rated_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_item ON purchases(item_id);
CREATE INDEX IF NOT EXISTS idx_purchases_haul ON purchases(haul_id);
-- Partial index: "what still needs a thumbs up/down?" only ever reads unrated
-- rows, so only those are worth indexing.
CREATE INDEX IF NOT EXISTS idx_purchases_unrated ON purchases(user_id) WHERE liked IS NULL;
