#!/usr/bin/env bash
# ファネル7段の計測受口 /api/ingest/events の検証（P2.5）
#   - 7段すべてが記録されるか
#   - 同じイベントを再送しても増えないか（冪等キー §16.1-④）
#   - レート制限・上限超過が効くか
set -euo pipefail

URL="${MMS_EVENTS_URL:-http://127.0.0.1:3000/api/ingest/events}"
# ★Origin を必ず送る（2026-07-24）。
#   受口は Origin allowlist で守っており（HMAC はブラウザに置けない・§9-D19）、
#   ヘッダ無しの curl は本番設定では必ず 403 になる。
#   .env の MMS_INGEST_ALLOWED_ORIGINS の先頭を既定にして、
#   「テストは通るのに本番は落ちる／その逆」を防ぐ。
ORIGIN="${MMS_EVENTS_ORIGIN:-$(grep -m1 '^MMS_INGEST_ALLOWED_ORIGINS=' .env 2>/dev/null | cut -d= -f2- | cut -d, -f1)}"
ORIGIN="${ORIGIN:-http://localhost:3000}"
echo "  Origin: $ORIGIN"
SID="testsession$(date +%s)"     # 8-64 文字の英数字
VID="testvisitor000001"

post() {
  curl -s -X POST "$URL" -H 'Content-Type: text/plain' -H "Origin: $ORIGIN" --data-binary "$1"
}

echo "── 7段すべてを1リクエストで送る ──"
BODY=$(cat <<JSON
{"visitorId":"$VID","sessionId":"$SID","session":{"landingContentExternalId":"ART-088","referrer":"https://www.google.com/"},"events":[
{"step":"cta_view","occurredAt":"2026-07-20T22:00:00.000Z","contentExternalId":"ART-088"},
{"step":"cta_click","occurredAt":"2026-07-20T22:00:05.000Z","contentExternalId":"ART-088"},
{"step":"lp_view","occurredAt":"2026-07-20T22:00:10.000Z"},
{"step":"lp_scroll","occurredAt":"2026-07-20T22:00:15.000Z","meta":{"depth":50}},
{"step":"form_view","occurredAt":"2026-07-20T22:00:20.000Z"},
{"step":"form_field","occurredAt":"2026-07-20T22:00:25.000Z"},
{"step":"submit","occurredAt":"2026-07-20T22:00:30.000Z"}
]}
JSON
)
post "$BODY"; echo

echo "── 同じ内容を再送（冪等: deduplicated=7 になるはず）──"
post "$BODY"; echo

echo "── 不正な step は rejected されるはず ──"
post "{\"visitorId\":\"$VID\",\"sessionId\":\"$SID\",\"events\":[{\"step\":\"not_a_step\"}]}"; echo

echo "── 上限超過（51件）は 413 になるはず ──"
BIG='{"visitorId":"'$VID'","sessionId":"'$SID'x","events":['
for i in $(seq 1 51); do BIG="$BIG{\"step\":\"cta_view\"},"; done
BIG="${BIG%,}]}"
curl -s -o /dev/null -w "  → HTTP %{http_code}\n" -X POST "$URL" -H 'Content-Type: text/plain' -H "Origin: $ORIGIN" --data-binary "$BIG"

echo "SID=$SID"   # DB 確認用に出力
