#!/usr/bin/env python3
"""内閣府「令和8年熊本地震に係る被害状況等について」日次報テキストのパーサー。

data/raw/bousai_*.txt (pdftotext -layout 抽出済み) を読み、
data/bousai_snapshots.json を出力する。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT_PATH = ROOT / "data" / "bousai_snapshots.json"

FULLWIDTH_DIGITS = "０１２３４５６７８９"
HALFWIDTH_DIGITS = "0123456789"
DIGIT_TRANS = str.maketrans(FULLWIDTH_DIGITS, HALFWIDTH_DIGITS)

KANJI_LEVEL_RE = re.compile(r"令和(\d+)年(\d+)月(\d+)日")
TIME_LEVEL_RE = re.compile(r"(\d+)時(\d+)分現在")

HIRAGANA_ONLY_RE = re.compile(r"^[぀-ゟー\s]+$")
PAGE_BREAK_RE = re.compile(r"^\d+\s*/\s*\d+$")
PREF_BRACKET_RE = re.compile(r"^【(.+?)】$")
DATE_TAIL_RE = re.compile(r"(\d{1,2}/\d{1,2}(?:[~～][\d/]*)?)\s*$")
STANDALONE_DIGIT_RE = re.compile(r"^\d{1,2}$")

NUM_TOKEN = r"約[\d,]+|不明|[\d,]+※?"
DATA_LINE_FULL_RE = re.compile(
    r"^([一-鿿]{1,8}[市町村])\s+(" + NUM_TOKEN + r")\s+(" + NUM_TOKEN +
    r")\s+(\d{1,2}/\d{1,2}(?:[~～](?:\d{1,2}(?:/\d{1,2})?)?)?)\s*(.*)$"
)
DATA_LINE_NODATE_RE = re.compile(
    r"^([一-鿿]{1,8}[市町村])\s+(" + NUM_TOKEN + r")\s+(" + NUM_TOKEN + r")\s+(.*)$"
)


def normalize_digits(s):
    return s.translate(DIGIT_TRANS)


def normalize_ws(s):
    return re.sub(r"\s+", " ", s).strip()


def parse_num(token):
    token = token.strip()
    core = token.replace("約", "").replace(",", "")
    core = core.rstrip("※").strip()
    if core in ("不明", "", "ー", "-", "―"):
        return None
    return int(core)


def strip_bullet(note):
    note = re.sub(r"^[・※]\s*", "", note.strip(), count=1)
    return note.strip()


def find_header_datetime(text):
    lines = text.split("\n")
    for i in range(len(lines) - 1):
        despaced1 = normalize_digits(lines[i].replace(" ", ""))
        m1 = KANJI_LEVEL_RE.match(despaced1)
        if not m1:
            continue
        despaced2 = normalize_digits(lines[i + 1].replace(" ", ""))
        m2 = TIME_LEVEL_RE.match(despaced2)
        if not m2:
            continue
        year = 2018 + int(m1.group(1))  # 令和1年=2019年
        month, day = int(m1.group(2)), int(m1.group(3))
        hour, minute = int(m2.group(1)), int(m2.group(2))
        return year, month, day, hour, minute
    return None


def parse_water_section(text):
    m = re.search(r"①水道.*?②電力", text, re.S)
    if not m:
        return {}, {"max": None, "current": None}
    sec = m.group(0)

    header_idx = None
    lines = sec.split("\n")
    for i, l in enumerate(lines):
        if "最大" in l and "現在" in l and "期間" in l:
            header_idx = i
            break
    if header_idx is None:
        return {}, {"max": None, "current": None}

    result = {}
    current_pref = None
    pending_period_prefix = None
    last_record_name = None

    end_idx = len(lines)
    for i in range(header_idx + 1, len(lines)):
        s = lines[i].strip()
        if s.startswith("合計"):
            end_idx = i
            break
        if "給水車" in s:
            end_idx = i
            break

    for i in range(header_idx + 1, end_idx):
        raw = lines[i]
        s = normalize_ws(raw)
        if not s:
            continue
        if PAGE_BREAK_RE.match(s):
            continue
        pm = PREF_BRACKET_RE.match(s)
        if pm:
            current_pref = pm.group(1)
            continue

        if STANDALONE_DIGIT_RE.match(s) and last_record_name is not None:
            rec = result[last_record_name]
            if rec["period"] and rec["period"].endswith(("～", "~")):
                rec["period"] = rec["period"] + s
            continue

        date_tail_m = DATE_TAIL_RE.search(s)
        if date_tail_m:
            prefix = s[: date_tail_m.start()].strip()
            if HIRAGANA_ONLY_RE.fullmatch(prefix) or prefix == "":
                pending_period_prefix = date_tail_m.group(1)
                continue

        if HIRAGANA_ONLY_RE.fullmatch(s):
            continue

        dm = DATA_LINE_FULL_RE.match(s)
        if dm:
            name, max_tok, cur_tok, period, note = dm.groups()
            result[name] = {
                "pref": current_pref,
                "max": parse_num(max_tok),
                "current": parse_num(cur_tok),
                "period": period,
                "note": strip_bullet(note),
            }
            last_record_name = name
            pending_period_prefix = None
            continue

        dm2 = DATA_LINE_NODATE_RE.match(s)
        if dm2:
            name, max_tok, cur_tok, note = dm2.groups()
            result[name] = {
                "pref": current_pref,
                "max": parse_num(max_tok),
                "current": parse_num(cur_tok),
                "period": pending_period_prefix,
                "note": strip_bullet(note),
            }
            last_record_name = name
            pending_period_prefix = None
            continue

    total_scope_end = sec.find("給水車")
    if total_scope_end == -1:
        total_scope_end = len(sec)
    total_idx = sec.find("合計", 0, total_scope_end)
    total = {"max": None, "current": None}
    if total_idx != -1:
        window = sec[total_idx:total_idx + 150]
        nums = re.findall(r"約?\s*([\d,]+|不明)", window)
        nums = [n for n in nums if n.strip()]
        if len(nums) >= 2:
            total["max"] = parse_num(nums[0])
            total["current"] = parse_num(nums[1])

    return result, total


POWER_RESOLVED_RE = re.compile(r"電力について.{0,200}?停電が発生した(?:が|ものの).{0,150}?復旧済み", re.S)


def parse_power_section(text):
    m = re.search(r"②電力.*?③", text, re.S)
    if not m:
        return None, None
    sec = m.group(0)
    nums = [int(n.replace(",", "")) for n in re.findall(r"([\d,]+)\s*戸", sec)]
    if not nums:
        return None, None
    max_v = max(nums)
    if POWER_RESOLVED_RE.search(sec):
        current = 0
    else:
        current = nums[0]
    return current, max_v


def parse_evacuee_summary(text):
    m = re.search(
        r"避難所数[：:]\s*([\d,]+)\s*か所\s*避難者数[：:]\s*([\d,]+)\s*人?"
        r"(?:（最大\s*([\d,]+)\s*か所\s*([\d,]+)\s*人）)?",
        text,
    )
    if not m:
        return None, None, None, None
    shelters = parse_num(m.group(1))
    evacuees = parse_num(m.group(2))
    shelters_max = parse_num(m.group(3)) if m.group(3) else None
    evacuees_max = parse_num(m.group(4)) if m.group(4) else None
    return shelters, evacuees, shelters_max, evacuees_max


def parse_casualty_summary(text):
    """「２ 人的・住家被害等の状況（消防庁情報）」の都道府県別表から熊本県の行を読む。

    列は空セルが多く（行方不明者・床上/床下浸水など）、桁揃えも報ごとに動くため
    位置合わせでは取り違えやすい。代わりに表自身の合計列を使って
      住家合計 = 全壊+半壊+床上+床下+一部破損
      人的合計 = 死者 + 負傷者小計（＋行方不明者）
    が成り立つ並びを探し、成り立たなければ何も返さない（誤った数値を出すより、
    その報の県全体値を持たない方を選ぶ）。県資料とは集計基準が違う点に注意
    （県報の負傷者は軽症/中等症/重症、こちらは重傷/軽傷等）。
    """
    m = re.search(r"人的・住家被害等の状況[^\n]*\n", text)
    if not m:
        return None
    section = text[m.end():]
    end = re.search(r"\n\s*(（２）|\(２\)|３\s+避難所)", section)
    if end:
        section = section[: end.start()]

    row = None
    for line in section.split("\n"):
        if line.strip().startswith("熊本県"):
            row = line
            break
    if row is None:
        return None

    values = [parse_num(t) for t in re.findall(r"[\d,]+", normalize_digits(row))]
    values = [v for v in values if v is not None]
    if len(values) < 4:
        return None

    houses_total = values[-1]
    housing_start = None
    for k in range(1, len(values) - 1):
        if sum(values[-1 - k : -1]) == houses_total:
            housing_start = len(values) - 1 - k
            break
    if housing_start is None or housing_start < 3:
        print(f"WARNING: 人的・住家被害表の住家内訳が合計と一致しない: {normalize_ws(row)}", file=sys.stderr)
        return None

    rest = values[:housing_start]
    casualties_total = rest[-1]
    deaths = rest[0]
    injured = rest[-2]
    if deaths + injured != casualties_total:
        print(f"WARNING: 人的被害の内訳が合計と一致しない（行方不明者あり？）: {normalize_ws(row)}", file=sys.stderr)
        return None

    return {
        "source": "消防庁",
        "deaths": deaths,
        "injured": injured,
        "casualties_total": casualties_total,
        "houses": houses_total,
    }


def parse_deaths_breakdown(text):
    idx = text.find("≪死者の内訳≫")
    if idx == -1:
        return {}, None, None
    lines = text[idx:].split("\n")[1:]
    block = []
    for l in lines:
        s = l.strip()
        if s == "":
            break
        if s.startswith("○") or re.match(r"^[（(][0-9０-９]", s):
            break
        block.append(s)
    block_text = normalize_digits(" ".join(block))

    possible = None
    m = re.search(r"災害による負傷の悪化又は身体的負担による疾病により死亡した可能性のある死者(\d+)人", block_text)
    if m:
        possible = int(m.group(1))
        block_text = block_text.replace(m.group(0), "")

    investigating = None
    m = re.search(r"災害との関連を調査中の死者(\d+)人", block_text)
    if m:
        investigating = int(m.group(1))
        block_text = block_text.replace(m.group(0), "")
    else:
        m = re.search(r"その他調査中死者(\d+)人", block_text)
        if m:
            investigating = int(m.group(1))
            block_text = block_text.replace(m.group(0), "")

    block_text = re.sub(r"【.+?】", "", block_text)

    breakdown = {}
    for chunk in re.split(r"[、,]", block_text):
        cm = re.match(r"\s*([一-鿿]{1,8}[市町村])\s*(\d+)\s*人\s*", chunk)
        if cm:
            breakdown[cm.group(1)] = int(cm.group(2))

    return breakdown, possible, investigating


def parse_quake_overview(text):
    quake = {}
    m = re.search(r"①発生日時\s*\n\s*(.+)", text)
    if m:
        line = normalize_digits(m.group(1))
        dm = KANJI_LEVEL_RE.search(re.sub(r"\s+", "", line))
        tm = re.search(r"(\d{1,2})[：:](\d{2})", line)
        if dm and tm:
            year = 2018 + int(dm.group(1))
            month, day = int(dm.group(2)), int(dm.group(3))
            hour, minute = int(tm.group(1)), int(tm.group(2))
            quake["origin"] = f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:00+09:00"

    m = re.search(r"ア\s*場所\s*(\S+)", text)
    if m:
        quake["epicenter"] = m.group(1).strip()

    m = re.search(r"イ\s*規模\s*マグニチュード\s*([\d.]+)", text)
    if m:
        quake["magnitude"] = float(m.group(1))

    m = re.search(r"ウ\s*震源の深さ\s*([\d.]+)\s*㎞", text)
    if m:
        quake["depth_km"] = float(m.group(1)) if "." in m.group(1) else int(m.group(1))

    quake["shindo"] = parse_shindo_block(text)
    return quake


def parse_shindo_block(text):
    m = re.search(r"各地の震度.*?\n(.*?)\(２\)地震活動の状況", text, re.S)
    if not m:
        return {}
    block = m.group(1)
    shindo = {}
    current_level = None
    current_pref = None

    def add_cities(pref, chunk):
        for city in chunk.split("、"):
            city = city.strip().rstrip("、")
            if city:
                shindo[current_level].append({"pref": pref, "name": city})

    for raw in block.split("\n"):
        s = normalize_ws(raw)
        if not s:
            continue
        lm = re.match(r"^震度(７|６強|６弱|５強|５弱)\s*(.*)$", s)
        if lm:
            current_level = "震度" + lm.group(1)
            shindo.setdefault(current_level, [])
            current_pref = None
            rest = lm.group(2).strip()
            if rest:
                pm = re.match(r"^([一-鿿]{2,4}県)[：:]\s*(.*)$", rest)
                if pm:
                    current_pref = pm.group(1)
                    add_cities(current_pref, pm.group(2))
            continue
        pm = re.match(r"^([一-鿿]{2,4}県)[：:]\s*(.*)$", s)
        if pm and current_level:
            current_pref = pm.group(1)
            add_cities(current_pref, pm.group(2))
            continue
        if current_level and current_pref:
            add_cities(current_pref, s)

    return shindo


def parse_file(path):
    text = path.read_text(encoding="utf-8")

    dt = find_header_datetime(text)
    if dt is None:
        print(f"WARNING: could not find header datetime in {path.name}", file=sys.stderr)
        return None
    year, month, day, hour, minute = dt
    id_str = f"{year:04d}{month:02d}{day:02d}-{hour:02d}{minute:02d}"
    datetime_str = f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:00+09:00"

    m = re.match(r"bousai_(.+)\.txt$", path.name)
    suffix = m.group(1) if m else path.stem.replace("bousai_", "")
    # 日次報PDFは status/ 配下に置かれている（当初は直下だったが移動し、
    # 直下のURLは全報とも404になる）。サイト上の出典リンクもこちらに合わせる
    source_url = f"https://www.bousai.go.jp/updates/r8kumamoto_jishin/status/pdf/r8kumamoto_jishin_{suffix}.pdf"

    water_outage, water_outage_total = parse_water_section(text)
    power_current, power_max = parse_power_section(text)
    shelters, evacuees, shelters_max, evacuees_max = parse_evacuee_summary(text)
    deaths_breakdown, deaths_possible, deaths_investigating = parse_deaths_breakdown(text)
    casualty_pref = parse_casualty_summary(text)

    return {
        "id": id_str,
        "datetime": datetime_str,
        "source_name": "内閣府 被害状況等について",
        "source_url": source_url,
        "water_outage": water_outage,
        "water_outage_total": water_outage_total,
        "deaths_breakdown": deaths_breakdown,
        "deaths_related_possible": deaths_possible,
        "deaths_related_investigating": deaths_investigating,
        # 消防庁ベースの熊本県全体値（県資料が無い日の時点でだけ使う）
        "casualty_pref": casualty_pref,
        "summary": {
            "shelters": shelters,
            "evacuees": evacuees,
            "shelters_max": shelters_max,
            "evacuees_max": evacuees_max,
            "power_outage_current": power_current,
            "power_outage_max": power_max,
        },
    }


def main():
    files = sorted(RAW_DIR.glob("bousai_*.txt"))
    if not files:
        print("no bousai_*.txt files found", file=sys.stderr)
        sys.exit(1)

    snapshots = []
    quake = None
    for path in files:
        snap = parse_file(path)
        if snap is None:
            continue
        snapshots.append(snap)
        if quake is None:
            text = path.read_text(encoding="utf-8")
            quake = parse_quake_overview(text)

    snapshots.sort(key=lambda s: s["datetime"])

    out = {"quake": quake, "snapshots": snapshots}
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"wrote {OUT_PATH} with {len(snapshots)} snapshots")
    for s in snapshots:
        cur_sum = sum(v["current"] for v in s["water_outage"].values() if v["current"] is not None)
        total_cur = s["water_outage_total"]["current"]
        ratio = (cur_sum / total_cur) if total_cur else None
        ok = "OK" if total_cur and abs(cur_sum - total_cur) <= 0.1 * total_cur else "CHECK"
        print(
            f"  {s['id']}: water_municipalities={len(s['water_outage'])} "
            f"sum_current={cur_sum} total_current={total_cur} ratio={ratio} [{ok}] "
            f"deaths_breakdown={len(s['deaths_breakdown'])} "
            f"shelters={s['summary']['shelters']} evacuees={s['summary']['evacuees']}"
        )


if __name__ == "__main__":
    main()
