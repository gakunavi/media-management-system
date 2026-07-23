#!/usr/bin/env python3
"""台帳3点照合を回して結果を MMS に取り込む（日次）

★cowork 作の `tools/media-console/ledger_integrity_check.py` を起動するだけの薄い層。
  スクリプト本体はメディア事業部リポジトリにあり、:ro マウントで読める（§D17 と同じ方針・
  コピーすると本体と乖離し「直したのに worker は古いまま」が起きる）。

★静的（原因）と動的（症状）の2段構え
  こちらは台帳・config・実公開の**突合**。実URLを叩くのは `url_health.py`。
  2026-07-23 のピラー301ループは三者が一致していたため静的では拾えなかった。
  逆に slug の打ち間違いは叩く前に静的で分かる。両方要る。

必要な環境変数: MMS_DATABASE_URL / MMS_WORKER_LEGACY_DIR（既定 /app/legacy）
任意: MMS_LEDGER_REPO（既定は legacy の親を辿る）
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

JST = timezone(timedelta(hours=9), "JST")
now_ts = datetime.now(JST)


def log(m: str) -> None:
    print(f"[ledger_check] {m}", flush=True)


def normalize_dsn(url: str) -> str:
    p = urlsplit(url)
    q = dict(parse_qsl(p.query, keep_blank_values=True))
    schema = q.pop("schema", None)
    if schema:
        q.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q, safe="-%"), p.fragment))


def main() -> int:
    repo = os.environ.get("MMS_LEDGER_REPO")
    if not repo:
        log("★MMS_LEDGER_REPO が未設定です。メディア事業部リポジトリをマウントしてください")
        return 0  # ★ジョブ全体は落とさない（未設定は障害ではない）
    script = os.path.join(repo, "tools", "media-console", "ledger_integrity_check.py")
    if not os.path.exists(script):
        log(f"★スクリプトが見つかりません: {script}")
        return 0

    r = subprocess.run([sys.executable, script, "--json"], cwd=repo,
                       capture_output=True, text=True, timeout=300)
    try:
        data = json.loads(r.stdout or "{}")
    except json.JSONDecodeError:
        log(f"★JSON として読めません（exit={r.returncode}）: {(r.stdout or r.stderr)[:300]}")
        return 1

    issues = data.get("issues", data if isinstance(data, list) else [])
    by_kind: dict[str, int] = {}
    for i in issues:
        by_kind[i.get("kind", "?")] = by_kind.get(i.get("kind", "?"), 0) + 1
    log(f"問題 {len(issues)} 件 " + (" / ".join(f"{k}={v}" for k, v in sorted(by_kind.items())) or "（なし）"))

    dsn = os.environ["MMS_DATABASE_URL"]
    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        cur.execute("SET TIME ZONE 'UTC'")
        cur.execute('SELECT id FROM "Business" WHERE slug=%s',
                    (os.environ.get("MMS_DEFAULT_BUSINESS_SLUG") or "tax-saving-agency",))
        row = cur.fetchone()
        if not row:
            log("★Business が見つかりません")
            return 1
        biz = row[0]
        date = now_ts.date()
        # ★件数だけを日次で残す。明細はスクリプトの出力（ジョブログ）に出る。
        #   明細まで持つと、直せば消える情報のためにテーブルが増え続ける。
        for metric, value in [("ledger_issues_total", len(issues))] + [
            (f"ledger_issues_{k.lower()}", v) for k, v in by_kind.items()
        ]:
            cur.execute(
                'SELECT id FROM "MetricSnapshot" WHERE "businessId"=%s AND metric=%s AND date=%s AND "channelId" IS NULL',
                (biz, metric, date))
            ex = cur.fetchone()
            if ex:
                cur.execute('UPDATE "MetricSnapshot" SET value=%s, "updatedAt"=%s WHERE id=%s',
                            (value, now_ts, ex[0]))
            else:
                cur.execute(
                    'INSERT INTO "MetricSnapshot" (id,"businessId",metric,value,date,granularity,"createdAt","updatedAt")'
                    " VALUES (%s,%s,%s,%s,%s,'daily',%s,%s)",
                    (f"ms_{uuid.uuid4().hex}", biz, metric, value, date, now_ts, now_ts))
        conn.commit()

    if issues:
        for i in issues[:15]:
            log(f"  [{i.get('severity','?')}] {i.get('kind')} {i.get('art','')} {i.get('message','')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
