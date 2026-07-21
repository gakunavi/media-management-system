/**
 * Threads.gs — Threads Graph API ラッパ（v2.1）
 *
 * ═══ v2.0 からの変更点 ═══
 *   ① checkYMYL_ の正規表現バグ修正（正当な表現を誤ってブロックしていた）
 *   ② エラーログへの access_token 露出を伏せ字化
 *   ③ AUTO_PUBLISH 経路を削除（post_id にコンテナIDを保存する潜在バグ）
 *
 * ベースURL: https://graph.threads.net/v1.0
 *
 * 対応メディアタイプ:
 *   - TEXT:  テキストのみ投稿
 *   - IMAGE: 画像1枚 + テキスト投稿（image_url 必須）
 *
 * 公式仕様:
 *   - POST /{uid}/threads         … コンテナ作成
 *   - POST /{uid}/threads_publish … 公開
 *   - GET  /{container_id}?fields=status,error_message … ステータス確認
 *   - テキストは最大500文字
 *   - 画像: JPEG/PNG, 最大 5MB, 公開URL必須
 *   - 推奨: コンテナ作成後 30秒待ってから publish
 *   - レート: 24時間 250投稿まで
 */

// ============================================================
// 高レベル API
// ============================================================

/**
 * 画像URLの有無で TEXT / IMAGE を自動判別して投稿する。
 * スプレッドシートからの呼び出しはこの関数を使う。
 *
 * @param {string} text 投稿本文（500文字以内）
 * @param {string=} imageUrl 画像URL（空なら TEXT 投稿）
 * @param {Object=} opts 任意パラメータ
 * @returns {{ mediaId: string, containerId: string }}
 */
function postAuto_(text, imageUrl, opts) {
  if (imageUrl && String(imageUrl).trim()) {
    return postImage_(text, String(imageUrl).trim(), opts);
  }
  return postText_(text, opts);
}

/**
 * テキスト投稿
 *
 * ★v2.1: CONFIG.AUTO_PUBLISH の分岐を削除した。
 *   auto_publish_text を使うと API が返すのは**コンテナID**であり、
 *   公開後の media ID ではない。それを post_id として保存すると
 *   fetchInsights_ が全件 "Object does not exist" で失敗する。
 *   通常経路（コンテナ作成 → publish）は正しく公開IDを返すので、
 *   危険な近道を残す理由がない。
 */
function postText_(text, opts) {
  opts = opts || {};
  validatePostText_(text);

  if (CONFIG.DRY_RUN) {
    Logger.log('[DRY_RUN] TEXT投稿せずに終了: ' + String(text).substring(0, 80));
    return { mediaId: 'DRY_RUN', containerId: 'DRY_RUN' };
  }

  var container = createTextContainer_(text, opts);
  var containerId = container.id;
  Logger.log('TEXTコンテナ作成OK: ' + containerId);

  Utilities.sleep(CONFIG.CONTAINER_WAIT_SECONDS * 1000);
  pollContainerStatus_(containerId);

  var publish = publishContainer_(containerId);
  Logger.log('TEXT公開OK: mediaId=' + publish.id);
  return { mediaId: publish.id, containerId: containerId };
}

/**
 * 画像投稿
 *
 * @param {string} text 投稿本文
 * @param {string} imageUrl 画像の公開URL（JPEG/PNG, 最大5MB）
 * @param {Object=} opts 任意パラメータ
 * @returns {{ mediaId: string, containerId: string }}
 */
function postImage_(text, imageUrl, opts) {
  opts = opts || {};
  validatePostText_(text);

  if (!imageUrl) {
    throw new Error('画像URLが空です。IMAGE投稿には公開URLが必須です。');
  }

  if (CONFIG.DRY_RUN) {
    Logger.log('[DRY_RUN] IMAGE投稿せずに終了: ' + String(text).substring(0, 80) + ' img=' + imageUrl);
    return { mediaId: 'DRY_RUN', containerId: 'DRY_RUN' };
  }

  var container = createImageContainer_(text, imageUrl, opts);
  var containerId = container.id;
  Logger.log('IMAGEコンテナ作成OK: ' + containerId);

  // 画像アップロードがあるため TEXT より長く待つ
  Utilities.sleep(CONFIG.IMAGE_WAIT_SECONDS * 1000);
  pollContainerStatus_(containerId);

  var publish = publishContainer_(containerId);
  Logger.log('IMAGE公開OK: mediaId=' + publish.id);
  return { mediaId: publish.id, containerId: containerId };
}

// ============================================================
// バリデーション
// ============================================================

/**
 * 投稿テキストの事前チェック（文字数 + YMYL禁止表現）
 */
function validatePostText_(text) {
  if (!text || !String(text).trim()) {
    throw new Error('投稿本文が空です。');
  }
  var clean = String(text);
  if (clean.length > CONFIG.TEXT_MAX_CHARS) {
    throw new Error('本文が ' + CONFIG.TEXT_MAX_CHARS + ' 文字を超えています（現在 ' + clean.length + ' 文字）。');
  }

  var ymylResult = checkYMYL_(clean);
  if (ymylResult.length > 0) {
    throw new Error('YMYL禁止表現が検出されました:\n' + ymylResult.join('\n'));
  }
}

/**
 * YMYL禁止表現チェッカー
 * 節税総研の禁止ルールに準拠:
 *   - 断定表現（必ず/確実に/絶対に）
 *   - 煽り表現（知らないと損/驚異の/ヤバい）
 *   - 金額保証表現
 *   - 個別税務アドバイス的表現
 *
 * ★v2.1 の修正: v2.0 は選択肢を [節税できる|儲かる|…] と**文字クラス**で
 *   書いていた。文字クラスは「いずれか1文字」に一致するため、
 *   「必ず**税**理士に確認を」「必ず**節**目で見直しを」のような
 *   **推奨したい表現まで誤ってブロック**していた。
 *   選択肢は (?:A|B|C) と書く必要がある。
 *
 *   あわせて /g フラグを外した。test() は /g があると lastIndex を
 *   持ち回るため、同じ正規表現オブジェクトを再利用すると判定が飛ぶ。
 *
 * ★v2.2 の修正: v2.1 は「語が出たら即ブロック」だったため、
 *   2026-07-22 時点で error になっていた7件のうち6件が誤検出だった。
 *
 *     ・100%  … 「取得価額の100%を経費化」「即時償却100%」は
 *               経営強化税制の**制度上の数値**。断定表現ではない。
 *     ・裏ワザ … 「派手な裏ワザではなく」「一発の裏技ではなく」は
 *               煽りを**否定**している。煽りを戒める投稿ほど落ちていた。
 *     ・確実に … 「年内反映を確実にしたいなら11月までに」は
 *               手続きの話で、節税効果の保証ではない。
 *
 *   そこで「その語の直後に**効果の主張**が来るか」で判定する。
 *   ゆるめた分の担保として、打ち消し文脈だけを除外し、
 *   「100%節税できる」「確実に還付されます」は従来どおり落とす。
 *
 * @param {string} text
 * @returns {string[]} 検出された違反のリスト（空配列なら問題なし）
 */
function checkYMYL_(text) {
  var violations = [];

  // ★打ち消し文脈の煽り語は先に取り除いてから判定する。
  //   「裏ワザではなく王道を」は煽りではなく、むしろ推奨したい書き方。
  var scanned = String(text).replace(
    /(?:裏ワザ|裏技)(?:ではなく|ではありません|じゃなく|より|に頼ら|は不要|は存在し|などない|はない)/g,
    ''
  );

  // 断定表現
  //   ★「効果の主張」が続くときだけ落とす（制度上の数値・手続きの話は通す）
  //   ★間の文字から「取」を外している。外さないと「確実に設備を取得したい」の
  //     "取**得し**" を効果の主張と誤認する。
  var BENEFIT = '[^。、\\n取]{0,4}(?:節税|減税|還付|戻り|戻る|得する|得し|得られ|儲か|安くな|下が|有利|安全|保証)';
  var assertive = [
    { pattern: /必ず(?:節税できる|儲かる|得する|減税|戻る)/,          label: '断定「必ず〜」' },
    { pattern: new RegExp('確実に' + BENEFIT),         label: '断定「確実に〜」' },
    { pattern: /絶対に?(?:節税|得|儲|損しない)/,                      label: '断定「絶対に〜」' },
    { pattern: new RegExp('間違いなく' + BENEFIT),      label: '断定「間違いなく〜」' },
    { pattern: new RegExp('100\\s*[%％]' + BENEFIT),    label: '断定「100%〜」' },
    { pattern: /guaranteed|保証します/,                               label: '保証表現' }
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
    if (allPatterns[i].pattern.test(scanned)) {
      violations.push('⚠️ ' + allPatterns[i].label + ' が検出されました');
    }
  }

  return violations;
}

// ============================================================
// API 低レベル
// ============================================================

/**
 * TEXT コンテナ作成
 */
function createTextContainer_(text, opts) {
  opts = opts || {};
  var url = CONFIG.API_HOST + '/' + CONFIG.API_VERSION + '/' + CONFIG.USER_ID + '/threads';
  var payload = {
    media_type:   'TEXT',
    text:         text,
    access_token: CONFIG.ACCESS_TOKEN
  };
  if (opts.reply_control)   payload.reply_control   = opts.reply_control;
  if (opts.link_attachment) payload.link_attachment = opts.link_attachment;
  if (opts.topic_tag)       payload.topic_tag       = opts.topic_tag;
  return apiPost_(url, payload);
}

/**
 * IMAGE コンテナ作成
 *
 * POST /{uid}/threads
 *   media_type=IMAGE
 *   image_url=<公開URL>
 *   text=<キャプション>
 *   access_token=<token>
 */
function createImageContainer_(text, imageUrl, opts) {
  opts = opts || {};
  var url = CONFIG.API_HOST + '/' + CONFIG.API_VERSION + '/' + CONFIG.USER_ID + '/threads';
  var payload = {
    media_type:   'IMAGE',
    image_url:    imageUrl,
    text:         text,
    access_token: CONFIG.ACCESS_TOKEN
  };
  if (opts.reply_control)   payload.reply_control   = opts.reply_control;
  if (opts.link_attachment) payload.link_attachment = opts.link_attachment;
  if (opts.topic_tag)       payload.topic_tag       = opts.topic_tag;
  return apiPost_(url, payload);
}

/**
 * 公開
 */
function publishContainer_(containerId) {
  var url = CONFIG.API_HOST + '/' + CONFIG.API_VERSION + '/' + CONFIG.USER_ID + '/threads_publish';
  var payload = {
    creation_id:  containerId,
    access_token: CONFIG.ACCESS_TOKEN
  };
  return apiPost_(url, payload);
}

/**
 * ステータスポーリング
 */
function pollContainerStatus_(containerId) {
  var url = CONFIG.API_HOST + '/' + CONFIG.API_VERSION + '/' + containerId
          + '?fields=status,error_message&access_token=' + encodeURIComponent(CONFIG.ACCESS_TOKEN);

  for (var i = 0; i < CONFIG.STATUS_POLL_MAX_RETRIES; i++) {
    var res = apiGet_(url);
    Logger.log('poll #' + (i + 1) + ': status=' + res.status);
    if (res.status === 'FINISHED' || res.status === 'PUBLISHED') {
      return res;
    }
    if (res.status === 'ERROR' || res.status === 'EXPIRED') {
      throw new Error('コンテナ状態異常: status=' + res.status + ' error=' + (res.error_message || 'N/A'));
    }
    Utilities.sleep(CONFIG.STATUS_POLL_INTERVAL_MS);
  }
  throw new Error('コンテナが規定時間内に FINISHED にならなかった: ' + containerId);
}

// ============================================================
// HTTP ユーティリティ
// ============================================================

/**
 * ★v2.1 で追加: ログ・例外メッセージに access_token を出さないための伏せ字化。
 *
 * v2.0 は parseJsonOrThrow_ の ctx に URL をそのまま渡していたため、
 * API がエラーを返すたびに**実行ログへ生のアクセストークンが記録**されていた。
 * 実行ログは共有・貼り付けされやすく、恒常的な漏洩経路になっていた。
 */
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

function parseJsonOrThrow_(res, ctx) {
  var code = res.getResponseCode();
  var body = res.getContentText();
  var json = null;
  try { json = JSON.parse(body); } catch (e) { /* noop */ }

  if (code >= 200 && code < 300) {
    if (!json) throw new Error('[' + ctx + '] 200だがJSONでない: ' + maskUrl_(body));
    return json;
  }
  var msg = 'HTTP ' + code;
  if (json && json.error) {
    msg += ' | type=' + json.error.type
        +  ' code=' + json.error.code
        +  ' message=' + json.error.message;
    if (json.error.error_subcode) msg += ' subcode=' + json.error.error_subcode;
    if (json.error.fbtrace_id)    msg += ' trace=' + json.error.fbtrace_id;
  } else {
    msg += ' | ' + maskUrl_(body.substring(0, 400));
  }
  throw new Error('[' + ctx + '] ' + msg);
}

/**
 * トークン有効性の簡易チェック
 */
function whoAmI() {
  assertConfig_();
  var url = CONFIG.API_HOST + '/' + CONFIG.API_VERSION + '/me'
          + '?fields=id,username,threads_profile_picture_url'
          + '&access_token=' + encodeURIComponent(CONFIG.ACCESS_TOKEN);
  var me = apiGet_(url);
  Logger.log(JSON.stringify(me, null, 2));
  return me;
}
