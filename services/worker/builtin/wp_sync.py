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
now_ts = datetime.now(JST)
PER_PAGE = 100

# ★ニュース記事のカテゴリ（blog_category）。新規記事の AIO Tier を Hot にする。
#   21626 税制改正ニュース / 11 税制改正・時事ニュース
#   カテゴリを増やしたらここに足す。合っているかは
#   /wp-json/wp/v2/blog_category?per_page=100 で確認できる。
NEWS_CATEGORY_IDS = {
    int(x) for x in (os.environ.get("MMS_WP_NEWS_CATEGORY_IDS") or "21626,11").split(",") if x.strip()
}


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
    # ★カテゴリのフィールド名は投稿タイプで変わる。
    #   このサイトの `blog` は独自タクソノミー `blog_category` を使っており、
    #   標準の `categories` は空で返る（今まで取っていたが中身が無かった）。
    #   ニュース記事の判定に使うので両方要求する。
    fields = (
        "id,slug,link,status,modified,title,"
        "categories,blog_category,tags,featured_media"
    )
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
        use_utc(conn)
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
                # ★AIO の初期値は Warm / 計測対象（2026-07-23・Notion廃止に伴い移設）
                #
                #   これまでは記事公開のたびに人が notion-sync.py を実行して
                #   Notion 側に Warm を入れていた（wp-publish-gate.md「スキップ禁止」）。
                #   Notion を廃止するにあたり、その既定値付与をここへ移した。
                #
                #   ★公開手順から同期ステップを消せるのが本質。
                #     手で実行する必須ステップは、忘れれば計測から漏れ、
                #     外部サービスが落ちれば記事公開そのものが止まる。
                #     WP に記事があれば翌日の同期で必ず拾われる形にする。
                #
                #   Warm = 60日の baseline 期間。その後データを見て Hot/Cold へ
                #   昇降格する（Pillar は手動で Hot）。
                #
                # ★ニュース記事だけは Hot。
                #   news-factory の pipeline.py が `--aio-tier Hot` を強制していた。
                #   時事ネタは鮮度が命で、計測間隔を空けると意味が無い。
                #   この仕様を持ってこないと、移行を境にニュース記事の
                #   計測頻度が黙って下がる。
                cats = set(p.get("blog_category") or []) | set(p.get("categories") or [])
                is_news = bool(cats & NEWS_CATEGORY_IDS)
                tier = "hot" if is_news else "warm"
                aio_note = (
                    f"[wp_sync {now_ts:%Y-%m-%d}] 新規記事のため "
                    + (
                        "Hot 初期投入（ニュースカテゴリ）"
                        if is_news
                        else "Warm 初期投入（60日 baseline 期間）"
                    )
                )
                cur.execute(
                    """
                    INSERT INTO "ContentItem"
                      ("id","channelId","externalId","type","title","url","status","wpPostId",
                       "articleType","isPillar","aioTier","aioTracked",
                       "aioTierUpdatedAt","aioNote","budgetTier",
                       "productFit","audience","impacts","tagIds","seoCheckPassed",
                       "reviewState","note","createdAt","updatedAt")
                    VALUES (%s,%s,%s,'article',%s,%s,%s,%s,
                            NULL,false,%s::"AioTier",true,
                            %s,%s,'unknown',
                            '{}','{}','{}','{}',false,
                            'fresh',%s,%s,%s)
                    ON CONFLICT ("channelId","externalId") DO NOTHING
                    """,
                    (
                        nid("ci"), channel_id, ext, title, link, status, wp_id,
                        tier, now_ts, aio_note,
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
