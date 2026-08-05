# 令和8年熊本地震 被害状況マップ

熊本県災害対策本部会議資料・内閣府被害状況報のPDFから市町村別の被害データを抽出し、
国土地理院の淡色地図タイル上に時系列（時間スライダー付き）で可視化する静的サイト。

## 構成

```
data/raw/        取得した報告PDFと抽出テキスト
data/            パース済みJSON（pref_snapshots / bousai_snapshots / municipalities）
scripts/
  parse_pref.py      県「人的被害等の状況」12時点のテーブルパーサー
  parse_bousai.py    内閣府日次報パーサー（断水・死者内訳・避難所ほか）
  geocode.py         国土地理院ジオコーディングAPIで市町村座標を取得
  build_timeline.py  上記をマージして web/data/ を生成
  update.sh          新しい報告PDFの取得〜再生成まで一括実行
web/             デプロイ対象の静的サイト（MapLibre GL JS + 地理院タイル）
```

## データ更新

```bash
bash scripts/update.sh
```

県の災害対策本部会議ページと内閣府の更新ページを確認し、新しいPDFがあれば
ダウンロード→パース→`web/data/timeline.json` 再生成まで行う。

## ローカル確認

```bash
python3 -m http.server 8000 --directory web
# http://localhost:8000
```

## 公開（GitHub Pages）

`main` ブランチへの push で `.github/workflows/pages.yml` が `web/` をそのまま GitHub Pages にデプロイする。
データ更新後は `bash scripts/update.sh` → commit → push するだけでよい。
サイト内のパス参照はすべて相対パスなので、`https://<user>.github.io/<repo>/` のサブパス配信でも動作する。

## 出典

- [熊本県 令和8年熊本地震に係る災害対策本部会議](https://www.pref.kumamoto.jp/soshiki/222/274487.html)（人的被害等の状況 各報）
- [内閣府 防災情報 令和8年熊本地震](https://www.bousai.go.jp/updates/r8kumamoto_jishin/index.html)（被害状況等について 日次報）
- [地理院タイル（淡色地図）](https://maps.gsi.go.jp/development/ichiran.html)
- 震央座標は地震調査研究推進本部の評価文書（北緯32度34分・東経130度42分）による

数値はいずれも速報値であり、今後変わることがある。

## ライセンス

- コード: [MIT License](LICENSE)
- `data/raw/` の報告書PDF・抽出テキストおよびそれに由来するデータ: 各発行元（熊本県・内閣府ほか）の利用規約に従う。政府標準利用規約（第2.0版、CC BY 4.0互換）に基づく出典明記のうえでの二次利用を想定している
- 地図タイルは表示時に国土地理院のサーバーから直接配信される（[地理院タイル利用規約](https://maps.gsi.go.jp/development/ichiran.html)）
