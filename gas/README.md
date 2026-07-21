# gas/ — Threads 投稿GASの修正版

Threads 自動投稿の Google Apps Script（スプレッドシート
`1rtkSNJBRHRt8db-wJ0SMWuEItrJzpnvw7kAYDcFfnSY` にバインド）のうち、
**MMS 側から提案した修正版**をここに置く。

> ★正本は GAS プロジェクト側。ここは「何をどう直したか」を残すための控え。
> 反映は GAS エディタに手で貼り付ける（clasp 未導入のため）。

## MMS との関係

MMS は **Threads API を叩かない**。トークンは GAS 側に置いたままでよい。
GAS の `Api.gs`（Web App / API_KEY 認証）から MMS が **pull** する。

```
GAS(投稿・Insights回収) → スプレッドシート → Api.gs Web App
                                                  ↑ pull
                          MMS worker: builtin/threads_sync.py
                                                  ↓ HMAC署名
                                  MMS: /api/ingest/threads
```

この向きなので **MMS を外部公開する必要がない**（Cloudflare Tunnel 不要）。

## ファイル

| ファイル | 状態 | 直した内容 |
|---|---|---|
| `Insights.gs` | ✅ 反映済 | 6分制限で途中終了する問題の解消（対象を鮮度で絞る／新しい順／書込1回化／時間予算ガード）＋週次サマリーの集計修正 |
| `Threads.gs` | 未反映 | **C** YMYL正規表現バグ（正当な表現を誤ブロック）／**C-2** ログへのトークン露出／**D-4** `AUTO_PUBLISH` 経路の削除 |
| `Spreadsheet.gs` | 未反映 | **D-1** status空欄の行が投稿される／**D-3** `resetErrorRows` 追加 |
| `Menu.gs` | 未反映 | **D-3** メニュー項目追加 |
| `Api.gs` | 未反映 | **D-5** HTTPステータスが常に200／**D-6** `insights_updated_at` を返す／`format` 判定を `extractFormat_` に統一 |
| `Config.gs` | 未反映 | **D-2** 定数2つ（下記）。ファイル全文は復元できなかったため手動 |
| `PATCHES.md` | — | 各修正の背景と根拠 |

## 反映手順

1. GAS エディタで対象ファイルを開く
2. **全選択 → このリポジトリの内容を貼り付け**（`Config.gs` を除く5ファイル）
3. 保存

### `Config.gs` だけは手動（値2つ）

```javascript
SCHEDULE_TOLERANCE_MIN: 120,   // 現在1440(24h)。セーフガードが実質無効なため
MAX_POSTS_PER_RUN:      3,     // 現状維持
```

README と `Main.gs` のコメントも実際の値に合わせる（現状は 30分/45分/1440分の三重不一致）。

## 反映後の確認

| 確認項目 | やり方 | 期待 |
|---|---|---|
| YMYL誤検知の解消 | メニュー `選択行のYMYLチェック` に「必ず税理士に確認してください」 | **通る**（v2.0 では誤ってブロック） |
| YMYL検知は生きている | 同じく「絶対に損しない」 | **止まる** |
| トークン非露出 | `whoAmI` を壊れたトークンで実行 | ログが `access_token=***` |
| 未計測の区別 | `?action=top_posts&limit=5` を実行 | `insights_updated_at` が含まれる |
| MMS取り込み | `docker compose exec worker python builtin/threads_sync.py` | 未計測行の指標が保存されない |
