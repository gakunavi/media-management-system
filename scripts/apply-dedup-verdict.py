"""重複メインKWの振り直し（cowork 判定 2026-07-23）

★適用するもの
  ART-163 → GPUサーバー 即時償却   （PRJ-030の仮KW放置・GPU特化へ）
  ART-165 → AIサーバー 即時償却     （同上・表示ほぼ0でKW再設計必須）
  「即時償却 税額控除」の本命 → ART-177（009:41位0クリック / 177:15.8位3クリック）

★適用しないもの（人の判断が要る）
  ART-009 の「177へ統合(301)」は記事の統廃合そのもの。石井さん判断。
  ここでは main を 177 に移すだけで、009 の狙い(mainKeywordId)は消さない。
  消すと「009が何を狙っていたか」が失われ、統合判断の材料がなくなる。
"""
import os, sys, uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import psycopg

JST = timezone(timedelta(hours=9), "JST"); now_ts = datetime.now(JST)
REASSIGN = {"ART-163": "GPUサーバー 即時償却", "ART-165": "AIサーバー 即時償却"}
MAIN_OWNER = {"即時償却 税額控除": "ART-177"}

def norm(u):
    p=urlsplit(u); q=dict(parse_qsl(p.query,keep_blank_values=True)); s=q.pop("schema",None)
    if s: q.setdefault("options", f"-csearch_path%3D{s}")
    return urlunsplit((p.scheme,p.netloc,p.path,urlencode(q,safe="-%"),p.fragment))
def nid(p): return f"{p}_{uuid.uuid4().hex}"
def slugify(s):
    import re
    b=re.sub(r"[^a-z0-9]+","-",s.lower()).strip("-"); h=uuid.uuid5(uuid.NAMESPACE_URL,s).hex[:8]
    return f"{b[:50]}-{h}" if b else f"kw-{h}"

apply_changes = "--apply" in sys.argv
with psycopg.connect(norm(os.environ["MMS_DATABASE_URL"])) as conn, conn.cursor() as cur:
    cur.execute("SET TIME ZONE 'UTC'")
    cur.execute('SELECT "externalId", id FROM "ContentItem"'); items=dict(cur.fetchall())
    cur.execute('SELECT id FROM "Business" WHERE slug=%s',
                (os.environ.get("MMS_DEFAULT_BUSINESS_SLUG") or "tax-saving-agency",))
    biz = cur.fetchone()[0]
    cur.execute('SELECT keyword,id FROM "Keyword" WHERE "businessId"=%s',(biz,)); kws=dict(cur.fetchall())

    def kw_id(k):
        if k in kws: return kws[k]
        i=nid("kw")
        cur.execute('INSERT INTO "Keyword"("id","businessId",keyword,slug,"createdAt","updatedAt")'
                    ' VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT ("businessId",keyword) DO NOTHING',
                    (i,biz,k,slugify(k),now_ts,now_ts))
        if cur.rowcount==0:
            cur.execute('SELECT id FROM "Keyword" WHERE "businessId"=%s AND keyword=%s',(biz,k)); i=cur.fetchone()[0]
        kws[k]=i; return i

    for ext,new_kw in REASSIGN.items():
        print(f"  {ext} のメインKW → 「{new_kw}」")
    for kw,ext in MAIN_OWNER.items():
        print(f"  「{kw}」の本命 → {ext}")
    print("  ★ART-009 は狙い(mainKeywordId)を残す。統合(301)は石井さん判断")

    if not apply_changes:
        print("★dry-run"); sys.exit(0)

    for ext,new_kw in REASSIGN.items():
        if ext not in items: print(f"  ★{ext} が無い"); continue
        kid=kw_id(new_kw)
        cur.execute('UPDATE "ContentItem" SET "mainKeywordId"=%s,"updatedAt"=%s WHERE id=%s',
                    (kid,now_ts,items[ext]))
        cur.execute('INSERT INTO "KeywordAssignment"(id,"keywordId","contentItemId",role,"createdAt","updatedAt")'
                    " VALUES(%s,%s,%s,'main',%s,%s) ON CONFLICT (\"keywordId\",role)"
                    ' DO UPDATE SET "contentItemId"=EXCLUDED."contentItemId","updatedAt"=EXCLUDED."updatedAt"',
                    (nid("ka"),kid,items[ext],now_ts,now_ts))
    for kw,ext in MAIN_OWNER.items():
        if ext not in items or kw not in kws: continue
        cur.execute('UPDATE "KeywordAssignment" SET "contentItemId"=%s,"updatedAt"=%s'
                    " WHERE \"keywordId\"=%s AND role='main'",(items[ext],now_ts,kws[kw]))
    conn.commit(); print("✅ 反映")
