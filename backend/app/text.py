"""Keeping her typing tidy.

This file is the whole answer to "the data is messy". No ML, no external
service: normalise on the way in, fuzzy-match so reusing an existing entry is
easier than typing a new one, and parse prices forgivingly.
"""

import re
from difflib import SequenceMatcher

_WHITESPACE = re.compile(r"\s+")
_PUNCT = re.compile(r"[^\w\s]")
# Possessives, straight or curly. Dropped *before* punctuation is stripped, so
# "Trader Joe's" and "trader joes" land on the same key instead of becoming two
# different stores.
_POSSESSIVE = re.compile(r"['’]s\b")


def normalize(text: str) -> str:
    """Display form: trimmed, single-spaced, capitalised like a label."""
    cleaned = _WHITESPACE.sub(" ", text).strip()
    if cleaned and cleaned.islower():
        cleaned = cleaned[0].upper() + cleaned[1:]
    return cleaned


def key_for(text: str) -> str:
    """Match form: what makes two entries 'the same thing'.

    Lowercased, punctuation dropped, spaces squashed, trailing plural 's'
    removed -- so "Milk", "milk.", and "milks" all collapse to one key.
    """
    cleaned = _POSSESSIVE.sub("", text.lower())
    cleaned = _PUNCT.sub(" ", cleaned)
    cleaned = _WHITESPACE.sub(" ", cleaned).strip()
    words = []
    for word in cleaned.split(" "):
        if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        words.append(word)
    return " ".join(words)


def similarity(a: str, b: str) -> float:
    """0..1. Cheap, stdlib, good enough for grocery names."""
    return SequenceMatcher(None, key_for(a), key_for(b)).ratio()


def rank_matches(query: str, candidates: list[str], limit: int = 8) -> list[str]:
    """Autocomplete: prefix and substring hits first, then fuzzy near-misses.

    This is the duplicate-prevention mechanism. If picking "Strawberries" off a
    list is faster than typing it, she picks it, and history accumulates on one
    item instead of scattering across three.
    """
    q = key_for(query)
    if not q:
        return candidates[:limit]

    scored: list[tuple[float, str]] = []
    for candidate in candidates:
        c = key_for(candidate)
        if c.startswith(q):
            rank = 3.0
        elif q in c:
            rank = 2.0
        else:
            ratio = SequenceMatcher(None, q, c).ratio()
            if ratio < 0.6:
                continue
            rank = ratio
        # Shorter matches first at equal rank: "Milk" before "Milk chocolate".
        scored.append((rank - len(c) / 1000, candidate))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [name for _, name in scored[:limit]]


_PRICE_CHARS = re.compile(r"[^\d.,]")


def parse_price_cents(raw: str | None) -> int | None:
    """Turn whatever she typed into whole cents, or None if she left it blank.

    Accepts "4.99", "$4.99", "4,99", "5". Returns None rather than raising --
    a mistyped price should never block logging the item.
    """
    if raw is None:
        return None
    text = _PRICE_CHARS.sub("", str(raw)).strip()
    if not text:
        return None

    # "4,99" (comma as decimal separator) vs "1,299" (comma as thousands).
    if "," in text and "." not in text:
        text = text.replace(",", ".") if len(text.split(",")[-1]) == 2 else text.replace(",", "")
    else:
        text = text.replace(",", "")

    try:
        value = float(text)
    except ValueError:
        return None
    if value < 0 or value > 100_000:
        return None
    return round(value * 100)


def format_price(cents: int | None) -> str | None:
    return None if cents is None else f"${cents / 100:.2f}"
