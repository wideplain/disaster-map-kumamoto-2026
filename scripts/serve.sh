#!/bin/bash
# ローカル配信の起動/停止/状態確認。ポートは8903固定
# （マシンの8901はTailscaleのHTTPSリスナーが使用中。tailnet URLは
#   https://macbook-pro.tail7aa935.ts.net:8901/ → localhost:8903 のまま不変）
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=8903
PIDFILE=".server.pid"

stop() {
  if [ -f "$PIDFILE" ]; then
    pid=$(cat "$PIDFILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && echo "停止: PID $pid"
    fi
    rm -f "$PIDFILE"
  fi
  # pidfileを失った残骸も回収する
  stray=$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$stray" ]; then
    kill $stray && echo "残骸を停止: PID $stray"
  fi
}

# DIR: 配信対象ディレクトリ。build サブコマンドのときだけ _site（生成物）、
# それ以外は web（素材をそのまま配信、ローカルではSEO生成なしでも動く構造）
DIR="web"

start() {
  stop
  nohup python3 -m http.server "$PORT" --directory "$DIR" >/dev/null 2>&1 &
  echo $! > "$PIDFILE"
  disown
  sleep 1
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/" | grep -q 200; then
    echo "起動: http://localhost:$PORT/ ($DIR を配信, PID $(cat "$PIDFILE"))"
  else
    echo "起動失敗" >&2
    exit 1
  fi
}

status() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "稼働中: http://localhost:$PORT/ (PID $(cat "$PIDFILE"))"
  else
    echo "停止中"
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) start ;;
  status) status ;;
  build)
    node "$(dirname "$0")/build_pages.js"
    DIR="_site"
    start
    ;;
  *) echo "usage: $0 {start|stop|restart|status|build}" >&2; exit 1 ;;
esac
