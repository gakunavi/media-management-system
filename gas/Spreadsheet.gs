/**
 * Spreadsheet.gs — シート読み書き（v2.0 列拡張対応）
 *
 * シート仕様 (1行目=ヘッダー, 12列):
 *   A: id             (THR-XXX 等)
 *   B: scheduled_at   (投稿予定日時)
 *   C: text           (投稿本文)
 *   D: image_url      (画像URL — 空ならTEXT投稿)       ★v2.0
 *   E: target         (法人/個人事業主/共通)             ★v2.0
 *   F: core_message   (柱①/柱②/柱③)                   ★v2.0
 *   G: article_link   (関連記事URL)                     ★v2.0
 *   H: status         (pending / posted / error / skipped)
 *   I: posted_at      (投稿完了日時)
 *   J: post_id        (media ID)
 *   K: error          (エラー内容)
 *   L: notes          (メモ)
 */

/**
 * キューシートのハンドルを取得。なければ作成＋ヘッダー行を投入。
 */
function getQueueSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('アクティブなスプレッドシートがありません。');
  }
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    var headers = [
      'id', 'scheduled_at', 'text', 'image_url',
      'target', 'core_message', 'article_link',
      'status', 'posted_at', 'post_id', 'error', 'notes'
    ];
    sheet.getRange(1, 1, 1, headers.length)
         .setValues([headers])
         .setFontWeight('bold')
         .setBackground('#1B2A4A')
         .setFontColor('#FFFFFF');
    // 列幅設定
    sheet.setColumnWidth(CONFIG.COL.ID, 100);
    sheet.setColumnWidth(CONFIG.COL.SCHEDULED_AT, 150);
    sheet.setColumnWidth(CONFIG.COL.TEXT, 480);
    sheet.setColumnWidth(CONFIG.COL.IMAGE_URL, 200);
    sheet.setColumnWidth(CONFIG.COL.TARGET, 100);
    sheet.setColumnWidth(CONFIG.COL.CORE_MESSAGE, 100);
    sheet.setColumnWidth(CONFIG.COL.ARTICLE_LINK, 200);
    sheet.setColumnWidth(CONFIG.COL.STATUS, 90);
    sheet.setColumnWidth(CONFIG.COL.POSTED_AT, 150);
    sheet.setColumnWidth(CONFIG.COL.POST_ID, 180);
    sheet.setColumnWidth(CONFIG.COL.ERROR, 250);
    sheet.setColumnWidth(CONFIG.COL.NOTES, 200);
    sheet.setFrozenRows(1);

    // target 列にドロップダウン（データバリデーション）
    var targetRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['法人', '個人事業主', '共通'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, CONFIG.COL.TARGET, 500, 1).setDataValidation(targetRule);

    // core_message 列にドロップダウン
    var coreRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['柱①知識差', '柱②税理士外', '柱③早め行動'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, CONFIG.COL.CORE_MESSAGE, 500, 1).setDataValidation(coreRule);

    // status 列にドロップダウン
    var statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['pending', 'posted', 'error', 'skipped'], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, CONFIG.COL.STATUS, 500, 1).setDataValidation(statusRule);
  }
  return sheet;
}

/**
 * 投稿対象の行を最大 MAX_POSTS_PER_RUN 件返す。
 */
function listPendingRows_() {
  var sheet = getQueueSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= CONFIG.HEADER_ROW) return [];

  var values = sheet.getRange(CONFIG.HEADER_ROW + 1, 1, lastRow - CONFIG.HEADER_ROW, CONFIG.TOTAL_COLS).getValues();
  var now = new Date();
  var toleranceMs = CONFIG.SCHEDULE_TOLERANCE_MIN * 60 * 1000;

  var pendingRows = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var rowIndex = CONFIG.HEADER_ROW + 1 + i;

    var status = String(row[CONFIG.COL.STATUS - 1] || '').trim().toLowerCase();
    // ★v2.1: 旧実装は `if (status && status !== 'pending')` で、status が
    //   **空欄のときに continue されず投稿対象になっていた**。
    //   書きかけの下書きをシートに置くと意図せず公開される事故につながる。
    //   投稿するのは明示的に pending と書かれた行だけにする。
    if (status !== 'pending') continue;

    var text = String(row[CONFIG.COL.TEXT - 1] || '').trim();
    if (!text) continue;

    var schedRaw = row[CONFIG.COL.SCHEDULED_AT - 1];
    var scheduledAt = parseScheduledAt_(schedRaw);
    if (scheduledAt) {
      var diff = now.getTime() - scheduledAt.getTime();
      if (diff < 0) continue;
      if (diff > toleranceMs) continue;
    }

    pendingRows.push({
      rowIndex:     rowIndex,
      id:           row[CONFIG.COL.ID - 1],
      scheduledAt:  scheduledAt,
      text:         text,
      imageUrl:     String(row[CONFIG.COL.IMAGE_URL - 1] || '').trim(),
      target:       String(row[CONFIG.COL.TARGET - 1] || ''),
      coreMessage:  String(row[CONFIG.COL.CORE_MESSAGE - 1] || ''),
      articleLink:  String(row[CONFIG.COL.ARTICLE_LINK - 1] || ''),
      notes:        row[CONFIG.COL.NOTES - 1]
    });
    if (pendingRows.length >= CONFIG.MAX_POSTS_PER_RUN) break;
  }
  return pendingRows;
}

function parseScheduledAt_(raw) {
  if (raw == null || raw === '') return null;
  if (Object.prototype.toString.call(raw) === '[object Date]') return raw;
  var s = String(raw).trim();
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  }
  Logger.log('scheduled_at のパース失敗: ' + s);
  return null;
}

/**
 * 投稿成功を書き戻す
 */
function markPosted_(rowIndex, mediaId) {
  var sheet = getQueueSheet_();
  var now = new Date();
  sheet.getRange(rowIndex, CONFIG.COL.STATUS).setValue('posted');
  sheet.getRange(rowIndex, CONFIG.COL.POSTED_AT).setValue(now);
  sheet.getRange(rowIndex, CONFIG.COL.POST_ID).setValue(mediaId);
  sheet.getRange(rowIndex, CONFIG.COL.ERROR).setValue('');
}

/**
 * 投稿失敗を書き戻す
 */
function markError_(rowIndex, message) {
  var sheet = getQueueSheet_();
  sheet.getRange(rowIndex, CONFIG.COL.STATUS).setValue('error');
  sheet.getRange(rowIndex, CONFIG.COL.ERROR).setValue(String(message).substring(0, 1000));
}

/**
 * error 状態の行を pending に戻す（再投稿させる）。★v2.1 で追加
 *
 * markError_ が status を 'error' にすると listPendingRows_ から恒久的に外れ、
 * API の一時的な障害で落ちた投稿も二度と出なくなっていた。
 *
 * ★YMYL違反で止まった行まで戻すと同じ理由で再び止まるだけなので、
 *   error 列を読んで本文を直してから実行すること。
 */
function resetErrorRows() {
  var sheet = getQueueSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= CONFIG.HEADER_ROW) return;

  var range = sheet.getRange(
    CONFIG.HEADER_ROW + 1, CONFIG.COL.STATUS,
    lastRow - CONFIG.HEADER_ROW, 1
  );
  var values = range.getValues();
  var reset = 0;

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim().toLowerCase() === 'error') {
      values[i][0] = 'pending';
      reset++;
    }
  }
  range.setValues(values);

  SpreadsheetApp.getUi().alert(
    reset + '件を pending に戻しました。\n次回のトリガーで再投稿されます。\n\n' +
    '※本文を直していない行は同じ理由で再び error になります。'
  );
}