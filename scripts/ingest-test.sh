#!/usr/bin/env bash
# /api/ingest/form への署名付きテスト送信（docs/INTEGRATIONS.md §1.6）
#
# 使い方:
#   npm run ingest:test              # 既定のテストデータを送る
#   npm run ingest:test -- --dup     # 同じ内容を2回送って冪等性を確認する
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

[ -f .env ] || { echo ".env がありません"; exit 1; }

SECRET="$(grep '^MMS_INGEST_SECRET=' .env | cut -d= -f2-)"
URL="${MMS_INGEST_URL:-http://127.0.0.1:3000/api/ingest/form}"

[ -n "$SECRET" ] || { echo "MMS_INGEST_SECRET が .env にありません"; exit 1; }

BODY=$(cat <<'JSON'
{"occurredAt":"2026-07-20T22:30:00+09:00","name":"テスト太郎","email":"test@example.co.jp","phone":"03-1234-5678","company":"テスト株式会社","message":"即時償却について相談したいです","interestProduct":["ML"],"from":"media","article":"ART-088","pageUrl":"https://asset-support.co.jp/contact/","idempotencyKey":"ingest-test-fixed-key"}
JSON
)

send() {
  local ts sig
  ts="$(date +%s)"
  sig="$(printf '%s.%s' "$ts" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.*= //')"
  curl -s -w '\nHTTP %{http_code}\n' -X POST "$URL" \
    -H 'Content-Type: application/json' \
    -H "X-MMS-Timestamp: ${ts}" \
    -H "X-MMS-Signature: ${sig}" \
    --data-binary "$BODY"
}

echo "── 1回目（新規で 201 になるはず）──"
send

if [ "${1:-}" = "--dup" ]; then
  echo
  echo "── 2回目（冪等: duplicate=true で Lead は増えないはず）──"
  send
fi

echo
echo "── 署名を壊した場合（401 になるはず）──"
ts="$(date +%s)"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST "$URL" \
  -H 'Content-Type: application/json' \
  -H "X-MMS-Timestamp: ${ts}" \
  -H "X-MMS-Signature: 00000000000000000000000000000000000000000000000000000000000000ff" \
  --data-binary "$BODY"
