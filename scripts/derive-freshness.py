#!/usr/bin/env python3
"""記事の鮮度階層を決め、次回見直し期限を計算する（cowork 回答 2026-07-23 反映版）

★どこにも記録が無いことを確認済み
  `FRESHNESS_TIER` は PRJ-030 の設計書1ファイルにしか存在せず未実装。
  cowork の台帳CSVも鮮度列は全175行が空だった。だから**ここで決める**。

★cowork の実運用ノウハウで、当初案から3点直した
  1. **リスク記事(C柱)を「商用60〜90日」に入れない。**
     当初案は商材・比較と同じ扱いにしていたが、C柱は制度・構造の解説で
     時事性が低い。実測でも intervention 9件中**リスク記事は0件**＝
     公開後に一度もリライトされていない。→ reference(12ヶ月)＋法改正トリガ。
  2. **90日は「全商材を定期的に回す」意味ではない。**
     実態は「CTR不全が出た記事だけの事後対応」。全商材を75日で回すと
     処理能力（週2〜3本）を超える。→ 期限は**督促を出す境界**に留め、
     実着手は CTR トリガと重なった記事に絞る二段構え。
  3. 既定75日 → **90日**（cowork の修正版数字）。

★AioTier(hot/warm/cold/none) とは別軸
  AioTier は「AI検索での引用をどの頻度で**計測**するか」。
  FreshnessTier は「記事をどの間隔で**見直す**か」。
  同じ Tier という語だが測っているものが違う。混ぜない。

★lastReviewedAt が無い記事は期限を出さない（§3）
  「見直し期限が未定」と「今すぐ見直すべき」は別物。
  基準日が無いものを overdue にすると、督促が意味を失う。

使い方:
  python3 scripts/derive-freshness.py            # dry-run
  python3 scripts/derive-freshness.py --apply
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import psycopg
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

JST = timezone(timedelta(hours=9), "JST")
now_ts = datetime.now(JST)
TODAY = now_ts.date()

# cowork 修正版のケイデンス（2026-07-23）
INTERVALS = {
    "breaking": (0, "速報・税制改正。随時（法改正イベント駆動）"),
    "commercial": (90, "商材・比較。90日目安＋CTR不全トリガ併用（全件を定期に回す意味ではない）"),
    "evergreen": (180, "Pillar・実務手順。6ヶ月"),
    "reference": (365, "制度・リスク中立。12ヶ月＋法改正トリガ"),
}

# 記事の型 → 鮮度階層
#   ★リスクを commercial に入れない（cowork 指摘・実測でリライト0件）
BY_FORMAT = {
    "news": "breaking",
    "product": "commercial",
    "comparison": "commercial",
    "howto": "evergreen",
    "case_study": "evergreen",
    "system": "reference",
    "risk": "reference",
}

DUE_SOON_DAYS = 30  # 期限の30日前から due_soon（§7.5.2）


def log(m: str) -> None:
    print(m, flush=True)


def normalize_dsn(url: str) -> str:
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = params.pop("schema", None)
    if schema:
        params.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(params, safe="-%"), parts.fragment)
    )


def main() -> int:
    apply_changes = "--apply" in sys.argv
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute("SET TIME ZONE 'UTC'")
        cur.execute(
            'SELECT id, "externalId", "contentFormat"::text, "isPillar", "lastReviewedAt"'
            ' FROM "ContentItem" WHERE type IN (\'article\',\'article_unlinked\')'
        )
        rows = cur.fetchall()

        tiers: dict[str, list] = {}
        undecided = []
        for cid, ext, fmt, is_pillar, reviewed in rows:
            # ★Pillar は型より優先（ハブは腐りにくく、頻繁に触ると逆効果）
            tier = "evergreen" if is_pillar else BY_FORMAT.get(fmt or "")
            if tier is None:
                undecided.append(ext)
                continue
            tiers.setdefault(tier, []).append((cid, ext, tier, reviewed))

        log(f"対象記事: {len(rows)}本")
        for t, (days, desc) in INTERVALS.items():
            n = len(tiers.get(t, []))
            log(f"  {t:11} {days:4}日  {n:3}本  {desc}")
        log(f"★型が未分類で決められない: {len(undecided)}本（空のまま残す）")

        # 期限の計算
        due_soon, overdue, fresh, no_base = [], [], [], []
        for t, items in tiers.items():
            days = INTERVALS[t][0]
            for cid, ext, _t, reviewed in items:
                if reviewed is None:
                    no_base.append(ext)
                    continue
                if days == 0:
                    # ★随時＝期限で督促しない。法改正イベントで起票する
                    fresh.append((cid, ext, None))
                    continue
                due = reviewed.date() + timedelta(days=days)
                if due <= TODAY:
                    overdue.append((cid, ext, due))
                elif due - timedelta(days=DUE_SOON_DAYS) <= TODAY:
                    due_soon.append((cid, ext, due))
                else:
                    fresh.append((cid, ext, due))

        log("")
        log("── 見直し期限 ──")
        log(f"  期限切れ(overdue): {len(overdue)}本")
        log(f"  まもなく(due_soon): {len(due_soon)}本")
        log(f"  まだ先(fresh)     : {len(fresh)}本")
        log(f"  ★基準日が無く期限を出せない: {len(no_base)}本（未定として残す）")

        if overdue:
            log("")
            log("  期限切れの上位（古い順）:")
            for cid, ext, due in sorted(overdue, key=lambda x: x[2])[:10]:
                log(f"    {ext}  期限 {due}（{(TODAY - due).days}日超過）")

        # ★処理能力との突き合わせ（cowork: 週2〜3本＝月8〜12本）
        if len(overdue) > 12:
            log("")
            log(f"  ★期限切れ {len(overdue)}本は処理能力（週2〜3本）を大きく超える。")
            log("    全部を赤で出すと誰も見なくなる。画面では")
            log("    **CTR不全（順位10〜14位×表示あり×クリック0）と重なった記事**を先に出す。")

        if not apply_changes:
            log("")
            log("★これは dry-run です。--apply で書き込みます。")
            return 0

        for tier, (days, desc) in INTERVALS.items():
            cur.execute(
                'UPDATE "FreshnessRule" SET "intervalDays"=%s, description=%s, "updatedAt"=%s'
                ' WHERE "freshnessTier"=%s::"FreshnessTier"',
                (days, desc, now_ts, tier),
            )

        n = 0
        for t, items in tiers.items():
            days = INTERVALS[t][0]
            for cid, ext, _t, reviewed in items:
                due = None
                state = "fresh"
                if reviewed is not None and days > 0:
                    d = reviewed.date() + timedelta(days=days)
                    due = datetime(d.year, d.month, d.day, tzinfo=JST)
                    if d <= TODAY:
                        state = "overdue"
                    elif d - timedelta(days=DUE_SOON_DAYS) <= TODAY:
                        state = "due_soon"
                cur.execute(
                    'UPDATE "ContentItem" SET "freshnessTier"=%s::"FreshnessTier",'
                    ' "nextReviewDue"=%s, "reviewState"=%s::"ReviewState", "updatedAt"=%s'
                    " WHERE id=%s",
                    (t, due, state, now_ts, cid),
                )
                n += 1
        conn.commit()
        log("")
        log(f"✅ 鮮度階層 {n}本 / 期限 {len(overdue) + len(due_soon) + len([f for f in fresh if f[2]])}本")

    return 0


if __name__ == "__main__":
    sys.exit(main())
