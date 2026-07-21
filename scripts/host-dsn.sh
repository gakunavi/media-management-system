#!/usr/bin/env bash
# .env の MMS_DATABASE_URL を「ホストから叩ける形」に読み替えて標準出力に出す。
#
# ★MMS_DATABASE_URL は Prisma と worker が共有する単一の値で、コンテナ間の
#   ホスト名 db:5432 を指している。ホストの npm から実行するスクリプト
#   （seed:jobs 等）はこれを解決できず「Can't reach database server at db:5432」で落ちる。
#   ホスト側の公開ポートは MMS_POSTGRES_PORT（既定 5433。5432 は Homebrew の
#   PostgreSQL と衝突するため）なので、そこへ向け直す。
set -euo pipefail

ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env"
[ -f "$ENV_FILE" ] || { echo ".env がありません: $ENV_FILE" >&2; exit 1; }

dsn=$(grep -E '^MMS_DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
[ -n "$dsn" ] || { echo "MMS_DATABASE_URL が .env にありません" >&2; exit 1; }

port=$(grep -E '^MMS_POSTGRES_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2-)
port=${port:-5433}

# @db:<任意のポート> → @localhost:<ホスト公開ポート>
echo "$dsn" | sed -E "s|@db:[0-9]+|@localhost:${port}|"
