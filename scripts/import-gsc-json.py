#!/usr/bin/env python3
"""GSC の取得結果（JSON）を MMS に取り込む（欠測の backfill・設計書 §3.2.2）

    「日次ジョブは『最終取得日〜昨日』の欠けている日を毎回チェックして埋める。
      1日失敗しても翌日に自動回復する」

使い方:
    python3 scripts/import-gsc-json.py --site  <site.json>   # dimensions=date
    python3 scripts/import-gsc-json.py --page  <page.json>   # dimensions=page,date

入力は GSC MCP / API の戻り値そのまま（{"result": "<json文字列>"} でも生JSONでも可）。

★冪等。ContentMetric / MetricSnapshot は一意制約で upsert される。
★URL が ContentItem に無い場合はスキップし件数を報告する（勝手に作らない）。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

JST = timezone(timedelta(hours=9), "JST")
now_ts = datetime.now(JST)


def normalize_dsn(url: str) -> str:
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = params.pop("schema", None)
    if schema:
        params.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(params, safe="-%"), parts.fragment)
    )


def load_rows(path: str) -> list[dict]:
    raw = json.load(open(path, encoding="utf-8"))
    if isinstance(raw, dict) and "result" in raw and isinstance(raw["result"], str):
        raw = json.loads(raw["result"])
    return raw["rows"]


def nid(p: str) -> str:
    return f"{p}_{uuid.uuid4().hex}"


def import_site(conn, rows: list[dict]) -> int:
    """サイト全体の日次 → MetricSnapshot"""
    with conn.cursor() as cur:
        cur.execute(
            'SELECT b.id, c.id FROM "Business" b JOIN "Channel" c ON c."businessId"=b.id '
            "WHERE b.slug='tax-saving-agency' LIMIT 1"
        )
        row = cur.fetchone()
        if not row:
            sys.exit("Business/Channel が見つかりません")
        business_id, channel_id = row

        batch = []
        for r in rows:
            d = datetime.strptime(r["date"], "%Y-%m-%d").date()
            for metric in ("clicks", "impressions", "position"):
                if r.get(metric) is None:
                    continue
                batch.append((nid("ms"), business_id, channel_id, metric, float(r[metric]), d, now_ts, now_ts))

        cur.executemany(
            """
            INSERT INTO "MetricSnapshot"
              ("id","businessId","channelId","metric","value","date","granularity","createdAt","updatedAt")
            VALUES (%s,%s,%s,%s,%s,%s,'daily',%s,%s)
            ON CONFLICT ("businessId","channelId","metric","date","granularity")
            DO UPDATE SET "value"=EXCLUDED."value","updatedAt"=EXCLUDED."updatedAt"
            """,
            batch,
        )
    conn.commit()
    return len(batch)


def import_page(conn, rows: list[dict]) -> tuple[int, int, set[str]]:
    """記事別の日次 → ContentMetric。URL で ContentItem に突合する。"""
    with conn.cursor() as cur:
        cur.execute('SELECT "url", "id" FROM "ContentItem" WHERE "url" IS NOT NULL')
        by_url = {u.rstrip("/"): i for u, i in cur.fetchall()}

        batch = []
        unknown: set[str] = set()
        for r in rows:
            key = r["page"].rstrip("/")
            item = by_url.get(key)
            if not item:
                unknown.add(r["page"])
                continue
            d = datetime.strptime(r["date"], "%Y-%m-%d").date()
            for metric in ("clicks", "impressions", "position"):
                if r.get(metric) is None:
                    continue
                batch.append((nid("cm"), item, metric, float(r[metric]), d, now_ts, now_ts))

        cur.executemany(
            """
            INSERT INTO "ContentMetric"
              ("id","contentItemId","metric","value","date","createdAt","updatedAt")
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT ("contentItemId","metric","date")
            DO UPDATE SET "value"=EXCLUDED."value","updatedAt"=EXCLUDED."updatedAt"
            """,
            batch,
        )
    conn.commit()
    return len(batch), len(rows), unknown


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", help="dimensions=date の JSON")
    ap.add_argument("--page", help="dimensions=page,date の JSON")
    args = ap.parse_args()

    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        sys.exit("MMS_DATABASE_URL が未設定です")

    with psycopg.connect(normalize_dsn(dsn)) as conn:
        if args.site:
            n = import_site(conn, load_rows(args.site))
            print(f"MetricSnapshot(daily): {n} 行を投入")
        if args.page:
            n, total, unknown = import_page(conn, load_rows(args.page))
            print(f"ContentMetric: {n} 行を投入（入力 {total} 行）")
            if unknown:
                print(f"★ContentItem に無い URL {len(unknown)} 件はスキップ:")
                for u in sorted(unknown)[:10]:
                    print(f"   {u}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
