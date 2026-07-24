# 石井さんへの依頼: Cloudflare のキャッシュを6本だけパージする（2026-07-24）

作業は **Cloudflare のダッシュボードで2分**。

---

## 何が起きているか

**6本の記事で、読者に届いているHTMLに計測タグが入っていません。**
サーバー側（オリジン）にはちゃんと入っています。**Cloudflare のキャッシュが古いだけ**です。

| 記事 | 内容 |
|---|---|
| ART-002 | 即時償却とは？中小企業経営強化税制… ← **主力商材** |
| ART-007 | 法人節税の完全ガイド【2026年版】 ← **ピラー** |
| ART-086 | GPU 節税の完全ガイド ← **ピラー** |
| ART-088 | データセンター 節税のスキーム |
| ART-009 | 即時償却 税額控除の違いと選び方 |
| ART-041 | 2026年 法人税制改正の全体像 |

残り153本は正常に配信されています。

★**なぜ今まで気づかなかったか**: 確認するときにURLへクエリを足して叩いていたため、
Cloudflare を素通りして**オリジンの正しいHTML**を見ていました。
読者と同じ条件（ブラウザとして叩く）で確認して初めて出ました。
この確認手順は `docs/RULES.md` §4-95 に規約として追加済みです。

## 影響

この6本を読んだ人の行動が**1件も記録されていません**。
記事内のリンククリック・CTA表示・LPへの送客が、この6本ぶんだけ欠けています。

★ただし**GSCの表示・クリックは別経路（Search Console API）なので影響ありません**。
欠けているのは記事内の行動計測だけです。

---

## 作業手順

1. **Cloudflare ダッシュボード** → 対象ドメイン `asset-support.co.jp`
2. 左メニュー **Caching** → **Configuration**
3. **Purge Cache** → **Custom Purge** を選ぶ
4. **URL** を選び、以下6本を貼る

```
https://asset-support.co.jp/media/immediate-depreciation-tax-saving/
https://asset-support.co.jp/media/houjin-setsuzei-complete-guide-2026/
https://asset-support.co.jp/media/gpu-server-tax-saving-pillar/
https://asset-support.co.jp/media/data-center-tax-saving/
https://asset-support.co.jp/media/sokuji-shokyaku-vs-zeigaku-koujyo-comparison/
https://asset-support.co.jp/media/reiwa-8-tax-reform-2026/
```

5. **Purge** を押す

> ★**「Purge Everything」は押さないでください。** 全ページがオリジンから
> 取り直しになり、一時的にサイトが重くなります。過去に重量化事故を起こしているので、
> 必要な6本だけにします。

## 終わったら教えてください

私の方で、読者と同じ条件（ブラウザとして）で6本を叩き直して、
タグが配信されているかを確認します。

---

---

# 自動化（2026-07-24 石井さん「発行して欲しい」）

**MMS 側は実装済みです。** トークンを `.env` に置いた翌朝から自動で直ります。

## 実装したもの

日次ジョブ **`tag-delivery-daily`（毎日 05:50）** を追加しました。

1. 全公開記事を**読者とまったく同じ条件**で叩く（ブラウザのUA＋`Accept: text/html`・クエリを足さない）
2. 計測タグが入っていない記事を検出する
3. **トークンがあれば、その記事のURLだけをパージする**（Purge Everything は使わない）
4. 結果を `DataQualityCheck(kind=tag_delivery)` に残し、通知は既存の
   `health-alert-daily` がまとめて出す（同じ異常が2箇所から届かないように）

★**すでに実行して、上の6本を独立に再現しています**（151/157 配信あり）。
いまはトークンが無いので、検出だけして止まっています。

## トークンの発行手順（Cloudflare・3分）

1. **Cloudflare ダッシュボード** 右上のアイコン → **My Profile**
2. 左メニュー **API Tokens** → **Create Token**
3. 一番下の **Create Custom Token** の「Get started」
4. 以下だけを設定します

| 項目 | 値 |
|---|---|
| **Token name** | `mms-cache-purge` |
| **Permissions** | `Zone` / **`Cache Purge`** / **`Purge`** ← **この1つだけ** |
| **Zone Resources** | `Include` / `Specific zone` / **`asset-support.co.jp`** |
| **TTL**（任意） | 無期限で構いません |

> ★**他の権限を足さないでください。** このトークンでできることを
> 「このドメインのキャッシュを消す」だけに閉じておくと、
> 万一漏れても被害が限定されます。DNS や WAF の権限は不要です。

5. **Continue to summary** → **Create Token**
6. **表示されたトークンをコピー**（★この画面を閉じると二度と表示されません）

## Zone ID の取得

1. Cloudflare ダッシュボード → `asset-support.co.jp` を開く
2. 右下の **API** 欄に **Zone ID** があるのでコピー

## 私に渡していただく形

`.env` に**石井さんご自身で**追記していただくのが安全です（値を私に貼らなくて済みます）。

```
MMS_CLOUDFLARE_API_TOKEN=（コピーしたトークン）
MMS_CLOUDFLARE_ZONE_ID=（Zone ID）
```

追記後、以下を実行すると worker に反映されます。

```bash
cd ~/システム開発/Next/media-management-system && docker compose up -d worker
```

★`.env` はコミット対象外です（§12-4）。`.env.example` には**キー名だけ**追加済みです。

## 終わったら教えてください

その場で `tag-delivery-daily` を手動実行して、
**6本がパージされ、読者と同じ条件でタグが配信されるようになったか**を確認します。

以降は毎朝 05:50 に自動で検査され、ズレていればその場で直ります。
**「パージし忘れた」という事故が構造的に起きなくなります。**
