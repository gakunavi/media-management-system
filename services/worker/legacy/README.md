# legacy/ — 既存 Python 資産の実行口

設計書 §6 / §9.4.5-② の規約:

> **既存 Python 資産は書き直さない。** worker から**呼ぶだけ**で中身に依存しない（疎結合）。

## ★実体はコピーではなく「読み取り専用マウント」（P1 の判断）

設計書 §2.2 は「`legacy/` に**配置**」と書いているが、**コピーすると本体と乖離する**。
メディア事業部側でスクリプトが更新されても worker 側は古いまま、という事故が起きる。

そのため P1 では **元のディレクトリを読み取り専用でマウント**する方式にした。

```yaml
# docker-compose.yml（worker）
volumes:
  - ${MMS_LEGACY_SCRIPTS_DIR:-./services/worker/legacy}:/app/legacy:ro
```

```bash
# .env
MMS_LEGACY_SCRIPTS_DIR=/Users/ishiimasataka/Documents/Claude/Projects/メディア事業部/.claude/scripts
```

| 利点 | 内容 |
|---|---|
| **乖離しない** | 本体を更新すれば worker にも即座に反映される（コピー忘れが起きない） |
| **改変できない** | `:ro` なので worker からは書き込めない。「書き直さない」を**構造的に保証**する |
| **P1 検証済み** | 62本すべてが構文 OK。`ai-tone-check.py --help` をジョブ経由で実行し `JobRun(success)` を確認 |

`MMS_LEGACY_SCRIPTS_DIR` が未設定のときはこのディレクトリ（空）がマウントされる。

## ジョブの登録方法

```jsonc
{
  "name": "gsc-daily",
  "schedule": "0 7 * * *",     // 日次 07:00（§5.1）
  "kind": "script",
  "config": {
    "script": "gsc-fetch.py",
    "args": ["--backfill"],
    "timeoutSeconds": 3600      // ★sandbox の45秒上限は無い（§12.1）
  },
  "enabled": true
}
```

worker が `croniter` で実行時刻を判定し、`JobRun` に成否・所要時間・stdout を記録する。

## ★スケジュール登録の前に必要なこと

**現時点で worker コンテナには外部サービスの資格情報が入っていない。**
以下のスクリプト群は、対応する Phase で環境変数を渡すまで**成功しない**。

| スクリプト群 | 必要なもの | Phase |
|---|---|---|
| `gsc-fetch.py` / `gsc-*.py` | GSC API の認証情報 | P1 以降（要 `.env` 追加） |
| `ga4-fetch.py` | GA4 の認証情報 | 同上 |
| `wp-*.py` | WordPress REST の資格情報 | **P1.8**（WP書き込みの MMS 一本化） |
| `notion-sync*.py` | Notion トークン | **P1.5 → P6 で廃止** |
| `rakko-*.py` | Chrome MCP / ラッコ | P4.5 |

**資格情報を渡していない状態でジョブを有効化しない。** 失敗した `JobRun` が段7を赤で埋める。

## 制約

- **`legacy/` の外は実行できない**（`worker.py` がパスを検証している）
- 実行は `python <script> <args>`。終了コード 0 以外は `JobRun.status = failed`
- 失敗は握り潰さず必ず `JobRun` に残る → 段7「ジョブ健全性」に出る
- 外部ライブラリは `requests` / `PyYAML` / `python-dotenv` のみ（62本の import を全収集して確認済み）
