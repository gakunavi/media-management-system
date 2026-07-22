#!/usr/bin/env python3
"""公式LINEの友だち数を Messaging API から取り込む（2026-07-23）

★なぜ要るか
  友だち総数は **Webhook では取れない**。理由は2つ:
    1. Webhook 設置（2026-07-22）より前の友だちには event が起きない
    2. 設置後も follow/unfollow の増減しか分からず、母数が分からない
  総数が無いと「登録率」「ブロック率」が出せず、公式LINEの画面は
  増減しか語れない。石井さんがチャネルアクセストークンを発行したので、
  insight/followers から日次で取り込む。

★API の仕様（LINE Messaging API）
  GET https://api.line.me/v2/bot/insight/followers?date=yyyyMMdd
    followers        … その日までに友だち追加した延べ人数（ブロックしても減らない）
    blocks           … その日時点でブロックしている人数
    targetedReaches  … 配信可能な人数（オプトイン済み）
    status           … ready / unready / out_of_service

  ★「友だち数」として使えるのは followers - blocks。
    followers だけを出すと、ブロックされても増え続ける数字を
    「友だち数」と呼ぶことになり、実態とずれる。
  ★集計は前日ぶんが翌日に確定する。当日を指定すると unready が返る。

環境変数:
  MMS_LINE_CHANNEL_ACCESS_TOKEN … チャネルアクセストークン（長期）
  MMS_DATABASE_URL
  MMS_DEFAULT_BUSINESS_SLUG
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

JST = timezone(timedelta(hours=9), "JST")
API = "https://api.line.me/v2/bot/insight/followers"
TIMEOUT = 30

# ★何日前まで遡って埋めるか。API は過去のぶんも返すので、
#   ジョブが数日止まっても穴が埋まるようにする
BACKFILL_DAYS = 7


def log(msg: str) -> None:
    print(f"[line_followers] {msg}", flush=True)


def normalize_dsn(url: str) -> str:
    """?schema=... を psycopg が読める形に直す（他の builtin と同じ）"""
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = params.pop("schema", None)
    if schema:
        params.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(params, safe="-%"), parts.fragment)
    )


def use_utc(conn) -> None:
    """DBセッションを UTC に固定する（他の builtin と同じ理由・JST混在を防ぐ）"""
    with conn.cursor() as c:
        c.execute("SET TIME ZONE 'UTC'")


def fetch(token: str, day: datetime) -> dict | None:
    url = f"{API}?date={day.strftime('%Y%m%d')}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        if e.code in (401, 403):
            # ★トークンが違う/権限が無い。黙って0件にせず落とす
            raise RuntimeError(f"認証に失敗しました（HTTP {e.code}）: {body}") from e
        log(f"★{day:%Y-%m-%d} の取得に失敗（HTTP {e.code}）: {body}")
        return None
    except Exception as e:  # noqa: BLE001
        log(f"★{day:%Y-%m-%d} の取得に失敗: {e}")
        return None


def main() -> int:
    token = (os.environ.get("MMS_LINE_CHANNEL_ACCESS_TOKEN") or "").strip()
    if not token:
        # ★未設定は異常ではない（トークンを持たない環境もある）。
        #   ただし「取れていない」ことは分かるようにログに残す
        log("MMS_LINE_CHANNEL_ACCESS_TOKEN が未設定です（取り込みなしで終了）")
        return 0

    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")
    slug = os.environ.get("MMS_DEFAULT_BUSINESS_SLUG", "tax-saving-agency")

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        use_utc(conn)
        cur.execute('SELECT id FROM "Business" WHERE slug=%s', (slug,))
        row = cur.fetchone()
        if not row:
            raise RuntimeError(f"Business({slug}) がありません")
        business_id = row[0]

        # LINE のチャネル行（無ければ作る）
        cur.execute("""SELECT id FROM "Channel" WHERE "businessId"=%s AND type='line'""", (business_id,))
        row = cur.fetchone()
        if row:
            channel_id = row[0]
        else:
            cur.execute(
                'INSERT INTO "Channel"(id,"businessId",type,"accountRef",name,config,'
                '"createdAt","updatedAt") '
                "VALUES (gen_random_uuid()::text,%s,'line','official','公式LINE','{}'::jsonb,"
                "now(),now()) RETURNING id",
                (business_id,),
            )
            channel_id = cur.fetchone()[0]
            log("Channel(line) を作成しました")

        today = datetime.now(JST).date()
        saved = 0
        prev_net: int | None = None

        for i in range(BACKFILL_DAYS, 0, -1):
            day = datetime.combine(today - timedelta(days=i), datetime.min.time())
            data = fetch(token, day)
            if not data:
                continue
            status = data.get("status")
            if status != "ready":
                # ★unready は「まだ集計中」。0 として保存すると友だちが消える
                log(f"  {day:%Y-%m-%d}: status={status}（保存しません）")
                continue

            followers = int(data.get("followers") or 0)
            blocks = int(data.get("blocks") or 0)
            # ★ブロックを引いた実数を「友だち数」として持つ
            net = max(0, followers - blocks)
            delta = 0 if prev_net is None else net - prev_net
            prev_net = net

            cur.execute(
                'SELECT id FROM "SnsAccountHealth" WHERE "channelId"=%s AND date=%s',
                (channel_id, day.date()),
            )
            existing = cur.fetchone()
            if existing:
                cur.execute(
                    'UPDATE "SnsAccountHealth" SET followers=%s, "followersDelta"=%s, '
                    '"updatedAt"=now() WHERE id=%s',
                    (net, delta, existing[0]),
                )
            else:
                cur.execute(
                    'INSERT INTO "SnsAccountHealth"(id,"channelId",date,followers,'
                    '"followersDelta","createdAt","updatedAt") '
                    "VALUES (gen_random_uuid()::text,%s,%s,%s,%s,now(),now())",
                    (channel_id, day.date(), net, delta),
                )
            saved += 1
            log(f"  {day:%Y-%m-%d}: 友だち {net}（追加延べ {followers} / ブロック {blocks}）")

        # ★計測開始を記録する（§3）。これが無いと画面が「未計測」のままになる
        cur.execute('SELECT 1 FROM "MeasurementCoverage" WHERE metric=%s', ("line_followers",))
        if not cur.fetchone() and saved:
            cur.execute(
                'INSERT INTO "MeasurementCoverage"(id,metric,"channelId","startedAt",method,note,'
                '"createdAt","updatedAt") VALUES (gen_random_uuid()::text,%s,%s,%s,%s,%s,now(),now())',
                (
                    "line_followers",
                    channel_id,
                    datetime.now(timezone.utc),
                    "line_insight_api",
                    "Messaging API insight/followers から日次取得（友だち数＝追加延べ − ブロック）",
                ),
            )
        conn.commit()

    log(f"完了: {saved}日ぶんを保存")
    return 0


if __name__ == "__main__":
    sys.exit(main())
