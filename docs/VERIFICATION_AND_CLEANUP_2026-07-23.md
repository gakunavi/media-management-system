# Notion→MMS 移行後 検証レポート ＋ 残件パンチリスト（2026-07-23 / Cowork）

## 検証結論
**移行そのものは健全。データ整合の核心（ID衝突対策）は合格。**
ただし **ライブ運用マニュアル5本＋スクリプト1本に、退役した Notion フローの指示が残存**。記事公開・リライトの手順書がそのままだと、退役済み `notion-sync.py` の実行を促し、辿ると失敗する。DB行数の実突合は MMS 稼働側で下記コマンドを流して確定する（Cloudからは不可）。

---

## ✅ 検証で健全と確認できたもの（ディスク実査）
- **退役17本＋bak2本＋README** が `.claude/scripts/_retired/` に実在（`notion-sync.py` `notion-sync-aio.py` `aio-trigger.py` `aio-promote-demote.py` `aio-prompt-fill.py` `aio-delete-rows.py` `aio-backfill-classify.py` `sync-pv-*.py` `sync-ga4-pv-to-notion.py` `gsc-fetch.py` `ga4-fetch.py` `gsc-weekly-*.py` `notion_snapshot.py` `fix-notion-preview-urls.py` `prj028_baseline_capture.py`）。
- **実行コード中に生きた Notion 書き込みは無し**（`prj028-baseline-capture.py` を除く＝下記残件）。`pipeline.py` から `notion-sync` ステージ削除済み。
- **AIO 配管 実在**: `services/worker/builtin/aio_run.py`（→ `legacy/aio/aio_monitor.py` を呼び ContentMetric に記録・`MMS_DATABASE_URL`）／`seed-jobs.mjs` に `aio-hot-weekly`/`aio-warm-biweekly`/`aio-cold-monthly`（kind=builtin）。
- **★ID衝突対策 合格**: `prompts.yaml` の `target_art` から危険な素の `ART-006 / ART-075 / ART-105` は消え、衝突記事は `LEGACY-chushokigyo-…` `LEGACY-aibeacon-shougaku-…` `ART-189` 等の MMS externalId へ正しく付替済み。残る `ART-001` 等は両側一致（衝突なし）で問題なし。

---

## ⚠️ 残件パンチリスト（優先度順）

### P1: ライブ運用マニュアルの Notion フロー残存（辿ると壊れる）
| ファイル | 箇所 | 現状 | あるべき姿 |
|---|---|---|---|
| `manuals/article-production-flow.md` | ⑮b / ⑯b / ⑮g / L73 / L110 | 「Notion同期 必須・スキップ禁止」「Notion動画ステータス更新(Notion MCP)」 | 公開後の Notion 同期を削除→「MMS `wp-sync-daily`(06:00) が翌朝 自動取込。公開後コマンド不要」。**⑮g 動画ステータスの新しい追跡先は要MMS確認** |
| `manuals/aio-monitoring.md` | 全体（§16） | AIO Tier/計測を Notion DB 前提で記述・`notion-sync.py が Tier 自動投入` | MMS 版へ書換：Tier は `wp-sync-daily` が自動付与、計測は `aio_run.py`→`ContentMetric`。Notion DB スキーマ節は撤去 |
| `manuals/news-factory.md` | L43 / L84 / L97 | `--stage …,notion-sync` / 「notion-sync で AIO Tier=Hot 強制」 | ステージから `notion-sync` 除去（正: `--stage draft,validate,publish,eyecatch`）。ニュース Hot は MMS が blog_category で自動付与 |
| `manuals/rewrite-flow.md` | L21 / L74 / L103（⑫） | リライト手順に「Notion 同期」ステップ | ⑫ を削除／「公開後は MMS 自動取込」に置換。intervention 記録の新しい正は MMS |
| `manuals/tag-rules.md` | L30 | 「タグ運用Notion DBにも記録」 | Notion 記録の一文を撤去（軽微） |

> ⑮g（動画ステータス）と rewrite の intervention 記録は、MMS 側の新しい格納先を確認してから書くべき（推測で書かない）。ここが Claude Code に寄せる理由。

### P2: PRJ-028 スクリプトの退役
- `.claude/scripts/prj028-baseline-capture.py`（ハイフン版）が **アクティブ領域に残存**し Notion API 依存。PRJ-028 は畳む決定なので `_retired/` へ移動。関連 `prj028-apply-intervention.py` `prj028-evaluate.py` も同様。
- ※ `.claude/` は remote ツールから書込不可＝**Claude Code か石井が移動**。

### P3: 軽微
- 最新版 `scheduled-tasks.md`（稼働7本・確定版）を `.claude/rules/` へ未配置（ディスク上は旧内容が残る）。石井が上書き保存。
- `seed-jobs.mjs` の `name:` が17件（ハンドオフは「18ジョブ」）。1件差は `npm run seed:jobs` 時に実数確認。

---

## 🧮 DB 実突合コマンド（MMS 稼働ホストで実行 / Cloudからは不可）
```bash
cd /Users/ishiimasataka/システム開発/Next/media-management-system

# ① 記事件数（Notion 158 と一致するか）
docker compose exec -T db psql -U mms -d mms -c \
  'SELECT count(*) AS content_items FROM "ContentItem";'

# ② AIO Tier 分布（hot31 / warm44 / cold63 と一致するか）
docker compose exec -T db psql -U mms -d mms -c \
  'SELECT "aioTier", count(*) FROM "ContentItem" WHERE "aioTracked" GROUP BY 1 ORDER BY 1;'

# ③ AIO 計測行（ContentMetric 1252 / ヒット合算）※metric名は環境の実値に合わせて調整
docker compose exec -T db psql -U mms -d mms -c \
  "SELECT metric, count(*) FROM \"ContentMetric\" WHERE metric LIKE 'aio%' GROUP BY 1 ORDER BY 1;"

# ④ URL 重複（突合キーの健全性・0行が正）
docker compose exec -T db psql -U mms -d mms -c \
  'SELECT url, count(*) FROM "ContentItem" WHERE url IS NOT NULL GROUP BY url HAVING count(*)>1;'

# ⑤ externalId 重複（両側 ART-006 問題の残存確認・channel跨ぎは仕様）
docker compose exec -T db psql -U mms -d mms -c \
  'SELECT "externalId", count(*) FROM "ContentItem" GROUP BY "externalId" HAVING count(*)>1;'
```
> psql がパスワードを要求する場合は `docker compose exec -T db psql "postgresql://mms:<MMS_POSTGRES_PASSWORD>@localhost:5432/mms" -c '...'` で。

---

## 私（Cowork）が確認できなかった範囲（正直な限界）
- **MMS Postgres の実行値**（①〜⑤）: localhost 到達不可のため未実行。上記コマンドで確定。
- **Cowork Scheduled レジストリ**: 保護領域のため未確認。石井がアプリ一覧で7本を確認済み＝削除は確定。
