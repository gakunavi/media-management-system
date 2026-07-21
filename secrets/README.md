# secrets/ — 認証鍵の置き場

**このディレクトリの中身は Git にコミットされません**（`.gitignore` の `secrets/`）。
worker には**読み取り専用**でマウントされます（`/app/secrets:ro`）。

---

## GSC（Google Search Console）日次取得 — ✅ 稼働中

> 既存の `asset-support@asset-support-492811.iam.gserviceaccount.com` が
> 既に GSC に siteOwner 権限を持っていたため、そのまま利用している。
> （`gcloud-tts-service-account.json` を `gsc-service-account.json` として配置）

### 置くファイル

```
secrets/gsc-service-account.json
```

Google Cloud で発行したサービスアカウント鍵JSONを、**この名前で**保存してください。

### 有効化

```bash
npm run seed:jobs     # 鍵の有無を見て gsc-fetch-daily を自動で有効化
npm run up            # worker を再起動（マウントを反映）
```

`npm run seed:jobs` は鍵が無ければジョブを**停止のまま**にします。
（鍵が無いまま有効にすると、失敗した JobRun が段7を赤で埋めるため）

### 動作確認

`/jobs` 画面で `gsc-fetch-daily` の「今すぐ実行」…は builtin ジョブなので
worker のスケジュール実行を待つか、次で直接実行できます。

```bash
docker compose exec worker python builtin/gsc_daily.py
```

成功すると `最新実測日: YYYY-MM-DD` が出力され、ダッシュボード段7の
「GSC 日次は最新」が更新されます。

---

## 鍵の作り方（Google Cloud）

1. https://console.cloud.google.com/ で任意のプロジェクトを選択（無ければ新規作成）
2. **APIとサービス → ライブラリ** で `Google Search Console API` を有効化
3. **APIとサービス → 認証情報 → 認証情報を作成 → サービスアカウント**
   - 名前は任意（例: `mms-gsc-reader`）。ロールは**付与しなくてよい**
4. 作成したサービスアカウント → **キー → 鍵を追加 → 新しい鍵を作成 → JSON**
   → ダウンロードされたファイルを `secrets/gsc-service-account.json` として保存
5. サービスアカウントの**メールアドレス**（`xxx@xxx.iam.gserviceaccount.com`）をコピー
6. https://search.google.com/search-console → 対象プロパティ →
   **設定 → ユーザーと権限 → ユーザーを追加** →
   上記メールアドレスを **「制限付き」（閲覧のみ）** で追加

> ★権限は**閲覧のみ**で足ります。所有者権限は与えないでください。

---

## 注意

| | |
|---|---|
| **鍵をチャットに貼らない** | 会話ログに残ります。ファイルとして保存してください |
| **バックアップ対象** | `.env` の `MMS_PII_KEY` と同様、失うと再発行が必要（§16.4） |
| **漏洩時** | Google Cloud でその鍵を無効化し、新しい鍵を発行してください |
