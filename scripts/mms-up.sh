#!/usr/bin/env bash
# MMS 常駐スタックの起動（launchd から呼ばれる）
# 設計書 §2.1「Docker Compose（web / db / worker）+ launchd。Mac起動時に自動立ち上げ」
#
# Docker Desktop の起動はログイン後に非同期で進むため、デーモンが上がるまで待つ。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S%z')] $*"; }

# Docker Desktop の CLI は PATH に無いことがあるので補う
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

if [ ! -f .env ]; then
  log "ERROR: .env がありません（cp .env.example .env して値を埋めてください）"
  exit 1
fi

# Docker Desktop が未起動なら起動する
if ! docker info >/dev/null 2>&1; then
  log "Docker が未起動。Docker Desktop を起動します"
  open -ga Docker || true
fi

# 最大5分待つ
for i in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    log "Docker 稼働を確認（${i}回目）"
    break
  fi
  sleep 5
done

if ! docker info >/dev/null 2>&1; then
  log "ERROR: Docker が起動しませんでした"
  exit 1
fi

log "docker compose up -d を実行します"
docker compose up -d --remove-orphans

log "起動状況:"
docker compose ps
