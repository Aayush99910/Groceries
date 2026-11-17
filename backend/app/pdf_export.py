"""The printable version of a grocery history.

A PDF because this is meant to be *read*, usually on a phone: iOS previews it
inline, saves it to Files, prints and shares it. The CSV export is the one for
reusing the data; this one is for looking at it.

Grouped by shopping trip with per-trip totals, and each item carries its photo —
the photos are the whole point of the app, so a text-only export would just be
the CSV with worse formatting.
"""

import io
from collections.abc import Callable

from fpdf import FPDF
from fpdf.enums import Align, XPos, YPos

from .text import format_price

# Core PDF fonts are Latin-1 only, and real data here contains typographic
# characters -- her iPhone keyboard writes "Trader Joe's" with a curly
# apostrophe. Map the common ones to ASCII rather than shipping a TTF.
_SUBSTITUTIONS = {
    "’": "'", "‘": "'", "“": '"', "”": '"',
    "–": "-", "—": "-", "…": "...", " ": " ",
}

ROW_HEIGHT = 16  # mm, tall enough for a readable thumbnail
THUMB = 13


def _safe(text: str | None) -> str:
    if not text:
        return ""
    for bad, good in _SUBSTITUTIONS.items():
        text = text.replace(bad, good)
    # Anything still outside Latin-1 becomes '?' rather than raising.
    return text.encode("latin-1", "replace").decode("latin-1")


def build_pdf(rows, account: str, load_photo: Callable[[str], bytes | None]) -> bytes:
    """`load_photo` takes a photo id and returns its JPEG bytes, or None.

    Passed in rather than imported so this module stays ignorant of where photos
    actually live -- it was a directory, it is now a database column.
    """
    pdf = FPDF(unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(0, 10, "Groceries", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 6, _safe(account), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    if not rows:
        pdf.ln(6)
        pdf.set_text_color(0, 0, 0)
        pdf.cell(0, 8, "Nothing logged yet.", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        return bytes(pdf.output())

    total_cents = sum(r["price_cents"] or 0 for r in rows)
    pdf.cell(
        0, 6,
        f"{len(rows)} purchases - {format_price(total_cents) or '$0.00'} total",
        new_x=XPos.LMARGIN, new_y=YPos.NEXT,
    )
    pdf.ln(4)

    # Rows arrive newest-first; group consecutive ones from the same trip.
    current_trip = None
    for r in rows:
        trip = (r["shopped_on"], r["store"])
        if trip != current_trip:
            current_trip = trip
            trip_total = sum(
                x["price_cents"] or 0
                for x in rows
                if (x["shopped_on"], x["store"]) == trip
            )
            pdf.ln(3)
            pdf.set_font("Helvetica", "B", 12)
            pdf.set_text_color(0, 0, 0)
            pdf.cell(130, 7, _safe(f"{r['store']} - {r['shopped_on']}"))
            pdf.set_font("Helvetica", "", 10)
            pdf.set_text_color(120, 120, 120)
            pdf.cell(0, 7, format_price(trip_total) or "", align=Align.R,
                     new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_draw_color(220, 220, 220)
            pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
            pdf.ln(1)

        top = pdf.get_y()
        # Keep a whole row on one page rather than splitting photo from text.
        if top + ROW_HEIGHT > pdf.h - pdf.b_margin:
            pdf.add_page()
            top = pdf.get_y()

        photo = r["purchase_photo"] or r["item_photo"]
        text_x = pdf.l_margin
        if photo:
            data = load_photo(photo)
            if data:
                try:
                    pdf.image(io.BytesIO(data), x=pdf.l_margin, y=top + 1, w=THUMB, h=THUMB)
                    text_x = pdf.l_margin + THUMB + 4
                except Exception:
                    # A corrupt image must not take the whole export down.
                    pass

        pdf.set_xy(text_x, top + 2)
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(0, 0, 0)
        pdf.cell(110, 5, _safe(r["item_name"]))

        pdf.set_font("Helvetica", "", 11)
        pdf.cell(0, 5, format_price(r["price_cents"]) or "", align=Align.R,
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        rating = {None: "not rated", 0: "disliked", 1: "liked"}[r["liked"]]
        pdf.set_xy(text_x, top + 7.5)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(130, 130, 130)
        pdf.cell(0, 5, _safe(f"{r['category']} - {rating}"),
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        pdf.set_y(top + ROW_HEIGHT)

    return bytes(pdf.output())
