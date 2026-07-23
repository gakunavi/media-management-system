"""基準日が無い記事を情報基準日（内容基準）で埋める。

★cowork 指示（2026-07-23）:「鮮度計算には INFO_DATE（内容基準）を使ってください」
  最終更新日が未来日（＝公開予定日のミラー）の3件は特にこれが正しい。
★日付として読めないもの（「2026年度税制改正大綱に基づく」等）は publishedAt に落とす。
  それも無ければ**埋めない**（§3）。
"""
import csv, os, re, sys
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import psycopg

JST = timezone(timedelta(hours=9), "JST")
now_ts = datetime.now(JST)

def norm(u):
    p = urlsplit(u); q = dict(parse_qsl(p.query, keep_blank_values=True))
    s = q.pop("schema", None)
    if s: q.setdefault("options", f"-csearch_path%3D{s}")
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q, safe="-%"), p.fragment))

def parse_info(v):
    """情報基準日を日付にする。『2026年5月時点』は月初に倒す（月内のどこかは不明）。"""
    v = (v or "").strip()
    if not v: return None
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", v)
    if m: return datetime(int(m[1]), int(m[2]), int(m[3]), tzinfo=JST)
    m = re.search(r"(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日", v)
    if m: return datetime(int(m[1]), int(m[2]), int(m[3]), tzinfo=JST)
    m = re.search(r"(\d{4})年\s*(\d{1,2})月", v)
    if m: return datetime(int(m[1]), int(m[2]), 1, tzinfo=JST)
    return None

apply_changes = "--apply" in sys.argv
rows = {r["ART番号"].strip(): r for r in csv.DictReader(open("/tmp/cl.csv", encoding="utf-8-sig"))
        if (r.get("ART番号") or "").strip()}

with psycopg.connect(norm(os.environ["MMS_DATABASE_URL"])) as conn, conn.cursor() as cur:
    cur.execute("SET TIME ZONE 'UTC'")
    cur.execute('SELECT id,"externalId","publishedAt" FROM "ContentItem"'
                ' WHERE type IN (\'article\',\'article_unlinked\')'
                ' AND "freshnessTier" IS NOT NULL AND "lastReviewedAt" IS NULL')
    todo = cur.fetchall()
    plan, skipped = [], []
    for cid, ext, pub in todo:
        d = parse_info((rows.get(ext) or {}).get("情報基準日(参考)"))
        src = "情報基準日"
        if d is None and pub is not None:
            d, src = pub, "公開日"
        if d is None:
            skipped.append(ext); continue
        plan.append((cid, ext, d, src))
    for _c, ext, d, src in plan:
        print(f"  {ext}  {d.date()}  ({src})")
    print(f"埋める {len(plan)}本 / 埋めない {len(skipped)}本 {skipped}")
    if apply_changes:
        for cid, _e, d, _s in plan:
            cur.execute('UPDATE "ContentItem" SET "lastReviewedAt"=%s,"updatedAt"=%s WHERE id=%s',
                        (d, now_ts, cid))
        conn.commit(); print("✅ 反映")
    else:
        print("★dry-run")
