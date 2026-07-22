#!/usr/bin/env python3
"""GSC 日次取得（設計書 §3.2.2 / §5.1 日次07:00）

    「日次ジョブは『最終取得日〜昨日』の欠けている日を毎回チェックして埋める。
      1日失敗しても翌日に自動回復する」
    「★GSC APIは16ヶ月しか遡れない。自前DBに貯め続けることだけが唯一の長期履歴」

★既存の gsc-fetch.py は Notion へ書くが、Notion は廃止方針（§7）なので
  MMS 用に Postgres へ直接書く実装をここに持つ。GSC API の叩き方は同等。

必要な環境変数:
    GOOGLE_APPLICATION_CREDENTIALS  サービスアカウント鍵JSONのパス
    MMS_GSC_SITE_URL                例: https://asset-support.co.jp/
    MMS_DATABASE_URL

冪等: ContentMetric / MetricSnapshot は一意制約で upsert。
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
from google.oauth2 import service_account
from googleapiclient.discovery import build

JST = timezone(timedelta(hours=9), "JST")

# ★DBセッションのタイムゾーンを UTC に固定する（2026-07-22）
#
#   Prisma は UTC を `timestamp without time zone` の列に書き、読むときも
#   UTC として解釈して表示時に JST へ直す。
#   一方 psycopg 経由の書き込みは、Postgres がセッションの TimeZone
#   （compose で Asia/Tokyo）で naive 化するため **JST が入っていた**。
#   SQL の now() も同じ理由でずれる。同じ列に UTC と JST が混ざり、
#   Prisma 側で 9時間ずれた値になっていた（MeasurementCoverage.startedAt で発覚）。
#
#   接続直後に一度 UTC へ固定すれば、aware な日時も now() も UTC で入る。
def use_utc(conn) -> None:
    with conn.cursor() as c:
        c.execute("SET TIME ZONE 'UTC'")
SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]
# GSC は反映に2〜3日かかる（docs/RULES.md §3-6）。昨日までを対象に、
# 既存日も上書きして遅れて確定した数値を取り込む。
LAG_DAYS = 3
MAX_BACKFILL_DAYS = 90  # 初回や長期停止時の取り過ぎを防ぐ

now_ts = datetime.now(JST)


def log(msg: str) -> None:
    print(f"[gsc_daily] {msg}", flush=True)


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


def gsc_client():
    key_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not key_path or not os.path.exists(key_path):
        raise RuntimeError(
            "GOOGLE_APPLICATION_CREDENTIALS が未設定、またはファイルがありません: "
            f"{key_path!r}"
        )
    creds = service_account.Credentials.from_service_account_file(key_path, scopes=SCOPES)
    return build("searchconsole", "v1", credentials=creds, cache_discovery=False)


def query_gsc(svc, site: str, start: date, end: date, dimensions: list[str]) -> list[dict]:
    """searchAnalytics.query をページングしながら全件取得する。"""
    rows: list[dict] = []
    start_row = 0
    while True:
        body = {
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "dimensions": dimensions,
            "rowLimit": 25000,
            "startRow": start_row,
            "type": "web",
        }
        res = svc.searchanalytics().query(siteUrl=site, body=body).execute()
        batch = res.get("rows", [])
        rows.extend(batch)
        if len(batch) < 25000:
            break
        start_row += len(batch)
    return rows


def last_measured(conn, table: str) -> date | None:
    with conn.cursor() as cur:
        cur.execute(f'SELECT max("date") FROM "{table}" WHERE metric=%s', ("clicks",))
        v = cur.fetchone()[0]
    return v


def upsert_site(conn, rows: list[dict]) -> int:
    with conn.cursor() as cur:
        cur.execute(
            'SELECT b.id, c.id FROM "Business" b JOIN "Channel" c ON c."businessId"=b.id '
            "WHERE b.slug=%s LIMIT 1",
            (os.environ.get("MMS_DEFAULT_BUSINESS_SLUG", "tax-saving-agency"),),
        )
        got = cur.fetchone()
        if not got:
            raise RuntimeError("Business/Channel が見つかりません")
        business_id, channel_id = got

        batch = []
        for r in rows:
            d = datetime.strptime(r["keys"][0], "%Y-%m-%d").date()
            for metric, val in (
                ("clicks", r.get("clicks")),
                ("impressions", r.get("impressions")),
                ("position", r.get("position")),
            ):
                if val is None:
                    continue
                batch.append(
                    (nid("ms"), business_id, channel_id, metric, float(val), d, now_ts, now_ts)
                )
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


def upsert_pages(conn, rows: list[dict]) -> tuple[int, int]:
    with conn.cursor() as cur:
        cur.execute('SELECT "url","id" FROM "ContentItem" WHERE "url" IS NOT NULL')
        by_url = {u.rstrip("/"): i for u, i in cur.fetchall()}

        batch = []
        skipped = 0
        for r in rows:
            page, day = r["keys"][0], r["keys"][1]
            item = by_url.get(page.rstrip("/"))
            if not item:
                skipped += 1
                continue
            d = datetime.strptime(day, "%Y-%m-%d").date()
            for metric, val in (
                ("clicks", r.get("clicks")),
                ("impressions", r.get("impressions")),
                ("position", r.get("position")),
            ):
                if val is None:
                    continue
                batch.append((nid("cm"), item, metric, float(val), d, now_ts, now_ts))
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
    return len(batch), skipped


def main() -> int:
    site = os.environ.get("MMS_GSC_SITE_URL")
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not site:
        raise RuntimeError("MMS_GSC_SITE_URL が未設定です（例: https://asset-support.co.jp/）")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    end = (now_ts - timedelta(days=1)).date()  # 昨日まで
    svc = gsc_client()

    with psycopg.connect(normalize_dsn(dsn)) as conn:
        last = last_measured(conn, "ContentMetric")
        if last:
            # 最終取得日の LAG_DAYS 前から取り直す（遅れて確定する数値を上書き）
            start = last - timedelta(days=LAG_DAYS)
        else:
            start = end - timedelta(days=27)
        floor = end - timedelta(days=MAX_BACKFILL_DAYS)
        if start < floor:
            start = floor
        if start > end:
            log(f"取得対象なし（最終 {last} / 対象末 {end}）")
            return 0

        log(f"取得: {start} 〜 {end}（サイト全体 + 記事別）")
        site_rows = query_gsc(svc, site, start, end, ["date"])
        page_rows = query_gsc(svc, site, start, end, ["page", "date"])

        n_site = upsert_site(conn, site_rows)
        n_page, skipped = upsert_pages(conn, page_rows)

        log(
            f"MetricSnapshot {n_site}行 / ContentMetric {n_page}行 "
            f"（URL未登録スキップ {skipped}行）"
        )
        new_last = last_measured(conn, "ContentMetric")
        log(f"最新実測日: {new_last}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 — 失敗理由を JobRun に残す
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
