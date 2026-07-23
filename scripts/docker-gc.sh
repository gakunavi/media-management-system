#!/usr/bin/env bash
# Docker のゴミを掃除する（2026-07-23 追加）
#
# ★なぜ要るか
#   ビルドのたびに旧イメージとビルドキャッシュが残り、放置すると数十GBになる。
#   2026-07-23 にディスクが99%まで埋まり、Postgres がチェックポイントを
#   書けずクラッシュループした（DBが落ちれば web も worker も同時に止まる）。
#   気づいたのは「画面が開かない」という最悪の入口だった。
#
# ★消すのは「タグ無しイメージ」と「ビルドキャッシュ」だけ。
#   稼働中のイメージ・ボリューム（DBのデータ）には触らない。
#   -a を付けない。付けると停止中コンテナのイメージまで消え、
#   起動できなくなる可能性がある。
set -euo pipefail

log() { printf '[docker-gc] %s\n' "$*"; }

before=$(df -k / | awk 'NR==2 {print $4}')

# ★タグ無し（dangling）のみ。-a は使わない
log "タグ無しイメージを削除"
docker image prune -f 2>&1 | tail -1

# ★ビルドキャッシュは純粋なキャッシュ。消しても次回ビルドが遅くなるだけ
#   7日より古いものだけ残さない（直近は再ビルドの高速化に効く）
log "7日より古いビルドキャッシュを削除"
docker builder prune -f --filter "until=168h" 2>&1 | tail -1

# ★停止して1日以上経ったコンテナ。migrate は毎回 Exited で残る
log "1日以上前に停止したコンテナを削除"
docker container prune -f --filter "until=24h" 2>&1 | tail -1

after=$(df -k / | awk 'NR==2 {print $4}')
freed=$(( (after - before) / 1024 / 1024 ))
avail=$(( after / 1024 / 1024 ))
log "完了: ${freed}GB 解放 / 残り ${avail}GB"

# ★ボリュームは消さない。DBのデータが入っている（prune すると消える）
