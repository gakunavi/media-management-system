#!/usr/bin/env python3
"""記事の構造化データ（JSON-LD）の中のURLを実際に叩いて検査する（日次・U91）

★なぜ要るか（2026-07-24）
  `url_health.py` は **MMS に登録されたURLしか叩いていない**ため、
  記事のHTMLに埋まっている JSON-LD の中は見ていなかった。
  その結果、実害のあるバグを2件とも**手でHTMLを読むまで発見できなかった**:

    1. パンくず（BreadcrumbList.item）が `/category/capital-investment/` を指しており、
       これが **301 → 404**。読者もクローラも行き止まりに着いていた。
       ★1ホップ目は 301 なので、**最終ステータスまで辿らないと気づけない**。
    2. Organization の `sameAs` に計測用リダイレクタが入っていた。
       `sameAs` は「同一主体を指す公式プロフィール」で、送客URLは用途違い。
       生成側が本文全体の `lin.ee` を無差別置換していたのが原因。

  cowork からも「(a) JSON-LD 内の全URLを抽出して実際に叩く
  (b) 301 の先まで辿って最終ステータスを見る」の2点を入れるよう合意済み。

★url_health.py との違い
  url_health : MMS の登録URL（ContentItem.url）を叩く＝「記事が開けるか」
  jsonld_health: 記事HTMLの **JSON-LD の中のURL** を叩く＝「構造化データが正しいか」
  対象が違うので別ジョブにする。

★キャッシュは迂回する（§4-44）。ここで見たいのは**原因**（オリジンの出力が
  正しいか）であって、配信状態ではない。配信は tag_delivery.py が見る（§4-95）。

必要な環境変数: MMS_DATABASE_URL
任意: MMS_JSONLD_TIMEOUT（既定20秒） / MMS_JSONLD_CONCURRENCY（既定4）
      MMS_JSONLD_MAX_ARTICLES（既定40・1回で見る記事数。古い順に回す）
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

TIMEOUT = int(os.environ.get("MMS_JSONLD_TIMEOUT", "20"))
CONCURRENCY = int(os.environ.get("MMS_JSONLD_CONCURRENCY", "4"))
MAX_ARTICLES = int(os.environ.get("MMS_JSONLD_MAX_ARTICLES", "40"))
MAX_HOPS = 6

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)

# ★JSON-LD のどのキーを「URLとして叩く対象」にするか。
#   値がURLでないキー（name / description 等）まで叩かないよう明示する。
URL_KEYS = {"sameAs", "item", "url", "logo", "contentUrl", "@id"}

# 叩かない値。★叩いても意味が無いものを毎日エラーとして並べない（§4-43）
SKIP_PREFIXES = ("mailto:", "tel:", "data:", "javascript:")
# schema.org の型URL・@context は識別子であってページではない
SKIP_HOSTS = {"schema.org", "www.schema.org"}


def log(m: str) -> None:
    print(m, flush=True)


def normalize_dsn(url: str) -> str:
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


def encode_url(url: str) -> str:
    """日本語パスを percent-encode。しないと urllib が落ちる（§4-46）"""
    p = urlsplit(url)
    path = urllib.parse.quote(p.path, safe="/%")
    try:
        host = p.netloc.encode("idna").decode("ascii")
    except Exception:  # noqa: BLE001
        host = p.netloc
    return urlunsplit((p.scheme, host, path, p.query, p.fragment))


def bust(url: str, token: str) -> str:
    """エッジキャッシュを迂回する（§4-44）。★見たいのは原因＝オリジンの出力"""
    p = urlsplit(url)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    q["_mmsjl"] = token
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q), p.fragment))


def fetch(url: str, token: str) -> str | None:
    req = urllib.request.Request(bust(encode_url(url), token), headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            return res.read().decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        return None


def trace(url: str) -> dict:
    """★301の先まで辿って最終ステータスを見る（cowork 指定 (b)）。

    パンくず404は 1ホップ目が 301 だったため、最終まで辿らないと気づけなかった。
    """
    seen: set[str] = set()
    cur = encode_url(url)
    hops = 0
    status = 0
    loop = False

    for _ in range(MAX_HOPS):
        key = cur.split("?")[0].rstrip("/")
        if key in seen:
            loop = True
            break
        seen.add(key)

        req = urllib.request.Request(cur, headers={"User-Agent": UA}, method="HEAD")
        try:
            opener = urllib.request.build_opener(NoRedirect)
            with opener.open(req, timeout=TIMEOUT) as res:
                status = res.status
                loc = res.headers.get("location")
        except urllib.error.HTTPError as e:
            status = e.code
            loc = e.headers.get("location") if e.headers else None
        except Exception as e:  # noqa: BLE001
            return {"status": 0, "hops": hops, "loop": False, "error": str(e)[:100], "final": cur}

        if status in (301, 302, 303, 307, 308) and loc:
            cur = urllib.parse.urljoin(cur, loc)
            hops += 1
            continue
        break

    return {"status": status, "hops": hops, "loop": loop, "error": None, "final": cur}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102, ANN001
        return None


def extract_jsonld_urls(html: str) -> list[tuple[str, str]]:
    """JSON-LD を全部拾い、(キー, URL) のリストを返す（cowork 指定 (a)）。

    ★キーを残す理由: 「どの項目が壊れているか」が分からないと直せない。
      sameAs の誤りとパンくずの404は**直し方が全く違う**。
    """
    out: list[tuple[str, str]] = []

    def walk(node: object, key: str = "") -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, k)
        elif isinstance(node, list):
            for v in node:
                walk(v, key)
        elif isinstance(node, str):
            if key not in URL_KEYS:
                return
            if not node.startswith(("http://", "https://")):
                return
            if node.startswith(SKIP_PREFIXES):
                return
            if urlsplit(node).netloc.lower() in SKIP_HOSTS:
                return
            out.append((key, node))

    for m in re.finditer(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.S
    ):
        try:
            walk(json.loads(m.group(1)))
        except Exception:  # noqa: BLE001
            # ★壊れた JSON-LD も情報。黙って捨てず件数だけ数える
            out.append(("__parse_error__", ""))
    return out


def main() -> int:
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    token = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")

    with psycopg.connect(normalize_dsn(dsn)) as conn:
        # ★autocommit。この後 HTTP を大量に叩くので接続を開いたままにしない（§4-51）
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                'SELECT "externalId", url FROM "ContentItem" '
                "WHERE type='article' AND status='publish' AND url IS NOT NULL AND url <> '' "
                'AND "redirectsToId" IS NULL '
                "ORDER BY random() LIMIT %s",
                (MAX_ARTICLES,),
            )
            targets = [(r[0], r[1]) for r in cur.fetchall()]

        log(f"対象記事 {len(targets)} 本の JSON-LD を検査する")

        def check(t: tuple[str, str]) -> dict:
            ext, url = t
            html = fetch(url, token)
            if html is None:
                return {"ext": ext, "url": url, "fetch_failed": True, "bad": [], "urls": 0}
            pairs = extract_jsonld_urls(html)
            parse_errors = sum(1 for k, _ in pairs if k == "__parse_error__")
            pairs = [(k, u) for k, u in pairs if k != "__parse_error__"]

            bad = []
            # ★同じURLを何度も叩かない（1記事に同じ logo が何度も出る）
            for key, u in {(k, u) for k, u in pairs}:
                r = trace(u)
                if r["loop"]:
                    bad.append({"key": key, "url": u, "why": "リダイレクトのループ"})
                elif r["error"]:
                    bad.append({"key": key, "url": u, "why": f"到達できない（{r['error']}）"})
                elif r["status"] >= 400:
                    # ★301の先で404、が今回のパンくず。最終ステータスで判定する
                    why = f"最終 {r['status']}"
                    if r["hops"]:
                        why += f"（{r['hops']}ホップ後）"
                    bad.append({"key": key, "url": u, "why": why})
            return {
                "ext": ext,
                "url": url,
                "fetch_failed": False,
                "bad": bad,
                "urls": len(pairs),
                "parse_errors": parse_errors,
            }

        with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
            results = list(ex.map(check, targets))

        checked = [r for r in results if not r["fetch_failed"]]
        failed_fetch = [r for r in results if r["fetch_failed"]]
        with_bad = [r for r in checked if r["bad"]]
        total_urls = sum(r["urls"] for r in checked)
        parse_errors = sum(r.get("parse_errors", 0) for r in checked)

        # ★異常の件数だけを出さない。動いている数を必ず並べる（§4-53）
        log(
            f"JSON-LD 内のURL {total_urls} 件を検査 ／ "
            f"問題のある記事 {len(with_bad)} / {len(checked)} 本"
            + (f" ／ 取得できず {len(failed_fetch)} 本" if failed_fetch else "")
            + (f" ／ JSON-LD の構文エラー {parse_errors} 件" if parse_errors else "")
        )
        for r in with_bad:
            for b in r["bad"]:
                log(f"  ✗ {r['ext']}  {b['key']}: {b['why']}")
                log(f"      {b['url']}")

        with conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "DataQualityCheck"("id","checkedAt",kind,metric,'
                '"ourValue","refValue","deviationPct",verdict,note,"createdAt","updatedAt")'
                " VALUES (%s,now(),%s,%s,%s,%s,%s,%s,%s,now(),now())",
                (
                    nid("dqc_"),
                    "jsonld_health",
                    "articles_with_valid_jsonld_urls",
                    float(len(checked) - len(with_bad)),
                    float(len(checked)),
                    (len(with_bad) / len(checked) * 100.0) if checked else 0.0,
                    "fail" if with_bad else "ok",
                    (
                        f"検査 {len(checked)}本 / URL {total_urls}件 / 問題 {len(with_bad)}本"
                        + (
                            " / 例: "
                            + "; ".join(
                                f"{r['ext']} {b['key']} {b['why']}"
                                for r in with_bad[:3]
                                for b in r["bad"][:1]
                            )
                            if with_bad
                            else ""
                        )
                    )[:900],
                ),
            )

            cur.execute('SELECT 1 FROM "MeasurementCoverage" WHERE metric=%s', ("jsonld_health",))
            if not cur.fetchone():
                cur.execute(
                    'INSERT INTO "MeasurementCoverage"("id",metric,"startedAt",method,note,'
                    '"createdAt","updatedAt") VALUES (%s,%s,%s,%s,%s,now(),now())',
                    (
                        nid("mc_"),
                        "jsonld_health",
                        datetime.now(timezone.utc),
                        "jsonld_fetch",
                        "構造化データ（JSON-LD）の中のURLを実際に叩く検査（U91）。"
                        "301の先まで辿って最終ステータスを見る",
                    ),
                )

    return 0


if __name__ == "__main__":
    sys.exit(main())
