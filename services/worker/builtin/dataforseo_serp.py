#!/usr/bin/env python3
"""DataForSEO で SERP 1〜20位を取得し SerpSnapshot に保存（設計書 §3.3.5）

    「対象KWの検索結果1〜20位を丸ごと保存（競合の動きを追う）」
    「コスト実測: DataForSEO SERP $0.60/1,000 SERP。300KW×週次で約$0.72/月」

★この $0.60/1,000 は **Standard キュー**（task_post → ポーリング → task_get）の
  価格。live/advanced は約3倍かかるため、設計書のコスト前提に合わせて
  Standard を使う。1回あたり数十秒〜数分待つが、週次バッチなので問題ない。

GSC（KeywordRanking）との違い:
  - GSC   … **自分の**順位だけ。競合が何位にいるかは分からない
  - SERP  … 1〜20位の **全ドメイン**。誰に負けているかが分かる（§3.3.5）
  加えて AI Overview の有無と引用ドメインを取る（§3.3.6 AIO有無でCTR曲線を分ける）

環境変数:
  MMS_DATAFORSEO_LOGIN / MMS_DATAFORSEO_PASSWORD
  MMS_DATAFORSEO_MAX_KEYWORDS  … 1回の上限（既定 400。事故的な高額請求の歯止め）
  MMS_WP_BASE_URL              … 自社ドメイン判定（isOurs）に使う
  MMS_DATABASE_URL

使い方:
  docker compose exec worker python builtin/dataforseo_serp.py --probe  # 1KWだけ（約$0.0006）
  docker compose exec worker python builtin/dataforseo_serp.py
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

import psycopg

JST = timezone(timedelta(hours=9), "JST")
API_HOST = "https://api.dataforseo.com"

# 日本・日本語・Google
LOCATION_CODE = int(os.environ.get("MMS_DATAFORSEO_LOCATION_CODE", "2392"))  # Japan
LANGUAGE_CODE = os.environ.get("MMS_DATAFORSEO_LANGUAGE_CODE", "ja")
# §3.3.5「1〜20位を丸ごと保存」
SERP_DEPTH = 20

# task_post は1リクエスト最大100タスク
POST_CHUNK = 100
# 1SERPあたりの単価（ログの概算表示にのみ使用）。2026-07-21 実測値
#   通常 $0.0006 / AI Overview の引用元まで取ると $0.0030（約5倍）
# ★どのKWで引用元まで取るかは Keyword.aioTracked（/keywords 画面で切替）が正。
#   コストを伴う判断を .env に置くと、変更のたびに再ビルドが要り運用者が触れない
USD_PER_SERP = 0.0006
USD_PER_SERP_AIO = 0.0030

# ポーリング
POLL_INTERVAL_S = 20
POLL_MAX_MINUTES = 20

# DataForSEO のステータスコード
SC_OK = 20000
SC_TASK_CREATED = 20100
SC_IN_QUEUE = 40602


def log(msg: str) -> None:
    print(f"[dataforseo_serp] {msg}", flush=True)


def normalize_dsn(url: str) -> str:
    from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

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


def auth_header() -> str:
    login = os.environ.get("MMS_DATAFORSEO_LOGIN", "").strip()
    pw = os.environ.get("MMS_DATAFORSEO_PASSWORD", "").strip()
    if not (login and pw):
        raise RuntimeError(
            "MMS_DATAFORSEO_LOGIN / MMS_DATAFORSEO_PASSWORD が未設定です（.env を確認してください）"
        )
    return "Basic " + base64.b64encode(f"{login}:{pw}".encode()).decode()


def api(method: str, path: str, payload=None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{API_HOST}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": auth_header(),
            "Content-Type": "application/json",
            "User-Agent": "MMS-dataforseo/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            body = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:300]
        # ★認証情報を例外メッセージに載せない（ログ共有時の漏洩を防ぐ）
        raise RuntimeError(f"DataForSEO HTTP {e.code} ({method} {path}): {detail}") from e

    if body.get("status_code") not in (SC_OK, SC_TASK_CREATED):
        raise RuntimeError(
            f"DataForSEO エラー: status_code={body.get('status_code')} "
            f"message={body.get('status_message')}"
        )
    return body


def our_domain() -> str:
    base = os.environ.get("MMS_WP_BASE_URL", "").strip()
    host = urllib.parse.urlsplit(base).netloc.lower() if base else ""
    return host[4:] if host.startswith("www.") else host


def fetch_keywords(cur, limit: int) -> list[tuple[str, str, bool]]:
    """対象キーワードを (id, keyword, aioTracked) で返す。

    ★順位が付いているものを優先する。まだ1位も取れていない新規KWより、
      すでに戦っているKWの競合状況を見る方が打ち手に直結する（§3.3.5）。
    """
    cur.execute(
        """
        SELECT k."id", k."keyword", k."aioTracked"
        FROM "Keyword" k
        JOIN "Business" b ON b.id = k."businessId"
        LEFT JOIN LATERAL (
            SELECT r."position" FROM "KeywordRanking" r
            WHERE r."keywordId" = k."id" ORDER BY r."date" DESC LIMIT 1
        ) last ON true
        WHERE b.slug = %s
        ORDER BY (last."position" IS NULL), last."position" ASC, k."keyword"
        LIMIT %s
        """,
        (os.environ.get("MMS_DEFAULT_BUSINESS_SLUG", "tax-saving-agency"), limit),
    )
    return [(r[0], r[1], bool(r[2])) for r in cur.fetchall()]


def post_tasks(keywords: list[tuple[str, str, bool]]) -> dict[str, str]:
    """task_post して {task_id: keyword_id} を返す"""
    task_by_id: dict[str, str] = {}
    for i in range(0, len(keywords), POST_CHUNK):
        chunk = keywords[i : i + POST_CHUNK]
        payload = [
            {
                "keyword": kw,
                "location_code": LOCATION_CODE,
                "language_code": LANGUAGE_CODE,
                "depth": SERP_DEPTH,
                # AI Overview の引用ドメインを取るか（§3.3.6）。KWごとに決まる。
                # ★OFF の行で aioCitedDomains を [] にすると「引用ゼロ」と誤読
                #   されるため、計測範囲を MeasurementCoverage に記録して区別する
                "load_async_ai_overview": aio,
                # 自前で照合できるよう KeywordId を持たせる（返却される）
                "tag": kid,
            }
            for kid, kw, aio in chunk
        ]
        res = api("POST", "/v3/serp/google/organic/task_post", payload)
        for t in res.get("tasks") or []:
            if t.get("status_code") != SC_TASK_CREATED:
                log(f"★タスク作成失敗: {t.get('status_message')} kw={t.get('data', {}).get('keyword')}")
                continue
            tag = (t.get("data") or {}).get("tag")
            if t.get("id") and tag:
                task_by_id[t["id"]] = tag
        log(f"  タスク投入 {min(i + POST_CHUNK, len(keywords))}/{len(keywords)}")
    return task_by_id


def collect_results(task_by_id: dict[str, str]) -> dict[str, dict]:
    """完了したタスクを回収する。{keyword_id: result} を返す"""
    pending = dict(task_by_id)
    done: dict[str, dict] = {}
    deadline = time.time() + POLL_MAX_MINUTES * 60

    while pending and time.time() < deadline:
        time.sleep(POLL_INTERVAL_S)
        for task_id in list(pending):
            try:
                res = api("GET", f"/v3/serp/google/organic/task_get/advanced/{task_id}")
            except RuntimeError as e:
                log(f"  task_get 失敗 {task_id}: {e}")
                continue
            t = (res.get("tasks") or [{}])[0]
            sc = t.get("status_code")
            if sc == SC_IN_QUEUE:
                continue
            if sc != SC_OK:
                log(f"  ★タスク異常 {task_id}: {t.get('status_message')}")
                pending.pop(task_id, None)
                continue
            results = t.get("result") or []
            if results:
                done[pending[task_id]] = results[0]
            pending.pop(task_id, None)
        log(f"  回収 {len(done)}/{len(task_by_id)}（待機中 {len(pending)}）")

    if pending:
        # ★取れなかったものを 0件として保存すると「20位以内に誰もいない」と
        #   誤読される。§3 の規約どおり、記録しない＝未計測のままにする
        log(f"★{len(pending)}件がタイムアウト。未計測として記録しません")
    return done


def parse_items(result: dict, ours: str) -> tuple[list[dict], bool, list[str]]:
    """SERP 結果から organic 行・AIO有無・AIO引用ドメインを取り出す"""
    rows: list[dict] = []
    has_aio = False
    aio_domains: list[str] = []

    for item in result.get("items") or []:
        itype = item.get("type")

        if itype == "ai_overview":
            has_aio = True
            for ref in (item.get("references") or []):
                d = (ref.get("domain") or "").lower()
                if d and d not in aio_domains:
                    aio_domains.append(d)
            continue

        if itype != "organic":
            continue

        pos = item.get("rank_group")
        domain = (item.get("domain") or "").lower()
        if not pos or not domain or pos > SERP_DEPTH:
            continue
        rows.append(
            {
                "position": int(pos),
                "domain": domain,
                "url": item.get("url") or "",
                "title": item.get("title"),
                "isOurs": bool(ours) and (domain == ours or domain.endswith("." + ours)),
            }
        )

    # 同順位が複数返ることがある（unique 制約は keywordId+date+position）
    seen: set[int] = set()
    uniq = []
    for r in sorted(rows, key=lambda x: x["position"]):
        if r["position"] in seen:
            continue
        seen.add(r["position"])
        uniq.append(r)
    return uniq, has_aio, aio_domains


def save(cur, keyword_id: str, day, rows: list[dict], has_aio: bool, aio_domains: list[str]) -> int:
    now = datetime.now(JST)
    n = 0
    for r in rows:
        cur.execute(
            """
            INSERT INTO "SerpSnapshot"
              ("id","keywordId","date","position","domain","url","title","isOurs",
               "hasAiOverview","aioCitedDomains","createdAt","updatedAt")
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT ("keywordId","date","position") DO UPDATE SET
              "domain"=EXCLUDED."domain", "url"=EXCLUDED."url", "title"=EXCLUDED."title",
              "isOurs"=EXCLUDED."isOurs", "hasAiOverview"=EXCLUDED."hasAiOverview",
              "aioCitedDomains"=EXCLUDED."aioCitedDomains", "updatedAt"=EXCLUDED."updatedAt"
            """,
            (
                nid("ss"), keyword_id, day, r["position"], r["domain"], r["url"], r["title"],
                r["isOurs"], has_aio, aio_domains, now, now,
            ),
        )
        n += 1
    return n


def main() -> int:
    probe = "--probe" in sys.argv
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    max_kw = 1 if probe else int(os.environ.get("MMS_DATAFORSEO_MAX_KEYWORDS", "400"))
    ours = our_domain()
    day = datetime.now(JST).date()

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        keywords = fetch_keywords(cur, max_kw)
        if not keywords:
            log("対象キーワードがありません")
            return 1
        n_aio = sum(1 for _, _, aio in keywords if aio)
        cost = (len(keywords) - n_aio) * USD_PER_SERP + n_aio * USD_PER_SERP_AIO
        log(
            f"対象 {len(keywords)}KW（うちAIO引用も取得 {n_aio}KW）/ "
            f"自社ドメイン={ours or '(未設定)'} / 概算コスト ${cost:.2f}"
        )

        task_by_id = post_tasks(keywords)
        if not task_by_id:
            raise RuntimeError("タスクが1件も作成できませんでした")

        results = collect_results(task_by_id)

        saved = aio_count = 0
        ours_ranked = 0
        for kid, result in results.items():
            rows, has_aio, aio_domains = parse_items(result, ours)
            if not rows:
                continue  # ★空を保存しない（未計測として残す）
            saved += save(cur, kid, day, rows, has_aio, aio_domains)
            if has_aio:
                aio_count += 1
            if any(r["isOurs"] for r in rows):
                ours_ranked += 1

        # ── 計測開始の記録（§3 規約）──
        now = datetime.now(JST)
        covers = [("serp_top20", "DataForSEO SERP(Standard)により1〜20位の計測を開始")]
        if n_aio:
            # ★これを別metricで持つのが要点。この日より前の aioCitedDomains=[] は
            #   「引用ゼロ」ではなく「未計測」だと後から判別できる（§3）
            covers.append(
                ("serp_aio_citations", "AI Overview の引用ドメインの計測を開始（load_async_ai_overview）")
            )
        for metric, note in covers:
            cur.execute('SELECT 1 FROM "MeasurementCoverage" WHERE metric=%s', (metric,))
            if not cur.fetchone():
                cur.execute(
                    """
                    INSERT INTO "MeasurementCoverage"
                      ("id","metric","startedAt","method","note","createdAt","updatedAt")
                    VALUES (%s,%s,%s,'dataforseo_serp',%s,%s,%s)
                    """,
                    (nid("mc"), metric, now, note, now, now),
                )
        conn.commit()

    log(
        f"完了: {len(results)}KW 取得 / SerpSnapshot {saved}行 / "
        f"AIOあり {aio_count}KW / 自社が20位以内 {ours_ranked}KW"
    )
    if probe:
        log("--probe のため1KWのみ実行しました")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
