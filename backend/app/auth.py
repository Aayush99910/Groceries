"""Accounts: email, password, session cookie.

Deliberately small. No email verification, no password-reset links, no OAuth --
all of those need an email service, and none of them are needed for two people on
a home network. What this does provide:

  * passwords stored only as a salted scrypt hash, never in the clear
  * constant-time comparison, so timing doesn't leak the hash
  * an HttpOnly session cookie, so page JavaScript can't read the token
  * a brute-force brake on repeated failed logins

scrypt comes from hashlib in the standard library: memory-hard, well regarded,
and nothing to install or pay for.
"""

import hashlib
import re
import secrets
import sqlite3
import time
from datetime import datetime, timedelta, timezone

from .db import parse_iso, utcnow_iso

COOKIE_NAME = "groceries_session"
# Long-lived on purpose. Being asked to log in in the middle of a shop is exactly
# the friction this app exists to remove.
SESSION_DAYS = 180

MIN_PASSWORD_LENGTH = 8

# scrypt cost. n=2**14 with r=8 needs ~16MB per hash: slow enough to make offline
# cracking expensive, fast enough that logging in feels instant.
_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_MAXMEM = 64 * 1024 * 1024
_SCRYPT_DKLEN = 32

# Rough email shape check. Deliberately loose -- the only real proof an address
# works is sending to it, which we're not doing.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")


# --------------------------------------------------------------------------
# passwords
# --------------------------------------------------------------------------


def hash_password(password: str) -> str:
    """Salted scrypt hash, stored as scrypt$n$r$p$salt_hex$hash_hex."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        maxmem=_SCRYPT_MAXMEM,
        dklen=_SCRYPT_DKLEN,
    )
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Re-derive with the stored salt and parameters, then compare."""
    try:
        scheme, n, r, p, salt_hex, hash_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=int(n),
            r=int(r),
            p=int(p),
            maxmem=_SCRYPT_MAXMEM,
            dklen=len(hash_hex) // 2,
        )
    except (ValueError, TypeError):
        return False
    # compare_digest, not ==, so the comparison can't be timed byte by byte.
    return secrets.compare_digest(digest.hex(), hash_hex)


# --------------------------------------------------------------------------
# validation
# --------------------------------------------------------------------------


def email_key(email: str) -> str:
    return email.strip().lower()


def email_looks_valid(email: str) -> bool:
    key = email_key(email)
    return bool(_EMAIL_RE.match(key)) and len(key) <= 254


def password_problem(password: str) -> str | None:
    """Return a human-readable complaint, or None if the password is acceptable."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password needs at least {MIN_PASSWORD_LENGTH} characters"
    if len(password.encode("utf-8")) > 1024:
        return "That password is unreasonably long"
    return None


# --------------------------------------------------------------------------
# brute-force brake
# --------------------------------------------------------------------------

_MAX_ATTEMPTS = 10
_LOCKOUT_SECONDS = 15 * 60
_attempts: dict[str, list[float]] = {}


def lockout_remaining(client: str) -> int:
    """Seconds still to wait before this client may try again, else 0."""
    now = time.monotonic()
    recent = [t for t in _attempts.get(client, []) if now - t < _LOCKOUT_SECONDS]
    if recent:
        _attempts[client] = recent
    else:
        _attempts.pop(client, None)
    if len(recent) < _MAX_ATTEMPTS:
        return 0
    return max(1, int(_LOCKOUT_SECONDS - (now - recent[0])))


def record_failure(client: str) -> None:
    _attempts.setdefault(client, []).append(time.monotonic())


def clear_failures(client: str) -> None:
    _attempts.pop(client, None)


# --------------------------------------------------------------------------
# users and sessions
# --------------------------------------------------------------------------


def create_user(db: sqlite3.Connection, email: str, password: str, display_name: str | None):
    cursor = db.execute(
        """INSERT INTO users (email, email_key, display_name, password_hash, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        (
            email.strip(),
            email_key(email),
            (display_name or "").strip() or None,
            hash_password(password),
            utcnow_iso(),
        ),
    )
    db.commit()
    return db.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()


def find_user_by_email(db: sqlite3.Connection, email: str):
    return db.execute("SELECT * FROM users WHERE email_key = ?", (email_key(email),)).fetchone()


def create_session(db: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = utcnow_iso()
    db.execute(
        "INSERT INTO sessions (token, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
        (token, user_id, now, now),
    )
    db.commit()
    return token


def user_for_session(db: sqlite3.Connection, token: str | None):
    """The logged-in user for this cookie, or None. Expired sessions are dropped."""
    if not token:
        return None

    row = db.execute(
        """SELECT s.token, s.created_at, u.*
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token = ?""",
        (token,),
    ).fetchone()
    if not row:
        return None

    if parse_iso(row["created_at"]) < datetime.now(timezone.utc) - timedelta(days=SESSION_DAYS):
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))
        db.commit()
        return None

    db.execute("UPDATE sessions SET last_seen_at = ? WHERE token = ?", (utcnow_iso(), token))
    db.commit()
    return row


def destroy_session(db: sqlite3.Connection, token: str | None) -> None:
    if token:
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))
        db.commit()
