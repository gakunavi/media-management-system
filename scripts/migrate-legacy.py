#!/usr/bin/env python3
"""P1: 既存データ移行（media.db / timeseries.db → PostgreSQL）

設計書の根拠:
  §6    media.db（14テーブル）/ timeseries.db を初回移行スクリプトで Postgres へ投入
  §3.2.2 **初回に既存データを全移行**。過去3ヶ月を失わない
  §3.2.2 日次を永久保持。GSC APIは16ヶ月しか遡れないため自前DBが唯一の長期履歴

使い方:
    python3 scripts/migrate-legacy.py            # 実行
    python3 scripts/migrate-legacy.py --dry-run  # 件数だけ確認

★冪等。何度実行しても同じ状態になる（全て upsert）。
★最後に「移行元の行数 vs 移行先の行数」の突合表を出す（P1 の完了条件）。
"""

from __future__ import annotations

import argparse
import os
import re
import sqlite3
import sys
import unicodedata
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
from psycopg.types.json import Jsonb

JST = timezone(timedelta(hours=9), "JST")  # docs/RULES.md §9

MEDIA_ROOT = os.environ.get(
    "MMS_LEGACY_MEDIA_ROOT",
    "/Users/ishiimasataka/Documents/Claude/Projects/メディア事業部",
)
MEDIA_DB = os.path.join(MEDIA_ROOT, "tools/media-console/media.db")
TIMESERIES_DB = os.path.join(MEDIA_ROOT, "shared/gsc-data/timeseries.db")

BUSINESS_SLUG = "tax-saving-agency"
BUSINESS_NAME = "節税商材代理店事業"
CHANNEL_TYPE = "media"
CHANNEL_ACCOUNT = "asset-support.co.jp"

# ts.intervention.intervention_type → Action.type（ActionType enum）
# ★設計書の打ち手タイプ（§5.2）に「本文リライト」に相当する値が無い。
#   元の値は Intervention.type と Action.rationale に原文のまま保存して失わない。
#   → docs/PHASES.md §8 U40
LEGACY_ACTION_TYPE = {
    "title-meta-rewrite": "title_meta_rewrite",
    "rewrite": "title_meta_rewrite",
    "meta-update": "title_meta_rewrite",
    "new-publish": "new_article",
    "cta-update": "cta_variant",
}

now_ts = datetime.now(JST)


def normalize_dsn(url: str) -> str:
    """Prisma の `?schema=` を libpq が解釈できる形に直す（worker.py と同じ処理）。"""
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = params.pop("schema", None)
    if schema:
        params.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(params, safe="-%"), parts.fragment)
    )


def nid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def to_date(v) -> date | None:
    if not v:
        return None
    s = str(v).strip()[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def num(v) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def slugify(text: str) -> str:
    s = unicodedata.normalize("NFKC", text).strip().lower()
    s = re.sub(r"\s+", "-", s)
    return re.sub(r"-{2,}", "-", s)[:180] or "kw"


def open_sqlite(path: str) -> sqlite3.Connection:
    if not os.path.exists(path):
        sys.exit(f"移行元が見つかりません: {path}")
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    return c


# ════════════════════════════════════════════════════════════════════
#  移行本体
# ════════════════════════════════════════════════════════════════════


class Migrator:
    def __init__(self, pg, media, ts):
        self.pg = pg
        self.media = media
        self.ts = ts
        self.stats: list[tuple[str, str, int, int]] = []  # (source, target, src, dst)
        self.item_by_slug: dict[str, str] = {}
        self.item_by_extid: dict[str, str] = {}
        self.pillar_slugs: set[str] = set()

    def report(self, source: str, target: str, src_n: int, dst_n: int) -> None:
        self.stats.append((source, target, src_n, dst_n))

    def count(self, sql: str, args=()) -> int:
        with self.pg.cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchone()[0]

    # ── 1. Business / Channel ──────────────────────────────────────
    def ensure_scaffold(self) -> None:
        with self.pg.cursor() as cur:
            cur.execute(
                """
                INSERT INTO "Business" ("id","slug","name","status","createdAt","updatedAt")
                VALUES (%s,%s,%s,'active',%s,%s)
                ON CONFLICT ("slug") DO UPDATE SET "name"=EXCLUDED."name","updatedAt"=EXCLUDED."updatedAt"
                RETURNING "id"
                """,
                (nid("biz"), BUSINESS_SLUG, BUSINESS_NAME, now_ts, now_ts),
            )
            self.business_id = cur.fetchone()[0]

            cur.execute(
                """
                INSERT INTO "Channel" ("id","businessId","type","accountRef","name","config","createdAt","updatedAt")
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT ("businessId","type","accountRef")
                DO UPDATE SET "name"=EXCLUDED."name","updatedAt"=EXCLUDED."updatedAt"
                RETURNING "id"
                """,
                (
                    nid("ch"),
                    self.business_id,
                    CHANNEL_TYPE,
                    CHANNEL_ACCOUNT,
                    "節税総研メディア",
                    Jsonb({"migratedFrom": "media.db"}),
                    now_ts,
                    now_ts,
                ),
            )
            self.channel_id = cur.fetchone()[0]
        self.pg.commit()

    # ── 2. ContentItem ─────────────────────────────────────────────
    def upsert_item(self, ext_id: str, **f) -> str:
        cols = {
            "id": nid("ci"),
            "channelId": self.channel_id,
            "externalId": ext_id,
            "createdAt": now_ts,
            "updatedAt": now_ts,
            **f,
        }
        names = ", ".join(f'"{k}"' for k in cols)
        holes = ", ".join(["%s"] * len(cols))
        upd = ", ".join(
            f'"{k}"=EXCLUDED."{k}"'
            for k in cols
            if k not in ("id", "channelId", "externalId", "createdAt")
        )
        with self.pg.cursor() as cur:
            cur.execute(
                f'INSERT INTO "ContentItem" ({names}) VALUES ({holes}) '
                f'ON CONFLICT ("channelId","externalId") DO UPDATE SET {upd} RETURNING "id"',
                list(cols.values()),
            )
            return cur.fetchone()[0]

    def migrate_articles(self) -> None:
        # timeseries の最新スナップショットから分類情報を拾う（media.db には無い）
        enrich: dict[str, sqlite3.Row] = {}
        for r in self.ts.execute("SELECT * FROM v_article_latest"):
            enrich[r["article_id"]] = r
        for r in self.ts.execute("SELECT article_id, pillar FROM v_article_latest WHERE pillar=1"):
            pass

        rows = list(self.media.execute("SELECT * FROM articles"))
        for a in rows:
            e = enrich.get(a["art_id"])
            aio = (e["aio_tier"] or "").strip().lower() if e else ""
            item_id = self.upsert_item(
                a["art_id"],
                type="article",
                title=a["title"] or a["slug"],
                url=a["url"],
                status=a["status"] or "publish",
                isPillar=bool(e["pillar"]) if e and e["pillar"] is not None else False,
                category=(e["category"] if e else None),
                charCount=a["chars"],
                wpPostId=a["wp_id"],
                publishedAt=to_date(a["published"]),
                aioTier=aio if aio in ("hot", "warm", "cold", "none") else "none",
                aioTracked=bool(e and e["aio_tier"]),
                note=f"P1移行: media.db articles (slug={a['slug']}, main_kw={a['main_kw'] or '-'})",
            )
            self.item_by_slug[a["slug"]] = item_id
            self.item_by_extid[a["art_id"]] = item_id
            if e and e["pillar"]:
                self.pillar_slugs.add(a["slug"])
        self.report("media.articles", "ContentItem(type=article)", len(rows), len(rows))

    def migrate_orphan_pages(self) -> None:
        """articles に無いが計測データがある URL を ContentItem として残す。

        ★捨てると GSC の実測履歴が失われる（§3.2.2「過去3ヶ月を失わない」）。
        """
        # ★計測データを持つ slug を「全ての出所」から集める。
        #   1箇所でも漏らすと、その分の実測履歴が移行されずに失われる。
        article_slugs: set[str] = set()
        for sql in (
            "SELECT DISTINCT slug FROM daily_page",
            "SELECT DISTINCT slug FROM daily_pv WHERE is_article=1",
            "SELECT DISTINCT slug FROM pv_lifetime",
        ):
            article_slugs |= {r["slug"] for r in self.media.execute(sql)}

        orphan_articles = sorted(article_slugs - set(self.item_by_slug))
        for slug in orphan_articles:
            self.item_by_slug[slug] = self.upsert_item(
                f"LEGACY-{slug}",
                type="article_unlinked",
                title=slug,
                url=f"https://{CHANNEL_ACCOUNT}/media/{slug}/",
                status="unknown",
                note="P1移行: daily_page に計測はあるが media.db articles に記事レコードが無い"
                "（改題・統合・削除された可能性）。実測履歴を失わないため保持する",
            )
        self.report("計測はあるが記事レコード無しのslug", "ContentItem(type=article_unlinked)",
                    len(orphan_articles), len(orphan_articles))

        # timeseries 側は art_id が主キー。slug では引けないので別途拾う
        weekly_ids = {r["article_id"] for r in self.ts.execute(
            "SELECT DISTINCT article_id FROM article_weekly WHERE article_id IS NOT NULL")}
        orphan_ids = sorted(weekly_ids - set(self.item_by_extid))
        for art_id in orphan_ids:
            self.item_by_extid[art_id] = self.upsert_item(
                art_id,
                type="article_unlinked",
                title=art_id,
                status="unknown",
                note="P1移行: timeseries.article_weekly に週次実績はあるが "
                     "media.db articles に記事レコードが無い art_id",
            )
        self.report("週次実績はあるが記事レコード無しのart_id", "ContentItem(type=article_unlinked)",
                    len(orphan_ids), len(orphan_ids))

        site_pages = [
            r["slug"]
            for r in self.media.execute("SELECT DISTINCT slug FROM daily_pv WHERE is_article=0")
            if r["slug"] not in self.item_by_slug
        ]
        for slug in site_pages:
            self.item_by_slug[slug] = self.upsert_item(
                f"PAGE-{slug}",
                type="site_page",
                title=slug,
                url=f"https://{CHANNEL_ACCOUNT}{slug}",
                status="publish",
                note="P1移行: 記事ではないサイトページ（/ /company/ /contact/ 等）のPV実績",
            )
        self.report("media.daily_pv の非記事ページ", "ContentItem(type=site_page)",
                    len(site_pages), len(site_pages))

    # ── 3. ContentMetric ───────────────────────────────────────────
    def put_metrics(self, batch: list[tuple[str, str, float, date]]) -> int:
        if not batch:
            return 0
        with self.pg.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO "ContentMetric" ("id","contentItemId","metric","value","date","createdAt","updatedAt")
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT ("contentItemId","metric","date")
                DO UPDATE SET "value"=EXCLUDED."value","updatedAt"=EXCLUDED."updatedAt"
                """,
                [
                    (nid("cm"), item, metric, val, d, now_ts, now_ts)
                    for item, metric, val, d in batch
                ],
            )
        self.pg.commit()
        return len(batch)

    def migrate_daily_page(self) -> None:
        rows = list(self.media.execute("SELECT * FROM daily_page"))
        batch, skipped = [], 0
        for r in rows:
            item = self.item_by_slug.get(r["slug"])
            d = to_date(r["date"])
            if not item or not d:
                skipped += 1
                continue
            for metric, v in (
                ("clicks", num(r["clicks"])),
                ("impressions", num(r["impressions"])),
                ("position", num(r["position"])),
            ):
                if v is not None:
                    batch.append((item, metric, v, d))
        n = self.put_metrics(batch)
        self.report("media.daily_page", "ContentMetric(clicks/impressions/position)",
                    len(rows), n // 3 if n else 0)

    def migrate_daily_pv(self) -> None:
        rows = list(self.media.execute("SELECT * FROM daily_pv"))
        batch = []
        for r in rows:
            item = self.item_by_slug.get(r["slug"])
            d = to_date(r["date"])
            v = num(r["pv"])
            if item and d and v is not None:
                batch.append((item, "pv", v, d))
        n = self.put_metrics(batch)
        self.report("media.daily_pv", "ContentMetric(pv)", len(rows), n)

    def migrate_pv_lifetime(self) -> None:
        rows = list(self.media.execute("SELECT * FROM pv_lifetime"))
        as_of = to_date(
            self.media.execute("SELECT MAX(date) d FROM daily_pv").fetchone()["d"]
        ) or now_ts.date()
        batch = []
        for r in rows:
            item = self.item_by_slug.get(r["slug"])
            v = num(r["pv"])
            if item and v is not None:
                batch.append((item, "pv_lifetime", v, as_of))
        n = self.put_metrics(batch)
        self.report("media.pv_lifetime", "ContentMetric(pv_lifetime)", len(rows), n)

    def migrate_article_weekly(self) -> None:
        """週次スナップショット。ContentMetric に granularity 列が無いため
        metric 名を weekly_* にして日次と混ざらないようにする。"""
        rows = list(self.ts.execute("SELECT * FROM article_weekly"))
        batch, skipped = [], 0
        for r in rows:
            item = self.item_by_extid.get(r["article_id"])
            d = to_date(r["snapshot_date"])
            if not item or not d:
                skipped += 1
                continue
            for col, metric in (
                ("rank", "weekly_rank"),
                ("clicks", "weekly_clicks"),
                ("impressions", "weekly_impressions"),
                ("ctr", "weekly_ctr"),
                ("pv", "weekly_pv"),
                ("pv7", "weekly_pv7"),
                ("lifetime_pv", "weekly_lifetime_pv"),
                ("aio_hit_rate", "weekly_aio_hit_rate"),
                ("aio_4week_hits", "weekly_aio_4week_hits"),
            ):
                v = num(r[col])
                if v is not None:
                    batch.append((item, metric, v, d))
        self.put_metrics(batch)
        migrated = len(rows) - skipped
        self.report("timeseries.article_weekly", "ContentMetric(weekly_*)", len(rows), migrated)
        if skipped:
            self.skipped_weekly = skipped

    def migrate_daily_site(self) -> None:
        rows = list(self.media.execute("SELECT * FROM daily_site"))
        batch = []
        for r in rows:
            d = to_date(r["date"])
            if not d:
                continue
            for metric, v in (
                ("clicks", num(r["clicks"])),
                ("impressions", num(r["impressions"])),
                ("position", num(r["position"])),
            ):
                if v is not None:
                    batch.append((metric, v, d))
        with self.pg.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO "MetricSnapshot"
                  ("id","businessId","channelId","metric","value","date","granularity","createdAt","updatedAt")
                VALUES (%s,%s,%s,%s,%s,%s,'daily',%s,%s)
                ON CONFLICT ("businessId","channelId","metric","date","granularity")
                DO UPDATE SET "value"=EXCLUDED."value","updatedAt"=EXCLUDED."updatedAt"
                """,
                [
                    (nid("ms"), self.business_id, self.channel_id, m, v, d, now_ts, now_ts)
                    for m, v, d in batch
                ],
            )
        self.pg.commit()
        self.report("media.daily_site", "MetricSnapshot(daily)", len(rows), len(rows))

    # ── 4. InternalLink ────────────────────────────────────────────
    def migrate_links(self) -> None:
        rows = list(self.media.execute("SELECT * FROM links"))
        batch = []
        for r in rows:
            src = self.item_by_slug.get(r["src_slug"])
            dst = self.item_by_slug.get(r["dst_slug"])
            if not src or not dst:
                continue
            sp = r["src_slug"] in self.pillar_slugs
            dp = r["dst_slug"] in self.pillar_slugs
            link_type = (
                "cross_pillar" if sp and dp
                else "pillar_to_cluster" if sp
                else "cluster_to_pillar" if dp
                else "cluster_to_cluster"
            )
            batch.append((nid("il"), src, dst, link_type))
        with self.pg.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO "InternalLink"
                  ("id","srcContentId","dstContentId","anchorText","contextSection","detectedAt","linkType","createdAt","updatedAt")
                VALUES (%s,%s,%s,NULL,NULL,%s,%s,%s,%s)
                ON CONFLICT ("srcContentId","dstContentId","anchorText")
                DO UPDATE SET "linkType"=EXCLUDED."linkType","updatedAt"=EXCLUDED."updatedAt"
                """,
                [(i, s, d, now_ts, t, now_ts, now_ts) for i, s, d, t in batch],
            )
        self.pg.commit()
        self.report("media.links", "InternalLink", len(rows), len(batch))

    # ── 5. Keyword / KeywordRanking ────────────────────────────────
    def migrate_query_weekly(self) -> None:
        rows = list(self.ts.execute("SELECT * FROM query_weekly"))
        kw_ids: dict[str, str] = {}
        with self.pg.cursor() as cur:
            for q in {r["query"] for r in rows}:
                cur.execute(
                    """
                    INSERT INTO "Keyword" ("id","businessId","keyword","slug","createdAt","updatedAt")
                    VALUES (%s,%s,%s,%s,%s,%s)
                    ON CONFLICT ("businessId","keyword") DO UPDATE SET "updatedAt"=EXCLUDED."updatedAt"
                    RETURNING "id"
                    """,
                    (nid("kw"), self.business_id, q, slugify(q), now_ts, now_ts),
                )
                kw_ids[q] = cur.fetchone()[0]

            batch = []
            for r in rows:
                d = to_date(r["snapshot_date"])
                if not d:
                    continue
                batch.append(
                    (
                        nid("kr"), kw_ids[r["query"]], d,
                        num(r["position"]) or 0.0,
                        int(num(r["clicks"]) or 0),
                        int(num(r["impressions"]) or 0),
                        num(r["ctr"]),
                        now_ts, now_ts,
                    )
                )
            cur.executemany(
                """
                INSERT INTO "KeywordRanking"
                  ("id","keywordId","date","position","clicks","impressions","ctr","createdAt","updatedAt")
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT ("keywordId","date")
                DO UPDATE SET "position"=EXCLUDED."position","clicks"=EXCLUDED."clicks",
                              "impressions"=EXCLUDED."impressions","ctr"=EXCLUDED."ctr",
                              "updatedAt"=EXCLUDED."updatedAt"
                """,
                batch,
            )
        self.pg.commit()
        # Keyword は「ユニークなクエリ数」が正。行数と比べても意味がない
        unique_queries = len({r["query"] for r in rows})
        self.report("timeseries.query_weekly のユニーククエリ", "Keyword",
                    unique_queries, len(kw_ids))
        self.report("timeseries.query_weekly", "KeywordRanking", len(rows), len(batch))

    # ── 6. Action / Intervention ───────────────────────────────────
    def migrate_interventions(self) -> None:
        rows = list(self.ts.execute("SELECT * FROM intervention ORDER BY intervention_id"))
        migrated = 0
        with self.pg.cursor() as cur:
            for r in rows:
                item = self.item_by_extid.get(r["article_id"])
                applied = to_date(r["intervention_date"])
                if not applied:
                    continue
                legacy_type = r["intervention_type"]
                action_type = LEGACY_ACTION_TYPE.get(legacy_type, "title_meta_rewrite")
                ext_key = f"legacy-intervention-{r['intervention_id']}"

                cur.execute(
                    """
                    INSERT INTO "Action"
                      ("id","businessId","type","title","rationale","impacts","proposedBy","state","createdAt","updatedAt")
                    VALUES (%s,%s,%s,%s,%s,%s,'migration:legacy','done',%s,%s)
                    ON CONFLICT DO NOTHING
                    RETURNING "id"
                    """,
                    (
                        f"act_{ext_key}",
                        self.business_id,
                        action_type,
                        f"[移行] {legacy_type} / {r['article_id']}",
                        (r["note"] or "")
                        + f"\n\n★移行時の原データ: intervention_type={legacy_type}"
                          f" (§5.2 の打ち手タイプに完全一致する値が無いため {action_type} に写像)",
                        ["clicks", "position"],
                        now_ts, now_ts,
                    ),
                )
                action_id = f"act_{ext_key}"

                cur.execute(
                    """
                    INSERT INTO "Intervention"
                      ("id","actionId","contentItemId","type","appliedAt","evaluateAt",
                       "baseline","result","verdict","createdAt","updatedAt")
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'pending',%s,%s)
                    ON CONFLICT ("actionId") DO UPDATE
                      SET "type"=EXCLUDED."type","appliedAt"=EXCLUDED."appliedAt",
                          "updatedAt"=EXCLUDED."updatedAt"
                    """,
                    (
                        f"itv_{ext_key}", action_id, item, legacy_type,
                        applied, applied + timedelta(days=28),
                        Jsonb({"legacySnapshotDate": r["pre_snapshot_date"]}),
                        Jsonb({"legacySnapshotDate": r["post_snapshot_date"]}),
                        now_ts, now_ts,
                    ),
                )
                migrated += 1
        self.pg.commit()
        self.report("timeseries.intervention", "Action + Intervention", len(rows), migrated)

    # ── 突合表 ─────────────────────────────────────────────────────
    def print_report(self) -> bool:
        print("\n" + "═" * 86)
        print(" P1 移行の突合（移行元の行数 vs 移行先）")
        print("═" * 86)
        print(f" {'移行元':<34} {'移行先':<38} {'元':>5} {'先':>5}")
        print("─" * 86)
        ok = True
        for src, dst, a, b in self.stats:
            mark = "OK " if a == b else "★差"
            if a != b:
                ok = False
            print(f" {mark}{src:<32} {dst:<38} {a:>5} {b:>5}")
        print("─" * 86)
        print(" 実際に DB に入った行数:")
        for t in ("ContentItem", "ContentMetric", "MetricSnapshot", "InternalLink",
                  "Keyword", "KeywordRanking", "Action", "Intervention"):
            print(f"   {t:<20} {self.count(f'SELECT count(*) FROM \"{t}\"'):>7}")
        print("═" * 86)
        return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        sys.exit("MMS_DATABASE_URL が未設定です")

    media, ts = open_sqlite(MEDIA_DB), open_sqlite(TIMESERIES_DB)
    print(f"移行元: {MEDIA_DB}\n        {TIMESERIES_DB}")

    if args.dry_run:
        for name, conn in (("media.db", media), ("timeseries.db", ts)):
            print(f"\n[{name}]")
            for t in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            ):
                n = conn.execute(f'SELECT count(*) FROM "{t["name"]}"').fetchone()[0]
                print(f"  {t['name']:<20} {n:>6}")
        return 0

    with psycopg.connect(normalize_dsn(dsn)) as pg:
        m = Migrator(pg, media, ts)
        m.ensure_scaffold()
        m.migrate_articles()
        m.migrate_orphan_pages()
        m.migrate_daily_page()
        m.migrate_daily_pv()
        m.migrate_pv_lifetime()
        m.migrate_article_weekly()
        m.migrate_daily_site()
        m.migrate_links()
        m.migrate_query_weekly()
        m.migrate_interventions()
        ok = m.print_report()

    print("\n★このスクリプトが移行しないもの（対象モデルが後続 Phase のため）:")
    print("   media.lp_funnel   (6)  → LandingPage / FunnelEvent … P2.5 / P2.9")
    print("   media.agency_lp   (20) → AgencyLead / Partner      … P5.6")
    print("   media.agency_master(0) → 空テーブル")
    print("   media.query_window(678)→ 期間集計（0/7/28/90日）の派生データ。")
    print("                            KeywordRanking は日付軸のため写像できない … P4.5 で再検討")
    print("   media.meta / ts.snapshot_meta → 移行メタ情報（業務データではない）")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
