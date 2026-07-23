#!/usr/bin/env python3
"""GSC page×query の取得（記事が「実際に何で検索されて表示されたか」）

★なぜ要るか（2026-07-23）
  179記事すべてで mainKeyword が空だった。埋める材料がどこにも無かったからで、
  gsc_daily.py は ["date"] と ["page","date"] しか取っておらず、
  **どの検索語で来ているか**を一度も保存していなかった。

  既存の Keyword(420件) はラッコの調査KW＝「狙っているKW」。
  こちらは「実際に来ているKW」。**両者は一致しない**。
  そのズレ自体が打ち手になる（狙っていないKWで大量に表示されている等）。

★なぜ日次にしないか
  page×query の日次は行数が跳ね、大半は0〜1表示のノイズになる。GSC側も
  日次×query では閾値で行が落ちる。**期間の集計スナップショット**として持つ。
  期間を列に持つので「いつの何日間か」が必ず分かる（§3 未計測との区別）。

★position は期間内の平均（GSCの定義）。加重平均ではないので合算してはいけない。

必要な環境変数:
    GOOGLE_APPLICATION_CREDENTIALS  サービスアカウント鍵JSONのパス
    MMS_GSC_SITE_URL                例: https://asset-support.co.jp/
    MMS_DATABASE_URL

任意:
    MMS_GSC_QUERY_WINDOW_DAYS       集計期間の日数（既定 90）

冪等: (contentItemId, query, periodStart, periodEnd) の一意制約で upsert。
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
SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]

# GSC は反映に2〜3日かかる（docs/RULES.md §3-6）
LAG_DAYS = 3
DEFAULT_WINDOW_DAYS = 90

now_ts = datetime.now(JST)


def log(msg: str) -> None:
    print(f"[gsc_queries] {msg}", flush=True)


# ★DBセッションを UTC に固定する（gsc_daily.py と同じ理由）。
#   compose の TimeZone は Asia/Tokyo なので、固定しないと now() が JST で入り、
#   Prisma が UTC として読んで9時間ずれる。
def use_utc(conn) -> None:
    with conn.cursor() as c:
        c.execute("SET TIME ZONE 'UTC'")


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
            f"GOOGLE_APPLICATION_CREDENTIALS が未設定、またはファイルがありません: {key_path!r}"
        )
    creds = service_account.Credentials.from_service_account_file(key_path, scopes=SCOPES)
    return build("searchconsole", "v1", credentials=creds, cache_discovery=False)


def query_gsc(svc, site: str, start: date, end: date) -> list[dict]:
    """page×query をページングしながら全件取得する。"""
    rows: list[dict] = []
    start_row = 0
    while True:
        body = {
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "dimensions": ["page", "query"],
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


def upsert(conn, rows: list[dict], start: date, end: date) -> tuple[int, int, int]:
    with conn.cursor() as cur:
        cur.execute('SELECT "url","id" FROM "ContentItem" WHERE "url" IS NOT NULL')
        by_url = {u.rstrip("/"): i for u, i in cur.fetchall()}

        batch = []
        skipped = 0
        pages = set()
        for r in rows:
            page, q = r["keys"][0], r["keys"][1]
            item = by_url.get(page.rstrip("/"))
            if not item:
                # ★記事レコードが無いURL（サイトページ等）。捨てた事実は件数で返す
                skipped += 1
                continue
            pages.add(item)
            batch.append(
                (
                    nid("cq"),
                    item,
                    q,
                    int(r.get("clicks") or 0),
                    int(r.get("impressions") or 0),
                    r.get("ctr"),
                    r.get("position"),
                    start,
                    end,
                    now_ts,
                    now_ts,
                )
            )
        cur.executemany(
            """
            INSERT INTO "ContentQuery"
              ("id","contentItemId","query","clicks","impressions","ctr","position",
               "periodStart","periodEnd","createdAt","updatedAt")
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT ("contentItemId","query","periodStart","periodEnd")
            DO UPDATE SET
              "clicks"=EXCLUDED."clicks",
              "impressions"=EXCLUDED."impressions",
              "ctr"=EXCLUDED."ctr",
              "position"=EXCLUDED."position",
              "updatedAt"=EXCLUDED."updatedAt"
            """,
            batch,
        )
    conn.commit()
    return len(batch), skipped, len(pages)


def ensure_coverage(conn, start: date, end: date) -> None:
    """計測開始を1度だけ記録する（§3）。無いと 0 が未計測か実測ゼロか区別できない。"""
    with conn.cursor() as cur:
        cur.execute('SELECT 1 FROM "MeasurementCoverage" WHERE metric=%s', ("content_query",))
        if cur.fetchone():
            return
        cur.execute(
            """
            INSERT INTO "MeasurementCoverage"
              ("id","metric","startedAt","method","note","createdAt","updatedAt")
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                nid("mc"),
                "content_query",
                now_ts,
                "gsc_api",
                f"GSC page×query。初回取得は {start}〜{end}",
                now_ts,
                now_ts,
            ),
        )
    conn.commit()


def main() -> int:
    site = os.environ.get("MMS_GSC_SITE_URL")
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not site:
        raise RuntimeError("MMS_GSC_SITE_URL が未設定です（例: https://asset-support.co.jp/）")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    window = int(os.environ.get("MMS_GSC_QUERY_WINDOW_DAYS") or DEFAULT_WINDOW_DAYS)
    end = now_ts.date() - timedelta(days=LAG_DAYS)
    start = end - timedelta(days=window - 1)

    log(f"site={site} 期間={start}〜{end}（{window}日）")
    svc = gsc_client()
    rows = query_gsc(svc, site, start, end)
    log(f"GSC から {len(rows)} 行")

    with psycopg.connect(normalize_dsn(dsn)) as conn:
        use_utc(conn)
        n, skipped, pages = upsert(conn, rows, start, end)
        ensure_coverage(conn, start, end)

    log(f"保存 {n} 行 / 記事 {pages} 本 / 記事レコード無しで除外 {skipped} 行")
    return 0


if __name__ == "__main__":
    sys.exit(main())
