#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  MMS 整合チェック — 設計書と実装仕様のズレを機械検出する
#
#  由来: docs/DESIGN.md §9.4.5「整合を人の記憶に頼らない（機械で担保する）」
#
#  検査項目:
#    [1] schema.prisma の model 数 == 設計書の `^model ` 出現数
#    [2] 設計書内の Phase 番号に重複が無いか
#    [3] 設計書内の「段N」参照が §4.1 の定義（段1〜段7）と矛盾しないか
#    [4] ロードマップ表が §9 以外に存在しないか
#    [5] GLOSSARY.md に定義された enum 値が schema.prisma の enum と一致するか
#
#  使い方:  bash docs/check-consistency.sh
#  終了コード: 0 = 全項目 pass / 1 = 1つ以上 fail
#
#  ★設計書（docs/DESIGN.md）を変更したら必ず実行する（docs/RULES.md §19-3）
# ═══════════════════════════════════════════════════════════════════════════

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESIGN="$ROOT/docs/DESIGN.md"
SCHEMA="$ROOT/packages/db/prisma/schema.prisma"
GLOSSARY="$ROOT/docs/GLOSSARY.md"

FAILED=0
PASSED=0

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }

pass() { PASSED=$((PASSED+1)); green "  PASS  $*"; }
fail() { FAILED=$((FAILED+1)); red   "  FAIL  $*"; }

require_file() {
  if [ ! -f "$1" ]; then
    red "必須ファイルがありません: $1"
    exit 2
  fi
}

require_file "$DESIGN"
require_file "$SCHEMA"
require_file "$GLOSSARY"

echo "═══════════════════════════════════════════════════════════"
echo " MMS 整合チェック"
echo "  設計書 : ${DESIGN#$ROOT/}  ($(wc -l < "$DESIGN" | tr -d ' ') 行)"
echo "  スキーマ: ${SCHEMA#$ROOT/}"
echo "  用語集  : ${GLOSSARY#$ROOT/}"
echo "═══════════════════════════════════════════════════════════"
echo

# ───────────────────────────────────────────────────────────────────────────
# [1] model 数の一致
# ───────────────────────────────────────────────────────────────────────────
echo "[1] model 数の一致（schema.prisma ⇔ 設計書）"

# schema.prisma のうち「AUTH ... ここから/ここまで」に挟まれた区間は
# Auth.js 用のインフラモデル（設計書スコープ外）なので model 数から除外する
schema_design_models() {
  awk '
    /AUTH .*ここから/ { skip = 1 }
    /AUTH .*ここまで/ { skip = 0; next }
    !skip && /^model / { sub(/^model +/, ""); sub(/ .*$/, ""); print }
  ' "$SCHEMA"
}

DESIGN_MODELS=$(grep -c '^model ' "$DESIGN" || true)
SCHEMA_MODELS=$(schema_design_models | grep -c . || true)
SCHEMA_AUTH_MODELS=$(( $(grep -c '^model ' "$SCHEMA" || true) - SCHEMA_MODELS ))

if [ "$DESIGN_MODELS" -eq "$SCHEMA_MODELS" ]; then
  pass "model 数が一致: $SCHEMA_MODELS（別途 Auth.js 用 $SCHEMA_AUTH_MODELS モデル・設計書スコープ外）"
else
  fail "model 数が不一致: 設計書=$DESIGN_MODELS / schema.prisma=$SCHEMA_MODELS"
  dim "    設計書にあって schema に無い model:"
  comm -23 \
    <(grep '^model ' "$DESIGN" | sed -E 's/^model +([A-Za-z0-9_]+).*/\1/' | sort -u) \
    <(schema_design_models | sort -u) \
    | sed 's/^/      - /'
  dim "    schema にあって設計書に無い model:"
  comm -13 \
    <(grep '^model ' "$DESIGN" | sed -E 's/^model +([A-Za-z0-9_]+).*/\1/' | sort -u) \
    <(schema_design_models | sort -u) \
    | sed 's/^/      - /'
fi

# model 名そのものの照合（数が同じでも中身が違う事故を防ぐ）
DIFF_NAMES=$(diff \
  <(grep '^model ' "$DESIGN" | sed -E 's/^model +([A-Za-z0-9_]+).*/\1/' | sort -u) \
  <(schema_design_models | sort -u) || true)

if [ -z "$DIFF_NAMES" ]; then
  pass "model 名が完全一致"
else
  fail "model 名に差分がある"
  echo "$DIFF_NAMES" | sed 's/^/      /'
fi
echo

# ───────────────────────────────────────────────────────────────────────────
# [2] Phase 番号の重複
# ───────────────────────────────────────────────────────────────────────────
echo "[2] Phase 番号の重複（設計書 §9.1 の全Phase表）"

# §9.1 の表から Phase ID を抜く（2列目が **PX.Y** 形式の行）
PHASE_IDS=$(awk '
  /^### 9\.1 /      { in91=1; next }
  /^### 9\.2 /      { in91=0 }
  in91 && /^\| *[0-9]+ *\|/ {
    # 2列目を取り出す
    n = split($0, c, "|")
    if (n >= 3) {
      id = c[3]
      gsub(/\*/, "", id)
      gsub(/^[ \t]+|[ \t]+$/, "", id)
      if (id ~ /^P[0-9]/) print id
    }
  }
' "$DESIGN")

PHASE_TOTAL=$(printf '%s\n' "$PHASE_IDS" | grep -c . || true)
PHASE_UNIQUE=$(printf '%s\n' "$PHASE_IDS" | sort | uniq | grep -c . || true)
PHASE_DUPES=$(printf '%s\n' "$PHASE_IDS" | sort | uniq -d)

if [ "$PHASE_TOTAL" -eq 0 ]; then
  fail "§9.1 から Phase を1つも抽出できなかった（表の書式が変わった可能性）"
elif [ -z "$PHASE_DUPES" ]; then
  pass "Phase 番号に重複なし（$PHASE_TOTAL 件 / ユニーク $PHASE_UNIQUE 件）"
else
  fail "Phase 番号が重複している"
  printf '%s\n' "$PHASE_DUPES" | sed 's/^/      - /'
fi

# PHASES.md 側との件数照合
if [ -f "$ROOT/docs/PHASES.md" ]; then
  PHASES_MD_COUNT=$(awk '
    /^\| *[0-9]+ *\| *\*\*P/ { print }
  ' "$ROOT/docs/PHASES.md" | wc -l | tr -d ' ')
  if [ "$PHASES_MD_COUNT" -eq "$PHASE_TOTAL" ]; then
    pass "docs/PHASES.md の Phase 行数が設計書 §9.1 と一致: $PHASE_TOTAL"
  else
    fail "docs/PHASES.md の Phase 行数が不一致: PHASES.md=$PHASES_MD_COUNT / 設計書 §9.1=$PHASE_TOTAL"
  fi
fi
echo

# ───────────────────────────────────────────────────────────────────────────
# [3] 「段N」参照の整合（§4.1 の定義: 段1〜段7）
# ───────────────────────────────────────────────────────────────────────────
echo "[3] 「段N」参照の整合（§4.1 の定義: 段1〜段7）"

# 3-a: 範囲外の段番号
OUT_OF_RANGE=$(grep -n '段[0-9]\+' "$DESIGN" \
  | grep -oE '段[0-9]+' \
  | sed 's/段//' \
  | awk '$1 < 1 || $1 > 7' | sort -u || true)

if [ -z "$OUT_OF_RANGE" ]; then
  pass "段番号は全て 1〜7 の範囲内"
else
  fail "§4.1 の定義（段1〜段7）の範囲外の段番号がある: $(printf '%s ' $OUT_OF_RANGE)"
  grep -n '段[0-9]\+' "$DESIGN" | grep -E "段($(printf '%s' "$OUT_OF_RANGE" | paste -sd'|' -))" | sed 's/^/      /'
fi

# 3-b: 意味の取り違え（§4.1 では 段6=施策の生死 / 段7=ジョブ健全性）
#      段6 が「ジョブ健全性」の語彙と同じ行に出たら §4.1 と矛盾する
#      ただし 段7 も同じ行にある場合は定義の列挙行なので除外する
MISMATCH=$(grep -n '段6' "$DESIGN" \
  | grep -v '段7' \
  | grep -E 'ジョブ|最終実行|トークン|残日数|欠測' || true)

if [ -z "$MISMATCH" ]; then
  pass "段6/段7 の意味に取り違えなし（段6=施策の生死 / 段7=ジョブ健全性）"
else
  fail "段6 が §4.1 の「段7=ジョブ健全性」の内容を指している（段番号の取り違え）"
  printf '%s\n' "$MISMATCH" | sed 's/^/      /'
fi
echo

# ───────────────────────────────────────────────────────────────────────────
# [4] ロードマップ表が §9 以外に存在しないか
# ───────────────────────────────────────────────────────────────────────────
echo "[4] ロードマップ表が §9 以外に存在しないか"

STRAY=$(awk '
  /^## / {
    sec = $0
    sub(/^## +/, "", sec)
    # 「9.」で始まるトップレベル節だけがロードマップを持ってよい
    in9 = (sec ~ /^9\./) ? 1 : 0
  }
  # ロードマップ表のヘッダ行: Phase 列と 見積 列を同時に持つ表
  /^\|/ && /Phase/ && /見積/ {
    if (!in9) printf "%d: [%s] %s\n", NR, sec, $0
  }
' "$DESIGN")

if [ -z "$STRAY" ]; then
  pass "ロードマップ表は §9 のみに存在する"
else
  STRAY_COUNT=$(printf '%s\n' "$STRAY" | grep -c . || true)
  fail "§9 以外に ロードマップ表が $STRAY_COUNT 箇所ある（ロードマップの正が分裂している）"
  printf '%s\n' "$STRAY" | sed 's/^/      /'
fi
echo

# ───────────────────────────────────────────────────────────────────────────
# [5] GLOSSARY.md の enum 値 ⇔ schema.prisma の enum
# ───────────────────────────────────────────────────────────────────────────
echo "[5] GLOSSARY.md の enum 値 ⇔ schema.prisma の enum"

TMPDIR_CHK=$(mktemp -d)
trap 'rm -rf "$TMPDIR_CHK"' EXIT

# schema.prisma から enum を抽出 → 1ファイル1enum
awk -v out="$TMPDIR_CHK" '
  /^enum [A-Za-z0-9_]+ *\{/ {
    name = $2
    file = out "/schema." name
    inenum = 1
    next
  }
  inenum && /^\}/ { inenum = 0; next }
  inenum {
    line = $0
    sub(/\/\/.*$/, "", line)
    gsub(/^[ \t]+|[ \t]+$/, "", line)
    if (line ~ /^[A-Za-z_][A-Za-z0-9_]*$/) print line > file
  }
' "$SCHEMA"

# GLOSSARY.md から `<!-- enum: NAME -->` 直後の表を抽出
awk -v out="$TMPDIR_CHK" '
  /<!-- *enum: *[A-Za-z0-9_]+ *-->/ {
    match($0, /enum: *[A-Za-z0-9_]+/)
    name = substr($0, RSTART+5, RLENGTH-5)
    gsub(/^[ \t]+|[ \t]+$/, "", name)
    file = out "/glossary." name
    printf "" > file
    ingl = 1
    next
  }
  ingl && !/^\|/ { if ($0 !~ /^[ \t]*$/) ingl = 0; next }
  ingl && /^\|/ {
    n = split($0, c, "|")
    if (n >= 2) {
      cell = c[2]
      gsub(/^[ \t]+|[ \t]+$/, "", cell)
      # 先頭セルがバッククォート囲みの識別子である行だけを値とみなす
      if (match(cell, /^`[A-Za-z_][A-Za-z0-9_]*`$/)) {
        v = cell
        gsub(/`/, "", v)
        print v > file
      }
    }
  }
' "$GLOSSARY"

ENUM_OK=0
ENUM_NG=0
UNDOCUMENTED=""

for sf in "$TMPDIR_CHK"/schema.*; do
  [ -e "$sf" ] || continue
  ename="${sf##*/schema.}"
  gf="$TMPDIR_CHK/glossary.$ename"
  if [ ! -f "$gf" ]; then
    UNDOCUMENTED="$UNDOCUMENTED $ename"
    continue
  fi
  if diff -q <(sort "$sf") <(sort "$gf") >/dev/null 2>&1; then
    ENUM_OK=$((ENUM_OK+1))
  else
    ENUM_NG=$((ENUM_NG+1))
    red "        enum $ename が不一致"
    dim "          schema のみ: $(comm -23 <(sort "$sf") <(sort "$gf") | tr '\n' ' ')"
    dim "          用語集のみ  : $(comm -13 <(sort "$sf") <(sort "$gf") | tr '\n' ' ')"
  fi
done

# 用語集にあって schema に無い enum（幽霊定義）
GHOST=""
for gf in "$TMPDIR_CHK"/glossary.*; do
  [ -e "$gf" ] || continue
  ename="${gf##*/glossary.}"
  [ -f "$TMPDIR_CHK/schema.$ename" ] || GHOST="$GHOST $ename"
done

if [ "$ENUM_NG" -eq 0 ] && [ -z "$GHOST" ]; then
  pass "enum 値が完全一致（照合 $ENUM_OK 件）"
else
  [ "$ENUM_NG" -gt 0 ] && fail "enum 値が不一致: $ENUM_NG 件（一致 $ENUM_OK 件）"
  [ -n "$GHOST" ]      && fail "用語集にあって schema.prisma に無い enum:$GHOST"
fi

if [ -n "$UNDOCUMENTED" ]; then
  fail "schema.prisma にあって用語集に定義が無い enum:$UNDOCUMENTED"
else
  pass "schema.prisma の全 enum が用語集に定義されている"
fi
echo

# ───────────────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
if [ "$FAILED" -eq 0 ]; then
  green " 全項目 pass （$PASSED 件）"
  echo "═══════════════════════════════════════════════════════════"
  exit 0
else
  red " FAIL $FAILED 件 / PASS $PASSED 件"
  echo "═══════════════════════════════════════════════════════════"
  echo
  dim " 検出された不整合は docs/PHASES.md §8（未解決リスト）を参照。"
  dim " ★設計書側の修正は石井さんの判断が要るため、自動修正はしない。"
  exit 1
fi
