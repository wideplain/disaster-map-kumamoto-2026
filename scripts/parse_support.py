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


HOUSING_BULLET_RE = re.compile(
    r"令和(\d+)年(\d{1,2})月(\d{1,2})日[、,]\s*([^。]+?)において[^。]*?着手(しました|する予定です|予定です)"
)


def parse_housing_bullets(page_html):
    """ページ冒頭の「新着概要」から (着手日, 市町村, 着手済みか) を拾う。

    県は8/21時点版で団地ごとの表をページから削除し、箇条書きと報道資料PDFだけにした。
    表がある間も「（予定）」のまま着手済みになった団地を確定させるのに使う。
    """
    text = strip_tags(page_html)
    out = []
    for m in HOUSING_BULLET_RE.finditer(text):
        year = 2018 + int(m.group(1))
        date = f"{year:04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        munis = [x for x in re.split(r"及び|、|，|,", m.group(4)) if x.endswith(("市", "町", "村"))]
        out.append({"date": date, "munis": munis, "started": m.group(5) == "しました"})
    return out


def apply_housing_bullets(housing, bullets):
    """箇条書きで「着手しました」と書かれた (市町村, 日付) の団地を着手済みにする。

    逆向き（着手済み→予定）には決して倒さない。件数と戸数は表由来のまま。
    """
    started = {(b["date"], muni) for b in bullets if b["started"] for muni in b["munis"]}
    changed = 0
    for h in housing:
        if h.get("start_planned") and (h.get("start_date"), h.get("muni")) in started:
            h["start_planned"] = False
            changed += 1
    return changed


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
# 応急住宅・報道資料PDF（進捗表がページから消えた後の代替データ源）
#
# 2026-08-21、県は団地ごとの表をページ本体から削除し、報道資料PDFと箇条書き
# だけが残る形になった。ただし各報道資料の1ページ目に「新たに工事着手する
# 仮設住宅団地の概要」という、その回に新規着手した団地だけのミニ表がある。
# これを新着分の唯一のソースとして使い、前回までの一覧に無い団地だけを追加する
# （名称の完全一致で重複判定するので、既知の団地を二重に足すことはない）。
# ---------------------------------------------------------------------------

HOUSING_REPORT_LABELS = ["団地名称", "所在地", "建設戸数", "住宅の構造・階数", "施工者", "入居予定時期", "備考"]


def find_housing_report_links(page_html):
    """ページ内の報道資料PDFリンクを新しい順で返す [(url, label), ...]。"""
    links = []
    for m in re.finditer(r'<a[^>]+href="([^"]+\.pdf)"[^>]*>(.*?)</a>', page_html, re.S):
        label = unicodedata.normalize("NFKC", strip_tags(m.group(2)))
        if re.match(r"^\d{6}【", label):  # 例: 260821【八代市、宇土市、美里町】3団地着手
            href = m.group(1)
            links.append((href if href.startswith("http") else BASE + href, label))
    return links


def parse_housing_report_pdf(pdf_path):
    """報道資料PDFの「新たに工事着手する仮設住宅団地の概要」表を読む。

    pdftotext -layout の空白幅で列を切る（bath等と違い、この表は列数が
    毎回2〜3程度と少なく、視覚的なセル結合も無いため座標計算までは不要）。
    """
    txt_path = pdf_path.with_suffix(".txt")
    subprocess.run(["pdftotext", "-layout", str(pdf_path), str(txt_path)], check=True)
    text = txt_path.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"新たに工事着手する仮設住宅団地の概要(.*?)(?=※|【参|$)", text, re.S)
    if not m:
        return [], text
    section = m.group(1)

    cols = {label: [] for label in HOUSING_REPORT_LABELS}
    for line in section.split("\n"):
        s2 = line.strip()
        for label in HOUSING_REPORT_LABELS:
            if s2.startswith(label):
                rest = s2[len(label):]
                cols[label].extend(p.strip() for p in re.split(r"\s{2,}", rest) if p.strip())
                break

    n = len(cols["団地名称"])
    if n == 0:
        return [], text
    for label in HOUSING_REPORT_LABELS:
        cols[label] = (cols[label] + [""] * n)[:n]  # 備考欄などは写真キャプションの巻き込みで余りうる

    out = []
    for i in range(n):
        units = re.search(r"(\d+)\s*戸", cols["建設戸数"][i])
        out.append(
            {
                "name": re.sub(r"\s+", "", cols["団地名称"][i]),
                "address": cols["所在地"][i],
                "units": int(units.group(1)) if units else None,
                "structure": cols["住宅の構造・階数"][i],
                "builder": cols["施工者"][i],
                "move_in": cols["入居予定時期"][i],
                "note": cols["備考"][i],
            }
        )
    return out, text


def report_start_date(report_text, bullets):
    """報道資料の文面（「明日２２日（土）に…整備に着手することとなりました」）から
    着手日を出し、当日の「新着概要」箇条書き（同じ日付のもの）で
    着手済み/予定を確認する。箇条書きに該当日が無い場合（過去の号でも
    ページの新着概要は直近数件しか載らない）は、日付が今日以前なら着手済みとみなす。

    pdftotext -layout は文中で行を折り返すため、"着手すること" と
    "となりました" の間に改行が挟まることがある。空白を全部削ってから
    照合することで折り返し位置に依存しないようにする。
    """
    flat = re.sub(r"\s+", "", report_text)
    issue_m = re.search(r"令和(\d+)年[（(]\d+年[）)](\d{1,2})月(\d{1,2})日", flat)
    if not issue_m:
        return None, False
    # 文書冒頭の発行日（「令和８年（２０２６年）８月２１日」）にも「…日」が含まれ、
    # 素直に検索すると着手日ではなくこちらの日付を先に拾ってしまう。
    # 本文の書き出し（本文中で繰り返される「令和８年熊本地震」）以降だけを対象にする
    body_start = flat.find("令和", flat.find("令和") + 1)
    body = flat[body_start:] if body_start != -1 else flat
    # 「新たに工事着手する仮設住宅団地の概要」以降には、既存団地の第1期/第2期
    # 着手日を書いた別表（「建設戸数を追加する団地概要」）が続くことがあり、
    # そちらの日付（例:「8月3日着手」）を誤って拾わないよう、冒頭の告知文
    # （新規団地の着手日を最初に述べる段落）だけを対象にする
    heading_idx = body.find("新たに工事着手する仮設住宅団地の概要")
    announce = body[:heading_idx] if heading_idx != -1 else body
    action_m = re.search(r"(\d{1,2})日[^。]*?着手(することとなりました|する予定です|予定です|します)", announce)
    if not action_m:
        return None, False
    year = 2018 + int(issue_m.group(1))
    month = int(issue_m.group(2))
    day = int(action_m.group(1))
    if day < int(issue_m.group(3)):  # 月末をまたいで「翌月1日」等になる場合
        month += 1
        if month > 12:
            month, year = 1, year + 1
    date = f"{year:04d}-{month:02d}-{day:02d}"
    bullet = next((b for b in bullets if b["date"] == date), None)
    started = bullet["started"] if bullet is not None else date <= datetime.now(JST).date().isoformat()
    return date, started


def parse_housing_report_additions(report_text):
    r"""報道資料の「建設戸数を追加する団地概要」表（既存団地への第2期増戸）を読む。

    行は「団地名 第1期戸数 第2期戸数 合計戸数」の並びで、合計を返す
    （呼び出し側は units を増分加算ではなくこの合計値へ置き換える。
    同じ報道資料を読み直しても二重加算にならないようにするため）。
    """
    m = re.search(r"建設戸数を追加する団地概要(.*?)(?=\Z|※|【参)", report_text, re.S)
    if not m:
        return [], None
    sec = m.group(1)
    phase2_dates = re.findall(r"（\s*(\d{1,2})月\s*(\d{1,2})日着手\s*）", sec)
    phase2_date = None
    if len(phase2_dates) >= 2:
        mo, d = phase2_dates[-1]
        phase2_date = (int(mo), int(d))

    out = []
    for line in sec.split(chr(10)):
        line_m = re.match(r"^(\S+仮設団地)\s+([0-9０-９]+)戸\s+([0-9０-９]+)戸\s+([0-9０-９]+)戸$", line.strip())
        if line_m:
            name, _phase1, _phase2, total = line_m.groups()
            out.append({"name": name, "total_units": int(unicodedata.normalize("NFKC", total))})
    return out, phase2_date


def apply_housing_additions(housing, report_texts, bullets):
    """既知団地への戸数追加（第2期増戸）を、報道資料を読める範囲で反映する。

    units はカード表示用に常に最新の合計値を持たせるが、時系列の指標
    （応急住宅 着工戸数）は各時点で本当に着工済みだった戸数を出す必要がある。
    そのため増戸のたびに unit_history へ (発効日, その日以降の合計戸数) を
    積み、build_timeline.py 側は unit_history から時点ごとの値を引く。
    最初の増戸を検出した時点で、変更前の値を着手日の実績として履歴の起点にする
    （そうしないと着手日〜増戸日の間も新しい合計値のままになってしまう）。
    """
    changed = []
    for text in report_texts:
        additions, phase2_date = parse_housing_report_additions(text)
        if not additions:
            continue
        started = True
        date = None
        if phase2_date:
            year = datetime.now(JST).year
            date = f"{year:04d}-{phase2_date[0]:02d}-{phase2_date[1]:02d}"
            bullet = next((b for b in bullets if b["date"] == date), None)
            started = bullet["started"] if bullet is not None else True
        if not started:
            continue  # まだ「予定」段階の増戸は数えない
        for add in additions:
            add_key = housing_team_key(add["name"])
            for h in housing:
                if housing_team_key(h["name"]) != add_key:
                    continue
                if not h.get("unit_history"):
                    h["unit_history"] = [{"date": h.get("start_date"), "units": h.get("units")}]
                already = {entry["date"] for entry in h["unit_history"]}
                if date and date not in already:
                    h["unit_history"].append({"date": date, "units": add["total_units"]})
                    h["unit_history"].sort(key=lambda e: e["date"] or "")
                if h.get("units") != add["total_units"]:
                    changed.append((h["name"], h.get("units"), add["total_units"]))
                    h["units"] = add["total_units"]
    return changed


_MUNI_NAMES_CACHE = None


def load_muni_names():
    global _MUNI_NAMES_CACHE
    if _MUNI_NAMES_CACHE is None:
        with open(MUNI_PATH, encoding="utf-8") as f:
            _MUNI_NAMES_CACHE = sorted(json.load(f).keys(), key=len, reverse=True)
    return _MUNI_NAMES_CACHE


def housing_team_key(name):
    """団地名の同一判定キー。

    最初のHTML表スクレイプ時代は「(仮称)宇城市当尾仮設団地」のように
    市町村名を埋め込んだ名称だったが、8/21以降のソースである報道資料PDFは
    常に市町村名なしの短い名称（「（仮称）当尾仮設団地」）しか出さない。
    全角/半角括弧のゆれ(NFKC)に加え、先頭の市町村名も取り除いた「核」の
    部分文字列で同一判定できるようにする。
    """
    norm = unicodedata.normalize("NFKC", name)
    core = re.sub(r"^\(仮称\)", "", norm)
    for muni in load_muni_names():
        if core.startswith(muni):
            core = core[len(muni):]
            break
    return core


def fetch_new_housing_from_reports(page, known_names, bullets, offline):
    """既知の団地名に無い団地を、新しい報道資料から順に探して追加分だけ返す。

    あわせて各報道資料の本文もまとめて返す（呼び出し側が
    apply_housing_additions() で第2期増戸の反映に再利用するため。
    どのPDFも新規団地探しの過程で既にダウンロード済みなので、
    ここでは追加のネットワークアクセスは発生しない）。
    """
    new_entries = []
    report_texts = []
    for url, label in find_housing_report_links(page):
        key_m = re.search(r"attachment/(\d+)\.pdf", url)
        key = key_m.group(1) if key_m else re.sub(r"\W+", "_", label)
        pdf_path = get_raw(f"housing_report_{key}", url, "pdf", offline)
        teams, text = parse_housing_report_pdf(pdf_path)
        report_texts.append(text)
        date, started = report_start_date(text, bullets)
        for t in teams:
            team_key = housing_team_key(t["name"])
            if team_key in known_names:
                continue
            muni = detect_muni(t["address"], load_muni_names())
            if not muni:
                print(f"    応急住宅（報道資料由来）の市町村を判定できずスキップ: {t['name']} / {t['address']}", file=sys.stderr)
                continue
            start_raw = ""
            if date:
                start_raw = f"{int(date[5:7])}月{int(date[8:10])}日" + ("（予定）" if not started else "")
            new_entries.append(
                {
                    "muni": muni,
                    "name": t["name"],
                    "units": t["units"],
                    "structure": t["structure"],
                    "hall": "",
                    "start_date": date,
                    "start_planned": (not started) if date else True,
                    "start_raw": start_raw,
                    "move_in": t["move_in"],
                    "builder": t["builder"],
                    "note": t["note"],
                }
            )
            known_names.add(team_key)
    return new_entries, report_texts


# ---------------------------------------------------------------------------
# ジオコーディング（国土地理院 住所検索API）
# ---------------------------------------------------------------------------

GSI_API = "https://msearch.gsi.go.jp/address-search/AddressSearch"
KUMAMOTO_BBOX = (32.0, 33.3, 129.9, 131.4)  # lat_min, lat_max, lng_min, lng_max


def load_previous_housing():
    """前回生成した support_sites.json の housing をそのまま返す（無ければ空）。"""
    if not OUT_PATH.exists():
        return []
    with open(OUT_PATH, encoding="utf-8") as f:
        return json.load(f).get("housing") or []


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

# 協力公衆浴場一覧の熊本市の節は市名を省いて「南区城南町…」と書かれる行がある
KUMAMOTO_WARDS = ("中央区", "東区", "西区", "南区", "北区")


def detect_muni(address, muni_names):
    """住所文字列に現れる市町村名（最も手前・同位置なら最長）を返す。"""
    best = None
    for name in muni_names:
        idx = address.find(name)
        if idx == -1:
            continue
        if best is None or idx < best[0] or (idx == best[0] and len(name) > len(best[1])):
            best = (idx, name)
    if best:
        return best[1]
    # 市名が無く区名から始まる住所は熊本市（政令市の区は熊本市にしか無い）
    if address.startswith(KUMAMOTO_WARDS):
        return "熊本市"
    return None


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
    m = re.search(r"[（(]令和(\d+)年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日時点", strip_tags(page))
    housing_as_of = (
        f"{2018 + int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else housing_updated
    )
    housing = parse_housing(page, housing_as_of or housing_updated)
    if not housing:
        # 2026-08-21以降、県は団地ごとの表をページ本体から削除した。
        # 前回の一覧を引き継ぎ、以後は報道資料PDFの新着分だけを足していく
        previous = load_previous_housing()
        if previous:
            housing = previous
            print(
                f"    警告: 進捗表がページから消えたため、前回の {len(housing)} 団地を引き継ぎます"
                f"（報道資料PDFのみになった可能性）",
                file=sys.stderr,
            )
        else:
            print("    警告: 進捗表が読めず、引き継げる前回データもありません", file=sys.stderr)

    bullets = parse_housing_bullets(page)
    confirmed = apply_housing_bullets(housing, bullets)
    if confirmed:
        print(f"  着手確認（新着概要より）: {confirmed} 団地の「予定」を外しました")

    known_names = {housing_team_key(h["name"]) for h in housing}
    new_from_reports, report_texts = fetch_new_housing_from_reports(page, known_names, bullets, args.offline)
    if new_from_reports:
        print(f"  報道資料から新規団地を追加: {len(new_from_reports)} 団地（{[h['name'] for h in new_from_reports]}）")
        housing.extend(new_from_reports)

    additions = apply_housing_additions(housing, report_texts, bullets)
    if additions:
        print(f"  報道資料から増戸を反映: {additions}")

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
