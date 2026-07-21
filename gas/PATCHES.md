# 部分差し替えパッチ

`Insights.gs` は全文差し替え（`gas/Insights.gs`）。それ以外はここに記す該当箇所だけを直す。

適用順は **C → D** を推奨（C は実害が出ているため）。

---

## C. `Threads.gs` — YMYL判定の正規表現バグ 🔴

### 何が起きているか

```javascript
/必ず[節税できる|儲かる|得する|減税|戻る]/g
```

`[...]` は**文字クラス**であって選択肢（alternation）ではない。
これは「必ず」の次に

> `節` `税` `で` `き` `る` `儲` `か` `得` `す` `減` `戻` `|`

の**いずれか1文字**が来ればマッチする。結果:

| 文章 | v1.0の判定 | 妥当か |
|---|---|---|
| 必ず**戻**ってくる | ブロック | ✅ 意図通り |
| 必ず**税**理士に確認を | **ブロック** | ❌ 誤検知 |
| 必ず**節**目で見直しを | **ブロック** | ❌ 誤検知 |
| 絶対に**し**た方がいい | **ブロック** | ❌ 誤検知 |

税務コンテンツで「必ず税理士に確認を」は**むしろ推奨したい表現**なのに弾かれる。
`裏ワザ|裏技` のように正しく書かれたパターン（THR-407 を止めたもの）は問題ない。

### 差し替え

`Threads.gs` の `checkYMYL_` を丸ごと以下に置き換える。

```javascript
/**
 * YMYL禁止表現チェッカー
 * 節税総研の禁止ルールに準拠:
 *   - 断定表現（必ず/確実に/絶対に）
 *   - 煽り表現（知らないと損/驚異の/ヤバい）
 *   - 金額保証表現
 *   - 個別税務アドバイス的表現
 *
 * ★v1.0 は選択肢を [節税|儲かる|...] と文字クラスで書いていたため、
 *   「必ず税理士に確認を」のような正当な表現まで弾いていた。
 *   選択肢は (?:A|B|C) で書く必要がある。
 *
 * @param {string} text
 * @returns {string[]} 検出された違反のリスト（空配列なら問題なし）
 */
function checkYMYL_(text) {
  var violations = [];

  // 断定表現
  var assertive = [
    { pattern: /必ず(?:節税できる|儲かる|得する|減税|戻る)/, label: '断定「必ず〜」' },
    { pattern: /確実に/,                                     label: '断定「確実に」' },
    { pattern: /絶対に?(?:節税|得|儲|損しない)/,             label: '断定「絶対に〜」' },
    { pattern: /間違いなく/,                                 label: '断定「間違いなく」' },
    { pattern: /100\s*[%％]/,                                label: '断定「100%」' },
    { pattern: /guaranteed|保証します/,                      label: '保証表現' }
  ];

  // 煽り表現
  var sensational = [
    { pattern: /知らないと損/,   label: '煽り「知らないと損」' },
    { pattern: /驚異の/,         label: '煽り「驚異の」' },
    { pattern: /ヤバい|やばい/,  label: '煽り「ヤバい」' },
    { pattern: /衝撃[のな]/,     label: '煽り「衝撃の」' },
    { pattern: /驚愕/,           label: '煽り「驚愕」' },
    { pattern: /業界の闇/,       label: '煽り「業界の闇」' },
    { pattern: /9割が知らない/,  label: '煽り「9割が知らない」' },
    { pattern: /裏ワザ|裏技/,    label: '煽り「裏ワザ」' }
  ];

  // 個別税務アドバイス的表現
  var taxAdvice = [
    { pattern: /あなたは?\d+万?円(?:節税|得|戻)/, label: '個別シミュレーション' },
    { pattern: /○○の場合は△△円/,                label: '個別税務アドバイス' }
  ];

  var allPatterns = assertive.concat(sensational).concat(taxAdvice);

  for (var i = 0; i < allPatterns.length; i++) {
    if (allPatterns[i].pattern.test(text)) {
      violations.push('⚠️ ' + allPatterns[i].label + ' が検出されました');
    }
  }

  return violations;
}
```

### 変更点まとめ

| | v1.0 | v2.0 |
|---|---|---|
| 選択肢の書き方 | `[A\|B\|C]`（文字クラス＝誤り） | `(?:A\|B\|C)` |
| `/g` フラグ | 付いていた | **外した**。`test()` は `/g` があると `lastIndex` を持ち回るため、同じ正規表現を再利用すると判定が飛ぶ。1回しか呼ばない今は無害だが、地雷なので除去 |
| `100%` | `/100%/` | `/100\s*[%％]/`（全角％と空白に対応） |
| ラベル誤字 | 「業界の闘」 | 「業界の闇」 |

### 適用後の確認

メニュー `Threads → 選択行のYMYLチェック` で、
「必ず税理士に確認してください」が**通る**こと、
「絶対に損しない」が**止まる**ことを確認してください。

---

## D. 事故防止まわり 🟡

### D-1. `Spreadsheet.gs` — status空欄の行が投稿されてしまう

`listPendingRows_` の中の

```javascript
if (status && status !== 'pending') continue;
```

これは「status が空欄」のとき `status &&` が false になり、**continue されない**＝
投稿対象になる。書きかけの下書きをシートに置くと、意図せず公開される。

**修正:**

```javascript
if (status !== 'pending') continue;
```

> ⚠️ 現在 status 空欄で運用している行があると、この修正で投稿されなくなります。
> 適用前に H列の空欄を検索し、投稿したい行には `pending` を入れてください。

### D-2. `Config.gs` — 設定値がドキュメントと三重に食い違っている

| 定数 | 現在の値 | README | Main.gsコメント |
|---|---|---|---|
| `SCHEDULE_TOLERANCE_MIN` | **1440**（24時間） | 30分 | 45分 |
| `MAX_POSTS_PER_RUN` | **3** | 5 | 10投稿/日 |

`SCHEDULE_TOLERANCE_MIN = 1440` だと「予定時刻を大幅に過ぎた古い行を投げない」
というセーフガードが**実質無効**になっている。トリガーが数時間止まったあとに
復旧すると、溜まった古い投稿がまとめて出る。

**推奨:**

```javascript
SCHEDULE_TOLERANCE_MIN: 120,   // 2時間。トリガーは毎時なので余裕を見て2枠分
MAX_POSTS_PER_RUN:      3,     // 現状維持（毎時×16回 = 理論上48/日）
```

あわせて README と Main.gs のコメントを実際の値に合わせてください。
**どれか1つを正とし、残りを合わせる**のが目的です（値そのものより不一致が危険）。

### D-3. `Spreadsheet.gs` / `Menu.gs` — error行が永久に再投稿されない

`markError_` が status を `error` にすると `listPendingRows_` から恒久的に外れる。
API の一時障害で落ちた投稿も二度と出ない（現在3件が該当）。

**追加する関数**（`Spreadsheet.gs` の末尾）:

```javascript
/**
 * error 状態の行を pending に戻す（再投稿させる）。
 * ★YMYL違反で止まった行まで戻すと同じ理由で再び止まるだけなので、
 *   本文を直してから実行すること。
 */
function resetErrorRows() {
  var sheet = getQueueSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= CONFIG.HEADER_ROW) return;

  var range = sheet.getRange(CONFIG.HEADER_ROW + 1, CONFIG.COL.STATUS, lastRow - CONFIG.HEADER_ROW, 1);
  var values = range.getValues();
  var reset = 0;

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim().toLowerCase() === 'error') {
      values[i][0] = 'pending';
      reset++;
    }
  }
  range.setValues(values);
  SpreadsheetApp.getUi().alert(reset + '件を pending に戻しました。\n次回のトリガーで再投稿されます。');
}
```

`Menu.gs` の `onOpen()` に1行追加:

```javascript
.addItem('errorの行を再投稿対象に戻す', 'resetErrorRows')
```

### D-4. `Threads.gs` — `AUTO_PUBLISH` を有効にすると post_id が壊れる（潜在）

```javascript
if (CONFIG.AUTO_PUBLISH) {
    var autoRes = createTextContainer_(text, Object.assign({ auto_publish_text: true }, opts));
    return { mediaId: autoRes.id, containerId: autoRes.id };   // ← これはコンテナID
}
```

`auto_publish_text` を使うと API が返すのは**コンテナID**であり、公開後の
media ID ではない。これを `post_id` に保存すると `fetchInsights_` が全滅する。

今は `AUTO_PUBLISH = false` なので無害だが、将来オンにすると壊れる。
**この分岐ごと削除する**のが安全（通常経路は正しく公開IDを保存している）。

### D-5. `Api.gs` — HTTPステータスが常に200になる

`jsonResponse_(data, statusCode)` が `statusCode` を使っていない。
GAS の `ContentService` は任意のステータスコードを返せない仕様なので、
**本文側で判別できるようにする**しかない。

```javascript
function jsonResponse_(data, statusCode) {
  var body = (data && typeof data === 'object') ? data : { data: data };
  // ★GAS の ContentService は HTTP ステータスを設定できない。
  //   呼び出し側が判定できるよう、本文に必ず ok と status を載せる
  if (body.ok === undefined) body.ok = !statusCode || statusCode < 400;
  body.status = statusCode || 200;
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
```

MMS 側（`services/worker/builtin/threads_sync.py`）は既に `ok` を見て
失敗を判定するので、この修正を入れると認証エラー等が正しく検知されます。

---

## C-2. `Threads.gs` — エラーログにアクセストークンが出る 🔴

### 何が起きたか

`parseJsonOrThrow_(res, ctx)` の `ctx` が `'GET ' + url` で、`fetchInsights_` /
`pollContainerStatus_` / `whoAmI` は URL に `access_token` を載せている。
このため **API がエラーを返すたびに実行ログへ生トークンが記録される**。

実例（2026-07-21 の Insights 回収時、投稿が削除されていた行）:

```
[Insights row 619] [GET https://graph.threads.net/v1.0/…/insights?…&access_token=<生トークンがそのまま出力される> ] HTTP 400 …
```

実行ログは共有・貼り付けされやすい。**トークン漏洩の常設経路**になっている。

### 差し替え

`Threads.gs` の HTTP ユーティリティ節を以下に置き換える。

```javascript
/** ログ・例外メッセージに access_token を出さないための伏せ字化 */
function maskUrl_(u) {
  return String(u).replace(/access_token=[^&]*/g, 'access_token=***');
}

function apiPost_(url, payload) {
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true,
    followRedirects: true
  });
  return parseJsonOrThrow_(res, 'POST ' + maskUrl_(url));
}

function apiGet_(url) {
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true
  });
  return parseJsonOrThrow_(res, 'GET ' + maskUrl_(url));
}
```

> ★既に露出したトークンは伏せ字化では戻らない。**再発行**して
> スクリプトプロパティ `THREADS_ACCESS_TOKEN` を差し替えること。

---

## D-6. `Api.gs` — `top_posts` に `insights_updated_at` を含める 🟡

### なぜ必要か

`top_posts` は **Insights 未回収の行も views=0 として返す**。
MMS 側はこれを受け取ると「まだ測っていない」を「0だった」として記録してしまう
（実際に190件がそうなっていた。設計書 §3「欠測とゼロの区別」違反）。

現在は MMS 側で「全指標が0なら未計測とみなす」という**推定**で回避している。
`insights_updated_at` が返ればこの推定が不要になり、判定が厳密になる。

### 修正

`Api.gs` の `getPostedRowsWithInsights_`（または `handleTopPosts_`）で
1行に組み立てているオブジェクトへ1項目足す。

```javascript
// 既存の views: row[12], likes: row[13], … に続けて
insights_updated_at: row[17] || ''   // R列（18列目）= insights_updated_at
```

MMS 側（`services/worker/builtin/threads_sync.py` の `is_measured`）は
この項目があれば自動的にそちらを正として使う。**MMS側の変更は不要**。
