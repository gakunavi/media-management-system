"""MMS worker — jobs テーブルをポーリングして実行する常駐プロセス。

設計書の根拠:
  §2.1  jobs テーブル + Python worker（常駐）
  §6    既存 .claude/scripts/ は **書き直さない**。legacy/ に置いてそのまま呼ぶ
  §12.1 常駐サーバーなので sandbox 45秒上限・DB書込制限・状態消失が全て消える
        → 「リマインダー方式」の5タスクがそのまま自動実行に変わる

P0 の範囲: 常駐・スケジュール判定・JobRun への記録まで。
           legacy スクリプトの実行口（kind="script"）は用意してあるが、
           実際のスクリプト配置と移行は P1。

★実装上の注意（Prisma との整合）
  - `id` の cuid は Prisma がクライアント側で生成する。DB 既定値は無いので
    ここでは自前で ID を採番する。
  - `updatedAt`（@updatedAt）も DB 既定値が無い。**INSERT/UPDATE のたびに
    明示的に値を入れる**（入れないと NOT NULL 違反になる）。
  - テーブル名・列名は Prisma の既定（camelCase）なので必ずダブルクォートする。
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
from croniter import croniter

# docs/RULES.md §9: 全ての日時は JST に正規化して保持する
JST = timezone(timedelta(hours=9), "JST")

POLL_SECONDS = int(os.environ.get("MMS_WORKER_POLL_SECONDS", "20"))
LEGACY_DIR = Path(os.environ.get("MMS_WORKER_LEGACY_DIR", "/app/legacy"))


def normalize_dsn(url: str | None) -> str | None:
    """Prisma 用の接続 URL を libpq が受け付ける形に直す。

    ★MMS_DATABASE_URL は Prisma と worker の両方が読む単一の値。
      Prisma 固有の `?schema=public` を libpq はクエリパラメータとして
      認識できず `invalid URI query parameter` で落ちるため、
      `options=-csearch_path=...` に読み替える。
    """
    if not url:
        return url
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    schema = params.pop("schema", None)
    if schema:
        params.setdefault("options", f"-csearch_path%3D{schema}")
    return urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            parts.path,
            urlencode(params, safe="-%"),
            parts.fragment,
        )
    )


DATABASE_URL = normalize_dsn(os.environ.get("MMS_DATABASE_URL"))

_shutdown = False


def now() -> datetime:
    return datetime.now(JST)


def log(msg: str) -> None:
    print(f"[{now():%Y-%m-%d %H:%M:%S%z}] {msg}", flush=True)


def new_id() -> str:
    """Prisma の cuid 相当。衝突しなければ形式は問われない String 列。"""
    return f"job_{uuid.uuid4().hex}"


def handle_shutdown(signum, _frame) -> None:
    global _shutdown
    log(f"シグナル {signum} を受信。現在のジョブ完了後に停止します")
    _shutdown = True


# ── ジョブ種別ごとの実行 ─────────────────────────────────────


def run_noop(config: dict) -> dict:
    """常駐と配管が生きていることの確認用（P0）。"""
    return {"handled": "noop", "config": config}


def run_script(config: dict) -> dict:
    """legacy/ 配下の既存 Python 資産をそのまま呼ぶ（§6）。

    中身には一切依存しない。引数を渡して実行し、終了コードと出力だけ見る。
    """
    script = config.get("script")
    if not script:
        raise ValueError("config.script が指定されていません")

    target = (LEGACY_DIR / script).resolve()
    # legacy ディレクトリの外を実行させない
    if not str(target).startswith(str(LEGACY_DIR.resolve())):
        raise ValueError(f"legacy ディレクトリ外は実行できません: {script}")
    if not target.exists():
        raise FileNotFoundError(f"スクリプトがありません: {target}")

    args = [str(a) for a in config.get("args", [])]
    timeout = int(config.get("timeoutSeconds", 3600))

    proc = subprocess.run(
        [sys.executable, str(target), *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"exit={proc.returncode}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        )
    return {
        "handled": "script",
        "script": script,
        "stdout_tail": proc.stdout[-2000:],
    }


HANDLERS = {"noop": run_noop, "script": run_script}


# ── DB アクセス ─────────────────────────────────────────────


def fetch_due_jobs(conn) -> list[tuple]:
    """enabled なジョブと、その最終実行時刻を取得する。"""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT j."id", j."name", j."schedule", j."kind", j."config",
                   MAX(r."startedAt") AS last_started
            FROM "Job" j
            LEFT JOIN "JobRun" r ON r."jobId" = j."id"
            WHERE j."enabled" = TRUE
            GROUP BY j."id", j."name", j."schedule", j."kind", j."config"
            """
        )
        return cur.fetchall()


def is_due(schedule: str, last_started: datetime | None, at: datetime) -> bool:
    """cron 式で次回実行時刻を求め、到来しているか判定する。"""
    if not schedule:
        return False
    base = last_started.astimezone(JST) if last_started else at - timedelta(days=1)
    try:
        return croniter(schedule, base).get_next(datetime) <= at
    except (ValueError, KeyError) as e:
        log(f"  cron 式が不正です: {schedule!r} ({e})")
        return False


def start_run(conn, job_id: str, started_at: datetime) -> str:
    run_id = new_id()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO "JobRun"
              ("id", "jobId", "startedAt", "status", "createdAt", "updatedAt")
            VALUES (%s, %s, %s, 'running', %s, %s)
            """,
            (run_id, job_id, started_at, started_at, started_at),
        )
    conn.commit()
    return run_id


def finish_run(conn, run_id: str, status: str, log_text: str, metrics: dict) -> None:
    finished = now()
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE "JobRun"
               SET "finishedAt" = %s,
                   "status"     = %s,
                   "log"        = %s,
                   "metrics"    = %s,
                   "updatedAt"  = %s
             WHERE "id" = %s
            """,
            (finished, status, log_text[-8000:], json.dumps(metrics), finished, run_id),
        )
    conn.commit()


def execute(conn, job_id: str, name: str, kind: str, config: dict) -> None:
    started = now()
    run_id = start_run(conn, job_id, started)
    log(f"  ▶ 実行: {name} (kind={kind}, run={run_id})")

    try:
        handler = HANDLERS.get(kind)
        if handler is None:
            raise ValueError(
                f"未知の kind: {kind!r}（対応: {', '.join(sorted(HANDLERS))}）"
            )
        result = handler(config or {})
        elapsed = (now() - started).total_seconds()
        finish_run(
            conn,
            run_id,
            "success",
            json.dumps(result, ensure_ascii=False),
            {"elapsedSeconds": elapsed},
        )
        log(f"  ✅ 完了: {name} ({elapsed:.1f}s)")
    except Exception as e:  # noqa: BLE001 — 失敗理由は必ず JobRun に残す
        elapsed = (now() - started).total_seconds()
        finish_run(
            conn,
            run_id,
            "failed",
            f"{type(e).__name__}: {e}",
            {"elapsedSeconds": elapsed},
        )
        # ★docs/RULES.md: 失敗を握り潰さない。段7 に出るよう status=failed で残す
        log(f"  ❌ 失敗: {name}: {type(e).__name__}: {e}")


# ── メインループ ────────────────────────────────────────────


def main() -> int:
    if not DATABASE_URL:
        log("MMS_DATABASE_URL が未設定です")
        return 2

    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)

    LEGACY_DIR.mkdir(parents=True, exist_ok=True)
    log(f"MMS worker 起動（ポーリング {POLL_SECONDS}秒 / legacy={LEGACY_DIR}）")

    # DB 起動待ち
    while not _shutdown:
        try:
            with psycopg.connect(DATABASE_URL, connect_timeout=5) as c:
                with c.cursor() as cur:
                    cur.execute("SELECT 1")
            break
        except psycopg.Error as e:
            log(f"DB 接続待ち: {e}")
            time.sleep(3)

    while not _shutdown:
        try:
            with psycopg.connect(DATABASE_URL) as conn:
                while not _shutdown:
                    at = now()
                    for job_id, name, schedule, kind, config, last in fetch_due_jobs(
                        conn
                    ):
                        if is_due(schedule, last, at):
                            execute(conn, job_id, name, kind, config or {})
                    time.sleep(POLL_SECONDS)
        except psycopg.Error as e:
            log(f"DB エラー。5秒後に再接続します: {e}")
            time.sleep(5)

    log("MMS worker 停止")
    return 0


if __name__ == "__main__":
    sys.exit(main())
