#!/usr/bin/env python3
import glob
import json
import os
import re
import sys

RAW_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "raw")
OUT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "pref_snapshots.json")

MUNICIPALITIES = [
    "熊本市", "八代市", "人吉市", "荒尾市", "水俣市", "玉名市", "山鹿市", "菊池市", "宇土市", "上天草市",
    "宇城市", "阿蘇市", "天草市", "合志市", "美里町", "玉東町", "南関町", "長洲町", "和水町", "大津町",
    "菊陽町", "南小国町", "小国町", "産山村", "高森町", "西原村", "南阿蘇村", "御船町", "嘉島町", "益城町",
    "甲佐町", "山都町", "氷川町", "芦北町", "津奈木町", "錦町", "多良木町", "湯前町", "水上村", "相良村",
    "五木村", "山江村", "球磨村", "あさぎり町", "苓北町",
]
MUNI_SET = set(MUNICIPALITIES)
assert len(MUNI_SET) == 45

SCHEMA_FIELDS = [
    "shelters", "evacuees", "injured_light", "injured_moderate", "injured_severe",
    "cardiac_arrest", "deaths", "casualty_unclassified",
    "houses_full", "houses_large_half", "houses_half", "houses_partial", "houses_unclassified",
    "power_outage", "water_outage", "water_stations",
]

TOKEN_RE = re.compile(r"\S+")


def tokenize(line):
    return [(m.group(), m.start(), m.end()) for m in TOKEN_RE.finditer(line)]


def parse_value(text):
    """Parse a single raw cell token into an int, or None if it is a
    dash placeholder ('―') or an unquantified '不明' (unknown) marker."""
    if text in ("―", "-", "―", "－"):
        return None
    m = re.fullmatch(r"不明[（(](\d+)名[）)]", text)
    if m:
        return int(m.group(1))
    if "不明" in text:
        return None
    cleaned = text.replace(",", "").lstrip("約")
    if re.fullmatch(r"\d+", cleaned):
        return int(cleaned)
    return None


def assign_row(tokens, columns):
    """Greedy nearest-column assignment. tokens: list of (text,start,end).
    columns: list of (key, end_pos) sorted by end_pos ascending.
    Returns dict key -> parsed value (int or None) for columns that
    received a token; columns with no token are absent from the dict.
    """
    result = {}
    col_idx = 0
    for text, start, end in tokens:
        while (col_idx + 1 < len(columns) and
               abs(columns[col_idx + 1][1] - end) <= abs(columns[col_idx][1] - end)):
            col_idx += 1
        key = columns[col_idx][0]
        result[key] = parse_value(text)
        col_idx += 1
        if col_idx >= len(columns):
            break
    return result


def detect_flags(header_lines):
    header_block = "\n".join(header_lines)
    has_house_breakdown = "全壊" in header_block
    has_calc_total = has_house_breakdown and "計" in header_block
    has_power = "停電" in header_block
    has_stations = "給水所" in header_block
    has_house_merged_total = ("住家被害" in header_block) and not has_house_breakdown
    return has_house_breakdown, has_calc_total, has_power, has_stations, has_house_merged_total


def field_order(flags):
    has_house_breakdown, has_calc_total, has_power, has_stations, has_house_merged_total = flags
    order = ["shelters", "evacuees", "injured_light", "injured_moderate",
             "injured_severe", "cardiac_arrest", "deaths", "casualty_unclassified"]
    if has_house_breakdown:
        order += ["houses_full", "houses_large_half", "houses_half",
                   "houses_partial", "houses_unclassified"]
        if has_calc_total:
            order.append("_ghost_house_calc_total")
    elif has_house_merged_total:
        order.append("_ghost_house_merged_total")
    if has_power:
        order.append("power_outage")
    order.append("water_outage")
    if has_stations:
        order.append("water_stations")
    return order


def build_columns(header_lines, total_tokens, fname):
    """Derive an ordered list of (field_key, end_position) describing every
    numeric column present in this report, including 'ghost' columns
    (merged house-damage total, house-damage calculated total) that exist
    purely for column-position alignment and are dropped before final
    output.

    Column positions are calibrated from the 合計 (totals) row rather than
    the header text: the totals row always has exactly one, fully-populated
    (non-blank) token per column, so its token end-positions are a far more
    reliable proxy for a right-aligned column's true boundary than the
    (often much narrower) header label text.
    """
    flags = detect_flags(header_lines)
    order = field_order(flags)

    if len(total_tokens) > len(order):
        print(
            f"WARNING: {fname}: totals row has {len(total_tokens)} values, "
            f"expected {len(order)}; dropping {len(total_tokens) - len(order)} "
            f"trailing value(s): {[t[0] for t in total_tokens[len(order):]]}",
            file=sys.stderr,
        )
        total_tokens = total_tokens[:len(order)]
    elif len(total_tokens) < len(order):
        print(
            f"WARNING: {fname}: totals row has only {len(total_tokens)} values, "
            f"expected {len(order)}; trailing column(s) {order[len(total_tokens):]} "
            f"could not be calibrated and will be dropped",
            file=sys.stderr,
        )
        order = order[:len(total_tokens)]

    columns = [(key, tok[2]) for key, tok in zip(order, total_tokens)]
    present_fields = {k for k, _ in columns if not k.startswith("_ghost")}
    return columns, present_fields


def row_to_record(tokens_after_name, columns, present_fields):
    raw = assign_row(tokens_after_name, columns)
    record = {}
    for field in SCHEMA_FIELDS:
        if field not in present_fields:
            record[field] = None
        elif field in raw:
            record[field] = raw[field]
        else:
            # Column exists in this report, but this row has no token
            # reaching it: the source cell is genuinely blank ("未報告"),
            # which is not the same as a reported value of 0.
            record[field] = None
    return record, raw


def parse_file(path):
    fname = os.path.basename(path)
    m = re.match(r"pref_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})_(\d+)\.txt", fname)
    if not m:
        raise ValueError(f"unexpected filename: {fname}")
    yyyy, mm, dd, hh, mi, attach_id = m.groups()
    snap_id = f"{yyyy}{mm}{dd}-{hh}{mi}"
    dt = f"{yyyy}-{mm}-{dd}T{hh}:{mi}:00+09:00"

    with open(path, encoding="utf-8") as f:
        lines = [l.rstrip("\n") for l in f]

    first_muni_idx = None
    for i, l in enumerate(lines):
        toks = tokenize(l)
        if toks and toks[0][0] in MUNI_SET:
            first_muni_idx = i
            break
    if first_muni_idx is None:
        raise ValueError(f"no municipality row found in {fname}")

    header_lines = lines[:first_muni_idx]

    total_line = None
    for l in lines[first_muni_idx:]:
        toks = tokenize(l)
        if toks and toks[0][0] == "合計":
            total_line = l
            break
    if total_line is None:
        raise ValueError(f"no 合計 (totals) row found in {fname}")
    total_tokens = tokenize(total_line)[1:]

    columns, present_fields = build_columns(header_lines, total_tokens, fname)

    municipalities = {}
    extras = {}
    totals = None
    seen_names = set()

    idx = first_muni_idx
    while idx < len(lines):
        line = lines[idx]
        toks = tokenize(line)
        if not toks:
            idx += 1
            continue
        first_text = toks[0][0]

        if "住家被害認定調査関係" in line:
            break
        if first_text.startswith("※") or first_text.startswith("（※") or line.strip().startswith("※"):
            idx += 1
            continue
        if "該当市町村数" in line:
            idx += 1
            continue

        if first_text in MUNI_SET:
            if first_text in seen_names:
                print(f"WARNING: duplicate municipality row '{first_text}' in {fname}", file=sys.stderr)
            seen_names.add(first_text)
            record, _ = row_to_record(toks[1:], columns, present_fields)
            municipalities[first_text] = record
            idx += 1
            continue

        if first_text == "合計":
            record, raw = row_to_record(toks[1:], columns, present_fields)
            totals = record
            idx += 1
            continue

        if first_text == "身元不明":
            record, raw = row_to_record(toks[1:], columns, present_fields)
            extras["unidentified_remains"] = {k: v for k, v in record.items() if v not in (0, None)}
            extras["_unidentified_remains_all"] = record
            idx += 1
            continue

        if first_text == "災害との関連調査中":
            record, raw = row_to_record(toks[1:], columns, present_fields)
            extras["deaths_related_investigating"] = record.get("deaths")
            idx += 1
            continue

        if first_text.startswith("災害と関連する可能性が"):
            dash_idx = None
            for k in range(idx + 1, min(idx + 5, len(lines))):
                cand_toks = tokenize(lines[k])
                if not cand_toks:
                    continue
                cand_texts = [t for t, s, e in cand_toks]
                if "ある死亡" in cand_texts[0] or "災害" in cand_texts[0]:
                    continue
                is_dash_row = all(t in ("―", "-", "－") or re.fullmatch(r"[\d,]+", t) for t in cand_texts)
                has_digit = any(re.fullmatch(r"[\d,]+", t) for t in cand_texts)
                if is_dash_row and has_digit:
                    dash_idx = k
                    break
            if dash_idx is not None:
                dash_toks = tokenize(lines[dash_idx])
                record, raw = row_to_record(dash_toks, columns, present_fields)
                extras["deaths_related_possible"] = record.get("deaths")
                idx = max(dash_idx, idx + 2) + 1
            else:
                print(f"WARNING: could not locate dash-row for 関連可能性死亡 in {fname}", file=sys.stderr)
                idx += 1
            continue

        idx += 1

    if len(municipalities) != 45:
        print(
            f"WARNING: {fname}: found {len(municipalities)} municipalities (expected 45)",
            file=sys.stderr,
        )
        missing = MUNI_SET - set(municipalities.keys())
        if missing:
            print(f"  missing: {sorted(missing)}", file=sys.stderr)

    return {
        "id": snap_id,
        "datetime": dt,
        "source_name": "熊本県 災害対策本部会議資料",
        "source_url": f"https://www.pref.kumamoto.jp/uploaded/attachment/{attach_id}.pdf",
        "municipalities": municipalities,
        "totals": totals,
        "extras": extras,
    }, present_fields


def validate(snapshot, present_fields, fname):
    ok = True
    munis = snapshot["municipalities"]
    if len(munis) != 45:
        ok = False

    totals = snapshot["totals"]
    extras = snapshot["extras"]
    extra_contrib = {}
    for k, v in extras.get("_unidentified_remains_all", {}).items():
        if v:
            extra_contrib[k] = extra_contrib.get(k, 0) + v
    if extras.get("deaths_related_investigating"):
        extra_contrib["deaths"] = extra_contrib.get("deaths", 0) + extras["deaths_related_investigating"]
    if extras.get("deaths_related_possible"):
        extra_contrib["deaths"] = extra_contrib.get("deaths", 0) + extras["deaths_related_possible"]

    for field in SCHEMA_FIELDS:
        if field not in present_fields:
            continue
        # Unreported (null) cells contribute 0 to the reconciliation sum;
        # only the total row's own figure carries the "true" unreported total.
        muni_sum = sum((v[field] or 0) for v in munis.values())
        muni_sum += extra_contrib.get(field, 0)
        total_val = totals.get(field) if totals else None
        if total_val is None:
            continue
        if muni_sum == total_val:
            continue
        tol_fields = ("power_outage", "water_outage")
        if field in tol_fields and total_val != 0:
            if abs(muni_sum - total_val) / abs(total_val) <= 0.05:
                continue
        print(
            f"WARNING: {fname}: field '{field}' municipality-sum={muni_sum} "
            f"!= total-row={total_val} (diff={muni_sum - total_val})",
            file=sys.stderr,
        )
        ok = False
    return ok


def main():
    files = sorted(glob.glob(os.path.join(RAW_DIR, "pref_2026*_*.txt")))
    # 報告は日々増えるので固定数チェックはしない。最低限、初期12時点を下回ったら警告する
    if len(files) < 12:
        print(f"WARNING: expected at least 12 pref_*.txt files, found {len(files)}", file=sys.stderr)

    snapshots = []
    results = []
    for path in files:
        fname = os.path.basename(path)
        snap, present_fields = parse_file(path)
        ok = validate(snap, present_fields, fname)
        extras = {k: v for k, v in snap["extras"].items() if not k.startswith("_")}
        snap["extras"] = extras
        snapshots.append(snap)
        results.append((snap["id"], ok, len(snap["municipalities"])))

    snapshots.sort(key=lambda s: s["datetime"])

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"snapshots": snapshots}, f, ensure_ascii=False, indent=2)

    print("\n=== Validation summary ===", file=sys.stderr)
    for sid, ok, n in sorted(results):
        status = "OK" if ok else "WARN"
        print(f"  {sid}: municipalities={n} status={status}", file=sys.stderr)
    print(f"\nWrote {len(snapshots)} snapshots to {OUT_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
