# 令和8年熊本地震 被害状況マップ

**公開サイト: https://wideplain.github.io/disaster-map-kumamoto-2026/**

> **注意**: 本サイトは公的資料の被害状況を見やすく整理・可視化した非公式サイトです。
> 正確な情報は必ず一次ソース（熊本県・内閣府等の公式発表）を確認してください。

熊本県災害対策本部会議資料・内閣府被害状況報のPDFから市町村別の被害データを抽出し、
国土地理院の淡色地図タイル上に時系列（時間スライダー付き）で可視化する静的サイト。

## 構成

```
data/raw/        取得した報告PDFと抽出テキスト
data/            パース済みJSON（pref_snapshots / bousai_snapshots / municipalities）
scripts/
  parse_pref.py         県「人的被害等の状況」各時点のテーブルパーサー
  parse_bousai.py       内閣府日次報パーサー（断水・死者内訳・避難所ほか）
  parse_bousai_news.py  内閣府日次報「その他の状況」から定性イベントを抽出（ニュースマップ用）
  geocode.py            国土地理院ジオコーディングAPIで市町村座標を取得
  build_timeline.py     上記をマージして web/data/ を生成
  update.sh             新しい報告PDFの取得〜再生成まで一括実行
  build_pages.js        SEO用ページ生成器（web/ → _site/。言語別ページ・data.html・sitemap.xmlを生成、自己検査つき）
  serve.sh              ローカル確認用サーバーの起動・停止（ポート8903固定。build サブコマンドあり）
web/             サイトの素材（MapLibre GL JS + 地理院タイル）。GitHub Pagesへの配信対象そのものではない
_site/           配信物。CI（node scripts/build_pages.js）が web/ から生成する。gitには入れない
```

## データ更新

```bash
bash scripts/update.sh
```

県の災害対策本部会議ページと内閣府の更新ページを確認し、新しいPDFがあれば
ダウンロード→パース→`web/data/timeline.json` 再生成まで行う。

## ローカル確認

```bash
bash scripts/serve.sh start   # http://localhost:8903 で web/ をそのまま配信（stop / status もあり）
bash scripts/serve.sh build   # node scripts/build_pages.js を実行して _site/ を生成し、それを配信
```

SEO用の言語別ページ・data.html・sitemap.xml を手元で見たいときは `node scripts/build_pages.js`
（どのディレクトリからでも実行可）で `_site/` を生成するか、`serve.sh build` で生成と配信を一度に行う。

## 公開（GitHub Pages）

`main` ブランチへの push で `.github/workflows/pages.yml` が `node scripts/build_pages.js` を実行して
`_site/`（言語別ページ・data.html・sitemap.xml を含む配信物一式）を生成し、それを GitHub Pages にデプロイする。
生成器は自己検査を内蔵しており、hreflang/canonical/JSON-LDなどが不正な場合はビルド自体が失敗する
（`exit 1`）ので、壊れたページがそのまま公開されることはない。
データ更新後は `bash scripts/update.sh` → commit → push するだけでよい。
サイト内のパス参照はすべて相対パス（`<base>` 基準）なので、`https://<user>.github.io/<repo>/` の
サブパス配信でも動作する。

補足:

- `app.js` / `i18n.js` / `style.css` の `?v=` キャッシュバスターは `web/index.html` の1箇所を上げれば、
  そこから生成される全言語ページ（ルート + 10言語ディレクトリの `index.html`）に伝播する。
  `data.html` は素の静的HTMLで `app.js`/`style.css` を読み込まないため対象外。
- `<base>` を導入しているため、`web/index.html` 本体に素の `href="#..."` のような
  ルート相対でないハッシュリンクは書かない（`<base>` の影響を受けて解決先がずれるため）。
- `sitemap.xml` は GitHub Pages のプロジェクトページ（`/disaster-map-kumamoto-2026/` サブパス）では
  `robots.txt` 経由でのクローラ発見が保証されないため、更新のたびに
  [Google Search Console](https://search.google.com/search-console) から手動送信することを想定している。

## 情報ソースマップ（どこにどんな情報があるか）

### パース対象（本サイトのデータ源）

- **[熊本県 令和8年熊本地震に係る災害対策本部会議](https://www.pref.kumamoto.jp/soshiki/222/274487.html)**（危機管理防災課）
  - 「人的被害等の状況（M月D日H時M分時点）」PDFが会議ごとに追加される（当初は朝夕2回、8/3以降は14時の1日1回）。
  - **市町村別**の避難所数・避難者数・死者・負傷者（重/中/軽）・住家被害（全壊/大規模半壊/半壊/一部損壊）・断水戸数・給水所数。時期により停電戸数欄あり（7/29〜7/31と8/2朝のみ。以降は欄ごと消滅）。
  - → `parse_pref.py` が抽出。**地図の数値の主データ源**（県内45市町村）。
  - 同ページには会議の次第・その他資料PDFもあるが、取得対象は「人的被害等の状況」のみ。
- **[内閣府 防災情報 令和8年熊本地震](https://www.bousai.go.jp/updates/r8kumamoto_jishin/index.html)**
  - 「被害状況等について」日次報PDF（毎朝時点）。
  - 地震諸元・各地の震度、市町村別断水（最大/現在戸数・復旧見込み時期。**県外の断水市町も載る**：柳川市・大川市・佐賀市・南島原市など）、死者の内訳、避難所・停電の県全体値 → `parse_bousai.py`。県資料が断水未報告の市町村の補完と県外表示に使用。
  - 「４ その他の状況」の定性情報（水道・電力・道路・鉄道・医療・福祉施設・廃棄物・農林水産・産業被害など省庁別の箇条書き）→ `parse_bousai_news.py` が抽出し**ニュースマップモード**の元データになる。
  - 消防庁とりまとめの市町村別人的・住家被害表も載っているが**画像埋め込みでテキスト抽出不可**のため、数値は県資料を正としている。

### 参照用（パースはしていない）

- **[熊本県 令和8年熊本地震に関する情報](https://www.pref.kumamoto.jp/soshiki/1/274517.html)**（広報課の総合ポータル）
  - 数値テーブルはないリンク集。災害対策本部会議ページへの入口のほか、政府非常災害対策本部・省庁リンク（官邸/経産/防衛/国交/厚労/環境/農水/総務/文科/財務/金融庁）、生活支援情報（給油・給水・入浴支援、応急住宅・県営住宅などすまい支援、避難所の熱中症対策、悪質商法等の注意喚起、こころのケア、医療・福祉、農林水産業の技術対策、義援金・ボランティア、相談窓口、窓口休止・イベント中止情報）がまとまっている。
  - 個別の支援情報を深掘りする際の起点として有用。将来ここから定性情報を拾う場合も候補。

### 地図・座標

- [地理院タイル（淡色地図）](https://maps.gsi.go.jp/development/ichiran.html)
- 市町村座標は[国土地理院ジオコーディングAPI](https://msearch.gsi.go.jp/address-search/AddressSearch)（`geocode.py`）
- 震央座標は地震調査研究推進本部の評価文書（北緯32度34分・東経130度42分）による

数値はいずれも速報値であり、今後変わることがある。

公開サイトでは利用状況の把握のため Google アナリティクス（gtag.js）を使用している。

## ライセンス

- コード: [MIT License](LICENSE)
- `data/raw/` の報告書PDF・抽出テキストおよびそれに由来するデータ: 各発行元（熊本県・内閣府ほか）の利用規約に従う。政府標準利用規約（第2.0版、CC BY 4.0互換）に基づく出典明記のうえでの二次利用を想定している
- 地図タイルは表示時に国土地理院のサーバーから直接配信される（[地理院タイル利用規約](https://maps.gsi.go.jp/development/ichiran.html)）
