#!/usr/bin/env python3
"""内閣府「令和8年熊本地震に係る被害状況等について」日次報テキストから、
数値以外の定性的なニュース的イベント（市町村ごとの出来事）を抽出する。

data/raw/bousai_*.txt (pdftotext -layout 抽出済み) の「４ その他の状況」
セクション以下を、見出し（①水道・(１７)医療関係 等）ごとにカテゴリへ
割り当てながら箇条書きを収集し、data/news_events.json を出力する。

標準ライブラリのみ使用。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
MUNI_PATH = ROOT / "data" / "municipalities.json"
SNAPSHOTS_PATH = ROOT / "data" / "bousai_snapshots.json"
OUT_PATH = ROOT / "data" / "news_events.json"

CATEGORIES = ("ライフライン", "交通", "医療・福祉", "生活・行政", "産業")

# ---------------------------------------------------------------------------
# 見出しタイトル → カテゴリ の対応表。
# 「４ その他の状況」以下に現れる見出し（①水道 / (17)医療関係 等）から、
# 末尾の（...）や：以降の日時情報を除いた「タイトル本体」をキーにする。
# 対象外の見出し（原子力施設・河川・法務関係・金融機関等 等）は辞書に
# 含めず、classify_header() が None を返して除外扱いとする。
# ---------------------------------------------------------------------------
HEADER_CATEGORY = {}


def _register(titles, category):
    for t in titles:
        HEADER_CATEGORY[t] = category


_register(
    ["水道", "電力", "ガス関係", "高圧ガス・火薬類", "通信関係", "下水道関係"],
    "ライフライン",
)
_register(
    [
        "道路", "高速道路", "有料道路", "直轄国道", "補助国道", "都道府県道等",
        "ライフライン",  # (3)道路の子見出し。共同溝等の道路占用ライフライン。
        "道路啓開及び交通マネジメント",
        "孤立集落", "防災道の駅・道の駅活用情報等",
        "交通機関", "鉄道", "航空", "海事", "物流・自動車", "港湾",
    ],
    "交通",
)
_register(
    [
        "医療関係", "医療施設の被害状況",
        "社会福祉施設等関係",
        "高齢者関係施設の被害状況",
        "障害児関係施設の被害状況", "障害者児関係施設の被害状況",
        "障害児者関係施設の被害状況", "障害者関係施設の被害状況",
        "その他施設の被害状況", "その他施設の被害",
        "保健・衛生関係",
        "人工呼吸器使用者の安否", "人工呼吸器在宅療養難病患者の安否",
        "人工透析患者の安否",
        "児童福祉施設等関係", "児童福祉施設等の被害状況",
        "障害児施設関係", "障害児施設の被害状況",
        "医薬品・医療機器製造販売業、卸売販売業関係",
        "医薬品・医療機器製造販売業、卸売製造販売業関係",
    ],
    "医療・福祉",
)
_register(
    [
        "市町村の行政機能の確保状況",
        "住宅", "公的賃貸住宅の被害状況",
        "被災建築物応急危険度判定", "被災建築物応急危険度判定の状況",
        "エレベーター閉じ込め情報",
        "公園・都市",
        "製油所・油槽所、ＳＳ",
        "食料支援の対応状況",
        "休校・短縮授業となっている学校等",
        "避難所となっている学校等",
    ],
    "生活・行政",
)
_register(
    [
        "観光",
        "労働関係", "労働基準関係", "労働安全衛生関係", "人材開発関係",
        "農林水産関係", "農林水産関係の被害",
        "農作物等の被害情報", "農作物等の被害 調査中",
        "農地・農業用施設の被害情報", "林野関係の被害情報",
        "水産関係の被害情報", "水産関係の被害情報 調査中",
        "農業関係の被害情報", "農村生活環境施設", "防災重点農業用ため池",
        "ため池・ダム等の被害情報", "卸売市場の被害情報", "食品産業の被害情報",
        "その他被害情報", "その他被害",
        "７月 28 日 16 時 27 分頃発生した地震",
        "７月 29 日 22 時 19 分頃発生した地震",
        "８月１日 21 時 47 分頃発生した地震",
    ],
    "産業",
)

# 「(１)ライフラインの状況」のような、それ自体は無内容な包括見出し。
# 明示的に None (除外) とし、辞書に載っていないその他大勢の見出し
# (原子力施設関係・河川・ダム・砂防・海岸・官庁施設・放送関係・郵政関係・
#  薬局/薬剤師関係・医療保険/介護保険関係・法務関係・金融機関等・
#  文教施設関係・地方支分部局関係 等) と同様に扱う。
HEADER_CATEGORY["ライフラインの状況"] = None

# 「その他」系見出し（③その他／⑧その他／(4)そ の 他 等、PDF のレイアウト
# 都合で字間にスペースが入ることがある）はどの節に現れるかでカテゴリが
# 変わるので固定辞書には登録せず、直前に確定していたカテゴリ
# (last_real_category) を継承させる。

HEADER_RE = re.compile(
    r"^(①|②|③|④|⑤|⑥|⑦|⑧|⑨|⑩|⑪|⑫|⑬|⑭|⑮"
    r"|\([0-9０-９]+\)|（[0-9０-９]+）)\s*(.*)$"
)

MARKER_CHARS = "○・※●〇◆"
PAGE_BREAK_RE = re.compile(r"^\d+\s*/\s*\d+$")
FURIGANA_PAREN_RE = re.compile(r"^[（(][ぁ-んー]+[）)]$")
BRACKET_LABEL_RE = re.compile(r"^(【[^】]*】|＜[^＞]*＞|［[^］]*］)$")
KANA_LABEL_RE = re.compile(r"^[アイウエオ][\s　]")
SECTION_START_RE = re.compile(r"^４\s*その他の状況")
SECTION_END_RE = re.compile(r"政府の主な対応")
STAT_TABLE_CAPTION_RE = re.compile(r"給水車の派遣状況|給水車の派遣予定|被災水道事業者|派遣先市町村")

# 「熊本市 南区 約 10 戸」のような、市町村名(＋地区名)＋数値＋単位のみ
# からなる断片。断水表・停電戸数内訳等の数値データの一行であり、文章
# としての情報がないため除外する。
NUMERIC_FRAGMENT_RE = re.compile(
    r"^[一-龥ぁ-んァ-ヶー]{1,10}(?:\s*[一-龥]{1,3}区)?\s*"
    r"約?\s*[\d,，]+\s*(?:戸|台|人|カ所|箇所|局|件|名|世帯)\s*$"
)

# 「都市公園 施設名 管理者 被害状況 対応状況等 くまもとじょう 熊本市 …」
# のような、多段組の表（施設名のふりがな行・管理者・被害状況・対応状況等の
# 列がページレイアウトの都合で縦横入り乱れて連結された断片）。列見出しの
# 並びで検出し、文として意味が通らないため除外する。
URBAN_PARK_TABLE_RE = re.compile(r"都市公園\s*施設名\s*管理者\s*被害状況")

# 施設名の羅列（「美里町役場中央庁舎」等）のような、助詞も句読点もない
# 短い名詞句断片は文章としての情報を持たないため除外する。
PARTICLE_RE = re.compile(r"[のがはをにでとやへも]|より|から|まで|。|、")
MIN_MEANINGFUL_LEN = 15


def is_meaningful_item(text):
    if len(text) >= MIN_MEANINGFUL_LEN:
        return True
    return bool(PARTICLE_RE.search(text))

# 数値表のキャプション／列見出し断片。文中の句読点を持たず、これらの
# 語のみで構成される行はテーブルの飾りであり、箇条書き本文ではない。
TABLE_WORDS = (
    "被災状況内訳", "被災状況別内訳", "被災施設数", "施設数", "建物被害",
    "停電", "断水", "ガス停止", "医療ガス", "浸水", "最大", "現在", "期間",
    "事業者名", "断水戸数", "被災", "その他", "市町村名", "区市町村名",
    "都道府県", "市町村", "地区名", "被災内容", "孤立集落", "集落へのア",
    "クセス", "ライフラ", "イン等",
)
TABLE_CAPTION_LINE_RE = re.compile(
    r"^(?:(?:" + "|".join(TABLE_WORDS) + r")[（）()　\s]*)+$"
)

# 「福岡県 大川市 断水あり・漏水あり（いずれも復旧済）」のような、市町村
# 名＋短い状態タグのみからなる断水状況の一覧行。数値マップ側で扱う断水表
# の文章版であり、除外対象。
STATUS_LIST_LINE_RE = re.compile(
    r"^(?:[一-龥]{2,4}県\s+)?"
    r"[一-龥ぁ-んァ-ヶー]{1,8}(?:市|町|村)\s*"
    r"(?:断水あり|漏水あり|濁水あり|飲用制限あり|復旧済)"
    r"(?:[・、](?:断水あり|漏水あり|濁水あり|飲用制限あり|復旧済))*"
    r"(?:[（(].*[）)])?\s*$"
)

FULLWIDTH_DIGITS = "０１２３４５６７８９"
HALFWIDTH_DIGITS = "0123456789"
DIGIT_TRANS = str.maketrans(FULLWIDTH_DIGITS, HALFWIDTH_DIGITS)
DIGIT_RUN_RE = re.compile(r"[0-9０-９][0-9０-９,，]*")


def normalize_ws(s):
    return re.sub(r"\s+", " ", s).strip()


def strip_header_title(raw_title):
    title = re.sub(r"[（(].*$", "", raw_title).strip()
    title = re.sub(r"\s*[:：].*$", "", title).strip()
    return title


def classify_header(raw_title):
    title = strip_header_title(raw_title)
    return HEADER_CATEGORY.get(title)


def is_other_title(raw_title):
    """「その他」系見出しか判定する。PDF のレイアウト都合で「そ の 他」の
    ように字間にスペースが入ることがあるため、空白を除去して比較する。"""
    title = strip_header_title(raw_title)
    title_nospace = re.sub(r"[\s　]+", "", title)
    return title_nospace == "その他"


def starts_with_marker(s):
    return bool(s) and s[0] in MARKER_CHARS


def strip_marker(s):
    return s[1:].strip()


def is_stat_table_trigger(s):
    if STAT_TABLE_CAPTION_RE.search(s):
        return True
    return "最大" in s and "現在" in s


def remove_page_breaks(lines):
    """pdftotext のページ区切り（空行 + 'N / 83' + 空行）を取り除く。
    ページ境界をまたいで文が分割され、境界直前の空行だけで箇条書きが
    途切れてしまうのを防ぐための前処理。"""
    out = []
    i = 0
    n = len(lines)
    while i < n:
        if PAGE_BREAK_RE.match(lines[i].strip()):
            if out and out[-1].strip() == "":
                out.pop()
            i += 1
            while i < n and lines[i].strip() == "":
                i += 1
            continue
        out.append(lines[i])
        i += 1
    return out


def find_section_span(lines):
    start = None
    end = len(lines)
    for i, l in enumerate(lines):
        s = l.strip()
        if start is None and SECTION_START_RE.match(s):
            start = i
        elif start is not None and SECTION_END_RE.search(s):
            end = i
            break
    return start, end


def extract_items(text):
    """(category, raw_text, source_line, header) のリストを返す。"""
    text = text.replace("\x0c", "")
    lines = text.split("\n")
    lines = remove_page_breaks(lines)
    start, end = find_section_span(lines)
    if start is None:
        return []

    items = []
    buf = []
    buf_start_line = None
    current_category = None
    current_header = None
    last_real_category = None
    in_stat_table = False

    def flush():
        nonlocal buf, buf_start_line
        if buf and current_category is not None:
            joined = normalize_ws(" ".join(buf))
            if (
                joined
                and not NUMERIC_FRAGMENT_RE.match(joined)
                and not URBAN_PARK_TABLE_RE.search(joined)
                and is_meaningful_item(joined)
            ):
                items.append((current_category, joined, buf_start_line, current_header))
        buf = []
        buf_start_line = None

    for i in range(start, end):
        raw = lines[i]
        s = raw.strip()

        m = HEADER_RE.match(s)
        if m:
            flush()
            in_stat_table = False
            if is_other_title(m.group(2)):
                # 「その他」系見出しは直前に確定していたカテゴリを継承する
                # （道路の「⑧その他」と児童福祉等の「（４）その他」のような
                # 同名異義の見出しを固定辞書一本で扱うと誤分類になるため）。
                current_category = last_real_category
            else:
                current_category = classify_header(m.group(2))
                if current_category is not None:
                    last_real_category = current_category
            current_header = normalize_ws(strip_header_title(m.group(2)))
            continue

        if not s:
            flush()
            continue
        if PAGE_BREAK_RE.match(s):
            continue
        if FURIGANA_PAREN_RE.match(s):
            continue
        if BRACKET_LABEL_RE.match(s):
            flush()
            continue
        if KANA_LABEL_RE.match(s):
            flush()
            continue

        if in_stat_table:
            if starts_with_marker(s):
                in_stat_table = False
                buf_start_line = i + 1
                buf = [strip_marker(s)]
            continue

        if is_stat_table_trigger(s):
            flush()
            in_stat_table = True
            continue

        if TABLE_CAPTION_LINE_RE.match(s):
            continue
        if STATUS_LIST_LINE_RE.match(s):
            flush()
            continue

        if starts_with_marker(s):
            flush()
            buf_start_line = i + 1
            buf = [strip_marker(s)]
        else:
            if not buf:
                buf_start_line = i + 1
            buf.append(s)

    flush()
    return items


def load_municipalities():
    return json.loads(MUNI_PATH.read_text(encoding="utf-8"))


def match_municipalities(text, muni_names_by_len_desc):
    """text 中に現れる市町村名をすべて検出する。上天草市/天草市 のような
    部分文字列関係は、長い名称を優先しクレームした区間と重ならない場合
    のみ短い名称も採用する。"""
    claimed = []  # (start, end)
    found = []

    def overlaps(a_start, a_end):
        for cs, ce in claimed:
            if a_start < ce and cs < a_end:
                return True
        return False

    for name in muni_names_by_len_desc:
        idx = 0
        while True:
            pos = text.find(name, idx)
            if pos == -1:
                break
            span = (pos, pos + len(name))
            if not overlaps(*span):
                found.append(name)
                claimed.append(span)
            idx = pos + 1
    return found


# 「震度６弱以上を観測した…市町村（Ａ、Ｂ、Ｃ…）の状況を確認したところ、
# Ｘにおいて…、Ｙにおいて…。その他の市町村については、災害対応業務に支障
# は生じていない。」のような、市町村を列挙したうえで打ち消す構文。単純な
# 部分文字列検索では列挙された市町村全てに問題が帰属してしまうため、この
# 構文を検出した場合は「〜において」で個別に問題が明記された市町村のみに
# マッチを絞る。
NEGATION_TRIGGER_RE = re.compile(r"その他の市町村について(は)?")
NEGATION_WORD_RE = re.compile(r"支障は生じていない|支障はない|問題(は)?ない|特段の異常はない|異常はない")


def has_municipality_negation_context(text):
    m = NEGATION_TRIGGER_RE.search(text)
    if not m:
        return False
    tail = text[m.end():m.end() + 40]
    return bool(NEGATION_WORD_RE.search(tail))


def match_municipalities_in_context(text, muni_names_by_len_desc):
    """打ち消し構文がある場合は「(市町村名)において」の形で個別に問題が
    明記された市町村のみを返す。それ以外は通常の match_municipalities。"""
    if not has_municipality_negation_context(text):
        return match_municipalities(text, muni_names_by_len_desc)

    claimed = []
    found = []

    def overlaps(a_start, a_end):
        for cs, ce in claimed:
            if a_start < ce and cs < a_end:
                return True
        return False

    for name in muni_names_by_len_desc:
        for m in re.finditer(re.escape(name) + r"において", text):
            span = (m.start(), m.start() + len(name))
            if not overlaps(*span):
                found.append(name)
                claimed.append(span)
    return found


SENTENCE_END_RE = re.compile(r"[。]")


def truncate_text(text, limit=300):
    if len(text) <= limit:
        return text
    window = text[:limit]
    ends = [m.end() for m in SENTENCE_END_RE.finditer(window)]
    if ends:
        cut = ends[-1]
    else:
        cut = limit
    return text[:cut] + "…"


NULL_DENYLIST_RE = re.compile(
    r"会議(を)?開催|名(を)?派遣|派遣状況|人[・･]日|派遣先|営業(中|停止)\s*\d+"
    r"|被害情報(等)?なし$|被害等情報なし$|特になし$|異常なし$|問題なし$"
    r"|現時点で.{0,6}なし$|調査中$|計[\d０-９,，]+[台名件戸局]$|[台件局]$"
)
NULL_MIN_LEN = 20
# 記述文らしい終わり方（文末の句点、または典型的な状況説明語）で終わる
# 行のみを「全域」候補として許可する。施設名の羅列や表の断片など、
# 名詞だけで終わる行はここで弾く。
NULL_SENTENCE_END_RE = re.compile(
    r"(。|済|済み|予定|見込み|実施|確認|解消|再開|停止|復旧|運休|規制|開通|中|要請|決定)$"
)


def is_meaningful_null_candidate(text):
    if len(text) < NULL_MIN_LEN:
        return False
    if NULL_DENYLIST_RE.search(text):
        return False
    if not NULL_SENTENCE_END_RE.search(text):
        return False
    return True


# 「７月29日」「８月１日」「7/29」のような日付表現。normalize_key_text で
# 数字を # に潰す際にこのパターンだけは保護し、日付違いのイベント
# （例: ７月29日の地震／８月１日の地震それぞれのため池点検結果）が
# 誤って同一キーにマージされないようにする。
DATE_LIKE_RE = re.compile(
    r"[0-9０-９]{1,2}\s*月\s*[0-9０-９]{1,2}\s*日"
    r"|[0-9０-９]{1,2}\s*/\s*[0-9０-９]{1,2}"
)


def normalize_key_text(text, limit=60):
    # ページ幅の都合で改行位置がわずかに変わると、同一文なのに単語の途中に
    # 空白が入る位置がずれてしまう（例:「巡視・復旧作業中」と「巡 視・復旧
    # 作業中」）。マージ判定用のキーでは空白を完全に除去し、この位置ずれで
    # 同一イベントが分裂しないようにする（表示用の text 自体は変更しない）。
    text = re.sub(r"[\s　]+", "", text)
    protected = [(m.start(), m.end()) for m in DATE_LIKE_RE.finditer(text)]

    def repl(m):
        for s, e in protected:
            if s <= m.start() and m.end() <= e:
                return m.group(0)
        return "#"

    collapsed = DIGIT_RUN_RE.sub(repl, text)
    return collapsed[:limit]


def parse_report(path, muni_names_by_len_desc):
    text = path.read_text(encoding="utf-8")
    items = extract_items(text)

    records = []  # (category, muni_or_None, text, header)
    seen_in_report = set()
    for category, item_text, _line, header in items:
        item_text = truncate_text(item_text)
        # 「宇城 市」「水 俣市」のような行折返しで名前中に空白が入った市町村名
        # も拾えるよう、空白を除去したテキストに対してマッチを行う。
        search_text = re.sub(r"[\s　]+", "", item_text)
        munis = match_municipalities_in_context(search_text, muni_names_by_len_desc)
        if munis:
            for muni in munis:
                key = (category, muni, item_text)
                if key in seen_in_report:
                    continue
                seen_in_report.add(key)
                records.append((category, muni, item_text, header))
        else:
            if is_meaningful_null_candidate(item_text):
                key = (category, None, item_text)
                if key in seen_in_report:
                    continue
                seen_in_report.add(key)
                records.append((category, None, item_text, header))
    return records


def build_reports_meta(files):
    snapshots = json.loads(SNAPSHOTS_PATH.read_text(encoding="utf-8"))["snapshots"]
    # 報とスナップショットの対応はPDFのファイル名の日付部分で取る。
    # 以前は source_url を突き合わせていたが、配信元のURLが変わる（直下→status/配下）
    # だけで全報が対応づかなくなり、ニュースが丸ごと消えるため、URLには依存させない
    by_suffix = {}
    for snap in snapshots:
        m = re.search(r"r8kumamoto_jishin_([\w-]+)\.pdf$", snap["source_url"])
        if m:
            by_suffix[m.group(1)] = snap

    reports = []
    file_to_report_id = {}
    for path in files:
        m = re.match(r"bousai_(.+)\.txt$", path.name)
        suffix = m.group(1) if m else path.stem.replace("bousai_", "")
        snap = by_suffix.get(suffix)
        if snap is None:
            print(f"WARNING: no matching snapshot for {path.name} (suffix={suffix})", file=sys.stderr)
            continue
        reports.append({
            "id": snap["id"],
            "datetime": snap["datetime"],
            "source_url": snap["source_url"],
        })
        file_to_report_id[path.name] = snap["id"]
    reports.sort(key=lambda r: r["datetime"])
    return reports, file_to_report_id


def merge_events(all_records, file_to_report_id, files_in_order, key_limit=60):
    """(report_id, category, muni, text, header) を時系列にマージして
    first_seen/last_seen/updated を確定させる。files_in_order は日次報の
    datetime 昇順（ファイル名の辞書順ではない）でなければならない。"""
    events_by_key = {}
    order = []

    for path in files_in_order:
        report_id = file_to_report_id.get(path.name)
        if report_id is None:
            continue
        for category, muni, text, header in all_records[path.name]:
            key = (muni, category, header, normalize_key_text(text, key_limit))
            if key in events_by_key:
                ev = events_by_key[key]
                ev["last_seen"] = report_id
                if ev["text"] != text:
                    ev["text"] = text
                    ev["updated"] = True
            else:
                ev = {
                    "category": category,
                    "muni": muni,
                    "text": text,
                    "first_seen": report_id,
                    "last_seen": report_id,
                    "updated": False,
                }
                events_by_key[key] = ev
                order.append(key)

    merged = [events_by_key[k] for k in order]
    return merged


def verify_events(events, report_id_to_flat):
    """各イベントについて、first_seen〜last_seen の範囲内で少なくとも
    last_seen 報には本文が存在することを確認する（「全報のどこかに存在」
    ではなく、範囲の終端で必ず裏取りできることを保証する）。あわせて、
    first_seen 報には本文が存在しない（＝最終的に採用された文面が
    first_seen 時点のものではない）件数を集計する。"""
    unverifiable = []
    first_seen_missing = 0
    for ev in events:
        check_text = ev["text"]
        if check_text.endswith("…"):
            check_text = check_text[:-1]
        check_text = normalize_ws(check_text)

        last_flat = report_id_to_flat.get(ev["last_seen"], "")
        ok = check_text in last_flat
        if not ok:
            unverifiable.append(ev)

        first_flat = report_id_to_flat.get(ev["first_seen"], "")
        if check_text not in first_flat:
            first_seen_missing += 1

    return unverifiable, first_seen_missing


def main():
    files = sorted(RAW_DIR.glob("bousai_*.txt"))
    if not files:
        print("no bousai_*.txt files found", file=sys.stderr)
        sys.exit(1)

    munis = load_municipalities()
    muni_names_by_len_desc = sorted(munis.keys(), key=len, reverse=True)

    reports, file_to_report_id = build_reports_meta(files)

    # ファイル名の辞書順ではなく、日次報の datetime 昇順でマージする
    # （bousai_20260729-1400.txt は '-' < '.' のためファイル名順では
    # bousai_20260729.txt より前に来てしまうが、実際の報の順序は逆）。
    report_id_to_filename = {v: k for k, v in file_to_report_id.items()}
    files_by_name = {p.name: p for p in files}
    files_in_datetime_order = [
        files_by_name[report_id_to_filename[r["id"]]]
        for r in reports
        if r["id"] in report_id_to_filename
    ]

    all_records = {}
    raw_texts_flat = {}
    for path in files:
        all_records[path.name] = parse_report(path, muni_names_by_len_desc)
        raw = path.read_text(encoding="utf-8").replace("\x0c", "")
        cleaned_lines = remove_page_breaks(raw.split("\n"))
        flat = normalize_ws(" ".join(cleaned_lines))
        raw_texts_flat[path.name] = flat

    report_id_to_flat = {
        file_to_report_id[name]: flat
        for name, flat in raw_texts_flat.items()
        if name in file_to_report_id
    }

    # 見出しキーを含めた状態で、先頭一致の長さ 30 と 60 それぞれでマージ
    # した場合のイベント総数を比較し、末尾差による分裂の解消度合いを見る。
    events_key30 = merge_events(all_records, file_to_report_id, files_in_datetime_order, key_limit=30)
    events_key60 = merge_events(all_records, file_to_report_id, files_in_datetime_order, key_limit=60)
    group_count_30 = len(events_key30)
    group_count_60 = len(events_key60)

    events = events_key60

    for ev in events:
        assert ev["first_seen"] <= ev["last_seen"], (
            f"first_seen > last_seen: {ev['first_seen']} > {ev['last_seen']} : {ev['text'][:40]}"
        )

    events.sort(key=lambda e: (e["first_seen"], e["category"], e["muni"] or ""))
    for i, ev in enumerate(events, 1):
        ev["id"] = f"ev-{i:04d}"
    events = [
        {
            "id": e["id"],
            "category": e["category"],
            "muni": e["muni"],
            "text": e["text"],
            "first_seen": e["first_seen"],
            "last_seen": e["last_seen"],
            "updated": e["updated"],
        }
        for e in events
    ]

    bad_muni = [e for e in events if e["muni"] is not None and e["muni"] not in munis]
    if bad_muni:
        print(f"ERROR: {len(bad_muni)} events have unknown muni values", file=sys.stderr)
        for e in bad_muni[:10]:
            print("  ", e["muni"], e["text"][:40], file=sys.stderr)

    unverifiable, first_seen_missing = verify_events(events, report_id_to_flat)

    out = {"reports": reports, "events": events}
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"wrote {OUT_PATH} with {len(events)} events across {len(reports)} reports")

    print("\n-- 報別件数 (first_seen) --")
    for r in reports:
        first_count = sum(1 for e in events if e["first_seen"] == r["id"])
        print(f"  {r['id']}: first_seen={first_count}")

    print("\n-- カテゴリ別件数 --")
    for c in CATEGORIES:
        n = sum(1 for e in events if e["category"] == c)
        print(f"  {c}: {n}")

    null_count = sum(1 for e in events if e["muni"] is None)
    updated_count = sum(1 for e in events if e["updated"])
    print(f"\n全域(null)イベント数: {null_count}")
    print(f"updated=true イベント数: {updated_count}")
    print(f"first_seen <= last_seen アサーション: 全 {len(events)} 件で成立")
    print(f"分裂グループ数比較（見出しキー込み・先頭一致長）: 30字={group_count_30} → 60字={group_count_60}")
    print(f"unverifiable (last_seen 報に本文なし) 件数: {len(unverifiable)}")
    if unverifiable:
        for e in unverifiable[:10]:
            print("  UNVERIFIED:", e["id"], e["muni"], e["text"][:60])
    print(f"first_seen 報に本文なし（最終文面採用）件数: {first_seen_missing}")

    if bad_muni or unverifiable:
        sys.exit(1)


if __name__ == "__main__":
    main()
