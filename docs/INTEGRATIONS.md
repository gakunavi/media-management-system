# 外部システムとの接続手順

> 設計書 §8（セキュリティ）／§3.10.3（計測タグの設計原則）／§3.9.1（WP書き込みの一本化）に基づく。
> **★WordPress 側では一切 DB 書き込みをしない。** 受けるのは MMS の `/api/ingest/*` だけ（§3.10.3-⑤）。

---

## 1. WordPress フォーム → MMS（P2・実装済み）

### 1.1 受口

```
POST /api/ingest/form
```

| 要件 | 内容 |
|---|---|
| 署名 | **HMAC-SHA256**（§8）。ヘッダ2つが必須 |
| 認証 | 不要（署名が認証を兼ねる）。`middleware.ts` の公開パス |
| 冪等性 | **再送しても二重起票されない**。内容から Lead の主キーを導出している |
| レート制限 | 既定 1分30件（`MMS_INGEST_RATE_LIMIT`）。超過は 429 |
| 個人情報 | **AES-256-GCM で列単位に暗号化**して保存（§16.2） |
| 拒否の通知 | **署名が通った後の拒否は石井さんに通知する**（下記 1.1.1） |

#### 1.1.1 拒否されたら鳴る（2026-07-22 追加）

署名が通っている＝送信元は自社の WordPress である。そこから先の 4xx/5xx は
攻撃ではなく**設定ミス**なので、黙って落とすと事故になる。

```
WP側が email のフィールド名を変えた
  → プラグインが値を拾えず 400
  → MMS の問い合わせ件数は 0 のまま
  → 「LPが効いていない」に見える     ← §3 が禁じる「壊れた計測の実測ゼロ化」
```

しかもこれが起きる場所は**ゴール指標（問い合わせ数）の直上**で、最も害が大きい。
WP プラグイン側は `debug.log` にしか書かないので、MMS から鳴らす。

| 状態 | 通知 | 理由 |
|---|---|---|
| 署名なし・不一致・期限切れ | **しない** | 攻撃・スキャンで鳴り続ける |
| 署名OK ＋ 400/500/503 | **する** | 自社WPからの設定ミス。取りこぼしが発生している |

同じ理由の通知は**1時間に1通**（壊れたフォームで鳴り続けると無視されるようになる）。

### 1.2 ヘッダ

| ヘッダ | 値 |
|---|---|
| `Content-Type` | `application/json` |
| `X-MMS-Timestamp` | UNIX 秒 |
| `X-MMS-Signature` | `hex(HMAC_SHA256(secret, "{timestamp}.{生のボディ}"))` |

**署名対象は「生のボディ文字列」**。JSON を再エンコードすると一致しなくなる。
タイムスタンプの許容差は **±300秒**（リプレイ攻撃対策）。

### 1.3 ボディ

```jsonc
{
  "occurredAt": "2026-07-20T22:30:00+09:00",  // 省略時はサーバー時刻
  "name":    "山田太郎",
  "email":   "yamada@example.co.jp",          // email か phone のどちらかは必須
  "phone":   "03-1234-5678",
  "company": "株式会社サンプル",
  "message": "即時償却について相談したい",
  "interestProduct": ["ML"],
  "from":    "media",                          // ?from= の値（§5.4 経路判定）
  "article": "ART-088",                        // ?article= の値。ContentItem と突合する
  "sessionId": "…",                            // P2.5 のファネル計測と接続する
  "pageUrl": "https://asset-support.co.jp/contact/",
  "idempotencyKey": "wp-entry-12345"           // 省略可。あれば再送判定が確実になる
}
```

### 1.4 WordPress 側の実装（子テーマ or 専用プラグイン）

> ★**`functions.php` に直書きしない。** テーマ更新で消える（§16.6-5 / docs/RULES.md §1.2）。

```php
<?php
/**
 * MMS へ問い合わせを転送する。
 * ★WP 側では DB 書き込みを一切しない（§3.10.3-⑤）。転送するだけ。
 * ★同期処理でユーザーを待たせない（過去の TTFB スパイク事故の教訓）。
 */
function mms_forward_inquiry(array $entry): void {
    $secret = getenv('MMS_INGEST_SECRET');
    $url    = getenv('MMS_INGEST_URL'); // 例: https://mms.example.com/api/ingest/form
    if (!$secret || !$url) { return; }

    $payload = wp_json_encode([
        'occurredAt'      => current_time('c'),
        'name'            => $entry['name']    ?? null,
        'email'           => $entry['email']   ?? null,
        'phone'           => $entry['phone']   ?? null,
        'company'         => $entry['company'] ?? null,
        'message'         => $entry['message'] ?? null,
        'interestProduct' => $entry['products'] ?? [],
        'from'            => $_GET['from']    ?? null,
        'article'         => $_GET['article'] ?? null,
        'pageUrl'         => home_url(add_query_arg(null, null)),
        'idempotencyKey'  => 'wp-entry-' . ($entry['id'] ?? uniqid()),
    ], JSON_UNESCAPED_UNICODE);

    $ts   = (string) time();
    $sig  = hash_hmac('sha256', $ts . '.' . $payload, $secret);

    // blocking=false で送信し、ユーザーの送信完了を待たせない
    wp_remote_post($url, [
        'headers'  => [
            'Content-Type'     => 'application/json',
            'X-MMS-Timestamp'  => $ts,
            'X-MMS-Signature'  => $sig,
        ],
        'body'     => $payload,
        'timeout'  => 5,
        'blocking' => false,
    ]);
}
```

### 1.5 ★接続したら必ず計測開始を記録する

```bash
npm run measurement -- start lead_direct_inquiry --method wp_form_webhook
```

**これを忘れると、問い合わせが入っても指標が「—(未計測)」のままになる**（§3 規約）。
逆に、**まだ繋いでいないのに記録してはいけない**。「0件」と表示され、
**直客2件を見逃した事故がそのまま再発する**。

確認:

```bash
npm run measurement -- list
```

### 1.6 動作確認

```bash
npm run ingest:test          # 署名付きのテスト送信（.env の値を使う）
```

同じ内容で2回送ると `duplicate: true` が返り、Lead は増えない（冪等性の確認）。

---

## 2. ファネル計測タグ（P2.5・実装済み）

### 2.1 受口

```
POST /api/ingest/events
```

| 要件 | 内容 |
|---|---|
| 認証 | **HMAC は使わない**。ブラウザのタグは共有シークレットを持てない（露出する）。代わりに **Origin allowlist ＋ セッション単位レート制限 ＋ 冪等キー**で守る |
| 受信形式 | `text/plain`（sendBeacon が CORS プリフライトを起こさないため）。本文は JSON |
| 冪等性 | `(sessionId, step, contentItemId, occurredAt秒)` の一意制約（§16.1-④）。再送しても増えない |
| 堅牢性 | 存在しない `ctaId` / `lpId` / `article` は **null 化**。タグの属性ミス1つでバッチ全体を落とさない |
| 上限 | 1リクエスト **50件**まで（§3.10.3-⑦）。超過は 413 |
| CTAの位置 | `ctaPosition` で送る。`meta.ctaPosition` に保存される（下記 2.1.1） |

#### 2.1.1 `ctaId` と `ctaPosition` は別物（2026-07-22 追加）

| 項目 | 意味 | いま送るべきか |
|---|---|---|
| `ctaId` | `Cta` テーブルの主キー（**cuid**） | **送らない** |
| `ctaPosition` | `hero` `mid` `final` `sidebar` `header` `footer` `fixed` | **これを送る** |

`Cta` は「記事ごとの1つのCTA」を表す行で、`contentItemId` と `targetUrl` が必須。
つまり **`"hero"` という `ctaId` は原理的に存在しない**。位置ラベルを `ctaId` に
入れて送ると、存在しない ID として null 化され、位置が消える。

★位置別の効き目（hero と final のどちらが押されているか）は
　`Cta` レジストリが無くても出せる。162記事 × 7位置 = 1134行を先に作る必要はない。

**互換**: 解決できない `ctaId` が位置ラベルと一致する場合は位置として扱う。
既存プラグイン（`ctaId: "hero"` を送る版）はそのままで記録される。
知らない値は捨てる（ゴミが混ざると位置別集計が信用できなくなる）。

### 2.2 タグの設置（子テーマ or 専用プラグイン）

> ★**`functions.php` 直書き禁止**（§16.6-5）。`defer` で読み込む（原則⑥）。

```html
<!-- 記事ページ -->
<script defer src="https://mms.example.com/mms-tag.js"
        data-endpoint="https://mms.example.com/api/ingest/events"
        data-article="ART-088"></script>

<!-- CTA・フォームは data 属性で宣言するだけで計測される -->
<a href="/lp" data-mms="cta_click" data-cta-id="hero" data-mms-view="cta">無料相談</a>

<!-- LP ページ（data-lp を付けると lp_view / lp_scroll を送る）-->
<script defer src="https://mms.example.com/mms-tag.js"
        data-endpoint="https://mms.example.com/api/ingest/events"
        data-lp="<LandingPage.id>"></script>
<form data-mms-form> … </form>
```

| data 属性 | 意味 |
|---|---|
| `data-mms="<step>"` | クリックでそのステップを送る（`cta_click` / `phone_click` 等） |
| `data-mms-view="cta"` | 画面に入ったら `cta_view`（IntersectionObserver・1回だけ） |
| `data-cta-id="hero"` | CTA位置（hero/mid/final/sidebar）。既存 `Cta` の id を入れると位置別集計に接続 |
| `data-mms-form` | フォーム。focus→`form_view` / change→`form_field` / submit→`submit` |

### 2.3 計測タグの7原則（§3.10.3・タグに実装済み）

① 離脱時に sendBeacon 1発 ／ ② スクロール throttle 250ms・深度 25/50/75/100 の4段のみ ／
③ 冪等キーで重複排除 ／ ④ 非同期送信のみ ／ ⑤ WP 側で DB 書込みしない ／
⑥ defer・`document.write` 禁止 ／ ⑦ 1セッション 50件で自己遮断

### 2.4 本番で必ず設定する

```bash
# .env — 計測タグを送ってよいオリジン（カンマ区切り）。未設定だと全許可（開発用）
MMS_INGEST_ALLOWED_ORIGINS=https://asset-support.co.jp
```

### 2.5 動作確認

```bash
npm run events:test   # 7段送信・冪等・不正step拒否・413 を確認
```

---

## 3. Threads（GAS → MMS・受口は実装済み）

### 3.1 方針：GAS はそのまま。MMS は「受け取るだけ」

設計書 §6 が「**Threads GAS は継続**。Insights を `/api/ingest/threads` へ POST する
よう1関数追加するだけ」としている通り、**投稿の仕組みは触りません**。

| | |
|---|---|
| **Threads トークン** | **MMS には不要**。GAS 側に置いたままでよい（MMS は Threads API を叩かない） |
| **認証** | 他の Webhook と同じ **HMAC-SHA256**（`MMS_INGEST_SECRET`） |
| **解決したい問題** | 「投稿はできているが**反応が測れていない**」。views 等を蓄積すると、平均の1.5倍跳ねた投稿を記事化ネタとして自動起票できる（§13.4-④） |

### 3.2 受口

```
POST /api/ingest/threads
```

```jsonc
{
  "accountRef": "setsuzei_masa",     // アカウント識別子（複数運用に備える・§11.3）
  "posts": [
    {
      "id": "THR-001",               // 必須。シートの id 列
      "postId": "17977672592851956",
      "text": "本文…",
      "target": "法人",               // → ContentItem.targetLabel
      "coreMessage": "柱②税理士外",   // → ContentItem.category
      "scheduledAt": "2026-05-08T07:00:00+09:00",
      "postedAt": "2026-05-07T15:06:05+09:00",
      "status": "posted",
      "notes": "good-bad / 利回り%の罠",
      "metrics": { "views": 17, "likes": 0, "replies": 0, "reposts": 0, "quotes": 0 }
    }
  ]
}
```

- **冪等**: 同じ `id` は上書き。`metrics` は同日・同指標を最新値で更新（インサイトは後から増えるため）
- 1リクエスト **500件**まで

### 3.3 GAS に足す関数（コピペ1回）

> ★既存の投稿処理は**一切変更しません**。この関数を追加し、
> 「キューを一括処理」の最後か、時間トリガーで呼ぶだけです。

```javascript
/** MMS へ投稿実績を送る（既存の投稿処理は変更しない） */
function syncToMms() {
  var ENDPOINT = PropertiesService.getScriptProperties().getProperty('MMS_INGEST_URL');
  var SECRET   = PropertiesService.getScriptProperties().getProperty('MMS_INGEST_SECRET');
  if (!ENDPOINT || !SECRET) { Logger.log('MMS 設定なし'); return; }

  var sh = SpreadsheetApp.getActive().getSheetByName('queue');
  var values = sh.getDataRange().getValues();
  var head = values[0];
  var col = {};
  head.forEach(function (h, i) { col[h] = i; });

  var posts = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row[col['id']]) continue;
    if (row[col['status']] !== 'posted') continue;   // 投稿済みだけ送る
    posts.push({
      id:          String(row[col['id']]),
      postId:      row[col['post_id']]      ? String(row[col['post_id']]) : undefined,
      text:        row[col['text']]         ? String(row[col['text']])    : undefined,
      target:      row[col['target']]       ? String(row[col['target']])  : undefined,
      coreMessage: row[col['core_message']] ? String(row[col['core_message']]) : undefined,
      scheduledAt: row[col['scheduled_at']] ? new Date(row[col['scheduled_at']]).toISOString() : undefined,
      postedAt:    row[col['posted_at']]    ? new Date(row[col['posted_at']]).toISOString()    : undefined,
      status:      String(row[col['status']]),
      notes:       row[col['notes']]        ? String(row[col['notes']])   : undefined,
      metrics: {
        views:   row[col['views']]   !== '' ? Number(row[col['views']])   : undefined,
        likes:   col['likes']   !== undefined ? Number(row[col['likes']])   : undefined,
        replies: col['replies'] !== undefined ? Number(row[col['replies']]) : undefined
      }
    });
  }
  if (!posts.length) { Logger.log('送る行なし'); return; }

  // 500件ずつ送る
  for (var i = 0; i < posts.length; i += 500) {
    var payload = JSON.stringify({ accountRef: 'setsuzei_masa', posts: posts.slice(i, i + 500) });
    var ts  = String(Math.floor(Date.now() / 1000));
    var raw = Utilities.computeHmacSha256Signature(ts + '.' + payload, SECRET);
    var sig = raw.map(function (b) {
      return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
    }).join('');

    var res = UrlFetchApp.fetch(ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      headers: { 'X-MMS-Timestamp': ts, 'X-MMS-Signature': sig },
      muteHttpExceptions: true
    });
    Logger.log('MMS: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  }
}
```

### 3.4 GAS 側の設定（スクリプトプロパティに2つ追加）

Apps Script → **プロジェクトの設定 → スクリプト プロパティ**:

| キー | 値 |
|---|---|
| `MMS_INGEST_URL` | `https://<MMSの公開URL>/api/ingest/threads` |
| `MMS_INGEST_SECRET` | MMS の `.env` の `MMS_INGEST_SECRET` と同じ値 |

> ★MMS は現在 `localhost` のみなので、**Cloudflare Tunnel（P9）で公開してから**
> でないと GAS から到達できません。それまでは受口だけ用意した状態になります。

---

## 3.5 公式LINE（Messaging API Webhook・2026-07-22 実装済み）

購入検討中の方から2件の問い合わせが来ていたのに誰も気づいていなかったのが契機。
**解くべきは「記録すること」より見逃さないこと**なので、受信した瞬間に Slack へ投げる。

```
Webhook URL: https://collect.asset-support.co.jp/api/ingest/line
署名: X-Line-Signature = Base64(HMAC-SHA256(channelSecret, rawBody))
環境変数: MMS_LINE_CHANNEL_SECRET（未設定なら fail-closed で 503）
```

| イベント | MMS の動作 |
|---|---|
| `follow` | `LineFriend` + `Lead(line_friend / line)` ＋ Slack通知 |
| `message` | `LineInbound` ＋ Slack通知 |
| `unfollow` | 扱わない（2026-07-22 石井さん判断） |

★**`collect.` に設定すること。** `mms.` は Cloudflare Access で保護されており、
LINE 側がログイン画面を受け取って Webhook が全部失敗する。
★本文は保存しない。内容は LINE 公式アカウント側にあり、MMS が持つのは件数だけ。

---

## 3.6 送客リンク（`/r/<遷移先>/<送り元>`・2026-07-22 実装済み）

```
https://collect.asset-support.co.jp/r/{soken|lp|line}/{送り元}

送り元が THR-xxx  → 投稿単位で記録（ContentMetric）／ from=threads
それ以外（site-*） → サイト単位で記録（MetricSnapshot）／ from=site
```

- 遷移先URLは環境変数で固定（`MMS_LINK_DEST_SOKEN` / `_LP` / `_LINE`）。
  **URLを引数で受けない**（自社ドメインが誘導の踏み台になるため）
- 診断LPが複数あるときはカンマ区切りで書くと一様ランダムに振り分ける
- クローラのプレビュー踏みは記録しない（投稿しただけでクリック1になるのを防ぐ）
- 計測に失敗しても遷移は必ず通す

---

## 3.7 GA4（MMS が直接取得・2026-07-22 実装済み）

以前は GA4 → Notion → MMS（週次）の経路で、`pv` が 7/13 から9日間止まっていた。
GA4 は一次ソースを直接叩けるため、間に人や別システムを挟む理由が無い。

```
builtin/ga4_daily.py（毎日07:30）
  記事別PV        → ContentMetric.pv（ContentItem.url で突合）
  診断LPのファネル → MetricSnapshot（変種別 lp_view_* / lp_users_* / lp_form_submit_*）
環境変数: GA4_PROPERTY_ID / MMS_GA4_CREDENTIALS（GSC用とは別の鍵）
```

★実際に1行でも入った指標にだけ `MeasurementCoverage` を作る。
　取得対象を全部登録すると「測れている」という誤った主張になる。

---

## 3.8 代理店LP（外部ドメイン・2026-07-22 実装済み）

```
builtin/agency_lp_import.py（毎日07:15）
  取得元: cowork の agency_lp_sources.json → 各LPの export.php?key=…&file=visits|inquiries
  保存先: AgencyLpDaily（lp / date / agencyCode / visits / inquiries）
```

★**PII を持ち込まない。** `inquiries` の CSV には氏名・メールアドレスが含まれるが、
MMS が必要なのは件数だけ。持たなければ守る必要も無い（§16.2）。
★取得に失敗した日は既存値を残す（0 で上書きすると偽の「流入ゼロ」になる）。

---

## 4. 未接続（後続 Phase）

| 接続先 | 受口 | Phase |
|---|---|---|
| WordPress への**書き込み** | `/api/wp/publish` | **P1.8** |
| m2（成約の還流） | `/api/ingest/m2` | **P6.10** |

**共通規約**: どの受口も HMAC-SHA256 署名検証・冪等キー・レート制限を必ず持つ
（§8 / §16.1-④ / §3.10.4）。
