#!/usr/bin/env python3
"""WordPress 同期チェック（設計書 §3.9.1 / P1.8 の保険部分）

    「日次で WP から title / metaDescription / status / tags / featured_media を取得し、
      ハッシュ比較（本文全体は比較しない＝軽量）。
      差分検出時のみ段7に表示し、ContentVersion を1件作って取り込む」

★このスクリプトは **読み取りのみ**。WordPress に一切書き込まない。
  書き込みの一本化（wp-publish.py → /api/wp/publish）は P1.8 の別作業。

やること:
  1. WP から全記事のメタを取得（本文は取らない＝軽量）
  2. MMS の ContentItem と突合
     - WPにあってMMSに無い       → 新規記事として ContentItem を作成
     - 双方にあるがメタが変わった → ContentItem を更新し ContentVersion を1件記録
     - MMSにあってWPに無い       → 報告のみ（勝手に消さない）
  3. 結果をサマリーで出力（JobRun に残る）

環境変数:
  MMS_WP_BASE_URL / MMS_WP_USER / MMS_WP_APP_PASSWORD / MMS_WP_POST_TYPE
  MMS_DATABASE_URL
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

JST = timezone(timedelta(hours=9), "JST")
now_ts = datetime.now(JST)
PER_PAGE = 100


def log(msg: str) -> None:
    print(f"[wp_sync] {msg}", flush=True)


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


def clean(s: str | None) -> str:
    return html.unescape(s or "").strip()


def fetch_wp_posts() -> list[dict]:
    site = os.environ.get("MMS_WP_BASE_URL", "").rstrip("/")
    user = os.environ.get("MMS_WP_USER")
    pw = os.environ.get("MMS_WP_APP_PASSWORD")
    ptype = os.environ.get("MMS_WP_POST_TYPE", "posts")
    if not (site and user and pw):
        raise RuntimeError("MMS_WP_BASE_URL / MMS_WP_USER / MMS_WP_APP_PASSWORD が未設定です")

    auth = base64.b64encode(f"{user}:{pw}".encode()).decode()
    fields = "id,slug,link,status,modified,title,categories,tags,featured_media"
    posts: list[dict] = []
    page = 1
    while True:
        q = urlencode(
            {"per_page": PER_PAGE, "page": page, "_fields": fields, "status": "publish,draft,private"}
        )
        req = urllib.request.Request(
            f"{site}/wp-json/wp/v2/{ptype}?{q}",
            headers={"Authorization": f"Basic {auth}", "User-Agent": "MMS-wp-sync/1.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                batch = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 400 and page > 1:
                break  # ページ超過
            raise RuntimeError(f"WP API HTTP {e.code}: {e.read().decode()[:200]}") from e
        if not batch:
            break
        posts.extend(batch)
        if len(batch) < PER_PAGE:
            break
        page += 1
    return posts


def meta_hash(p: dict) -> str:
    """本文を含めない軽量ハッシュ（§3.9.1「本文全体は比較しない＝軽量」）"""
    basis = json.dumps(
        {
            "title": clean((p.get("title") or {}).get("rendered")),
            "status": p.get("status"),
            "link": p.get("link"),
            "tags": sorted(p.get("tags") or []),
            "featured_media": p.get("featured_media"),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(basis.encode()).hexdigest()[:32]


def main() -> int:
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    posts = fetch_wp_posts()
    log(f"WP から {len(posts)} 件のメタを取得")

    created = updated = unchanged = 0
    missing_in_wp: list[str] = []

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT c.id FROM "Channel" c JOIN "Business" b ON b.id=c."businessId" '
            "WHERE b.slug=%s AND c.type='media' LIMIT 1",
            (os.environ.get("MMS_DEFAULT_BUSINESS_SLUG", "tax-saving-agency"),),
        )
        got = cur.fetchone()
        if not got:
            raise RuntimeError("media チャネルが見つかりません")
        channel_id = got[0]

        # MMS 側の現状（wpPostId をキーに）
        cur.execute(
            'SELECT "id","wpPostId","title","status","url" FROM "ContentItem" '
            "WHERE \"type\" IN ('article','article_unlinked')"
        )
        rows = cur.fetchall()
        by_wp = {r[1]: r for r in rows if r[1] is not None}
        seen_wp: set[int] = set()

        # 新規 externalId の採番用（ART-### の最大値）
        cur.execute(
            "SELECT COALESCE(MAX(NULLIF(regexp_replace(\"externalId\",'\\D','','g'),'')::int),0) "
            "FROM \"ContentItem\" WHERE \"externalId\" LIKE 'ART-%'"
        )
        next_num = (cur.fetchone()[0] or 0) + 1

        for p in posts:
            wp_id = p.get("id")
            seen_wp.add(wp_id)
            title = clean((p.get("title") or {}).get("rendered"))
            status = p.get("status")
            link = p.get("link")
            h = meta_hash(p)

            existing = by_wp.get(wp_id)
            if existing is None:
                # ★WPにあってMMSに無い＝新規記事。取りこぼすと計測対象から漏れる
                ext = f"ART-{next_num:03d}"
                next_num += 1
                cur.execute(
                    """
                    INSERT INTO "ContentItem"
                      ("id","channelId","externalId","type","title","url","status","wpPostId",
                       "articleType","isPillar","aioTier","aioTracked","budgetTier",
                       "productFit","audience","impacts","tagIds","seoCheckPassed",
                       "reviewState","note","createdAt","updatedAt")
                    VALUES (%s,%s,%s,'article',%s,%s,%s,%s,
                            NULL,false,'none',false,'unknown',
                            '{}','{}','{}','{}',false,
                            'fresh',%s,%s,%s)
                    ON CONFLICT ("channelId","externalId") DO NOTHING
                    """,
                    (
                        nid("ci"), channel_id, ext, title, link, status, wp_id,
                        f"wp_sync: WP から新規検出（metaHash={h}）", now_ts, now_ts,
                    ),
                )
                created += 1
                continue

            item_id, _, cur_title, cur_status, cur_url = existing
            if clean(cur_title) == title and cur_status == status and (cur_url or "") == (link or ""):
                unchanged += 1
                continue

            # ★差分あり: 変更前を ContentVersion に退避してから更新（§16.3 ロールバック用）
            cur.execute(
                'SELECT COALESCE(MAX("versionNo"),0)+1 FROM "ContentVersion" WHERE "contentItemId"=%s',
                (item_id,),
            )
            ver = cur.fetchone()[0]
            cur.execute(
                """
                INSERT INTO "ContentVersion"
                  ("id","contentItemId","versionNo","capturedAt","title","tags",
                   "capturedBy","createdAt","updatedAt")
                VALUES (%s,%s,%s,%s,%s,'{}','manual',%s,%s)
                """,
                (nid("cv"), item_id, ver, now_ts, cur_title, now_ts, now_ts),
            )
            cur.execute(
                'UPDATE "ContentItem" SET "title"=%s,"status"=%s,"url"=%s,"updatedAt"=%s WHERE "id"=%s',
                (title, status, link, now_ts, item_id),
            )
            updated += 1

        # MMSにあってWPに無いもの（★勝手に消さない。報告のみ）
        for wp_id, r in by_wp.items():
            if wp_id not in seen_wp:
                missing_in_wp.append(str(wp_id))

        conn.commit()

    log(f"新規 {created} / 更新 {updated} / 変更なし {unchanged}")
    if missing_in_wp:
        log(f"★WPに存在しない wpPostId {len(missing_in_wp)}件（削除はしない）: {missing_in_wp[:10]}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
