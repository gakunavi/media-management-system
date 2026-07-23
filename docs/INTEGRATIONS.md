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
| 拒否の通知 | **署名が通った後の拒否・例外は石井さんに通知する**（下記 1.1.1） |
| 堅牢性 | 存在しない `sessionId` は **null 化**。問い合わせ本体を落とさない（下記 1.1.2） |

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

**★「拒否は鳴る」だけでは足りない。** 想定外の例外（下記 1.1.2 の FK 違反など）は
`bad()` を通らないので、拒否通知の経路に乗らない。POST 全体を try/catch し、
**落ちても鳴る**ようにしてある。

#### 1.1.2 存在しない `sessionId` は null 化する（2026-07-22 追加）

`Lead.sessionId` は `VisitorSession` への外部キー。WP は hidden の `mms-sid` を
そのまま送るが、**そのセッションが MMS にまだ無いことがある**
（計測タグがイベントを1件も送る前にフォーム送信した場合など）。

検証せずに渡すと FK 違反で 500 になり、**問い合わせが丸ごと消える**。
実際に 2026-07-22 の実送信テストで発生し、しかも例外なので無音だった。

★セッションの紐づけは「あると嬉しい」情報であって、
　**問い合わせ本体を落としてまで守るものではない**。
　`/api/ingest/events` の「存在しない ID は null 化する」と同じ方針にそろえた。

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
  "interestProduct": ["外貨両替機", "GPUサーバー"],  // interest[] を配列のまま。1文字列に潰さない
  "customerType": "パートナー提携をご検討の方（会計士・税理士様）",  // customer_type。Lead.type に対応（下記 1.3.1）
  "from":    "media",                          // ?from= の値（§5.4 経路判定）
  "article": "ART-088",                        // ?article= の値。ContentItem と突合する
  "sessionId": "…",                            // P2.5 のファネル計測と接続する
  "pageUrl": "https://asset-support.co.jp/contact/",
  "idempotencyKey": "wp-entry-12345"           // 省略可。あれば再送判定が確実になる
}
```

#### 1.3.1 `customerType` は `Lead.type` になる（2026-07-22 追加）

区分は**リードの行き先**を決める。商材の情報ではない。

| CF7 の値 | `Lead.type` | 行き先 |
|---|---|---|
| パートナー提携をご検討の方（会計士・税理士様） | `agency` | 代理店候補。百瀬さん |
| 資産防衛をご検討の方（経営者・投資家様） | `direct_inquiry` | 顧客。営業フロー |

★**新しいフィールドは作らない。** `LeadType.agency` は既にあり、Threads DM 経由の
代理店候補がこれで入っている。同じ意味の区分を2つ持つと `/agency` の分母が
どちらを見ているか分からなくなる。

★`interestProduct` に混ぜてはいけない。混ざると商材別集計が顧客区分で埋まり、
代理店候補が顧客として営業に流れて**両方の歩留まりの分母が壊れる**。

**判定はラベルの完全一致ではなく語で行う**（CF7 の文言は変わりうる）。
判定できなければ**直客として起票したうえで通知する**（黙って営業に流さない）。

```
区分: ★判定できず（直客として起票）「その他のご相談」
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

**★捨てたら鳴る。** 黙って捨てると、計測タグ側でセレクタを増やしたときに
位置別集計がその分だけ静かに欠ける。README の注意書きだけでは防げない。

```
⚠️ 知らないCTA位置が来たので捨てました（位置別集計が欠けます）
値: sticky-cta
セッション: <sessionId>          ← 実訪問か動作確認かの切り分けに使う
受け付ける位置: hero / mid / final / sidebar / header / footer / fixed
```

同じ値につき**1日1通**（同じ語彙が全PVで飛ぶため抑止は必須）。
セッションIDを載せているのは、これが無いと DB を突き合わせる往復が要るため
（2026-07-22 に実際に発生した）。

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
| `data-cta-id="hero"` | CTA位置。`hero`/`mid`/`final`/`sidebar`/`header`/`footer`/`fixed` の7種のみ（2.1.1）。`meta.ctaPosition` に入る |
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
| `unfollow` | `LineFriend.status = blocked`（2026-07-23 追加。扱わないと設置以降の純増すら出せないため。行は消さない） |

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

## 公式LINE 友だち数（Messaging API insight/followers）

**2026-07-23 追加。** 友だち総数は **Webhook では取れない**（設置前の友だちに event が
起きない）。チャネルアクセストークンを発行して日次で取り込む。

| | |
|---|---|
| 対象アカウント | `@898ubeoo`（【公式】中小企業のための節税総研）。★`lin.ee/5NVLBXA` と `lin.ee/szd8e1x` は**同じアカウントの短縮URLが2本あるだけ**で、配信先は同一。canonical `szd8e1x` に統一・`MMS_LINK_DEST_LINE=lin.ee/szd8e1x`（2026-07-22 石井判断） |
| ジョブ | `line-followers-daily`（毎日 07:45・`builtin/line_followers.py`） |
| API | `GET https://api.line.me/v2/bot/insight/followers?date=yyyyMMdd` |
| 環境変数 | `MMS_LINE_CHANNEL_ACCESS_TOKEN`（LINE Developers → Messaging API → 長期トークン） |
| 保存先 | `SnsAccountHealth`（channel=line）の `followers` |

★**保存するのは `followers - blocks`**。API の `followers` は「その日までに友だち追加した
延べ人数」で、ブロックされても減らない。そのまま「友だち数」と呼ぶと実態とずれる。

★**当日は取らない**。集計は前日ぶんが翌日に確定し、当日を指定すると `unready` が返る。
`unready` のときは保存しない（0で保存すると友だちが消える）。過去7日ぶんを毎回
埋め直すので、ジョブが数日止まっても穴が埋まる。

## 公式LINEへの送客リンク（`/r/line/{設置場所}`）

**2026-07-23 に cowork がテーマ側19本を張り替え済み**（本番反映は zip→FTP 待ち）。
生の `lin.ee` は書かない。遷移先は MMS の `MMS_LINK_DEST_LINE` に単一固定で、
アカウントを変えるときは **MMS の env 1箇所**を直すだけで全箇所に効く。

| 種別 | 本数 | 設置場所ID |
|---|---|---|
| 固定 `hp-`（常にHP面） | 4 | `hp-contact` / `hp-top-cta` / `hp-top-card` / `hp-tool-tax-judge` |
| **文脈で切替**（`hp-` ⇄ `media-`） | 6 | `header` / `header-material` / `header-question` / `footer-tabbar` / `footer-sns` / `footer-link` |
| 固定 `media-`（常にメディア面） | 11 | `media-entry-card` / `media-news-subscribe` / `media-lead-card` / `media-fixed-bar` / `media-category-cta-card` / `media-category-fixed-bar` / `media-category-corp-cta-card` / `media-category-corp-fixed-bar` / `media-tag-cta` / **`media-article-bottom`** / **`media-article-sidebar`**（記事末・v175で追加） |

**2026-07-23 テーマ v175 で計装完了**（全21本）。実測で確認した内訳:

| ページ | 出ているID |
|---|---|
| `/media/`（`blog` のポストタイプアーカイブ） | `media-header*`3・`media-footer*`3・`media-entry-card`・`media-lead-card`・`media-fixed-bar` |
| 記事詳細（`single-blog`） | `media-header*`3・`media-footer*`3・**`media-article-bottom`**・**`media-article-sidebar`** |
| タグ一覧 | `media-header*`3・`media-footer*`3・`media-tag-cta` |
| トップ | `hp-top-cta`・`hp-top-card` |
| `/contact/` | `hp-contact` |

★**`/media/` の判定は `is_post_type_archive('blog')`**。固定ページではないので
`is_page_template()` も `is_page()` も false になる（v171・v173 で2回間違えた）。
判定式は**本番HTMLの body class で裏取りしてから渡す**。

★**カテゴリ一覧の実URLは `/media/category/{slug}/`**（`functions.php` の rewrite で
`blog_category` の生スラッグから付け替えている。`get_term_link()` も GNav もこちらを指す）。
`/blog_category/{slug}/` は**旧・生スラッグで記事へ301する**ため、そちらで検証すると
記事詳細のIDが出てきて「カテゴリのCTAが無い」と誤読する（2026-07-23 に実際に誤読した）。

| ページ | 実URL | 出るID |
|---|---|---|
| 法人税カテゴリ | `/media/category/corporate-tax/` | `media-category-corp-cta-card` / `media-category-corp-fixed-bar` |
| その他カテゴリ | `/media/category/{slug}/` | `media-category-cta-card` / `media-category-fixed-bar` |
| タグ一覧 | `/tag/{slug}/` | `media-tag-cta` |

★カテゴリ4本は**到達可能**（GNav → `/media/category/{slug}/`）。クリック0は
「到達不能」ではなく「まだ踏まれていない」。混同すると導線を直す必要が無いのに
直そうとする。

★**接頭辞は出力時にページ文脈で決める**（2026-07-23）。判定は
`is_singular('blog') || is_tax('blog_category') || is_tag() || is_page_template('page-media.php') || is_search()`。
**この案件の記事は `post_type=blog`**（`post` ではない）。`is_singular('post')` と書くと
記事詳細が必ず `hp-` に落ち、いちばん避けたい誤配分が入る。

★**同期前にクリックされた投稿リンクは `threads_link_clicks_pending_{dest}__{THR-xxx}` へ退避し、
次の同期で `ContentMetric` に付け替える**（`api/ingest/threads` の `reclaimPendingClicks`）。
Threads 同期は日次 06:30 なので、その後に公開された投稿は最大24時間 ContentItem が無い。
退避しないと「サイトからのクリック」に化け、**Threads のメディア送客が0のまま**になる
（2026-07-23 に THR-034/035/042 の初クリック5件で実際に発生）。

★**`header-media` / `footer-media` はメディア面専用**（HP側は無印 `header.php` で
LINEボタンが無い）。つまり文脈切替の6本は実運用でほぼ常に `media-` に倒れ、
**HP面のLINE導線は実質4本しかない**（contact・トップ2・判定ツール）。
マトリクスの「HP → 公式LINE」が伸びないときは、施策ではなく**導線の本数**を先に疑う。

- 設置場所IDは `SAFE_SOURCE = /^[A-Za-z0-9_-]{1,40}$/`。外れると**記録が捨てられる**
- 指標は `site_link_clicks_line`（合計）と `site_link_clicks_line__{設置場所}`（内訳）
- UTM は MMS が自動付与。テーマ側では書かない（二重になり GA4 の流入元が汚れる）

★**ヘッダ/フッタはページ文脈で接頭辞を出し分ける**（2026-07-23 石井さん）。
`header-media` / `footer-media` はメディア面にも出るため、固定 `hp-` だと
**記事を読んでいる最中のクリックが HP に計上される**。それでは
「記事を増やしてもHPからの登録が増えるだけ」に見えて判断を誤る。

★**記事詳細（`single-media.php`）にLINE CTAが1本も無い**（2026-07-23 判明）。
メディア9本はすべてトップ・カテゴリ一覧・タグ一覧。いちばん温まっている
読者に出口が無い状態で、これは計測ではなく**設計の穴**。

---

## 7. AIO引用率の計測（2026-07-23・Notion から移設）

### 7.1 何を測るか

ChatGPT / Gemini に質問し、**回答に自社が出てくるか**を数える。
検索順位とは別の指標で、AI検索経由の流入の先行指標になる。

ヒットの定義は4項目のいずれか（旧 `notion-sync-aio.py` と同じ）:

```
media_name  … メディア名が出た
company_name… 社名が出た
site_url    … 自社URLが出た
near_url    … ブランド名がURL近傍（前後100字）に出た
```

### 7.2 保存する形

| metric | 意味 |
|---|---|
| `aio_trials` | 試行数（1試行 = 1プロンプト × 1エンジン × 1回） |
| `aio_hits` | ヒット数 |
| `aio_trials_chatgpt` / `aio_hits_chatgpt` | エンジン別 |
| `aio_trials_gemini` / `aio_hits_gemini` | 同上 |

★**引用率（rate）は保存しない。** §16.5「母数が足りなければ判定不能」。
　rate だけ持つと 1試行1ヒットの 100% と 30試行30ヒットの 100% が同じ値になる。
　hits と trials があれば rate は導出でき、信頼度も判断できる。

★**API が失敗した試行は数に入れない。**
　失敗を hit=false として入れると偽の0%が昇降格判定を汚す。

### 7.2.1 被引用ドメインの保存（2026-07-23 追加・生データのみ）

**ChatGPT が誰を引用したか**を `AioCitation` に残す。**画面もアラートも作らない。**

| 列 | 内容 |
|---|---|
| `citedDomains` | 実際に引用されたURLのホスト。既知リストに無い競合もここで見つかる |
| `citedCompetitors` | `COMPETITOR_PATTERNS` で検出した既知キー（`moneyforward` / `chusho_gov` 等） |
| `hasPrivateCompetitor` | 民間競合が1つでも出たか。公的機関(`.go.jp` / `.lg.jp`)だけなら false |

★**`ContentMetric` には入れない。** metric 文字列にドメインを埋めると
　名前空間が無制限に肥大する（`aio_competitor_moneyforward` … が増え続ける）。

★**Gemini は保存しない。** 実測（2026-05〜06 の3353試行）で
　Gemini は自社0% / 競合0.2% と、特定サイトを引用する挙動をほぼ持たない。

```
chatgpt 1971試行  自社 74 (3.8%)  競合 90 (4.6%)   ← 主に中小企業庁
gemini  1382試行  自社  0 (0.0%)  競合  3 (0.2%)
```

★**なぜ保存だけするのか。** 現状 ChatGPT の被引用は公的機関が中心で、
　民間競合には負けていない。**民間競合が現れた時点**が打ち手の分岐なので、
　その瞬間を後から辿れるようにしておく。可視化はそれからでよい。

### 7.3 Tier と実行間隔

| Tier | エンジン | 試行 | 間隔 | ジョブ |
|---|---|---|---|---|
| Hot | chatgpt, gemini | 3 | 週次 | `aio-hot-weekly`（木 02:00） |
| Warm | chatgpt, gemini | 3 | 隔週 | `aio-warm-biweekly`（木 03:30） |
| Cold | chatgpt | 1 | 月次 | `aio-cold-monthly`（第1木 05:00） |

★**隔週は cron で表現しない。** `%U % 2` は年跨ぎでずれる。
　毎週起動して、**前回計測から日が浅ければ何もしない**でスクリプト側が吸収する。

新規記事の初期 Tier は `wp_sync.py` が付ける（ニュースカテゴリ=Hot / それ以外=Warm）。

### 7.4 Tier の昇降格

計測直後に自動で1段だけ動かす。

```
直近60日の試行が 20未満  → 動かさない（判定不能。成果ゼロではない・§16.5）
ヒット率 > 5%           → 1段上げる
ヒット率 = 0%           → 1段下げる
```

### 7.5 必要な鍵

```bash
OPENAI_API_KEY=...
GEMINI_API_KEY=...
```

どちらか一方でもあればジョブは動く（片方が落ちても計測を続けるため）。
両方無ければジョブは `enabled=false` で登録される。

> **★2026-07-23 時点で OpenAI のクレジットが切れている**（429 insufficient_quota）。
> 移行データではヒットの全件が chatgpt 由来（gemini は1382試行0ヒット）なので、
> このままだと AIO 計測はほぼ意味を持たない。

### 7.6 プロンプト集

`services/worker/legacy/aio/prompts.yaml`（576件）。
`target_art` は **MMS の `externalId`**。Notion の記事IDではない。

★MMS 側で ID を改番したため、旧IDのままだと**別の記事に実績が付く**。
　移行時に27件を付け替えた。プロンプトを追加するときは MMS の ID を使うこと。
