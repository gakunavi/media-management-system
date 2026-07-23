#!/usr/bin/env python3
"""記事に買い手軸（budgetTier / funnelStage）を一括で付ける（P4.9）

★方針（docs/PHASES.md §9.4.2）
  **ルール＋一括処理＋人の承認**で行う。157記事をAIが1本ずつ判定しない。
  ここを取り違えるとトークンを数十倍消費する。

★判定できないものは unknown / null のまま残す（§3 欠測とゼロの区別）
  推測で埋めると「タグが付いている」ように見えて、段3の買い手の質が
  嘘の数字になる。**埋まっていない方がまだ正しい。**

★既定は dry-run。--apply を付けたときだけ書き込む。
  既に人が設定した値は上書きしない（--force で明示したときのみ）。

────────────────────────────────────────────────
budgetTier … その記事を読む人が動かせる金額の規模
  high    1,000万〜  設備投資型の節税商材（GPU・航空機リース・データセンター等）
  mid     300〜1,000万  法人の制度活用（経営強化税制・役員退職金・法人保険）
  low     〜300万    個人事業主・小規模（共済・iDeCo・確定申告・家賃按分）

funnelStage … その記事に来た人がどこにいるか
  awareness     そもそも何かを知る（「とは」「完全ガイド」「全体像」）
  comparison    選択肢を比べる（「比較」「選び方」「どっち」「違い」）
  product_deep  特定商材を深く調べる（商材名＋要件・申請・シミュレーション・税務調査）
  decision      買う直前の不安を潰す（「リスク」「否認」「失敗」「業者選び」「相談」）
────────────────────────────────────────────────

使い方:
  python3 scripts/tag-buyer-axis.py            # dry-run（何をどう変えるか出すだけ）
  python3 scripts/tag-buyer-axis.py --apply    # 書き込む
  python3 scripts/tag-buyer-axis.py --csv > /tmp/tags.csv   # 全件をCSVで確認
"""

from __future__ import annotations

import os
import re
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

# ── budgetTier のルール ────────────────────────────────
#
# ★順に評価し、最初に当たったものを採る。上ほど強い根拠。
#   「個人事業主」は法人向けキーワードより優先する（読者が明確に違う）。

BUDGET_RULES: list[tuple[str, str, list[str]]] = [
    # (tier, 根拠ラベル, キーワード)
    (
        "low",
        "個人事業主・小規模向け",
        [
            "個人事業主", "フリーランス", "小規模企業共済", "iDeCo", "イデコ",
            "青色申告", "確定申告", "家賃", "白色", "e-Tax",
        ],
    ),
    (
        "high",
        "設備投資型の節税商材（数百万〜数千万）",
        [
            "GPU", "AIサーバー", "データセンター", "航空機", "オペレーティングリース",
            "オペリース", "JOL", "外貨両替機", "IoTビーコン", "EV充電", "DXポータル",
            "IoT自販機", "船舶", "コンテナ", "LP出資", "重機", "太陽光",
        ],
    ),
    (
        "mid",
        "法人の制度活用・出口設計（300〜1,000万）",
        [
            "経営強化税制", "即時償却", "特別償却", "税額控除", "役員退職金", "法人保険",
            "決算賞与", "投資促進税制", "研究開発税制", "賃上げ促進税制", "事業承継",
            "自社株", "経営セーフティ共済", "倒産防止共済", "中退共", "特退共",
            "少額減価償却", "役員報酬", "社宅", "短期前払費用", "繰越欠損金",
            "ストックオプション", "設備投資", "決算対策", "決算前", "決算月", "決算直前",
        ],
    ),
]

# ── funnelStage のルール ───────────────────────────────
#
# ★decision を最優先に見る。「リスク」「否認」「失敗」を調べている人は
#   もう商材を知っていて、買うかどうかを決めようとしている。
#   これを awareness に落とすと、買う直前の読者を「知らない人」として扱う。

FUNNEL_RULES: list[tuple[str, str, list[str]]] = [
    (
        "decision",
        "買う直前の不安を潰す",
        [
            "リスク", "否認", "失敗", "業者選び", "倒産", "破産", "民事再生",
            "税務調査", "デメリット", "トラブル", "落とし穴", "逆効果",
            "相談はどこ", "選び方とリスク", "注意",
        ],
    ),
    (
        "comparison",
        "選択肢を比べる",
        ["比較", "選び方", "どっち", "違い", "使い分け", "vs", "選ぶ", "最適解", "判断軸", "優先順位"],
    ),
    (
        "product_deep",
        "特定商材・制度を深く調べる",
        [
            "スキーム", "要件", "申請", "手続き", "シミュレーション", "事例", "実務",
            "対象設備", "類型", "書き方", "テンプレ", "チェックリスト", "フロー",
            "仕訳", "計算方法", "ひな形", "適正額", "手順",
        ],
    ),
    (
        "awareness",
        "そもそも何かを知る",
        ["とは", "完全ガイド", "全体像", "仕組み", "基礎", "入門", "解説", "影響", "改正", "速報", "ニュース"],
    ),
]

# ★カテゴリからの補強。タイトルで決まらなかったときだけ使う
CATEGORY_BUDGET = {
    "個人事業主・フリーランス": ("low", "カテゴリ"),
    "設備投資・減税": ("mid", "カテゴリ"),
    "節税商品ガイド": ("high", "カテゴリ"),
    "事業承継・退職金": ("mid", "カテゴリ"),
    "決算期の節税": ("mid", "カテゴリ"),
    "法人節税": ("mid", "カテゴリ"),
}


def log(msg: str) -> None:
    print(msg, flush=True)


def normalize_dsn(url: str) -> str:
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = params.pop("schema", None)
    if schema:
        params.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(params, safe="-%"), parts.fragment)
    )


def decode_entities(s: str) -> str:
    """移行時に残った実体参照を戻す（&#038; → &）"""
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    return s.replace("&amp;", "&")


def match_rules(text: str, rules: list[tuple[str, str, list[str]]]) -> tuple[str, str] | None:
    low = text.lower()
    for value, why, words in rules:
        for w in words:
            if w.lower() in low:
                return value, f"{why}（「{w}」）"
    return None


def decide(title: str, category: str | None) -> tuple[str | None, str, str | None, str]:
    """(budgetTier, 根拠, funnelStage, 根拠) を返す。決まらなければ None"""
    t = decode_entities(title)

    b = match_rules(t, BUDGET_RULES)
    if b:
        budget, b_why = b
    elif category and category in CATEGORY_BUDGET:
        budget, b_why = CATEGORY_BUDGET[category]
        b_why = f"{b_why}「{category}」"
    else:
        budget, b_why = None, "判定不能"

    f = match_rules(t, FUNNEL_RULES)
    funnel, f_why = f if f else (None, "判定不能")

    return budget, b_why, funnel, f_why


def main() -> int:
    apply_changes = "--apply" in sys.argv
    force = "--force" in sys.argv
    as_csv = "--csv" in sys.argv

    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT id, "externalId", title, category, "budgetTier", "funnelStage"
               FROM "ContentItem" WHERE type = 'article' ORDER BY "externalId" """
        )
        rows = cur.fetchall()

        stats = {"budget": {}, "funnel": {}}
        changes: list[tuple] = []
        undecided: list[str] = []

        if as_csv:
            print("externalId,budgetTier,budget_why,funnelStage,funnel_why,title")

        for cid, ext, title, category, cur_budget, cur_funnel in rows:
            budget, b_why, funnel, f_why = decide(title, category)

            # ★既に人が入れた値は上書きしない
            keep_budget = cur_budget not in (None, "unknown") and not force
            keep_funnel = cur_funnel is not None and not force
            new_budget = cur_budget if keep_budget else (budget or "unknown")
            new_funnel = cur_funnel if keep_funnel else funnel

            stats["budget"][new_budget] = stats["budget"].get(new_budget, 0) + 1
            key_f = new_funnel or "（未判定）"
            stats["funnel"][key_f] = stats["funnel"].get(key_f, 0) + 1

            if budget is None or funnel is None:
                undecided.append(f"  {ext}  budget={b_why} / funnel={f_why}  {decode_entities(title)[:60]}")

            if as_csv:
                safe = decode_entities(title).replace('"', "'")
                print(f'{ext},{new_budget},"{b_why}",{new_funnel or ""},"{f_why}","{safe}"')

            if new_budget != cur_budget or new_funnel != cur_funnel:
                changes.append((cid, ext, cur_budget, new_budget, cur_funnel, new_funnel))

        if as_csv:
            return 0

        log(f"対象記事: {len(rows)}件")
        log("")
        log("── budgetTier（買い手の予算規模）──")
        for k in ("high", "mid", "low", "unknown"):
            n = stats["budget"].get(k, 0)
            log(f"  {k:8} {n:4}件  {'█' * (n * 40 // max(1, len(rows)))}")
        log("")
        log("── funnelStage（読者がどこにいるか）──")
        for k in ("awareness", "comparison", "product_deep", "decision", "（未判定）"):
            n = stats["funnel"].get(k, 0)
            log(f"  {k:12} {n:4}件  {'█' * (n * 40 // max(1, len(rows)))}")

        if undecided:
            log("")
            log(f"── ★判定できなかったもの（{len(undecided)}件・unknown/null のまま残す）──")
            for line in undecided[:20]:
                log(line)
            if len(undecided) > 20:
                log(f"  … 他 {len(undecided) - 20}件")

        log("")
        log(f"変更対象: {len(changes)}件")
        if not apply_changes:
            log("")
            log("★これは dry-run です。全件を確認するには:")
            log("    python3 scripts/tag-buyer-axis.py --csv > /tmp/tags.csv")
            log("★書き込むには --apply を付けてください。")
            return 0

        for cid, _ext, _cb, nb, _cf, nf in changes:
            cur.execute(
                'UPDATE "ContentItem" SET "budgetTier"=%s, "funnelStage"=%s, "updatedAt"=now() WHERE id=%s',
                (nb, nf, cid),
            )
        conn.commit()
        log(f"✅ {len(changes)}件を更新しました")

    return 0


if __name__ == "__main__":
    sys.exit(main())
