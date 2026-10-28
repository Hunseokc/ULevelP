"""코드 진행의 보이싱을 건반 그림(SVG)으로 그린다."""

import re
from html import escape

NOTE_RE = re.compile(r"^([A-Ga-g])(##|bb|x|#|b|♯|♭)?(-?\d)$")
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
ACC = {"": 0, "#": 1, "♯": 1, "##": 2, "x": 2, "b": -1, "♭": -1, "bb": -2}
BLACK = {1, 3, 6, 8, 10}

WHITE_W, WHITE_H = 20, 72
BLACK_W, BLACK_H = 12, 44
LABEL_W, ROW_GAP, PAD = 150, 30, 16
COLORS = {"lh": "#4263eb", "rh": "#f08c00", "all": "#2f9e44"}


def midi(note):
    """'Gb4' → 66. 옥타브가 없거나 읽을 수 없으면 None."""
    m = NOTE_RE.match(note.strip())
    if not m:
        return None
    letter, acc, octave = m.groups()
    return (int(octave) + 1) * 12 + STEP[letter.upper()] + ACC[acc or ""]


def _keys(lo, hi):
    """lo~hi 범위의 건반 위치. {midi: (x, is_black)}"""
    keys, white = {}, 0
    for n in range(lo, hi + 1):
        if n % 12 in BLACK:
            keys[n] = (white * WHITE_W - BLACK_W / 2, True)
        else:
            keys[n] = (white * WHITE_W, False)
            white += 1
    return keys, white


def _row(chord, keys, y):
    """한 코드의 건반 줄. 누른 건반에 색과 음이름을 표시한다."""
    pressed = {}
    for hand in ("lh", "rh"):
        for name in chord[hand]:
            n = midi(name)
            if n in keys:
                pressed[n] = (COLORS[hand if chord["split"] else "all"], name)

    out = [f'<text x="0" y="{y + WHITE_H / 2 + 5}" font-size="14" font-weight="700">{escape(chord["symbol"])}</text>']
    for black in (False, True):  # 흰 건반 위에 검은 건반을 덮어 그린다
        for n, (x, is_black) in keys.items():
            if is_black != black:
                continue
            w, h = (BLACK_W, BLACK_H) if black else (WHITE_W, WHITE_H)
            fill = pressed[n][0] if n in pressed else ("#222" if black else "#fff")
            out.append(f'<rect x="{LABEL_W + x}" y="{y}" width="{w}" height="{h}" fill="{fill}" stroke="#555" stroke-width="0.8"/>')
            if n in pressed:
                # 흰 건반은 건반 안 아래쪽, 검은 건반은 폭이 좁아 건반 줄 아래에 음이름을 쓴다
                color, name = pressed[n]
                ty, fill = (y + WHITE_H + 12, color) if black else (y + h - 6, "#fff")
                out.append(f'<text x="{LABEL_W + x + w / 2}" y="{ty}" font-size="9" fill="{fill}" '
                           f'text-anchor="middle" font-weight="700">{escape(name)}</text>')
    return out


def progression_svg(chords):
    """chords: [{symbol, lh, rh, split}] → SVG 문자열. 그릴 노트가 하나도 없으면 None."""
    rows = [c for c in chords if any(midi(n) is not None for n in c["lh"] + c["rh"])]
    if not rows:
        return None
    notes = [midi(n) for c in rows for n in c["lh"] + c["rh"] if midi(n) is not None]
    lo = min(notes) // 12 * 12  # 가장 낮은 음이 속한 옥타브의 C부터
    hi = max(max(notes) // 12 * 12 + 11, lo + 23)  # 최소 2옥타브
    keys, whites = _keys(lo, hi)

    legend_h = 22 if any(c["split"] for c in rows) else 0
    width = LABEL_W + whites * WHITE_W + PAD * 2
    height = legend_h + len(rows) * (WHITE_H + ROW_GAP) - ROW_GAP + PAD * 2

    body = []
    if legend_h:
        body += [
            f'<rect x="{LABEL_W}" y="0" width="10" height="10" fill="{COLORS["lh"]}"/>',
            f'<text x="{LABEL_W + 14}" y="9" font-size="11">LH</text>',
            f'<rect x="{LABEL_W + 44}" y="0" width="10" height="10" fill="{COLORS["rh"]}"/>',
            f'<text x="{LABEL_W + 58}" y="9" font-size="11">RH</text>',
        ]
    for i, chord in enumerate(rows):
        body += _row(chord, keys, legend_h + i * (WHITE_H + ROW_GAP))

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" font-family="Helvetica, Arial, sans-serif">'
        f'<rect width="100%" height="100%" fill="#fff"/>'
        f'<g transform="translate({PAD},{PAD})" fill="#222">{"".join(body)}</g></svg>'
    )
