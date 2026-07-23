#!/usr/bin/env python3
"""登録URLを実際に叩いて 301ループ・404・多段リダイレクトを検出する（日次）

★なぜ台帳の突合では足りないか
  2026-07-23、P1ピラー（ART-142 中小企業経営強化税制）が本番で
  **301の無限ループ**に陥り、読者もクローラも到達できなかった。
  しかし台帳・config・MMS の三者は一致していたため、静的な突合では
  一切引っかからなかった。表示246・クリック0 という結果だけが残っていた。

  3日で3件踏んでいる:
    ・ピラーの301ループ（keieikyoka ⇄ chushokigyo）
    ・カテゴリ tax-reform が削除済みtermへ301 → 404
    ・breadcrumb の capital-investment が存在しないterm → 404

  「登録は正しいが本番が壊れている」は**叩かないと分からない**。

★合格条件: 最大1ホップで200・ループ無し
  2ホップ以上は評価が減衰し、ループは到達不能を意味する。

★静的キャッシュを迂回する
  Xserver の静的キャッシュが古い301を返し続けることがあり、
  実際それがループの一因だった。クエリを1つ足して素通りさせる。

必要な環境変数: MMS_DATABASE_URL
任意: MMS_URL_HEALTH_TIMEOUT（既定20秒） / MMS_URL_HEALTH_CONCURRENCY（既定6）
"""

from __future__ import annotations

import os
import sys
import uuid
import json
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

JST = timezone(timedelta(hours=9), "JST")
now_ts = datetime.now(JST)
TODAY = now_ts.date()

MAX_HOPS = 10
OK_MAX_HOPS = 1  # 合格条件
TIMEOUT = int(os.environ.get("MMS_URL_HEALTH_TIMEOUT") or 20)
CONCURRENCY = int(os.environ.get("MMS_URL_HEALTH_CONCURRENCY") or 6)
UA = "MMS-url-health/1.0 (+https://asset-support.co.jp)"


def log(m: str) -> None:
    print(f"[url_health] {m}", flush=True)


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


def bust(url: str, token: str) -> str:
    """静的キャッシュを迂回する。★元URLは変えない（記録は元URLで残す）"""
    p = urlsplit(url)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    q["_mmsck"] = token
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q), p.fragment))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """自分でホップを数えるため、urllib の自動追跡を止める"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


_opener = urllib.request.build_opener(NoRedirect)


def trace(url: str, token: str) -> dict:
    """1URLを追跡する。ループ・ホップ数・最終ステータスを返す。"""
    chain: list[str] = []
    seen: set[str] = set()
    cur = url
    status = 0
    loop = False

    for _ in range(MAX_HOPS):
        key = cur.split("?")[0].rstrip("/")
        if key in seen:
            loop = True
            break
        seen.add(key)
        chain.append(cur)
        req = urllib.request.Request(bust(cur, token), headers={"User-Agent": UA}, method="GET")
        try:
            with _opener.open(req, timeout=TIMEOUT) as r:
                status = r.status
                break  # リダイレクトでない＝終着
        except urllib.error.HTTPError as e:
            status = e.code
            loc = e.headers.get("Location") if e.headers else None
            if 300 <= e.code < 400 and loc:
                cur = urllib.parse.urljoin(cur, loc)
                continue
            break  # 404 等
        except Exception as e:  # noqa: BLE001
            # ★到達できない理由を握りつぶさない。0 で残して件数に出す
            log(f"  取得失敗 {cur}: {type(e).__name__}")
            status = 0
            break
    else:
        loop = True  # MAX_HOPS 使い切り＝実質ループ

    return {
        "url": url,
        "finalStatus": status,
        "hops": max(0, len(chain) - 1),
        "loop": loop,
        "chain": chain[:MAX_HOPS],
    }


def main() -> int:
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    token = now_ts.strftime("%Y%m%d%H%M")

    with psycopg.connect(normalize_dsn(dsn)) as conn:
        with conn.cursor() as cur:
            cur.execute("SET TIME ZONE 'UTC'")
            # ★対象から外すもの（外さないと毎日「異常」が出続けて誰も見なくなる）
            #   ・301元        … 301を返すのが正常
            #   ・下書き        … 公開していないので404が正常。URLもプレビュー形式
            #   ・?post_type=  … WPのプレビューURL。canonical ではない
            #   ・http で始まらない … 過去の取り込みで本文が混入した壊れた行
            cur.execute(
                'SELECT id, url FROM "ContentItem"'
                " WHERE url IS NOT NULL AND url <> ''"
                "   AND url LIKE 'http%'"
                "   AND url NOT LIKE '%?post_type=%'"
                '   AND "redirectsToId" IS NULL'
                "   AND status <> 'draft'"
                "   AND type IN ('article','article_unlinked','site_page')"
            )
            targets = cur.fetchall()

        log(f"対象 {len(targets)} URL（301元は除外）")
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
            results = list(ex.map(lambda t: (t[0], trace(t[1], token)), targets))

        bad = [(cid, r) for cid, r in results if r["loop"] or r["finalStatus"] != 200 or r["hops"] > OK_MAX_HOPS]
        loops = [r for _c, r in results if r["loop"]]
        dead = [r for _c, r in results if not r["loop"] and r["finalStatus"] != 200]
        slow = [r for _c, r in results if not r["loop"] and r["finalStatus"] == 200 and r["hops"] > OK_MAX_HOPS]

        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO "UrlHealthCheck"
                  ("id","contentItemId","url","finalStatus","hops","loop","chain","checkedAt","createdAt","updatedAt")
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT ("url","checkedAt") DO UPDATE SET
                  "finalStatus"=EXCLUDED."finalStatus","hops"=EXCLUDED."hops",
                  "loop"=EXCLUDED."loop","chain"=EXCLUDED."chain","updatedAt"=EXCLUDED."updatedAt"
                """,
                [
                    (nid("uh"), cid, r["url"], r["finalStatus"], r["hops"], r["loop"],
                     json.dumps(r["chain"], ensure_ascii=False), TODAY, now_ts, now_ts)
                    for cid, r in results
                ],
            )
            # 計測開始を1度だけ記録する（§3）
            cur.execute('SELECT 1 FROM "MeasurementCoverage" WHERE metric=%s', ("url_health",))
            if not cur.fetchone():
                cur.execute(
                    'INSERT INTO "MeasurementCoverage" ("id",metric,"startedAt",method,note,"createdAt","updatedAt")'
                    " VALUES (%s,%s,%s,%s,%s,%s,%s)",
                    (nid("mc"), "url_health", now_ts, "http_probe",
                     "登録URLの実地チェック（301ループ・404・多段）。初回実行により計測開始", now_ts, now_ts),
                )
        conn.commit()

    log(f"★ループ {len(loops)} / 到達不可 {len(dead)} / 2ホップ以上 {len(slow)}（合計 {len(bad)}）")
    for r in (loops + dead + slow)[:15]:
        mark = "ループ" if r["loop"] else (f"HTTP{r['finalStatus']}" if r["finalStatus"] != 200 else f"{r['hops']}ホップ")
        log(f"  [{mark}] {r['url']}")
        if r["loop"] or r["finalStatus"] != 200:
            log(f"        経路: {' → '.join(x.split('asset-support.co.jp')[-1] for x in r['chain'][:5])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
