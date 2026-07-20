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

## 2. 未接続（後続 Phase）

| 接続先 | 受口 | Phase |
|---|---|---|
| 計測タグ（ファネル7段） | `/api/ingest/events` | **P2.5** |
| Threads GAS（Insights） | `/api/ingest/threads` | **P5** |
| LINE Messaging API | `/api/ingest/line` | **P5.7** |
| WordPress への**書き込み** | `/api/wp/publish` | **P1.8** |
| m2（成約の還流） | `/api/ingest/m2` | **P6.10** |

**共通規約**: どの受口も HMAC-SHA256 署名検証・冪等キー・レート制限を必ず持つ
（§8 / §16.1-④ / §3.10.4）。
