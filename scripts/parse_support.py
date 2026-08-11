#!/usr/bin/env python3
"""熊本県の生活支援ページから「支援拠点」と建設型応急住宅の進捗を収集する。

出典（すべて熊本県ホームページ）:
  入浴支援 …… /soshiki/45/244416.html の「協力公衆浴場一覧」PDF
  防災井戸 …… /soshiki/49/275636.html の「利用可能な井戸水等」PDF
  応急住宅 …… /soshiki/117/275490.html の進捗表(HTML)
  はくおう2 … /soshiki/219/275641.html（入浴・休憩）・/soshiki/219/276703.html（宿泊）
  ペット救護 … /soshiki/30/275568.html

被害数値の各報（pref_*/bousai_*）と違って「最新の一覧で上書きされる」情報なので、
取得したHTML/PDFは data/raw/support/<種別>_<取得日>.<ext> に日付つきで残し、
出力 data/support_sites.json は常に最新一覧そのものとする。

住所のジオコーディングは国土地理院の住所検索APIを使い、結果を
data/support_geocode.json にキャッシュする（毎回の再問い合わせを避ける）。
座標が取れない場合は市町村の代表点に落とし、precision で区別する。

標準ライブラリのみ使用。--offline で既存のraw取得済みファイルだけを使う。
"""
import argparse
import html
import json
import re
import ssl
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw" / "support"
MUNI_PATH = ROOT / "data" / "municipalities.json"
CACHE_PATH = ROOT / "data" / "support_geocode.json"
OUT_PATH = ROOT / "data" / "support_sites.json"

JST = timezone(timedelta(hours=9))
BASE = "https://www.pref.kumamoto.jp"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

PAGES = {
    "bath": {
        "url": f"{BASE}/soshiki/45/244416.html",
        "name": "熊本県 被災者への入浴支援事業（協力公衆浴場一覧）",
        "pdf_label": "協力公衆浴場一覧",
    },
    "well": {
        "url": f"{BASE}/soshiki/49/275636.html",
        "name": "熊本県 宇城・八代地域の防災井戸等",
        "pdf_label": "井戸水",
    },
    "housing": {
        "url": f"{BASE}/soshiki/117/275490.html",
        "name": "熊本県 建設型応急住宅の進捗状況",
    },
    "ferry_bath": {
        "url": f"{BASE}/soshiki/219/275641.html",
        "name": "熊本県 フェリー「はくおう2」入浴・休憩支援（八代港）",
    },
    "ferry_stay": {
        "url": f"{BASE}/soshiki/219/276703.html",
        "name": "熊本県 フェリー「はくおう2」宿泊支援（八代港）",
    },
    "pet": {
        "url": f"{BASE}/soshiki/30/275568.html",
        "name": "熊本県 熊本地震ペット救護本部",
    },
}


# ---------------------------------------------------------------------------
# 取得
# ---------------------------------------------------------------------------

def fetch(url):
    """取得は curl に任せる（この環境のPythonにはCAバンドルが入っていないため、
    update.sh の他の取得処理と同じく curl を単一の経路にする）。"""
    res = subprocess.run(
        ["curl", "-sSL", "--max-time", "60", "-A", UA, url],
        check=True,
        capture_output=True,
    )
    return res.stdout


def raw_path(key, ext, day):
    return RAW_DIR / f"{key}_{day}.{ext}"


def latest_raw(key, ext):
    files = sorted(RAW_DIR.glob(f"{key}_*.{ext}"))
    return files[-1] if files else None


def get_raw(key, url, ext, offline):
    """当日分がなければ取得して data/raw/support/ に保存し、そのパスを返す。"""
    day = datetime.now(JST).strftime("%Y%m%d")
    path = raw_path(key, ext, day)
    if path.exists():
        return path
    if offline:
        prev = latest_raw(key, ext)
        if prev is None:
            raise SystemExit(f"offline指定だが {key} のrawファイルがない: {RAW_DIR}")
        return prev
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    body = fetch(url)
    path.write_bytes(body)
    print(f"  取得: {path.relative_to(ROOT)} ({len(body):,} bytes)")
    return path


def page_text(path):
    return path.read_text(encoding="utf-8", errors="replace")


def strip_tags(s):
    return re.sub(r"[\s​　]+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def page_updated(text):
    """ページ本文の「更新日：2026年8月11日更新」を ISO 日付にする。"""
    m = re.search(r"更新日：?(\d{4})年(\d{1,2})月(\d{1,2})日", strip_tags(text))
    if not m:
        return None
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"


def find_attachment(text, label):
    """ページ内のPDFリンクのうちラベルに label を含むものを (url, ラベル) で返す。"""
    for m in re.finditer(r'<a[^>]+href="([^"]+\.pdf)"[^>]*>(.*?)</a>', text, re.S):
        text_label = unicodedata.normalize("NFKC", strip_tags(m.group(2)))
        if label in text_label:
            href = m.group(1)
            return (href if href.startswith("http") else BASE + href), text_label
    return None, None


# ---------------------------------------------------------------------------
# PDFの表をワード座標つきで読む（pdftotext -bbox-layout）
# ---------------------------------------------------------------------------

WORD_RE = re.compile(
    r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', re.S
)


def pdf_words(pdf_path):
    """ページごとに [(xMin, yMin, xMax, text), ...] を返す。"""
    xml_path = pdf_path.with_suffix(".bbox.html")
    subprocess.run(["pdftotext", "-bbox-layout", str(pdf_path), str(xml_path)], check=True)
    xml = xml_path.read_text(encoding="utf-8", errors="replace")
    pages = []
    for chunk in re.split(r"<page ", xml)[1:]:
        words = []
        for m in WORD_RE.finditer(chunk):
            t = html.unescape(m.group(5)).strip()
            if t:
                words.append((float(m.group(1)), float(m.group(2)), float(m.group(3)), t))
        pages.append(words)
    return pages


def group_rows(words, tol=4.0):
    """y座標が近いワードを1行にまとめ、行を上から順に返す。"""
    rows = []
    for w in sorted(words, key=lambda w: (w[1], w[0])):
        if rows and abs(w[1] - rows[-1][0]) <= tol:
            rows[-1][1].append(w)
        else:
            rows.append((w[1], [w]))
    return [(y, sorted(ws, key=lambda w: w[0])) for y, ws in rows]


# ---------------------------------------------------------------------------
# 入浴支援（協力公衆浴場一覧）
# ---------------------------------------------------------------------------

BATH_COLUMNS = ["name", "address", "tel", "hours", "period", "closed", "note"]
BATH_HEADERS = ["名称", "営業所所在地", "電話番号", "営業時間", "協力期間", "定休日", "備考"]


def bath_column_bounds(rows):
    """ページ内の見出し行から、列の切れ目（x座標）を作る。"""
    for _y, ws in rows:
        texts = [w[3] for w in ws]
        if all(h in texts for h in BATH_HEADERS[:6]):
            centers = []
            for h in BATH_HEADERS:
                hit = next((w for w in ws if w[3] == h), None)
                # 「備考」列は空ページがあり見出しごと無いことがある
                centers.append(None if hit is None else (hit[0] + hit[2]) / 2)
            known = [c for c in centers if c is not None]
            bounds = [(a + b) / 2 for a, b in zip(known, known[1:])]
            return bounds, len(known)
    return None, 0


def parse_bath(pdf_path):
    """PDFの各ページを列位置で切り分けて施設一覧にする。

    1施設が複数行になる（営業時間の2段書き・定休日の但し書き）ことがあり、
    しかもセルが縦中央揃えなので、続き行は連番のある行の上にも下にも出る。
    そのため「連番のある行＝レコード」を先に拾い、それ以外の行はy座標が
    最も近いレコードへ寄せる（直前のレコードに送ると1件ずれる）。
    """
    sites = []
    as_of = None
    for words in pdf_words(pdf_path):
        rows = group_rows(words)
        bounds, _ncols = bath_column_bounds(rows)
        if not bounds:
            continue

        body = []
        for y, ws in rows:
            joined = " ".join(w[3] for w in ws)
            m = re.search(r"令和(\d+)年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}:\d{2})?", joined)
            if m and "現在" in joined:
                year = 2018 + int(m.group(1))
                as_of = f"{year}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
                if m.group(4):
                    as_of += "T" + m.group(4) + ":00+09:00"
                continue
            if "名称" in joined and any(h in joined for h in BATH_HEADERS[1:3]):
                continue
            if "無料入浴公衆浴場一覧" in joined or "実施施設" in joined:
                continue

            # 左端の連番は名称列のさらに手前に、次のワードとの間を空けて置かれる
            is_record = (
                len(ws) >= 2
                and re.fullmatch(r"\d+", ws[0][3])
                and (ws[0][0] + ws[0][2]) / 2 < bounds[0]
                and ws[1][0] - ws[0][2] > 3
            )
            body.append((y, ws[1:] if is_record else ws, is_record))

        record_ys = [y for y, _ws, is_rec in body if is_rec]
        if not record_ys:
            continue
        page_sites = {y: {k: [] for k in BATH_COLUMNS} for y in record_ys}
        prev_owner = None
        for y, ws, _is_rec in body:
            owner = min(record_ys, key=lambda ry: abs(ry - y))
            # 「（最終受付…）」は直前の営業時間行とセットなので、そちらの
            # 施設へ寄せる（中央揃えのせいで隣の施設に近くなることがある）
            joined = "".join(w[3] for w in ws)
            if prev_owner is not None and re.match(r"^[（(]最終", joined):
                owner = prev_owner
            prev_owner = owner
            for x0, _y0, x1, text in ws:
                center = (x0 + x1) / 2
                col = 0
                while col < len(bounds) and center > bounds[col]:
                    col += 1
                if col < len(BATH_COLUMNS):
                    page_sites[owner][BATH_COLUMNS[col]].append(text)
        for y in record_ys:
            sites.append(page_sites[y])

    out = []
    for s in sites:
        rec = {k: " ".join(v).strip() for k, v in s.items()}
        if not rec["name"] or not rec["address"]:
            continue
        out.append(rec)
    return out, as_of


# ---------------------------------------------------------------------------
# 防災井戸
# ---------------------------------------------------------------------------

def parse_well(pdf_path):
    """「1 三加和…」形式の2列（場所・所在地）を読む。用途は全行共通の注記。"""
    txt_path = pdf_path.with_suffix(".txt")
    subprocess.run(["pdftotext", "-layout", str(pdf_path), str(txt_path)], check=True)
    lines = txt_path.read_text(encoding="utf-8", errors="replace").splitlines()
    sites = []
    for line in lines:
        if not line.strip():
            continue
        m = re.match(r"\s*(\d+)\s+(\S.*?)\s{2,}(\S.*)$", line)
        if m:
            name = m.group(2).strip()
            rest = re.sub(r"\s{2,}.*$", "", m.group(3)).strip()  # 右端の「生活用水」注記を落とす
            sites.append({"name": name, "address": rest})
        elif sites and re.match(r"^\s{6,}\S", line) and not line.strip().startswith("※"):
            # 住所が2行に折り返された行（前レコードの住所へ連結）
            cont = re.sub(r"\s{2,}.*$", "", line.strip())
            if cont and "利用可能" not in cont and "用" not in cont[:2]:
                sites[-1]["address"] += cont
    for s in sites:
        s["address"] = normalize_address(s["address"])
    return [s for s in sites if re.search(r"[市町村]", s["address"])]


def normalize_address(addr):
    addr = unicodedata.normalize("NFKC", addr)
    addr = addr.replace("ー", "-").replace("－", "-").replace("‐", "-")
    return re.sub(r"\s+", "", addr)


# ---------------------------------------------------------------------------
# 建設型応急住宅（HTMLの表）
# ---------------------------------------------------------------------------

def html_table_grid(table_html):
    """rowspan/colspanを展開して2次元配列にする。"""
    rows = re.findall(r"<tr.*?</tr>", table_html, re.S)
    grid = []
    filled = set()
    for ri, row in enumerate(rows):
        while len(grid) <= ri:
            grid.append({})
        ci = 0
        for attrs, content in re.findall(r"<t[hd]([^>]*)>(.*?)</t[hd]>", row, re.S):
            while (ri, ci) in filled:
                ci += 1
            rs = int((re.search(r'rowspan="?(\d+)', attrs) or ["", 1])[1]) if re.search(r'rowspan="?(\d+)', attrs) else 1
            cs = int(re.search(r'colspan="?(\d+)', attrs).group(1)) if re.search(r'colspan="?(\d+)', attrs) else 1
            text = strip_tags(content)
            for dr in range(rs):
                for dc in range(cs):
                    while len(grid) <= ri + dr:
                        grid.append({})
                    filled.add((ri + dr, ci + dc))
                    grid[ri + dr][ci + dc] = text
            ci += cs
    width = max((max(r) + 1) for r in grid if r) if grid else 0
    return [[r.get(c, "") for c in range(width)] for r in grid]


HOUSING_HEADER_KEYS = [
    ("name", "団地名"),
    ("units", "戸数"),
    ("structure", "構造"),
    ("hall", "集会施設"),
    ("start", "着手"),
    ("move_in", "入居予定"),
    ("builder", "施工者"),
    ("note", "備考"),
]


def parse_housing(page_html, updated):
    tables = re.findall(r"<table.*?</table>", page_html, re.S)
    if not tables:
        return []
    grid = html_table_grid(tables[0])
    header_rows = [r for r in grid[:3]]
    colmap = {}
    for key, label in HOUSING_HEADER_KEYS:
        for row in header_rows:
            for ci, cell in enumerate(row):
                if label in cell and key not in colmap:
                    colmap[key] = ci
    missing = [k for k, _ in HOUSING_HEADER_KEYS if k not in colmap]
    if missing:
        raise SystemExit(f"応急住宅の表の見出しが読めない（欠けた列: {missing}）")

    year = int(updated[:4]) if updated else datetime.now(JST).year
    out = []
    for row in grid:
        muni = row[0].strip()
        name = row[colmap["name"]].strip()
        if not muni or not name or "団地名" in name:
            continue
        units = re.search(r"(\d+)\s*戸", row[colmap["units"]])
        start_raw = row[colmap["start"]].strip()
        dm = re.search(r"(\d{1,2})月(\d{1,2})日", start_raw)
        out.append(
            {
                "muni": muni,
                "name": re.sub(r"\s+", "", name),
                "units": int(units.group(1)) if units else None,
                "structure": row[colmap["structure"]].strip(),
                "hall": row[colmap["hall"]].strip(),
                "start_date": f"{year}-{int(dm.group(1)):02d}-{int(dm.group(2)):02d}" if dm else None,
                "start_planned": "予定" in start_raw,
                "start_raw": start_raw,
                "move_in": row[colmap["move_in"]].strip(),
                "builder": row[colmap["builder"]].strip(),
                "note": re.sub(r"\s+", " ", row[colmap["note"]]).strip(),
            }
        )
    return out


# ---------------------------------------------------------------------------
# ジオコーディング（国土地理院 住所検索API）
# ---------------------------------------------------------------------------

GSI_API = "https://msearch.gsi.go.jp/address-search/AddressSearch"
KUMAMOTO_BBOX = (32.0, 33.3, 129.9, 131.4)  # lat_min, lat_max, lng_min, lng_max


def load_cache():
    if CACHE_PATH.exists():
        with open(CACHE_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


def gsi_lookup(query):
    url = f"{GSI_API}?q={urllib.parse.quote(query)}"
    try:
        data = json.loads(fetch(url).decode("utf-8"))
    except Exception as e:  # 応答なし・JSON不正は「見つからない」と同じ扱い
        print(f"    ジオコーディング失敗({query}): {e}", file=sys.stderr)
        return None
    if not isinstance(data, list) or not data:
        return None
    coords = data[0].get("geometry", {}).get("coordinates")
    if not coords or len(coords) != 2:
        return None
    lat, lng = round(coords[1], 5), round(coords[0], 5)
    if not (KUMAMOTO_BBOX[0] <= lat <= KUMAMOTO_BBOX[1] and KUMAMOTO_BBOX[2] <= lng <= KUMAMOTO_BBOX[3]):
        return None
    return {"lat": lat, "lng": lng}


def address_variants(address):
    """詳細な住所から順に粗くしていく検索クエリ列（先に当たったものを採用）。"""
    a = normalize_address(address)
    variants = [a]
    trimmed = re.sub(r"字[^0-9]*?\d.*$", "", a)  # 「字○○1234」以降を落とす
    if trimmed != a:
        variants.append(trimmed)
    no_number = re.sub(r"[0-9].*$", "", a)  # 番地以降を落とす
    if no_number and no_number not in variants:
        variants.append(no_number)
    no_aza = re.sub(r"(大字|字).*$", "", no_number or a)
    if no_aza and no_aza not in variants:
        variants.append(no_aza)
    return [v for v in variants if len(v) >= 4]


def geocode(address, muni, muni_data, cache, offline):
    """住所→座標。詳細住所で当たれば precision=address、粗い一致は area、
    最後は市町村代表点で municipality。結果はキャッシュに残す。"""
    key = normalize_address(address)
    if key in cache:
        hit = cache[key]
        if hit.get("lat") is not None:
            return hit
    if not offline:
        for i, q in enumerate(address_variants(address)):
            query = q if q.startswith("熊本県") else "熊本県" + q
            found = gsi_lookup(query)
            time.sleep(0.4)
            if found:
                found["precision"] = "address" if i == 0 else "area"
                found["query"] = query
                cache[key] = found
                return found
    loc = muni_data.get(muni)
    if loc:
        return {"lat": loc["lat"], "lng": loc["lng"], "precision": "municipality"}
    return None


# ---------------------------------------------------------------------------
# 市町村の推定
# ---------------------------------------------------------------------------

def detect_muni(address, muni_names):
    """住所文字列に現れる市町村名（最も手前・同位置なら最長）を返す。"""
    best = None
    for name in muni_names:
        idx = address.find(name)
        if idx == -1:
            continue
        if best is None or idx < best[0] or (idx == best[0] and len(name) > len(best[1])):
            best = (idx, name)
    return best[1] if best else None


# ---------------------------------------------------------------------------
# 組み立て
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="取得済みrawとキャッシュだけで再生成する")
    args = ap.parse_args()

    with open(MUNI_PATH, encoding="utf-8") as f:
        muni_data = json.load(f)
    muni_names = sorted(muni_data.keys(), key=len, reverse=True)
    cache = load_cache()

    sites = []
    sources = {}
    counter = {}

    def add_site(kind, name, address, muni, extra, source_key):
        counter[kind] = counter.get(kind, 0) + 1
        loc = geocode(address, muni, muni_data, cache, args.offline) if address else None
        if loc is None and muni in muni_data:
            loc = {"lat": muni_data[muni]["lat"], "lng": muni_data[muni]["lng"], "precision": "municipality"}
        if loc is None:
            print(f"    座標が取れないため除外: {name} / {address}", file=sys.stderr)
            return
        site = {
            "id": f"{kind}-{counter[kind]:03d}",
            "type": kind,
            "name": name,
            "muni": muni,
            "address": address,
            "lat": loc["lat"],
            "lng": loc["lng"],
            "precision": loc.get("precision", "address"),
            "source": source_key,
        }
        site.update({k: v for k, v in extra.items() if v})
        sites.append(site)

    # --- 入浴支援 -----------------------------------------------------------
    print("== 入浴支援（協力公衆浴場） ==")
    page = page_text(get_raw("bath_page", PAGES["bath"]["url"], "html", args.offline))
    pdf_url, pdf_label = find_attachment(page, PAGES["bath"]["pdf_label"])
    if not pdf_url:
        raise SystemExit("協力公衆浴場一覧のPDFリンクが見つからない（ページ構造の変更を確認）")
    bath_pdf = get_raw("bath", pdf_url, "pdf", args.offline)
    bath_rows, bath_as_of = parse_bath(bath_pdf)
    sources["bath"] = {
        "name": PAGES["bath"]["name"],
        "url": PAGES["bath"]["url"],
        "file_url": pdf_url,
        "as_of": bath_as_of or page_updated(page),
    }
    for row in bath_rows:
        address = normalize_address(row["address"])
        muni = detect_muni(address, muni_names)
        if not muni:
            print(f"    市町村を判定できずスキップ: {row['name']} / {address}", file=sys.stderr)
            continue
        add_site(
            "bath",
            re.sub(r"\s+", " ", row["name"]).strip(),
            address,
            muni,
            {
                "tel": row["tel"].replace(" ", "") if row["tel"] not in ("-", "") else "",
                "hours": row["hours"],
                "period": row["period"],
                "closed": row["closed"],
                "note": row["note"],
            },
            "bath",
        )
    print(f"  {sum(1 for s in sites if s['type'] == 'bath')} 件（{sources['bath']['as_of']} 時点）")

    # --- 防災井戸 -----------------------------------------------------------
    print("== 防災井戸等（生活用水） ==")
    page = page_text(get_raw("well_page", PAGES["well"]["url"], "html", args.offline))
    pdf_url, _ = find_attachment(page, PAGES["well"]["pdf_label"])
    if not pdf_url:
        raise SystemExit("防災井戸PDFのリンクが見つからない（ページ構造の変更を確認）")
    well_rows = parse_well(get_raw("well", pdf_url, "pdf", args.offline))
    sources["well"] = {
        "name": PAGES["well"]["name"],
        "url": PAGES["well"]["url"],
        "file_url": pdf_url,
        "as_of": page_updated(page),
    }
    for row in well_rows:
        muni = detect_muni(row["address"], muni_names)
        if not muni:
            continue
        add_site("well", row["name"], row["address"], muni, {"note": "生活用水のみ（飲用不可）"}, "well")
    print(f"  {sum(1 for s in sites if s['type'] == 'well')} 件（{sources['well']['as_of']} 時点）")

    # --- 建設型応急住宅 -----------------------------------------------------
    print("== 建設型応急住宅 ==")
    page = page_text(get_raw("housing", PAGES["housing"]["url"], "html", args.offline))
    housing_updated = page_updated(page)
    m = re.search(r"整備状況\s*[（(]令和(\d+)年(\d{1,2})月(\d{1,2})\s*日時点", strip_tags(page))
    housing_as_of = (
        f"{2018 + int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else housing_updated
    )
    housing = parse_housing(page, housing_as_of or housing_updated)
    sources["housing"] = {
        "name": PAGES["housing"]["name"],
        "url": PAGES["housing"]["url"],
        "as_of": housing_as_of,
    }
    for h in housing:
        if h["muni"] not in muni_data:
            print(f"    未知の市町村: {h['muni']}", file=sys.stderr)
            continue
        add_site(
            "housing",
            h["name"],
            "",
            h["muni"],
            {
                "units": h["units"],
                "structure": h["structure"],
                "start_date": h["start_date"],
                "start_planned": h["start_planned"],
                "start_raw": h["start_raw"],
                "move_in": h["move_in"],
                "builder": h["builder"],
                "note": h["note"],
            },
            "housing",
        )
    print(f"  {len(housing)} 団地 / {sum(h['units'] or 0 for h in housing)} 戸（{housing_as_of} 時点）")

    # --- フェリー「はくおう2」（八代港） ------------------------------------
    print("== フェリー「はくおう2」（八代港） ==")
    ferry_notes = []
    ferry_updated = None
    for key in ("ferry_bath", "ferry_stay"):
        p = page_text(get_raw(key, PAGES[key]["url"], "html", args.offline))
        upd = page_updated(p)
        if upd and (ferry_updated is None or upd > ferry_updated):
            ferry_updated = upd
        title = re.search(r"<h1[^>]*>(.*?)</h1>", p, re.S)
        ferry_notes.append(strip_tags(title.group(1)) if title else PAGES[key]["name"])
    sources["ferry"] = {
        "name": "熊本県 フェリー「はくおう2」による入浴・休憩・宿泊支援（八代港）",
        "url": PAGES["ferry_bath"]["url"],
        "url2": PAGES["ferry_stay"]["url"],
        "as_of": ferry_updated,
    }
    add_site(
        "ferry",
        "フェリー「はくおう2」（八代港）",
        "八代市新港町1丁目",
        "八代市",
        {"note": " / ".join(n for n in ferry_notes if n), "hours": "日により変動（要事前予約）"},
        "ferry",
    )

    # --- ペット救護 ---------------------------------------------------------
    print("== ペット救護本部 ==")
    p = page_text(get_raw("pet", PAGES["pet"]["url"], "html", args.offline))
    body = strip_tags(p)
    tel = re.search(r"電話\s*([\d‐-―-]{9,})", body)
    # 「受付時間：月～土曜の9時～16時（…）」の直後は次の見出し（2 その他活動）に続く
    hours = re.search(r"受付時間：(.+?)(?=\s*\d+\s*[　 ]*(その他|熊本地震)|・|※|$)", body)
    sources["pet"] = {"name": PAGES["pet"]["name"], "url": PAGES["pet"]["url"], "as_of": page_updated(p)}
    add_site(
        "pet",
        "熊本地震ペット救護本部（一時預かり受付窓口）",
        "",
        "熊本市",
        {
            "tel": normalize_address(tel.group(1)) if tel else "",
            "hours": hours.group(1).strip() if hours else "",
            "note": "電話受付（一般社団法人熊本県獣医師会）。地図上の位置は市町村の代表点",
        },
        "pet",
    )

    payload = {
        "updated": datetime.now(JST).isoformat(timespec="seconds"),
        "types": ["bath", "well", "housing", "ferry", "pet"],
        "sources": sources,
        "sites": sites,
        "housing": housing,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1, sort_keys=True)

    by_type = {}
    for s in sites:
        by_type[s["type"]] = by_type.get(s["type"], 0) + 1
    print(f"\nsupport_sites.json: {len(sites)} 拠点 {by_type}")
    approx = [s["id"] for s in sites if s["precision"] != "address"]
    if approx:
        print(f"  概略位置（住所一致せず）: {len(approx)} 件 {approx[:10]}")


if __name__ == "__main__":
    main()
