"""기타 코드 진행을 도수 표기 코드 다이어그램(SVG)으로 그린다."""

import re
from html import escape

from keyboard import ACC, STEP

OPEN = [40, 45, 50, 55, 59, 64]  # 표준 튜닝 6번줄(E2)~1번줄(E4)
ROOT_RE = re.compile(r"^([A-G])(#|b|♯|♭)?")

BASE = {0: "R", 1: "b2", 2: "2", 3: "b3", 4: "3", 5: "4", 6: "b5", 7: "5", 8: "#5", 9: "6", 10: "b7", 11: "7"}

STR_GAP, FRET_GAP, DOT_R = 18, 22, 8
CELL_W, PER_ROW, PAD = 140, 6, 16
TITLE_H, MARK_H = 22, 20


def root_pc(symbol):
    m = ROOT_RE.match(symbol.strip())
    if not m:
        return None
    return (STEP[m.group(1)] + ACC[m.group(2) or ""]) % 12


def parse_frets(frets):
    """['x','3','2','0','1','0'] → [None, 3, 2, 0, 1, 0]. 6줄이 아니면 None."""
    if len(frets) != 6:
        return None
    out = []
    for f in frets:
        f = str(f).strip().lower()
        if f in ("x", "-", ""):
            out.append(None)
        elif f.isdigit():
            out.append(int(f))
        else:
            return None
    return out


def degrees(symbol, frets):
    """각 줄의 도수. 7음이 있거나 텐션 코드면 2/4/6을 9/11/13으로 읽는다."""
    root = root_pc(symbol)
    if root is None:
        return [None] * 6
    ivs = [None if f is None else (OPEN[i] + f - root) % 12 for i, f in enumerate(frets)]
    present = {iv for iv in ivs if iv is not None}
    extended = bool(present & {10, 11}) or bool(re.search(r"(?<!add)(9|11|13)|7", symbol))
    sus = "sus" in symbol

    def name(iv):
        if not extended:
            return BASE[iv]
        if iv == 1:
            return "b9"
        if iv == 2:
            return "9"
        if iv == 3 and 4 in present:
            return "#9"
        if iv == 5 and not sus:
            return "11"
        if iv == 6 and 7 in present:
            return "#11"
        if iv == 8 and 7 in present:
            return "b13"
        if iv == 9 and "6" not in symbol:
            return "13"
        return BASE[iv]

    return [None if iv is None else name(iv) for iv in ivs]


def _box(chord, frets, x0, y0):
    degs = degrees(chord["symbol"], frets)
    fretted = [f for f in frets if f]
    start = 1 if not fretted or max(fretted) <= 4 else min(fretted)
    count = max(4, (max(fretted) - start + 1) if fretted else 4)

    gx = x0 + (CELL_W - STR_GAP * 5) / 2  # 6번줄 x
    gy = y0 + TITLE_H + MARK_H  # 첫 프렛 줄 y
    out = [f'<text x="{x0 + CELL_W / 2}" y="{y0 + 15}" font-size="14" font-weight="700" '
           f'text-anchor="middle">{escape(chord["symbol"])}</text>']

    # 프렛 가로줄, 줄 세로줄
    for i in range(count + 1):
        w = 4 if i == 0 and start == 1 else 1
        out.append(f'<line x1="{gx}" y1="{gy + i * FRET_GAP}" x2="{gx + STR_GAP * 5}" '
                   f'y2="{gy + i * FRET_GAP}" stroke="#222" stroke-width="{w}"/>')
    for s in range(6):
        out.append(f'<line x1="{gx + s * STR_GAP}" y1="{gy}" x2="{gx + s * STR_GAP}" '
                   f'y2="{gy + count * FRET_GAP}" stroke="#222" stroke-width="1"/>')
    if start > 1:
        out.append(f'<text x="{gx + STR_GAP * 5 + 8}" y="{gy + FRET_GAP / 2 + 4}" font-size="11">{start}fr</text>')

    for s, (f, d) in enumerate(zip(frets, degs)):
        x = gx + s * STR_GAP
        if f is None:  # 뮤트
            my = gy - MARK_H / 2
            out.append(f'<path d="M{x - 5} {my - 5} L{x + 5} {my + 5} M{x + 5} {my - 5} L{x - 5} {my + 5}" '
                       f'stroke="#222" stroke-width="1.6"/>')
        elif f == 0:  # 개방현: 빈 원 안에 도수
            my = gy - MARK_H / 2
            out.append(f'<circle cx="{x}" cy="{my}" r="{DOT_R}" fill="#fff" stroke="#222" stroke-width="1.2"/>')
            out.append(f'<text x="{x}" y="{my + 3}" font-size="8" font-weight="700" text-anchor="middle">{escape(d or "")}</text>')
        else:  # 누른 자리: 검은 점 안에 도수, 루트는 강조색
            cy = gy + (f - start + 0.5) * FRET_GAP
            fill = "#e8590c" if d == "R" else "#222"
            out.append(f'<circle cx="{x}" cy="{cy}" r="{DOT_R}" fill="{fill}"/>')
            out.append(f'<text x="{x}" y="{cy + 3}" font-size="8" font-weight="700" fill="#fff" '
                       f'text-anchor="middle">{escape(d or "")}</text>')
    return out, TITLE_H + MARK_H + count * FRET_GAP


def progression_svg(chords):
    """chords: [{symbol, frets}] → SVG 문자열. 그릴 코드가 없으면 None."""
    boxes = [(c, f) for c in chords if (f := parse_frets(c["frets"])) and any(x is not None for x in f)]
    if not boxes:
        return None

    body, y, row_h = [], 0, 0
    for i, (chord, frets) in enumerate(boxes):
        col = i % PER_ROW
        if i and col == 0:
            y += row_h + PAD
            row_h = 0
        shapes, h = _box(chord, frets, col * CELL_W, y)
        body += shapes
        row_h = max(row_h, h)

    width = min(len(boxes), PER_ROW) * CELL_W + PAD * 2
    height = y + row_h + PAD * 2
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" font-family="Helvetica, Arial, sans-serif">'
        f'<rect width="100%" height="100%" fill="#fff"/>'
        f'<g transform="translate({PAD},{PAD})" fill="#222">{"".join(body)}</g></svg>'
    )
