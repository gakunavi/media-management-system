#!/usr/bin/env python3
"""代理店LP（外部ドメイン）の流入を取り込む（設計書 §3-6・PRJ-034）

★なぜ要るか
  代理店募集は Threads の4目的の1つだが、MMS が持っていたのは DM だけだった。
  実際には配布URL `?ag=AG-XXXX` 経由の流入と問い合わせが LP 側に溜まっていて、
  「どの代理店コードが動いているか」はそこにしか無い。

★PII を持ち込まない
  取得元の inquiries CSV には氏名・メールアドレスが入っている。
  MMS が必要なのは日付とコード別の件数だけ。持たなければ守る必要も無い（§16.2）。
  このスクリプトは行を数えるだけで、本文を保存しない。

★取得先は cowork の agency_lp_sources.json が正本（読み取り専用）。
  LP が増えたらそちらに足せば、MMS 側の変更は要らない。

環境変数:
  MMS_AGENCY_LP_SOURCES  … agency_lp_sources.json のパス
  MMS_DATABASE_URL
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg

JST = timezone(timedelta(hours=9), "JST")

# 集計から外すコード
#   AG-9999 … 検証用の予約コード（実代理店には発行しない）
EXCLUDED_CODES = {"AG-9999"}
# inquiries の本文に含まれていたら動作確認とみなす
TEST_MARKERS = ("テスト送信",)


def log(msg: str) -> None:
    print(f"[agency_lp_import] {msg}", flush=True)


def normalize_dsn(url: str) -> str:
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = params.pop("schema", None)
    if schema:
        params.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(params, safe="-%"), parts.fragment)
    )


def fetch_csv(base_url: str, key: str, kind: str) -> list[list[str]] | None:
    """取得できなければ None。空の [] （＝0件）と区別する（§3）"""
    url = f"{base_url.rstrip('/')}/export.php?key={key}&file={kind}"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            raw = r.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, OSError) as e:
        # ★LP側が落ちていても他のLPの取り込みは続ける
        log(f"★{kind} を取得できません: {type(e).__name__}")
        return None
    return [row for row in csv.reader(io.StringIO(raw)) if row]


def main() -> int:
    src = os.environ.get("MMS_AGENCY_LP_SOURCES", "").strip()
    if not src or not os.path.exists(src):
        log(f"★取得元の定義がありません（取り込みなしで終了）: {src or '(未設定)'}")
        return 0
    dsn = os.environ.get("MMS_DATABASE_URL")
    if not dsn:
        raise RuntimeError("MMS_DATABASE_URL が未設定です")

    with open(src, encoding="utf-8") as f:
        sources = json.load(f)

    now = datetime.now(JST)
    total_rows = 0

    with psycopg.connect(normalize_dsn(dsn)) as conn, conn.cursor() as cur:
        for lp, cfg in sources.items():
            base_url = str(cfg.get("base_url") or "").strip()
            key = str(cfg.get("export_key") or "").strip()
            label = str(cfg.get("label") or lp)
            if not base_url or not key:
                log(f"★{lp}: base_url / export_key が足りません")
                continue

            # (date, code) -> [visits, inquiries]
            agg: dict[tuple[str, str], list[int]] = {}
            fetched_any = False

            for kind, idx in (("visits", 1), ("inquiries", 1)):
                rows = fetch_csv(base_url, key, kind)
                if rows is None:
                    continue
                fetched_any = True
                skipped = 0
                for row in rows:
                    if len(row) <= idx:
                        continue
                    # ★動作確認の送信を実績に混ぜない
                    if kind == "inquiries" and any(
                        m in cell for cell in row for m in TEST_MARKERS
                    ):
                        skipped += 1
                        continue
                    date = row[0].strip().strip('"')[:10]
                    if len(date) != 10 or date[4] != "-":
                        continue
                    raw_code = row[idx].strip().strip('"')
                    code = raw_code if raw_code.startswith("AG-") else "direct"
                    if code in EXCLUDED_CODES:
                        skipped += 1
                        continue
                    k = (date, code)
                    agg.setdefault(k, [0, 0])[0 if kind == "visits" else 1] += 1
                log(f"{label}/{kind}: {len(rows)}行（除外 {skipped}）")

            if not fetched_any:
                # ★1つも取れなかった日は「0件」ではない。既存値を消さない（§3）
                log(f"★{label}: 取得できなかったので既存データを保持します")
                continue

            for (date, code), (v, q) in agg.items():
                cur.execute(
                    'INSERT INTO "AgencyLpDaily"(id,lp,date,"agencyCode",visits,inquiries,'
                    '"createdAt","updatedAt") '
                    "VALUES (gen_random_uuid()::text,%s,%s,%s,%s,%s,%s,%s) "
                    'ON CONFLICT (lp,date,"agencyCode") DO UPDATE SET '
                    'visits=EXCLUDED.visits, inquiries=EXCLUDED.inquiries, "updatedAt"=%s',
                    (lp, date, code, v, q, now, now, now),
                )
                total_rows += 1
            conn.commit()

            codes = {c for _, c in agg} - {"direct"}
            log(
                f"{label}: {len(agg)}行を保存"
                f"（訪問 {sum(v for v, _ in agg.values())} / "
                f"問い合わせ {sum(q for _, q in agg.values())} / "
                f"稼働コード {len(codes)}）"
            )

        # 計測開始の記録（§3: 0 と未計測を区別する）
        for metric in ("agency_lp_visits", "agency_lp_inquiries"):
            cur.execute('SELECT 1 FROM "MeasurementCoverage" WHERE metric=%s', (metric,))
            if cur.fetchone():
                continue
            cur.execute(
                'INSERT INTO "MeasurementCoverage"(id,metric,"startedAt",method,note,'
                '"createdAt","updatedAt") VALUES (gen_random_uuid()::text,%s,now(),%s,%s,now(),now())',
                (metric, "agency_lp_export", "代理店LPの export.php から日次取得（PIIは保存しない）"),
            )
        conn.commit()

    log(f"完了: {total_rows}行")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(1)
