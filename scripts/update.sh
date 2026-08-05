#!/bin/bash
# 新しい報告PDFを取得してデータを再生成する
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 熊本県 災害対策本部会議ページを確認 =="
# curl | python3 - <<EOF はヒアドキュメントがstdinを奪ってパイプが死ぬので、一時ファイル経由で渡す
pref_html=$(mktemp)
trap 'rm -f "$pref_html"' EXIT
curl -sL "https://www.pref.kumamoto.jp/soshiki/222/274487.html" -o "$pref_html"
python3 - "$pref_html" <<'EOF'
import sys, re, html, unicodedata, subprocess, pathlib
t = open(sys.argv[1], encoding="utf-8", errors="replace").read()
for m in re.finditer(r'<a[^>]+href="([^"]*attachment/(\d+)\.pdf)"[^>]*>(.*?)</a>', t, re.S):
    label = unicodedata.normalize('NFKC', html.unescape(re.sub(r'<[^>]+>', '', m.group(3)).strip()))
    if '人的被害等の状況' not in label:
        continue
    dm = re.search(r'\((\d+)月(\d+)日\s*(\d+)時(\d+)分時点\)', label)
    if not dm:
        print('  時刻不明のためスキップ:', label)
        continue
    mo, d, h, mi = (int(x) for x in dm.groups())
    ts = f"2026{mo:02d}{d:02d}-{h:02d}{mi:02d}"
    out = pathlib.Path(f"data/raw/pref_{ts}_{m.group(2)}.pdf")
    if out.exists():
        continue
    print('  新規:', ts)
    subprocess.run(['curl', '-sSL', '-o', str(out),
                    f"https://www.pref.kumamoto.jp/uploaded/attachment/{m.group(2)}.pdf"], check=True)
    subprocess.run(['pdftotext', '-layout', str(out), str(out).replace('.pdf', '.txt')], check=True)
EOF

echo "== 内閣府 防災情報ページを確認 =="
curl -sL "https://www.bousai.go.jp/updates/r8kumamoto_jishin/index.html" \
  | grep -oE 'pdf/r8kumamoto_jishin_[0-9-]+\.pdf' | sort -u | while read -r p; do
    name=$(basename "$p" .pdf | sed 's/r8kumamoto_jishin_/bousai_/')
    out="data/raw/${name}.pdf"
    if [ ! -f "$out" ]; then
      echo "  新規: $name"
      curl -sSL -o "$out" "https://www.bousai.go.jp/updates/r8kumamoto_jishin/$p"
      pdftotext -layout "$out" "${out%.pdf}.txt"
    fi
  done

echo "== パースとマージ =="
python3 scripts/parse_pref.py
python3 scripts/parse_bousai.py
python3 scripts/parse_bousai_news.py
python3 scripts/build_timeline.py
echo "完了。commit して main に push すると GitHub Pages に自動デプロイされます。"
