# legacy/ — 既存 Python 資産の置き場

設計書 §6 / §9.4.5-② の規約:

> **既存 Python 資産は書き直さない。** worker の `legacy/` に置き**そのまま呼ぶ**。
> 中身に依存しない設計にする（これは手抜きではなく**疎結合**）。

## 使い方

1. `.claude/scripts/` の既存スクリプト（`gsc-fetch.py` / `ingest.py` /
   `validate-article.py` / `rakko-import.py` 等 40本超）をこのディレクトリに配置する（**P1**）
2. `Job` レコードを次のように作る

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

3. worker が `croniter` で実行時刻を判定し、`JobRun` に成否・所要時間・ログを記録する

## 制約

- **`legacy/` の外は実行できない**（`worker.py` がパスを検証している）
- 実行は `python <script> <args>`。終了コード 0 以外は `JobRun.status = failed`
- 失敗は握り潰さず必ず `JobRun` に残る → 段7「ジョブ健全性」に出る
