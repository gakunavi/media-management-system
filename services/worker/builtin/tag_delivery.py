#!/usr/bin/env python3
"""計測タグが「読者に届いているか」を実訪問者と同じ条件で検査する（日次）

★なぜ要るか（2026-07-24・docs/RULES.md §4-95）
  記事6本で、**読者に届くHTMLに計測タグが入っていなかった**。
  オリジンには入っていて、Cloudflare APO のキャッシュが古いだけだった。
  該当は ART-002 即時償却（主力商材）・ART-007 法人節税ガイド（ピラー）・
  ART-086 GPU節税（ピラー）ほか。**その6本を読んだ人の行動は1件も残っていない**。

★url_health.py と役割が違う
  url_health.py は §4-44 に従い **クエリを足してキャッシュを迂回する**。
  それは「301ループの原因を見る」ためには正しいが、
  **配信されているものを見る手順ではない**。
  実際、迂回して叩くと6本ともタグが見えており、静的な確認では発見できなかった。

  こちらは逆に **ブラウザと同じヘッダで、キャッシュごと**叩く。
    - User-Agent をブラウザにする
    - Accept: text/html を送る（これが無いと APO を素通りしてしまう）
    - クエリを足さない
  症状（読者に届いていない）を見るのがこのジョブの仕事。

★見つけたら直す
  MMS_CLOUDFLARE_API_TOKEN があれば該当URLだけを自動パージする。
  無ければ検知だけして `DataQualityCheck(kind=tag_delivery)` に残す。
  通知は health-alert-daily がまとめて出すので、ここで独自に鳴らさない
  （同じ異常が2箇所から届くと、どちらも信用されなくなる）。
  ★Purge Everything は使わない。全ページがオリジン取り直しになり、
    過去に起こした重量化事故（§3.10）を自分で再現することになる。

必要な環境変数: MMS_DATABASE_URL
任意: MMS_CLOUDFLARE_API_TOKEN / MMS_CLOUDFLARE_ZONE_ID（あれば自動パージ）
      MMS_TAG_DELIVERY_TIMEOUT（既定20秒） / MMS_TAG_DELIVERY_CONCURRENCY（既定4）
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

# ★実訪問者と同じ条件で叩くためのヘッダ。
#   Accept を省くと APO がキャッシュを使わず、**壊れていても気づけない**。
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja,en;q=0.9",
}

# 探す印。script の id は WP プラグインが付けている
TAG_MARKER = "mms-tag"

TIMEOUT = int(os.environ.get("MMS_TAG_DELIVERY_TIMEOUT", "20"))
CONCURRENCY = int(os.environ.get("MMS_TAG_DELIVERY_CONCURRENCY", "4"))

# ★1回のパージ上限。これを超えるときは「1本ずつの事故」ではなく
#   タグ設置そのものが外れている疑いなので、パージせず人に知らせる。
MAX_AUTO_PURGE = 30


def log(m: str) -> None:
    print(m, flush=True)


def normalize_dsn(url: str) -> str:
    """?schema=public を psycopg が読める options= に直す（他の builtin と同じ扱い）"""
    parts = urlsplit(url.replace("postgresql+psycopg://", "postgresql://"))
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = params.pop("schema", None)
    if schema:
        params.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(params, safe="-%"), parts.fragment)
    )


def nid(p: str) -> str:
    return f"{p}{uuid.uuid4().hex[:20]}"


def fetch_as_visitor(url: str) -> dict:
    """読者と同じ条件で1回だけ叩く。リダイレクトは追う（最終的に届くものを見る）"""
    req = urllib.request.Request(url, headers=BROWSER_HEADERS, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            body = res.read().decode("utf-8", errors="replace")
            return {
                "url": url,
                "status": res.status,
                "hasTag": TAG_MARKER in body,
                "apo": res.headers.get("cf-apo-via") or "-",
                "age": int(res.headers.get("age") or 0),
                "error": None,
            }
    except urllib.error.HTTPError as e:
        return {"url": url, "status": e.code, "hasTag": False, "apo": "-", "age": 0,
                "error": f"HTTP {e.code}"}
    except Exception as e:  # noqa: BLE001
        # ★取得できなかったものを「タグ無し」と数えない。原因が違う（§4-13）
        return {"url": url, "status": 0, "hasTag": None, "apo": "-", "age": 0,
                "error": str(e)[:120]}


def purge(urls: list[str]) -> tuple[bool, str]:
    """該当URLだけを Cloudflare からパージする。★Purge Everything は使わない"""
    token = (os.environ.get("MMS_CLOUDFLARE_API_TOKEN") or "").strip()
    zone = (os.environ.get("MMS_CLOUDFLARE_ZONE_ID") or "").strip()
    if not token or not zone:
        return False, "MMS_CLOUDFLARE_API_TOKEN / MMS_CLOUDFLARE_ZONE_ID が未設定"

    body = json.dumps({"files": urls}).encode()
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/zones/{zone}/purge_cache",
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            out = json.loads(res.read().decode("utf-8", errors="replace"))
            if out.get("success"):
                return True, f"{len(urls)}件をパージした"
            return False, f"Cloudflare が success=false を返した: {out.get('errors')}"
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:200]
        return False, f"HTTP {e.code}: {detail}"
    except Exception as e:  # noqa: BLE001
        return False, str(e)[:200]


def main() -> int:
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    with psycopg.connect(normalize_dsn(dsn)) as conn:
        # ★autocommit。この後 HTTP を数百回叩くので、
        #   接続を開いたままにすると idle in transaction が残る（§4-51）
        conn.autocommit = True
        with conn.cursor() as cur:
            # ★301元（redirectsToId あり）は除く。301を返すのが正常なので、
            #   タグが無くて当たり前（§4-43「異常が正常なものを外す」）
            cur.execute(
                'SELECT "externalId", url FROM "ContentItem" '
                "WHERE type='article' AND url IS NOT NULL AND url <> '' "
                'AND "redirectsToId" IS NULL AND status = %s',
                ("publish",),
            )
            targets = [(r[0], r[1]) for r in cur.fetchall()]

        log(f"対象記事 {len(targets)} 本を読者と同じ条件で確認する")
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
            results = list(ex.map(lambda t: fetch_as_visitor(t[1]), targets))

        by_url = {r["url"]: r for r in results}
        missing = [(ext, u) for ext, u in targets if by_url[u]["hasTag"] is False]
        unknown = [(ext, u) for ext, u in targets if by_url[u]["hasTag"] is None]
        ok_count = len(targets) - len(missing) - len(unknown)

        # ★異常の件数だけを出さない。動いている数を必ず並べる（§4-53）
        log(f"タグ配信あり {ok_count} / {len(targets)}　"
            f"配信なし {len(missing)}　確認できず {len(unknown)}")
        for ext, u in missing:
            r = by_url[u]
            log(f"  ✗ {ext}  apo={r['apo']} age={r['age']}s  {u}")
        for ext, u in unknown:
            log(f"  ? {ext}  {by_url[u]['error']}  {u}")

        purged = False
        purge_note = ""
        if missing:
            if len(missing) > MAX_AUTO_PURGE:
                purge_note = (
                    f"{len(missing)}本は多すぎるので自動パージしない。"
                    "タグ設置そのものが外れている疑いがあり、パージしても直らない"
                )
            else:
                purged, purge_note = purge([u for _, u in missing])
            log(f"  パージ: {'成功' if purged else '未実行'} — {purge_note}")

        with conn.cursor() as cur:
            # ★結果は DataQualityCheck に残す（§13-①②の計測検証・P2.4）。
            #   通知は health-alert-daily がまとめて出す仕組みなので、
            #   ここで独自に鳴らさない（同じ異常が2箇所から届くと信用されなくなる）。
            #   ★確認できなかったもの（unknown）は分母から外す。
            #     取得失敗を「タグ無し」と混ぜると打ち手が変わる（§4-13）
            checked = ok_count + len(missing)
            cur.execute(
                'INSERT INTO "DataQualityCheck"("id","checkedAt",kind,metric,'
                '"ourValue","refValue","deviationPct",verdict,note,"createdAt","updatedAt")'
                " VALUES (%s,now(),%s,%s,%s,%s,%s,%s,%s,now(),now())",
                (
                    nid("dqc_"),
                    "tag_delivery",
                    "articles_with_tag",
                    float(ok_count),
                    float(checked),
                    (len(missing) / checked * 100.0) if checked else 0.0,
                    "fail" if missing and not purged else ("repaired" if purged else "ok"),
                    " / ".join(
                        filter(
                            None,
                            [
                                f"配信あり {ok_count}/{checked}",
                                f"確認できず {len(unknown)}" if unknown else "",
                                ("届いていない: " + ", ".join(e for e, _ in missing))
                                if missing
                                else "",
                                f"パージ: {purge_note}" if purge_note else "",
                            ],
                        )
                    )[:900],
                ),
            )

            # ★計測開始を記録する。無いと「0件」が未計測か実測ゼロか区別できない（§2-3）
            cur.execute('SELECT 1 FROM "MeasurementCoverage" WHERE metric=%s', ("tag_delivery",))
            if not cur.fetchone():
                cur.execute(
                    'INSERT INTO "MeasurementCoverage"("id",metric,"startedAt",method,note,'
                    '"createdAt","updatedAt") VALUES (%s,%s,%s,%s,%s,now(),now())',
                    (
                        nid("mc_"),
                        "tag_delivery",
                        datetime.now(timezone.utc),
                        "browser_fetch",
                        "計測タグが読者に届いているかの検査（実訪問者と同じヘッダで叩く・§4-95）",
                    ),
                )

    return 0


if __name__ == "__main__":
    sys.exit(main())
