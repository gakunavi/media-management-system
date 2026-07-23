#!/usr/bin/env python3
"""記事のメインKWを**実測から**決める（P4.9）

★なぜ実測から決めるか
  179記事すべてで mainKeyword が空だった。埋める材料が無かったからで、
  GSC の page×query を一度も保存していなかった（→ builtin/gsc_queries.py で解決）。

  ここで「狙っていたKW」を人が入力するのではなく、**実際に一番クリックを
  集めている検索語**をメインKWとする。狙いと実測がズレている記事こそが
  リライトの対象なので、実測を正にしないと発見できない。

★カニバリはここで初めて見える
  KeywordAssignment の一意制約は (keywordId, role) で、1つのKWに main は1記事だけ。
  同じ検索語が2記事以上のトップになっていたら、それは**カニバリ**である。
  黙って片方を落とさず、必ず一覧に出す（§3 捨てた事実を隠さない）。

★判定できないものは埋めない（§3）
  ContentQuery が1行も無い記事（検索流入ゼロ）は空のままにする。
  さらに **根拠が薄いものも埋めない**。最初の試行では、クリック0・表示1回の
  ノイズ検索語（例:「"設立 2026年"」）が記事のメインKWになっていた。
  表示1回は「その記事が何のKWで戦っているか」の証拠にならない。
  → クリック1以上、または表示10以上を要求する（MIN_CLICKS / MIN_IMPRESSIONS）。

使い方:
  python3 scripts/derive-main-keywords.py            # dry-run
  python3 scripts/derive-main-keywords.py --apply    # 書き込む
"""

from __future__ import annotations

import os
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

JST = timezone(timedelta(hours=9), "JST")
now_ts = datetime.now(JST)

# ★根拠の下限。これを下回るものはメインKWにしない（§3 推測で埋めない）
MIN_CLICKS = 1
MIN_IMPRESSIONS = 10


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


def nid(p: str) -> str:
    return f"{p}_{uuid.uuid4().hex}"


def slugify(s: str) -> str:
    """Keyword.slug 用。日本語は残らないので、消えたときは hash で埋める。"""
    base = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return base[:60] if base else "kw-" + uuid.uuid5(uuid.NAMESPACE_URL, s).hex[:12]


def decode_entities(s: str) -> str:
    s = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))), s)
    return s.replace("&amp;", "&")


def main() -> int:
    apply_changes = "--apply" in sys.argv

    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute("SET TIME ZONE 'UTC'")

        # 最新の集計期間だけを見る（古い期間が混ざると順位が入れ替わる）
        cur.execute('SELECT max("periodEnd") FROM "ContentQuery"')
        period_end = cur.fetchone()[0]
        if period_end is None:
            log("★ContentQuery が空です。先に builtin/gsc_queries.py を実行してください")
            return 1

        # 記事ごとのトップKW（クリック優先・同数なら表示回数）
        cur.execute(
            """
            SELECT DISTINCT ON (cq."contentItemId")
                   cq."contentItemId", ci."externalId", ci.title,
                   cq.query, cq.clicks, cq.impressions, cq.position,
                   ci."mainKeywordId"
            FROM "ContentQuery" cq
            JOIN "ContentItem" ci ON ci.id = cq."contentItemId"
            WHERE cq."periodEnd" = %s
            ORDER BY cq."contentItemId", cq.clicks DESC, cq.impressions DESC, cq.query
            """,
            (period_end,),
        )
        all_tops = cur.fetchall()

        # ★根拠が薄いものを落とす。落とした事実は件数で必ず出す
        tops = [t for t in all_tops if t[4] >= MIN_CLICKS or t[5] >= MIN_IMPRESSIONS]
        weak = [t for t in all_tops if t not in tops]

        cur.execute('SELECT id FROM "Business" WHERE slug=%s',
                    (os.environ.get("MMS_DEFAULT_BUSINESS_SLUG") or "tax-saving-agency",))
        row = cur.fetchone()
        if not row:
            raise RuntimeError("Business が見つかりません")
        business_id = row[0]

        cur.execute('SELECT keyword, id FROM "Keyword" WHERE "businessId"=%s', (business_id,))
        kw_ids = {k: i for k, i in cur.fetchall()}

        # ── カニバリ検出: 同じ検索語が2記事以上のトップになっている ──
        by_query: dict[str, list] = {}
        for t in tops:
            by_query.setdefault(t[3], []).append(t)

        winners = []
        cannibal = []
        for q, group in by_query.items():
            group.sort(key=lambda r: (-r[4], -r[5]))
            winners.append(group[0])
            if len(group) > 1:
                cannibal.append((q, group))

        log(f"対象期間: 〜{period_end}")
        log(f"検索流入のある記事: {len(all_tops)}本")
        log(f"　うち根拠が薄く見送り: {len(weak)}本"
            f"（クリック{MIN_CLICKS}未満かつ表示{MIN_IMPRESSIONS}未満）")
        log(f"メインKWを決められる記事: {len(winners)}本")
        log(f"新規に作る Keyword: {len({w[3] for w in winners} - set(kw_ids))}件")

        if cannibal:
            log("")
            log(f"── ★カニバリ（同じ検索語で複数記事が上位になっている）{len(cannibal)}件 ──")
            for q, group in sorted(cannibal, key=lambda x: -sum(r[4] for r in x[1]))[:10]:
                log(f"  「{q}」")
                for r in group:
                    mark = "  ← main" if r is group[0] else "        "
                    log(
                        f"    {r[1]} clicks={r[4]:3} imp={r[5]:5} pos={r[6]:5.1f}{mark}"
                        f"  {decode_entities(r[2])[:40]}"
                    )
            if len(cannibal) > 10:
                log(f"  … 他 {len(cannibal) - 10}件")

        if weak:
            log("")
            log(f"── 根拠が薄いので空のまま残す（{len(weak)}本）──")
            for t in weak[:8]:
                log(f"  {t[1]}  最上位「{t[3]}」 clicks={t[4]} imp={t[5]}")
            if len(weak) > 8:
                log(f"  … 他 {len(weak) - 8}本")

        if not apply_changes:
            log("")
            log("★これは dry-run です。--apply で書き込みます。")
            return 0

        created_kw = 0
        for w in winners:
            content_id, _ext, _title, q, _c, _i, _p, _cur_main = w
            kid = kw_ids.get(q)
            if not kid:
                kid = nid("kw")
                cur.execute(
                    """
                    INSERT INTO "Keyword"
                      ("id","businessId","keyword","slug","createdAt","updatedAt")
                    VALUES (%s,%s,%s,%s,%s,%s)
                    ON CONFLICT ("businessId","keyword") DO NOTHING
                    """,
                    (kid, business_id, q, slugify(q), now_ts, now_ts),
                )
                if cur.rowcount == 0:
                    cur.execute(
                        'SELECT id FROM "Keyword" WHERE "businessId"=%s AND keyword=%s',
                        (business_id, q),
                    )
                    kid = cur.fetchone()[0]
                else:
                    created_kw += 1
                kw_ids[q] = kid

            # ★ContentItem.mainKeywordId と KeywordAssignment(main) は
            #   二重の正になりうる（§13 記録済）ので、必ず同じ処理で同時に書く。
            cur.execute(
                'UPDATE "ContentItem" SET "mainKeywordId"=%s, "updatedAt"=%s WHERE id=%s',
                (kid, now_ts, content_id),
            )
            cur.execute(
                """
                INSERT INTO "KeywordAssignment"
                  ("id","keywordId","contentItemId","role","createdAt","updatedAt")
                VALUES (%s,%s,%s,'main',%s,%s)
                ON CONFLICT ("keywordId","role")
                DO UPDATE SET "contentItemId"=EXCLUDED."contentItemId","updatedAt"=EXCLUDED."updatedAt"
                """,
                (nid("ka"), kid, content_id, now_ts, now_ts),
            )
        conn.commit()
        log("")
        log(f"✅ メインKWを {len(winners)}本に設定（Keyword 新規 {created_kw}件）")

    return 0


if __name__ == "__main__":
    sys.exit(main())
