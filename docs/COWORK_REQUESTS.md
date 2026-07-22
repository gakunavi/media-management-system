# cowork への依頼・確認（2026-07-22 最終）

MMS 側の作業で不要になったものを外し、**cowork でしか判断・対応できないもの**だけを
優先順に残した。cowork へ渡す文面はこのまま貼れる形にしてある。

---

## 完了したもの

| 項目 | 結果 |
|---|---|
| **A-4 診断LPの送信計測** | ✅ cowork が修正。CF7 6.x は `wpcf7mailsent` を dispatch せず `wpcf7submit` の `detail.status` を見る方式に変わっていた。3本とも実発火を確認済み |
| **A-2 公式LINE のURL** | ✅ `https://lin.ee/5NVLBXA`（本番稼働側）を採用。`organization.yaml` の `szd8e1x` との食い違いは要整理 |
| **A-3 の真因特定** | ✅ リダイレクトではなく `sessionStorage` 保持が原因と判明（対応は未） |
| **B-4 日次タスクの書き込み枠** | ✅ 09:00 / 12:00 / 19:00 に限定済み |
| **A-1 の原因特定** | ✅ 下記のとおり（対応は未） |

---

## A-1【最優先】スケジュール停止の原因と再発防止

### 原因：アプリの不具合ではなく、UIからの手動無効化

`~/Library/Logs/Claude/main3.log` に記録が残っていた。

```
2026-07-13 12:20:59〜12:21:30 の31秒間に12件を順次 disabled
  CoworkScheduledTasksApi.updateScheduledTaskStatus（UIからの操作API）
  間隔は1〜6秒とばらつく（自動処理なら同一秒に集中する）
  12:21:29 gsc-weekly-fetch を Enabled → 12:21:30 Disabled（押し間違いの訂正）
```

### なぜ止めることになったか（直前11分）

```
12:07:55  [ScheduledTasks] Reset（アプリ再起動）
12:09:00  4本が同時起動 → global_limit (active=3, limit=3) で待ち
12:13:00  iriguchi がようやく起動（4分待ち）
12:13〜16 Not auto-approving "mcp__google-sheets__get_sheet_data"
          Not auto-approving "mcp__apple-events__reminders_tasks"
          → rule(s) not in stored approvals → 都度 decision=once で手動承認
12:20:59  全部無効化を開始
```

**MCPツールが承認リストに無く、動くたびに手動承認を求めていた。**

### enabled 状態の保存場所

```
~/Library/Application Support/Claude/local-agent-mode-sessions/
  97c32ace-…/66a9cc56-…/scheduled-tasks.json
```
`~/Documents/Claude/Scheduled/` には SKILL.md しか無く enabled は持たない。
だから「SKILL.md は残っているのに登録だけ消えた」ように見えた。

### 依頼（再有効化の前に原因を直す）

1. 各タスクの `approvedPermissions` に不足MCPを追加（最低 `mcp__google-sheets` / `mcp__apple-events`）
2. cron をずらす（同時実行上限3本。現状 7:00 / 8:00 / 9:00 に集中）
3. そのうえで11本を再有効化

★threads の2本は 7/22 に作り直して有効化済み。触らないこと。

---

## 【最優先】計測されていない送客を埋める（ゴールに直結）

MMS の「送客 × 受け皿」マトリクスは実測 **5/13**。
HP・メディア・記事からの送客がほぼ全部「未計測」で、
PV 4,556 があるのに**そこから何人がどの受け皿へ向かったかが分からない**。
増やす対象が測れていないので、増えたかどうかも判定できない。

### 1. サイトの `lin.ee` 生リンクを置換（3マスが埋まる）

```
変更前: https://lin.ee/5NVLBXA
変更後: https://collect.asset-support.co.jp/r/line/{設置場所}

{設置場所} は英数字と - _ のみ・40文字以内。設置箇所ごとに変える
例: site-header / site-footer / article-cta / article-inline
    contact-page / category-page
```
対象は `/media/` 9箇所・`/contact/` 7箇所ほか（テーマ全体）。

- MMS が設置場所別にクリックを記録する（どのCTAが効いたかが出る）
- utm と `?from=site` は MMS が自動付与。書かない
- クローラのプレビュー踏みは除外済み
- 遷移先は MMS 側で管理するので `lin.ee` を直接書く必要は無い

### 2. HPの問い合わせフォームを計測可能にする（3マスが埋まる）

MMS の受口 `/api/ingest/form` は稼働中。WordPress から呼ぶ。HMAC-SHA256 署名が要る。
あわせて段2ファネル（CTA表示 → CTAクリック → フォーム到達 → 送信）も計測する。

**1と2で 5/13 → 11/13 になる。**

---

## その他の依頼

### 3. 代理店LP の `sessionStorage` → `localStorage` + Cookie（30〜90日）

LP訪問189のうち152（80%）がコード無しで、どの代理店の貢献か識別できていない。
配布済みコードのうち6件が7日以上流入なし。

### 4. 診断LPを1本（B・写真）に集約

石井さん判断。`lp-link-inject.py` の `ROTATION_JS` を廃し、既存記事のリンクを B に寄せる。
A-4 が直ったので集約後は送信が正しく計測される。
**「壊れていた期間」と「直った後」を混ぜないよう集約日を記録すること。**

あわせて記事側の導線も直す（LP到達率 0.42% < 目安 0.5%）。
LPを1本にしても記事から人が来なければ判定母数は増えない。

### 5. `lp-ab-weekly-report.py` を before/after 型 ＋ 経路分離に

1. パターン別の勝敗判定をやめ「LPを大きく変えた前後28日」の比較に
2. `pagePath` → `pagePathPlusQueryString`（`.split("?")[0]` を削除）
3. 記事→LP の CTR は `from=media-article` のみを分子に
4. `from=threads` / `from=site` を別行で出す（母数が違うので混ぜない）
5. 分母の記事PVを「LPリンクを持つ記事」に限定（現状 `/media/` 全部を合算しており、
   Threads送客が始まると分子だけ増えて CTR が実態以上に良く見える）

### 6. Threads の送客導線を SKILL.md に反映

cowork の提案どおり採用。

- 型: チェックリスト・結論ファースト・比較型の3つ
- 本数: 週88本のうち12本（3型 × 4本）
- 遷移先: `line` 6本 / `soken` 4本 / `lp` 2本
- A/B: 同一フォーマット内でリンク有無を混ぜる

```
article_link 列: https://collect.asset-support.co.jp/r/{soken|lp|line}/{THR-xxx}
utm・?from・LP振り分けは MMS が自動付与。書かない
```

★`line` 6本には計測上の限界がある。`lin.ee` へのリダイレクトまでは MMS が数えるが、
その先の友だち追加は測れない（LINE の follow イベントに経路情報が入らない。公式FAQに明記）。
「LINEに送った人数」までしか出ないので、友だち追加数と突き合わせて判断すること。

### 7. 片付け

- `weekly_*` 6指標は**廃止**（移管不要）。MMS の `evaluate.ts` は日次データから
  28日窓を直接計算しており、固定スナップショットを介さない
- `media.db` コンソールを畳む。`ingest.py` を `gsc-weekly-fetch` のステップ7.5 から外す。
  「記事別 日次推移」は作らない判断で合意済みなので残る差分は無い

---

## MMS が cowork の出力に依存している箇所

パスやフォーマットを変えるときは事前に知らせてほしい。

| MMS のジョブ | 読んでいるもの | 実行 |
|---|---|---|
| dm-log-import-daily | `.../agency-recruitment/dm-log.md` | 毎日10:00 |
| rakko-import-daily | `shared/keywords/rakko-exports/<YYYY-MM>/` | 毎日05:00 |
| agency-lp-import-daily | `tools/media-console/agency_lp_sources.json` → 各LPの export.php | 毎日07:15 |
| threads-sync-daily | Threads GAS Web App | 毎日06:30 |
| queue-refill-daily | Threads GAS のシート（draft → pending） | 毎日05:00 |

**`dm-log.md` は MMS の唯一のDM情報源。** 列順と判定4語
（有効 / 有効候補 / 保留 / 無効）を変えないこと。

---

## MMS 側で対応済み（依頼不要）

| 元の課題 | 対応 |
|---|---|
| PV が7/13で停止 | MMS が GA4 を直接読む（毎日07:30）。Notion経由をやめた |
| GA4ファネルの受け渡し | 同上で不要 |
| intervention の二重管理 | MMS を正とし、記録の入口も `/experiments` に移した |
| 代理店LPのデータ | MMS が export.php を直接取得（PIIは保存しない） |
| 診断LPの成約接続 | `/lp` を 記事PV→到達→送信→問い合わせ→成約 の5段に |
| 代理店の画面分散 | `/agency` に統合（DM ／ 代理店LP の2階段） |
