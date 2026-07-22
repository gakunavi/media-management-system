#!/usr/bin/env python3
"""ラッコキーワードのエクスポートを取り込む（設計書 §3-8 KWリサーチ・§13.3）

★正本はメディア事業部側。MMS は読むだけ。
  ラッコは現行プランで API が使えず、cowork が Chrome を自動操作して取得し、
  メディア事業部の規約（rakko-required.md）に従って保存している:

      shared/keywords/rakko-exports/<YYYY-MM>/<kw-slug>/
          meta.yaml
          suggestions.csv  related.csv  cooccurrence.csv
          questions.csv    headings.csv

  MMS 側に別の受け口を作ると保存先が二重になり、どちらが正か分からなくなる。
  §6「既存資産は書き直さない」に従い、**この正本を読み取り専用で参照する**。
  ファイルは移動も削除もしない。

対応（KeywordResearch の各列は、この5ファイルにそのまま対応する）:
  meta.yaml        → Keyword.volume / difficulty / cpc, KeywordVolume
  suggestions.csv  → KeywordResearch.suggests
  related.csv      → KeywordResearch.related
  cooccurrence.csv → KeywordResearch.cooccurrence
  headings.csv     → KeywordResearch.competitorH2
  questions.csv    → KeywordResearch.qaQuestions（§13.4-② 未回答はネタ化）
  meta.article_id  → KeywordAssignment（KW ↔ 記事の割当・§3.1）

環境変数:
  MMS_RAKKO_EXPORTS_DIR  … 既定 /app/rakko-exports（compose で読み取り専用マウント）

使い方:
  docker compose exec worker python builtin/rakko_import.py --dry-run
  docker compose exec worker python builtin/rakko_import.py
"""

from __future__ import annotations

import csv
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
import yaml

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
EXPORTS = Path(os.environ.get("MMS_RAKKO_EXPORTS_DIR", "/app/rakko-exports"))

# §13.3「90日鮮度 → 30日前に自動再取得」
RESEARCH_TTL_DAYS = 90

# ファイル名 → KeywordResearch の列
CSV_TO_COLUMN = {
    "suggestions.csv": "suggests",
    "related.csv": "related",
    "cooccurrence.csv": "cooccurrence",
    "headings.csv": "competitorH2",
    "questions.csv": "qaQuestions",
}


def log(msg: str) -> None:
    print(f"[rakko_import] {msg}", flush=True)


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


def norm_kw(s: str) -> str:
    """KW照合用。全角空白と連続空白の揺れを吸収する"""
    return " ".join(str(s or "").replace("　", " ").split()).lower()


def to_int(v):
    try:
        return int(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def to_float(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def read_csv(path: Path) -> list[dict]:
    """CSVを辞書の配列にする。読めなければ空ではなく例外にしない（部分取り込みを許す）"""
    try:
        with path.open(encoding="utf-8-sig", newline="") as f:
            return [dict(r) for r in csv.DictReader(f)]
    except OSError as e:
        log(f"  ★読めません {path.name}: {e}")
        return []


def load_export(d: Path) -> dict | None:
    meta_path = d / "meta.yaml"
    if not meta_path.is_file():
        return None
    try:
        meta = yaml.safe_load(meta_path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as e:
        log(f"★meta.yaml を読めません {d.name}: {e}")
        return None

    # ★meta.yaml には2形式ある（2026-06 に規約が変わった）。両方読む。
    #   片方だけ対応すると 47件中 38件を静かに取りこぼす（実際に起きた）。
    #     形式A(2026-05, 7件): keyword / search_volume / seo_difficulty / cpc
    #     形式B(2026-06〜,38件): main_kw / volume_jp / difficulty / cpc_jpy
    keyword = meta.get("keyword") or meta.get("main_kw")
    if not keyword:
        log(f"★{d.name}: meta.yaml に keyword / main_kw がありません")
        return None

    payload = {}
    for fname, column in CSV_TO_COLUMN.items():
        p = d / fname
        payload[column] = read_csv(p) if p.is_file() else None

    return {
        "dir": d,
        "keyword": str(keyword),
        "slug": meta.get("slug") or d.name,
        # 形式Bは article_id を持たず notes に「ART-124〜129」等が書かれる。
        # ★範囲表記や複数記事の共有利用があり、機械的に1本へ割り当てると誤る。
        #   誤った割当は §3.1 のカニバリ検出を壊すので、明示的な article_id だけ使う
        "articleId": meta.get("article_id"),
        "month": str(meta.get("month") or d.parent.name),
        "fetchedAt": meta.get("fetched_at"),
        "volume": to_int(meta.get("search_volume") if meta.get("search_volume") is not None
                         else meta.get("volume_jp")),
        "difficulty": to_int(meta.get("seo_difficulty") if meta.get("seo_difficulty") is not None
                             else meta.get("difficulty")),
        "cpc": to_float(meta.get("cpc") if meta.get("cpc") is not None else meta.get("cpc_jpy")),
        "intent": meta.get("intent"),
        "payload": payload,
    }


def as_datetime(v) -> datetime:
    """meta.fetched_at は date で来る。無ければ現在時刻"""
    if isinstance(v, datetime):
        return v.replace(tzinfo=v.tzinfo or JST)
    if v is not None:
        try:
            return datetime.fromisoformat(str(v)).replace(tzinfo=JST)
        except ValueError:
            pass
    return datetime.now(JST)


def main() -> int:
    dry = "--dry-run" in sys.argv
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")
    if not EXPORTS.is_dir():
        log(f"エクスポート置き場がありません: {EXPORTS}")
        return 1

    dirs = sorted(p for p in EXPORTS.glob("*/*") if p.is_dir())
    exports = [e for e in (load_export(d) for d in dirs) if e]
    log(f"{len(dirs)}ディレクトリ中 {len(exports)}件が取り込み対象")
    if not exports:
        return 0

    slug = os.environ.get("MMS_DEFAULT_BUSINESS_SLUG", "tax-saving-agency")
    now = datetime.now(JST)

    created = updated = volumes = researches = assignments = 0
    skipped_research = 0
    missing_articles: list[str] = []

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        use_utc(conn)
        cur.execute('SELECT id FROM "Business" WHERE slug=%s', (slug,))
        got = cur.fetchone()
        if not got:
            raise RuntimeError(f"Business({slug}) がありません")
        business_id = got[0]

        cur.execute('SELECT id, keyword FROM "Keyword" WHERE "businessId"=%s', (business_id,))
        kw_ids = {norm_kw(k): i for i, k in cur.fetchall()}

        cur.execute('SELECT id, "externalId" FROM "ContentItem"')
        article_ids = {e: i for i, e in cur.fetchall() if e}

        for ex in exports:
            key = norm_kw(ex["keyword"])
            kid = kw_ids.get(key)

            # ★調査したKWは登録する。運用者が明示的に調べた＝スコープ内である
            #   ことが行動で示されている（サジェスト数百件の自動登録とは別）
            if not kid:
                if dry:
                    created += 1
                    log(f"  [dry-run] 新規KW「{ex['keyword']}」")
                    continue
                new_id = nid("kw")
                cur.execute(
                    """
                    INSERT INTO "Keyword"
                      ("id","businessId","keyword","slug","volume","difficulty","cpc",
                       "budgetTier","productFit","createdAt","updatedAt")
                    VALUES (%s,%s,%s,%s,%s,%s,%s,'unknown','{}',%s,%s)
                    ON CONFLICT ("businessId","keyword") DO NOTHING
                    """,
                    (new_id, business_id, ex["keyword"], ex["slug"],
                     ex["volume"], ex["difficulty"], ex["cpc"], now, now),
                )
                cur.execute(
                    'SELECT id FROM "Keyword" WHERE "businessId"=%s AND keyword=%s',
                    (business_id, ex["keyword"]),
                )
                row = cur.fetchone()
                if not row:
                    continue
                kid = row[0]
                kw_ids[key] = kid
                created += 1
            elif not dry:
                cur.execute(
                    'UPDATE "Keyword" SET "volume"=COALESCE(%s,"volume"), '
                    '"difficulty"=COALESCE(%s,"difficulty"), "cpc"=COALESCE(%s,"cpc"), '
                    '"updatedAt"=%s WHERE id=%s',
                    (ex["volume"], ex["difficulty"], ex["cpc"], now, kid),
                )
                updated += 1

            if dry:
                continue

            # ── 月次ボリューム ──
            if ex["volume"] is not None:
                cur.execute(
                    """
                    INSERT INTO "KeywordVolume"
                      ("id","keywordId","month","volume","source","createdAt","updatedAt")
                    VALUES (%s,%s,%s,%s,'rakko',%s,%s)
                    ON CONFLICT ("keywordId","month","source")
                    DO UPDATE SET "volume"=EXCLUDED."volume", "updatedAt"=EXCLUDED."updatedAt"
                    """,
                    (nid("kv"), kid, ex["month"], ex["volume"], now, now),
                )
                volumes += 1

            # ── リサーチ本体（★同じ取得日を二重に入れない）──
            fetched = as_datetime(ex["fetchedAt"])
            cur.execute(
                'SELECT 1 FROM "KeywordResearch" WHERE "keywordId"=%s AND source=%s '
                'AND "fetchedAt"=%s',
                (kid, "rakko", fetched),
            )
            if cur.fetchone():
                skipped_research += 1
            else:
                p = ex["payload"]
                cur.execute(
                    """
                    INSERT INTO "KeywordResearch"
                      ("id","keywordId","fetchedAt","source","expiresAt",
                       "suggests","related","cooccurrence","competitorH2","qaQuestions",
                       "createdAt","updatedAt")
                    VALUES (%s,%s,%s,'rakko',%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        nid("kr"), kid, fetched, fetched + timedelta(days=RESEARCH_TTL_DAYS),
                        *[json.dumps(p[c], ensure_ascii=False) if p[c] is not None else None
                          for c in ("suggests", "related", "cooccurrence", "competitorH2", "qaQuestions")],
                        now, now,
                    ),
                )
                researches += 1

            # ── KW ↔ 記事の割当（§3.1 main重複＝カニバリをDB制約で検出）──
            art = ex["articleId"]
            if art:
                cid = article_ids.get(art)
                if not cid:
                    # ★存在しない記事IDを黙って捨てない。割当漏れは気づけない
                    missing_articles.append(f"{ex['keyword']}→{art}")
                else:
                    cur.execute(
                        """
                        INSERT INTO "KeywordAssignment"
                          ("id","keywordId","contentItemId","role","createdAt","updatedAt")
                        VALUES (%s,%s,%s,'main',%s,%s)
                        ON CONFLICT ("keywordId","role") DO NOTHING
                        """,
                        (nid("ka"), kid, cid, now, now),
                    )
                    assignments += 1

        if not dry:
            conn.commit()

    log(
        f"{'[dry-run] ' if dry else ''}完了: KW新規 {created} / 更新 {updated} / "
        f"月次ボリューム {volumes} / リサーチ {researches}"
        f"（取得日が同じで既存 {skipped_research}）/ 記事割当 {assignments}"
    )
    if missing_articles:
        log(f"★MMSに無い記事IDへの割当 {len(missing_articles)}件: {missing_articles[:5]}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
