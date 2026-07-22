#!/usr/bin/env python3
"""GA4 日次取得（PV と 診断LPのファネル）

★なぜ MMS が直接 GA4 を読むのか
  これまで PV は「GA4 → Notion（sync-ga4-pv-to-notion.py・週次）」の経路で入り、
  MMS の pv は 2026-07-13 を最後に9日間止まっていた。全ジョブ success のまま
  データだけが止まっており、誰も気づけなかった。

  GA4 は一次ソースを直接叩ける。dm-log.md やラッコのエクスポートと違い、
  間に人や別システムを挟む理由が無い。挟むと (1) 1週遅れる
  (2) 向こうの障害がこちらに伝播する の2つを引き受けることになる。

★取るもの
  1. 記事別PV        … ContentMetric.pv（日次）。ContentItem.url で突合
  2. 診断LPのファネル … MetricSnapshot（日次・サイト単位）
       lp_view_<変種> / lp_cta_click_<変種> / lp_form_submit_<変種>
       ★変種別に持つ。合計だけだと ABC の勝敗が出せない

★日次で取る理由
  週次スナップショットだと施策の28日判定に前後4点しか無く、
  対照群補正つきの netEffect を出す粒度に足りない（§5.3）。

環境変数:
  GA4_PROPERTY_ID
  MMS_GA4_CREDENTIALS             … GA4 用サービスアカウント鍵
      ★GSC 用（GOOGLE_APPLICATION_CREDENTIALS）とは別の鍵。
        同じ変数を使い回すと、どちらかが必ず権限不足で落ちる
  MMS_DATABASE_URL
  MMS_GA4_LOOKBACK_DAYS           … 既定 30（欠測を毎回埋め直す・§3.2.2）
"""

from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

JST = timezone(timedelta(hours=9), "JST")

# 診断LP の3パターン（cowork の lp-ab-weekly-report.py と同じ定義）
LP_VARIANTS = {
    "a": "/setsuzei-diagnosis-a/",
    "b": "/setsuzei-diagnosis-b/",
    "c": "/setsuzei-diagnosis-c/",
}
LP_EVENTS = ("lp_view", "lp_cta_click", "lp_form_submit")


def log(msg: str) -> None:
    print(f"[ga4_daily] {msg}", flush=True)


def normalize_dsn(url: str) -> str:
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = params.pop("schema", None)
    if schema:
        params.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(params, safe="-%"), parts.fragment)
    )


def norm_path(u: str) -> str:
    """URL でもパスでも `/media/foo/` の形に揃える。末尾スラッシュとクエリを落とす"""
    s = (u or "").strip()
    if not s:
        return ""
    if s.startswith("http"):
        s = urlsplit(s).path
    s = s.split("?")[0].split("#")[0]
    if not s.startswith("/"):
        s = "/" + s
    return s.rstrip("/") or "/"


def ga4_rows(property_id: str, dimensions: list[str], metric: str, start: date, end: date):
    from google.analytics.data_v1beta import BetaAnalyticsDataClient
    from google.analytics.data_v1beta.types import (
        DateRange,
        Dimension,
        Metric,
        RunReportRequest,
    )

    client = BetaAnalyticsDataClient()
    offset = 0
    while True:
        req = RunReportRequest(
            property=f"properties/{property_id}",
            dimensions=[Dimension(name=d) for d in dimensions],
            metrics=[Metric(name=metric)],
            date_ranges=[DateRange(start_date=start.isoformat(), end_date=end.isoformat())],
            limit=100000,
            offset=offset,
        )
        res = client.run_report(req)
        for row in res.rows:
            yield ([dv.value for dv in row.dimension_values], row.metric_values[0].value)
        offset += len(res.rows)
        # ★ページングを切ると多い日が黙って欠ける。総件数に届くまで回す
        if not res.rows or offset >= res.row_count:
            break


def main() -> int:
    prop = os.environ.get("GA4_PROPERTY_ID", "").strip()
    if not prop:
        log("GA4_PROPERTY_ID が未設定です（.env を確認してください）")
        return 1
    key = os.environ.get("MMS_GA4_CREDENTIALS", "").strip()
    if not key or not os.path.exists(key):
        log(f"★GA4 のサービスアカウント鍵がありません: {key or '(未設定)'}")
        return 1
    # google-analytics-data は GOOGLE_APPLICATION_CREDENTIALS を見る。
    # GSC 用の鍵を上書きしないよう、このプロセス内でだけ差し替える
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = key
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    lookback = int(os.environ.get("MMS_GA4_LOOKBACK_DAYS", "30"))
    today = datetime.now(JST).date()
    # ★GA4 は当日分が確定しない。前日までを対象にする
    end = today - timedelta(days=1)
    start = end - timedelta(days=lookback - 1)
    log(f"対象期間 {start} 〜 {end}（{lookback}日・欠測を毎回埋め直す）")

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        # ── 記事の URL → ContentItem を作る ──
        cur.execute(
            "SELECT id, url FROM \"ContentItem\" WHERE type='article' AND url IS NOT NULL"
        )
        by_path: dict[str, str] = {}
        for cid, url in cur.fetchall():
            p = norm_path(url)
            if p and p != "/":
                by_path[p] = cid
        log(f"URL を持つ記事 {len(by_path)}件")

        cur.execute("SELECT id FROM \"Business\" LIMIT 1")
        row = cur.fetchone()
        if not row:
            raise RuntimeError("Business がありません")
        business_id = row[0]

        # ── ① 記事別PV ──
        pv_rows = 0
        unmatched: set[str] = set()
        for dims, val in ga4_rows(prop, ["date", "pagePath"], "screenPageViews", start, end):
            d_raw, path = dims
            cid = by_path.get(norm_path(path))
            if not cid:
                if norm_path(path).startswith("/media/"):
                    unmatched.add(norm_path(path))
                continue
            d = datetime.strptime(d_raw, "%Y%m%d").date()
            cur.execute(
                'INSERT INTO "ContentMetric"(id,"contentItemId",metric,value,date,'
                '"createdAt","updatedAt") VALUES (gen_random_uuid()::text,%s,%s,%s,%s,now(),now()) '
                'ON CONFLICT ("contentItemId",metric,date) DO UPDATE SET value=EXCLUDED.value,'
                '"updatedAt"=now()',
                (cid, "pv", float(val), d),
            )
            pv_rows += 1
        conn.commit()
        log(f"PV: {pv_rows}行を保存")
        if unmatched:
            # ★突合できない /media/ 配下は「PVが無い」ではなく「記事が未登録」。
            #   黙って捨てると PV 合計が理由不明に小さくなる
            log(f"★記事に紐づかない /media/ パス {len(unmatched)}件（WP同期に無いURL）")
            for p in sorted(unmatched)[:5]:
                log(f"    {p}")

        # ── ② 診断LPのファネル（変種別）──
        path_to_variant = {norm_path(v): k for k, v in LP_VARIANTS.items()}
        counts: dict[tuple[date, str], float] = {}
        for dims, val in ga4_rows(
            prop, ["date", "pagePath", "eventName"], "eventCount", start, end
        ):
            d_raw, path, ev = dims
            v = path_to_variant.get(norm_path(path))
            if not v or ev not in LP_EVENTS:
                continue
            d = datetime.strptime(d_raw, "%Y%m%d").date()
            counts[(d, f"{ev}_{v}")] = counts.get((d, f"{ev}_{v}"), 0) + float(val)

        # ── ③ LPの実人数（イベント数と人数は別物）──
        # ★lp_view はイベント数。同じ人が再訪すれば増える。
        #   ABCの判定に必要なのは「何人来たか」なので users も取る。
        #   2026-07-22 の実測では30日で12イベントだったが、
        #   これが12人なのか2〜3人の再訪なのかで意味が全く違う。
        for dims, val in ga4_rows(prop, ["date", "pagePath"], "totalUsers", start, end):
            d_raw, path = dims
            v = path_to_variant.get(norm_path(path))
            if not v:
                continue
            d = datetime.strptime(d_raw, "%Y%m%d").date()
            key = (d, f"lp_users_{v}")
            counts[key] = counts.get(key, 0) + float(val)

        for (d, metric), value in counts.items():
            # ★MetricSnapshot は channelId NULL だと一意制約が効かない（§13 記録済）。
            #   先に消してから入れる
            cur.execute(
                'DELETE FROM "MetricSnapshot" WHERE "businessId"=%s AND metric=%s AND date=%s '
                'AND "channelId" IS NULL',
                (business_id, metric, d),
            )
            cur.execute(
                'INSERT INTO "MetricSnapshot"(id,"businessId",metric,value,date,granularity,'
                '"createdAt","updatedAt") VALUES (gen_random_uuid()::text,%s,%s,%s,%s,%s,now(),now())',
                (business_id, metric, value, d, "daily"),
            )
        conn.commit()
        log(f"診断LPファネル: {len(counts)}行を保存")

        # ── 計測開始の記録（§3: 0 と未計測を区別する）──
        #
        # ★実際に1行でも入った指標にだけ付ける。
        #   最初は取得対象を全部登録していたが、それは「測れている」という
        #   誤った主張になる。2026-07-22 に判明した通り、診断LPの
        #   lp_form_submit は CF7 6.x でイベント名が変わっており
        #   （wpcf7mailsent は dispatch されない）1件も発火していなかった。
        #   計測開始を記録してしまうと、この 0 が「実測ゼロ」に化けて
        #   「LPが悪い」という誤った結論を導く。
        measured_metrics = {"pv"} if pv_rows else set()
        measured_metrics |= {m for (_, m) in counts}
        for metric in sorted(measured_metrics):
            cur.execute('SELECT 1 FROM "MeasurementCoverage" WHERE metric=%s', (metric,))
            if cur.fetchone():
                continue
            cur.execute(
                'INSERT INTO "MeasurementCoverage"(id,metric,"startedAt",method,note,'
                '"createdAt","updatedAt") VALUES (gen_random_uuid()::text,%s,now(),%s,%s,now(),now())',
                (metric, "ga4_api", "MMS が GA4 Data API から日次取得（ga4_daily.py）"),
            )
        conn.commit()

    log("完了")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
