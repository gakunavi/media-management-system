#!/usr/bin/env python3
"""cowork の代理店DMログを AgencyLead に取り込む（設計書 §3-6・§13.4-④）

★なぜ要るか
  MMS の /threads は「代理店募集の投稿はあるのに DM の記録が1件もない」と
  警告を出していた。だが実際には DM は来ていて、cowork の日次監視タスク
  （threads-daily-monitor Step 2B）が画面を見て検知し、
  dm-log.md に相手・アングル・判定まで書いていた。
  取り込んでいなかっただけで、MMS は「代理店募集の効果ゼロ」という
  誤った像を出していた。

★このファイルは cowork 側の正本。**読み取りのみ**で書き換えない（§6）。
  運用の実体は cowork にあり、MMS が勝手に直すと二重管理になる。

★AgencyLead と Lead の両方に入れる（2026-07-22 石井さんの指摘で修正）
  Threads は送客元で、DM は受け皿の1つ。他の受け皿（LINE・LP・電話・メール）は
  すべて Lead に入るのに、Threads DM だけ AgencyLead にしか無かった。
  そのため /leads の受け皿一覧で Threads DM だけ永久に「未計測」になっていた。
    AgencyLead … 代理店としての選別パイプライン（stage 遷移）
    Lead       … 受け皿をまたいだ獲得の実績（件数・成約・金額）
  役割が違うので両方持つ。二重計上ではない。

★判定の対応（dm-log.md → AgencyLeadStage）
    有効          → qualified
    有効候補      → answered   （まだ選別が終わっていない。qualified にしない）
    保留          → screening_sent
    無効          → rejected
  ★「有効候補」を qualified に寄せると、有効DM数が実態より多く出る。
    KPI を良く見せる方向の丸めは入れない（§16.5）。

環境変数:
  MMS_DM_LOG_PATH   … dm-log.md のパス
  MMS_DATABASE_URL
"""

from __future__ import annotations

import os
import re
import sys
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


def to_db(dt: datetime) -> datetime:
    """aware な日時を **UTC の naive** に直す。

    ★2026-07-22 に発覚した不整合の対処。
      Prisma は UTC を `timestamp without time zone` の列に書き、読むときも
      UTC として解釈して表示時に JST へ直す。
      一方 psycopg が aware な日時を渡すと、Postgres がセッションの
      TimeZone（Asia/Tokyo）で naive に変換するため **JST が入る**。
      同じ列に UTC と JST が混ざり、Prisma 側で 9時間ずれた値になる。
      日付境界をまたぐ行では集計日が1日ずれる。
    """
    return dt.astimezone(timezone.utc).replace(tzinfo=None)

# dm-log.md の判定列 → AgencyLeadStage
# ★前方一致で見るので「有効候補」を「有効」より先に置く
STAGE_MAP: tuple[tuple[str, str], ...] = (
    ("有効候補", "answered"),
    ("有効", "qualified"),
    ("保留", "screening_sent"),
    ("無効", "rejected"),
)

# AgencyLeadStage → LeadStatus
# ★「有効候補」を qualified にしない（下の注記と同じ理由）。
#   無効は lost。返信済み＝接触済みなので contacted に寄せる。
LEAD_STATUS_MAP: dict[str, str] = {
    "answered": "contacted",
    "qualified": "qualified",
    "screening_sent": "contacted",
    "rejected": "lost",
    "received": "new",
}

# 反応元が集客投稿なら「見込み客」。それ以外（アングル・代理店DMリクエスト）は「代理店候補」。
#
# ★なぜ分けるか（2026-07-23 cowork の指摘）
#   この取り込みは Lead.type を 'agency' に決め打ちし、AgencyLead にも無条件で
#   起票していた。集客投稿から来たDMを同じファイルに書くと、見込み客が
#   代理店候補として起票され、**代理店の歩留まりの分母が壊れる**。
#   相手が何を求めて来たのかは記録の「反応元」列にしか無いので、そこで判定する。
#
# ★列は増やさない。dm-log.md の列順と判定4語は MMS が依存している契約で、
#   増やすと cowork 側の記録運用も MMS 側のパーサも両方直すことになる。
PROSPECT_PREFIX = "集客"

# 「A12(相互送客の座組み) への返信」「A12相互送客」から A12 を取り出す。
# ★\b は使えない。Python の \w は CJK を含むので "A12相互" に境界が立たず
#   アングルを取りこぼす（実際に @lightconnect.ia を取りこぼした）
ANGLE_RE = re.compile(r"(A\d{2})(?!\d)")


def log(msg: str) -> None:
    print(f"[dm_log_import] {msg}", flush=True)


def normalize_dsn(url: str) -> str:
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = params.pop("schema", None)
    if schema:
        params.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(params, safe="-%"), parts.fragment)
    )


def parse_stage(verdict: str) -> str | None:
    v = verdict.strip()
    for key, stage in STAGE_MAP:
        if v.startswith(key):
            return stage
    return None


# HTML コメント。中に「記録フォーマットの例」が書かれており、
# そのまま読むと @example という架空のリードが1件生まれる（実際に生まれた）
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)


def parse_rows(text: str) -> list[dict]:
    """記録テーブルの行だけを拾う。見出し・区切り・コメント例は捨てる"""
    out: list[dict] = []
    for line in COMMENT_RE.sub("", text).splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if len(cells) < 6:
            continue
        # 見出し行と区切り行
        if cells[0] in ("日付", "") or set(cells[0]) <= {"-", ":"}:
            continue
        # 日付として読めない行は記録ではない（説明文など）
        m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", cells[0])
        if not m:
            continue
        handle = cells[1].lstrip("@").strip()
        if not handle or handle.startswith("@example"):
            continue

        y, mo, d = (int(x) for x in m.groups())
        stage = parse_stage(cells[5])
        if stage is None:
            log(f"★判定を解釈できない行を飛ばしました: {cells[0]} @{handle} 「{cells[5]}」")
            continue

        angle_src = f"{cells[2]} {cells[3]}"
        angle = ANGLE_RE.search(angle_src)
        # ★判定は「反応元」列の先頭だけを見る。本文（要約）に「集客」の語が
        #   出ただけで見込み客に化けると、代理店の実績が静かに減る
        is_prospect = cells[2].strip().startswith(PROSPECT_PREFIX)
        out.append(
            {
                "handle": handle,
                "received_at": datetime(y, mo, d, tzinfo=JST),
                "angle": angle.group(1) if angle else None,
                "is_prospect": is_prospect,
                "stage": stage,
                "summary": cells[3],
                "answer": cells[4],
                "verdict": cells[5],
            }
        )
    return out


def main() -> int:
    path = os.environ.get("MMS_DM_LOG_PATH", "").strip()
    if not path:
        log("MMS_DM_LOG_PATH が未設定です（.env を確認してください）")
        return 1
    if not os.path.exists(path):
        # ★ここで落とさない。cowork 側のフォルダが無い環境（本番/CI）でも
        #   他のジョブを巻き込まないため
        log(f"★dm-log.md が見つかりません（取り込みなしで終了）: {path}")
        return 0

    with open(path, encoding="utf-8") as f:
        rows = parse_rows(f.read())
    log(f"dm-log.md から {len(rows)} 件を解釈しました")
    if not rows:
        return 0

    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")
    slug = os.environ.get("MMS_DEFAULT_BUSINESS_SLUG", "tax-saving-agency")

    # 同じ相手が複数行に出る（初回反応 → 続き）。最後の行がいまの状態
    latest: dict[str, dict] = {}
    for r in rows:
        prev = latest.get(r["handle"])
        if prev is None or r["received_at"] >= prev["received_at"]:
            # ★受信日は「最初に来た日」を保つ。ファネルの経過日数が狂う
            first = prev["first_at"] if prev else r["received_at"]
            latest[r["handle"]] = {**r, "first_at": first}

    now = datetime.now(JST)
    created = updated = 0
    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        use_utc(conn)
        cur.execute('SELECT id FROM "Business" WHERE slug=%s', (slug,))
        row = cur.fetchone()
        if not row:
            raise RuntimeError(f"Business({slug}) がありません")
        business_id = row[0]

        for handle, r in latest.items():
            answers = psycopg.types.json.Json(
                {
                    "angle": r["angle"],
                    "summary": r["summary"],
                    "answer": r["answer"],
                    "verdict": r["verdict"],
                    "source": "cowork dm-log.md",
                }
            )
            # ★見込み客は代理店パイプラインに入れない。入れると
            #   「DM受信 → 有効 → 契約」の分母に代理店希望でない人が混ざる
            if r["is_prospect"]:
                row = None
            else:
                cur.execute(
                    'SELECT id, stage FROM "AgencyLead" WHERE "threadsUserId"=%s', (handle,)
                )
                row = cur.fetchone()
            if r["is_prospect"]:
                pass
            elif row:
                cur.execute(
                    'UPDATE "AgencyLead" SET stage=%s, "screeningAnswers"=%s, "updatedAt"=%s '
                    "WHERE id=%s",
                    (r["stage"], answers, to_db(now), row[0]),
                )
                updated += 1
            else:
                # ★sourcePostId は ContentItem.externalId（THR-xxx）への参照。
                #   dm-log.md が持っているのはアングル記号（A12）で、1つの
                #   アングルに複数の投稿があるため投稿は特定できない。
                #   ここに A12 を入れると投稿との紐付けが静かに壊れるので、
                #   アングルは screeningAnswers 側にだけ持たせて null のままにする。
                cur.execute(
                    'INSERT INTO "AgencyLead"(id,"threadsUserId","receivedAt",'
                    'stage,"screeningAnswers","createdAt","updatedAt") '
                    "VALUES (gen_random_uuid()::text,%s,%s,%s,%s,%s,%s)",
                    (handle, to_db(r["first_at"]), r["stage"], answers, to_db(now), to_db(now)),
                )
                created += 1
            # ── 受け皿としての Lead も持つ ──
            # ★他の受け皿はすべて Lead に入る。Threads DM だけ入らないと
            #   /leads の受け皿一覧で永久に「未計測」になる
            lead_status = LEAD_STATUS_MAP.get(r["stage"], "new")
            # ★受け皿は同じ Threads DM でも、相手の性質が違う。
            #   直客の問い合わせ（direct_inquiry）と代理店（agency）を混ぜない
            lead_type = "direct_inquiry" if r["is_prospect"] else "agency"
            cur.execute(
                'SELECT id FROM "Lead" WHERE "sourceType"=\'threads_dm\' AND note=%s',
                (f"Threads DM @{handle}",),
            )
            lead = cur.fetchone()
            if lead:
                # ★type も更新する。記録側で「代理店希望 → 見込み客」と
                #   直したのに MMS が古い区分を持ち続けると、二度と一致しない
                cur.execute(
                    'UPDATE "Lead" SET status=%s, type=%s, "updatedAt"=%s WHERE id=%s',
                    (lead_status, lead_type, to_db(now), lead[0]),
                )
            else:
                cur.execute(
                    'INSERT INTO "Lead"(id,"businessId",type,"sourceType","occurredAt",status,'
                    'note,"createdAt","updatedAt") '
                    "VALUES (gen_random_uuid()::text,%s,%s,'threads_dm',%s,%s,%s,%s,%s)",
                    (
                        business_id,
                        lead_type,
                        to_db(r["first_at"]),
                        lead_status,
                        f"Threads DM @{handle}",
                        to_db(now),
                        to_db(now),
                    ),
                )

            kind = "見込み客" if r["is_prospect"] else "代理店"
            log(
                f"  @{handle}  {kind}  angle={r['angle'] or '—'}  "
                f"{r['verdict']} → {r['stage']}/{lead_status}"
            )
        # ★受け皿として計測が始まっていることを記録する（§3）。
        #   これが無いと /leads で Threads DM が「未計測」のままになる。
        #
        # ★指標を2つに分ける（2026-07-23）。
        #     lead_threads_dm … 受け皿「Threads DM」の計測（代理店・見込み客の両方）
        #     lead_agency     … 代理店リードの計測（代理店パイプラインの分母）
        #   1つにまとめると、集客DMしか来ていない期間でも「代理店を計測中」に
        #   見えてしまう。逆も同じで、どちらが測れているのか分からなくなる。
        def ensure_coverage(metric: str, started_at, note: str) -> None:
            cur.execute('SELECT 1 FROM "MeasurementCoverage" WHERE metric=%s', (metric,))
            if cur.fetchone():
                return
            cur.execute(
                'INSERT INTO "MeasurementCoverage"(id,metric,"startedAt",method,note,'
                '"createdAt","updatedAt") VALUES (gen_random_uuid()::text,%s,%s,%s,%s,%s,%s)',
                (metric, to_db(started_at), "cowork_dm_log", note, to_db(now), to_db(now)),
            )

        if latest:
            ensure_coverage(
                "lead_threads_dm",
                min(r["first_at"] for r in latest.values()),
                "cowork の日次監視が dm-log.md に記録したDMを取り込んで計測（§3-6）",
            )
        agency_rows = [r for r in latest.values() if not r["is_prospect"]]
        if agency_rows:
            ensure_coverage(
                "lead_agency",
                min(r["first_at"] for r in agency_rows),
                "dm-log.md の代理店候補DM（反応元がアングル）を取り込んで計測（§3-6）",
            )
        conn.commit()

    log(f"完了: 新規 {created}件 / 更新 {updated}件")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
