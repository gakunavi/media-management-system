/**
 * Insights.gs — エンゲージメント自動回収（v2.0）
 *
 * ═══ v1.0 からの変更点（なぜ直したか）═══
 *
 * ★問題: 毎回シート先頭から全posted行を叩き直していたため、6分の実行時間
 *   上限に到達して途中で強制終了していた。実データでは 432行目で停止し、
 *   433行目以降（＝新しい投稿）が前日のまま更新されていなかった。
 *   「一番知りたい直近の反応が取れない」という最悪の壊れ方をしていた。
 *
 * ① 鮮度に応じて対象を絞る（FRESHNESS）
 *      投稿直後ほど数値が動くので頻繁に、古い投稿は稀にしか見に行かない。
 *      対象が 400行 → 数十行 になり、数十秒で完走する。
 * ② 新しい順に処理する
 *      万一時間切れになっても、価値の高い直近データから埋まる。
 * ③ 時間予算ガード（TIME_BUDGET_MS）
 *      6分に達する前に自分で止め、どこまで進んだかをログに残す。
 *      「黙って途中で死ぬ」のをやめる。
 * ④ 書き込みを 6回 → 1回 に
 *      writeInsightsToRow_ が setValue を6回呼んでいた。Sheets API は
 *      呼ぶたびに往復が発生するため、1行あたり約0.6秒を無駄にしていた。
 * ⑤ sleep を 500ms → 200ms、失敗時のみ待つ
 * ⑥ 週次サマリーのフォーマット判定を修正
 *      notes に2つの書式が混在しており、v1.0 の notes.split(' / ')[0] は
 *      新しい書式（"A01 代理店募集 | track=agency;...;angle=A01;..."）を
 *      分割できず、1投稿=1グループ（count=1）になって集計が壊れていた。
 *
 * 取得メトリクス: views / likes / replies / reposts / quotes
 *
 * API仕様:
 *   GET /{media_id}/insights?metric=views,likes,replies,reposts,quotes&access_token=TOKEN
 *
 * スプレッドシート列（M〜R列 = 13〜18列）:
 *   M: views  N: likes  O: replies  P: reposts  Q: quotes  R: insights_updated_at
 */

// ─── 列定義（Insightsで追加する列） ─────────────────
var INSIGHTS_COL = {
  VIEWS:              13,
  LIKES:              14,
  REPLIES:            15,
  REPOSTS:            16,
  QUOTES:             17,
  INSIGHTS_UPDATED:   18
};

var INSIGHTS_TOTAL_COLS = 18;  // A〜R

var INSIGHTS_METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes'];

var MS_HOUR = 60 * 60 * 1000;
var MS_DAY  = 24 * MS_HOUR;

/**
 * 鮮度ポリシー。「投稿からの経過日数」ごとに「何日おきに取り直すか」を決める。
 * 上から順に評価し、最初に該当したものを採用する。
 */
var FRESHNESS = [
  { withinDays:   1, refetchAfterHours:  6 },  // 当日: 1日に数回まで許す
  { withinDays:  14, refetchAfterHours: 20 },  // 2週間以内: 毎日1回
  { withinDays:  60, refetchAfterHours: 24 * 7 },   // 2ヶ月以内: 週1回
  { withinDays: 9999, refetchAfterHours: 24 * 30 }  // それ以降: 月1回
];

/** 投稿直後は数値が不安定なので取りに行かない */
var MIN_AGE_MS = 2 * MS_HOUR;

/** 6分の上限に対する自主的な打ち切り。残り時間で無理をしない */
var TIME_BUDGET_MS = 4.5 * 60 * 1000;

/** API 呼び出しの間隔（レート制限対策） */
var API_INTERVAL_MS = 200;

// ─── メイン ─────────────────────────────────────────

/**
 * 鮮度ポリシーに従って Insights を取得する（トリガーから毎日1回）。
 * 対象を絞るので、シートが数千行に育っても完走する。
 */
function collectMatureInsights() {
  return collectInsights_({ respectFreshness: true });
}

/**
 * 全posted行を強制的に取り直す（手動実行用）。
 * ★行数が多いと6分で打ち切られる。その場合はログに続きの行番号が出るので
 *   もう一度実行すれば続きから進む（更新済みは鮮度判定でスキップされるため）。
 */
function collectAllInsights() {
  return collectInsights_({ respectFreshness: false });
}

/**
 * @param {{respectFreshness: boolean}} opts
 */
function collectInsights_(opts) {
  assertConfig_();
  var startedAt = new Date().getTime();

  var sheet = getQueueSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= CONFIG.HEADER_ROW) return;

  ensureInsightsHeaders_(sheet);

  var values = sheet.getRange(
    CONFIG.HEADER_ROW + 1, 1,
    lastRow - CONFIG.HEADER_ROW,
    Math.max(CONFIG.TOTAL_COLS, INSIGHTS_TOTAL_COLS)
  ).getValues();

  var now = new Date().getTime();

  // ── ① 対象を選び出す ──
  var targets = [];
  var skippedFresh = 0;
  var skippedTooNew = 0;

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var status = String(row[CONFIG.COL.STATUS - 1] || '').trim().toLowerCase();
    var postId = String(row[CONFIG.COL.POST_ID - 1] || '').trim();
    if (status !== 'posted' || !postId || postId === 'DRY_RUN') continue;

    var postedAt = asDate_(row[CONFIG.COL.POSTED_AT - 1]);
    var updatedAt = asDate_(row[INSIGHTS_COL.INSIGHTS_UPDATED - 1]);

    // 投稿直後は数値が安定しないので見送る
    if (postedAt && now - postedAt.getTime() < MIN_AGE_MS) {
      skippedTooNew++;
      continue;
    }

    if (opts.respectFreshness && !needsRefetch_(now, postedAt, updatedAt)) {
      skippedFresh++;
      continue;
    }

    targets.push({
      rowIndex: CONFIG.HEADER_ROW + 1 + i,
      postId: postId,
      // ② 新しい順に処理するための並べ替えキー。日時が無い行は最古扱い
      sortKey: postedAt ? postedAt.getTime() : 0
    });
  }

  // ② 新しい投稿から先に埋める（時間切れになっても価値の高い方が残る）
  targets.sort(function (a, b) { return b.sortKey - a.sortKey; });

  Logger.log(
    '対象 ' + targets.length + '件'
    + '（鮮度スキップ ' + skippedFresh + ' / 投稿直後スキップ ' + skippedTooNew + '）'
  );

  // ── 取得して書き戻す ──
  var updated = 0;
  var errors = 0;
  var ranOutOfTime = false;

  for (var t = 0; t < targets.length; t++) {
    // ③ 時間予算ガード。6分で強制終了される前に自分で止める
    if (new Date().getTime() - startedAt > TIME_BUDGET_MS) {
      ranOutOfTime = true;
      Logger.log(
        '★時間予算に到達したため中断。未処理 ' + (targets.length - t) + '件。'
        + '次回の実行で続きから取得されます'
      );
      break;
    }

    var tg = targets[t];
    try {
      var insights = fetchInsights_(tg.postId);
      writeInsightsToRow_(sheet, tg.rowIndex, insights);
      updated++;
      Utilities.sleep(API_INTERVAL_MS);
    } catch (e) {
      Logger.log('[Insights row ' + tg.rowIndex + '] ' + e.message);
      errors++;
      // ⑤ 失敗時だけ長めに待つ（レート制限に当たっている可能性があるため）
      Utilities.sleep(1000);
    }
  }

  var elapsed = Math.round((new Date().getTime() - startedAt) / 1000);
  Logger.log(
    'Insights回収完了: updated=' + updated + ' errors=' + errors
    + ' elapsed=' + elapsed + 's' + (ranOutOfTime ? ' (時間切れ中断)' : '')
  );

  return { updated: updated, errors: errors, ranOutOfTime: ranOutOfTime };
}

/**
 * この行を取り直すべきか。
 * 一度も取っていなければ必ず取る。取得済みなら投稿の古さに応じた間隔で判断する。
 */
function needsRefetch_(nowMs, postedAt, updatedAt) {
  if (!updatedAt) return true;  // 未取得は最優先

  var ageDays = postedAt ? (nowMs - postedAt.getTime()) / MS_DAY : 9999;
  var sinceUpdateHours = (nowMs - updatedAt.getTime()) / MS_HOUR;

  for (var i = 0; i < FRESHNESS.length; i++) {
    if (ageDays <= FRESHNESS[i].withinDays) {
      return sinceUpdateHours >= FRESHNESS[i].refetchAfterHours;
    }
  }
  return false;
}

function asDate_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? null : v;
  }
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// ─── API呼び出し ─────────────────────────────────────

/**
 * 1投稿分のInsightsを取得
 * @param {string} mediaId Threads media ID
 * @returns {Object} { views: N, likes: N, replies: N, reposts: N, quotes: N }
 */
function fetchInsights_(mediaId) {
  var url = CONFIG.API_HOST + '/' + CONFIG.API_VERSION + '/' + mediaId
          + '/insights?metric=' + INSIGHTS_METRICS.join(',')
          + '&access_token=' + encodeURIComponent(CONFIG.ACCESS_TOKEN);

  var res = apiGet_(url);

  var result = {};
  if (res.data && Array.isArray(res.data)) {
    for (var i = 0; i < res.data.length; i++) {
      var item = res.data[i];
      var val = 0;
      if (item.values && item.values.length > 0) {
        val = item.values[0].value || 0;
      } else if (item.total_value && item.total_value.value !== undefined) {
        val = item.total_value.value;
      }
      result[item.name] = val;
    }
  }

  return result;
}

// ─── シート書き込み ──────────────────────────────────

/**
 * ④ 6回の setValue を1回の setValues にまとめる。
 *    Sheets API は呼び出しごとに往復が発生するため、ここが最大のボトルネックだった。
 */
function writeInsightsToRow_(sheet, rowIndex, insights) {
  sheet.getRange(rowIndex, INSIGHTS_COL.VIEWS, 1, 6).setValues([[
    insights.views   || 0,
    insights.likes   || 0,
    insights.replies || 0,
    insights.reposts || 0,
    insights.quotes  || 0,
    new Date()
  ]]);
}

function ensureInsightsHeaders_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).getValues()[0];

  if (!headers[INSIGHTS_COL.VIEWS - 1]) {
    var insightsHeaders = ['views', 'likes', 'replies', 'reposts', 'quotes', 'insights_updated_at'];
    sheet.getRange(1, INSIGHTS_COL.VIEWS, 1, insightsHeaders.length)
         .setValues([insightsHeaders])
         .setFontWeight('bold')
         .setBackground('#1B2A4A')
         .setFontColor('#FFFFFF');

    sheet.setColumnWidth(INSIGHTS_COL.VIEWS, 80);
    sheet.setColumnWidth(INSIGHTS_COL.LIKES, 80);
    sheet.setColumnWidth(INSIGHTS_COL.REPLIES, 80);
    sheet.setColumnWidth(INSIGHTS_COL.REPOSTS, 80);
    sheet.setColumnWidth(INSIGHTS_COL.QUOTES, 80);
    sheet.setColumnWidth(INSIGHTS_COL.INSIGHTS_UPDATED, 150);
  }
}

// ─── 週次サマリーシート自動更新 ──────────────────────

/**
 * ⑥ notes からフォーマットを取り出す。
 *
 * notes には2つの書式が混在している:
 *   旧: "比較型 / 節税の誤解を解く"
 *   新: "A01 代理店募集 | track=agency;exp=AGC-001;arm=A;angle=A01;slot=am"
 *
 * v1.0 の notes.split(' / ')[0] は新書式を分割できず、notes 全体が
 * フォーマット名になっていた。結果、1投稿ごとに別グループ（count=1）が
 * 作られ、フォーマット別集計が意味を成していなかった。
 */
function extractFormat_(notes) {
  var s = String(notes || '').trim();
  if (!s) return 'unknown';

  // 新書式は angle= を持つ。これが実質のフォーマット識別子
  var m = s.match(/angle=([^;\s|]+)/);
  if (m) return m[1];

  // 旧書式（' / ' 区切り）と、angle を持たない新書式（' | ' 区切り）の両対応
  var head = s.split(/\s\/\s|\s\|\s/)[0];
  return head.trim() || 'unknown';
}

/**
 * 投稿データを集計して「週次サマリー」シートに書き出す。
 */
function updateWeeklySummary() {
  var sheet = getQueueSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= CONFIG.HEADER_ROW) return;

  var values = sheet.getRange(
    CONFIG.HEADER_ROW + 1, 1,
    lastRow - CONFIG.HEADER_ROW,
    INSIGHTS_TOTAL_COLS
  ).getValues();

  // posted行だけ集計
  var postedRows = [];
  var unmeasured = 0;
  for (var i = 0; i < values.length; i++) {
    var status = String(values[i][CONFIG.COL.STATUS - 1] || '').trim().toLowerCase();
    if (status !== 'posted') continue;

    // ★「未計測」と「0」を分けて数える。まだ取れていない投稿を 0 として
    //   平均に混ぜると、実績を実際より悪く見せてしまう
    var measured = !!asDate_(values[i][INSIGHTS_COL.INSIGHTS_UPDATED - 1]);
    if (!measured) { unmeasured++; continue; }

    postedRows.push({
      id:           String(values[i][CONFIG.COL.ID - 1] || ''),
      text:         String(values[i][CONFIG.COL.TEXT - 1] || ''),
      target:       String(values[i][CONFIG.COL.TARGET - 1] || ''),
      core_message: String(values[i][CONFIG.COL.CORE_MESSAGE - 1] || ''),
      format:       extractFormat_(values[i][CONFIG.COL.NOTES - 1]),
      postedAt:     values[i][CONFIG.COL.POSTED_AT - 1],
      views:        Number(values[i][INSIGHTS_COL.VIEWS - 1] || 0),
      likes:        Number(values[i][INSIGHTS_COL.LIKES - 1] || 0),
      replies:      Number(values[i][INSIGHTS_COL.REPLIES - 1] || 0),
      reposts:      Number(values[i][INSIGHTS_COL.REPOSTS - 1] || 0),
      quotes:       Number(values[i][INSIGHTS_COL.QUOTES - 1] || 0)
    });
  }

  if (postedRows.length === 0) {
    Logger.log('集計対象なし（未計測 ' + unmeasured + '件）');
    return;
  }

  // ─── 集計 ─────
  var formatStats = {};
  var targetStats = {};
  var coreStats = {};

  for (var j = 0; j < postedRows.length; j++) {
    var r = postedRows[j];
    var eng = r.likes + r.replies + r.reposts + r.quotes;

    if (!formatStats[r.format]) formatStats[r.format] = { count: 0, views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, engagement: 0 };
    formatStats[r.format].count++;
    formatStats[r.format].views += r.views;
    formatStats[r.format].likes += r.likes;
    formatStats[r.format].replies += r.replies;
    formatStats[r.format].reposts += r.reposts;
    formatStats[r.format].quotes += r.quotes;
    formatStats[r.format].engagement += eng;

    if (!targetStats[r.target]) targetStats[r.target] = { count: 0, views: 0, engagement: 0 };
    targetStats[r.target].count++;
    targetStats[r.target].views += r.views;
    targetStats[r.target].engagement += eng;

    if (!coreStats[r.core_message]) coreStats[r.core_message] = { count: 0, views: 0, engagement: 0 };
    coreStats[r.core_message].count++;
    coreStats[r.core_message].views += r.views;
    coreStats[r.core_message].engagement += eng;
  }

  // ─── サマリーシート書き出し ─────
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var summarySheet = ss.getSheetByName('週次サマリー');
  if (!summarySheet) {
    summarySheet = ss.insertSheet('週次サマリー');
  }
  summarySheet.clear();

  var tz = Session.getScriptTimeZone();
  var now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  summarySheet.getRange(1, 1)
    .setValue('週次サマリー — 最終更新: ' + now)
    .setFontWeight('bold').setFontSize(14);

  // ★未計測件数を明示する。「0件」と「まだ測れていない」を混同させない
  summarySheet.getRange(2, 1).setValue(
    '集計対象 ' + postedRows.length + '件 ／ 未計測（Insights未取得）' + unmeasured + '件'
  ).setFontColor(unmeasured > 0 ? '#B71C1C' : '#555555');

  var fRow = 4;
  summarySheet.getRange(fRow, 1).setValue('■ フォーマット別パフォーマンス').setFontWeight('bold');
  fRow++;
  summarySheet.getRange(fRow, 1, 1, 8)
    .setValues([['フォーマット', '投稿数', '総views', '総いいね', '総返信', '総リポスト', '総引用', '平均エンゲージメント']])
    .setFontWeight('bold').setBackground('#E8EAF6');

  var formatKeys = Object.keys(formatStats).sort();
  for (var k = 0; k < formatKeys.length; k++) {
    fRow++;
    var fs = formatStats[formatKeys[k]];
    var avgEng = fs.count > 0 ? Math.round(fs.engagement / fs.count * 10) / 10 : 0;
    summarySheet.getRange(fRow, 1, 1, 8)
      .setValues([[formatKeys[k], fs.count, fs.views, fs.likes, fs.replies, fs.reposts, fs.quotes, avgEng]]);
  }

  fRow += 2;
  summarySheet.getRange(fRow, 1).setValue('■ ターゲット別パフォーマンス').setFontWeight('bold');
  fRow++;
  summarySheet.getRange(fRow, 1, 1, 5)
    .setValues([['ターゲット', '投稿数', '総views', '総エンゲージメント', '平均エンゲージメント']])
    .setFontWeight('bold').setBackground('#E8F5E9');

  var targetKeys = Object.keys(targetStats).sort();
  for (var m = 0; m < targetKeys.length; m++) {
    fRow++;
    var ts = targetStats[targetKeys[m]];
    var avgEngT = ts.count > 0 ? Math.round(ts.engagement / ts.count * 10) / 10 : 0;
    summarySheet.getRange(fRow, 1, 1, 5)
      .setValues([[targetKeys[m], ts.count, ts.views, ts.engagement, avgEngT]]);
  }

  fRow += 2;
  summarySheet.getRange(fRow, 1).setValue('■ コアメッセージ別パフォーマンス').setFontWeight('bold');
  fRow++;
  summarySheet.getRange(fRow, 1, 1, 5)
    .setValues([['コアメッセージ', '投稿数', '総views', '総エンゲージメント', '平均エンゲージメント']])
    .setFontWeight('bold').setBackground('#FFF3E0');

  var coreKeys = Object.keys(coreStats).sort();
  for (var n = 0; n < coreKeys.length; n++) {
    fRow++;
    var cs = coreStats[coreKeys[n]];
    var avgEngC = cs.count > 0 ? Math.round(cs.engagement / cs.count * 10) / 10 : 0;
    summarySheet.getRange(fRow, 1, 1, 5)
      .setValues([[coreKeys[n], cs.count, cs.views, cs.engagement, avgEngC]]);
  }

  fRow += 2;
  summarySheet.getRange(fRow, 1).setValue('■ エンゲージメント TOP10').setFontWeight('bold');
  fRow++;
  summarySheet.getRange(fRow, 1, 1, 8)
    .setValues([['ID', '本文（先頭50字）', 'フォーマット', 'views', 'いいね', '返信', 'リポスト', '引用']])
    .setFontWeight('bold').setBackground('#FCE4EC');

  postedRows.sort(function (a, b) {
    var engA = a.likes + a.replies + a.reposts + a.quotes;
    var engB = b.likes + b.replies + b.reposts + b.quotes;
    return engB - engA;
  });

  for (var p = 0; p < Math.min(10, postedRows.length); p++) {
    fRow++;
    var pr = postedRows[p];
    summarySheet.getRange(fRow, 1, 1, 8).setValues([
      [pr.id, pr.text.substring(0, 50), pr.format, pr.views, pr.likes, pr.replies, pr.reposts, pr.quotes]
    ]);
  }

  Logger.log('週次サマリー更新完了: ' + postedRows.length + '件を集計（未計測 ' + unmeasured + '件）');
}

// ─── Insightsトリガー登録 ─────────────────────────────

/**
 * Insights回収用のトリガーを登録:
 *   - 毎日 6:00 と 18:00: collectMatureInsights
 *     ★2回に増やした。1回あたりの対象が鮮度ポリシーで絞られるため
 *       負荷は v1.0 の1回分より軽い。当日投稿の反応を夕方に拾える
 *   - 毎週月曜 5:00: updateWeeklySummary
 */
function installInsightsTriggers() {
  var existing = ScriptApp.getProjectTriggers();
  var deleted = 0;
  for (var i = 0; i < existing.length; i++) {
    var fn = existing[i].getHandlerFunction();
    if (fn === 'collectMatureInsights' || fn === 'updateWeeklySummary' || fn === 'collectAllInsights') {
      ScriptApp.deleteTrigger(existing[i]);
      deleted++;
    }
  }
  Logger.log('既存Insightsトリガー削除: ' + deleted + '件');

  var hours = [6, 18];
  for (var h = 0; h < hours.length; h++) {
    ScriptApp.newTrigger('collectMatureInsights')
      .timeBased()
      .atHour(hours[h])
      .nearMinute(0)
      .everyDays(1)
      .create();
  }

  ScriptApp.newTrigger('updateWeeklySummary')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(5)
    .nearMinute(0)
    .create();

  SpreadsheetApp.getUi().alert(
    'Insightsトリガー登録完了\n\n' +
    '・毎日 6:00 / 18:00 — エンゲージメント自動回収\n' +
    '・毎週月曜 5:00 — 週次サマリー自動更新'
  );
}
