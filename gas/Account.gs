/**
 * Account.gs — アカウント指標（フォロワー数）の日次記録（v1.0）
 *
 * ═══ なぜ要るか ═══
 * views は「フォロワーが増えたから伸びた」のか「刺さったから伸びた」のか
 * 区別できない。views / followers（1フォロワーあたりの到達）を見ると
 * その2つを分けられる。
 *
 * さらに重要なのが **急落の検知**。Threads は規約違反の疑いなどで配信を
 * 絞ることがあり、そのとき「投稿は普通にできているのに views だけ落ちる」。
 * フォロワー数が横ばいなのに views/follower が急落したら、内容の問題では
 * なく配信側の問題を疑うべき。これは投稿を書き直しても直らない。
 *
 * ═══ API ═══
 *   GET /{user-id}/threads_insights?metric=followers_count&access_token=...
 *
 * ★followers_count は「その時点の総数」を返す時系列メトリクス。
 *   過去に遡れないため、**毎日記録しないと履歴が作れない**。
 *   始めるのが遅れるほど、急落を判断する基準線が作れない。
 *
 * ═══ 使い方 ═══
 *   1) まず checkFollowersCount() を手動実行し、取得できるか確認する
 *   2) 取れたら installAccountTrigger() で日次記録を開始する
 *
 * ★結果は「実行ログ」に出る（アラートは出さない）。GASエディタから実行すると
 *   アラートはスプレッドシート側のタブに出てしまい、気づかないまま
 *   「実行中」で固まるため。
 */

/** 記録先シート名 */
var ACCOUNT_SHEET = 'account';

/**
 * ★alert は使わない。
 *   SpreadsheetApp.getUi().alert() はダイアログを**スプレッドシート側のタブ**に
 *   出すため、GASエディタから ▶ 実行するとダイアログが見えないまま
 *   「実行中」で固まる（実際に起きた）。セットアップ系の関数はエディタから
 *   実行されるので、結果は実行ログにだけ出す。
 */
function alog_(msg) {
  Logger.log(msg);
}

/**
 * 【まずこれを実行】フォロワー数が取得できるか確認する。
 * 取得できれば実行ログに数値が出る。権限不足なら Threads API のエラーが出る。
 */
function checkFollowersCount() {
  assertConfig_();
  try {
    var n = fetchFollowersCount_();
    alog_('✅ フォロワー数の取得に成功: ' + n + '人'
        + ' / 次に installAccountTrigger() を実行すると日次記録が始まります');
    return n;
  } catch (e) {
    alog_('❌ フォロワー数を取得できません: ' + e.message
        + ' / アクセストークンに threads_manage_insights 権限が必要な可能性があります');
    throw e;
  }
}

/**
 * フォロワー数を取得する。
 *
 * ★応答の形が2通りある（total_value 形式と values 配列形式）。
 *   どちらでも読めるようにしておく。片方だけ想定すると静かに 0 が入り、
 *   「フォロワー0人」という誤ったデータが履歴に残る（§3 欠測とゼロの区別）。
 */
function fetchFollowersCount_() {
  var url = CONFIG.API_HOST + '/' + CONFIG.API_VERSION + '/' + CONFIG.USER_ID
          + '/threads_insights?metric=followers_count'
          + '&access_token=' + encodeURIComponent(CONFIG.ACCESS_TOKEN);

  var res = apiGet_(url);
  var data = (res && res.data) || [];
  for (var i = 0; i < data.length; i++) {
    var item = data[i];
    if (item.name !== 'followers_count') continue;

    if (item.total_value && item.total_value.value !== undefined && item.total_value.value !== null) {
      return Number(item.total_value.value);
    }
    if (item.values && item.values.length > 0) {
      var last = item.values[item.values.length - 1];
      if (last && last.value !== undefined && last.value !== null) return Number(last.value);
    }
  }
  throw new Error('応答に followers_count が含まれていません: ' + JSON.stringify(res).substring(0, 300));
}

/**
 * 日次記録。1日1行だけ書く（同日に複数回走っても上書き）。
 */
function collectAccountDaily() {
  assertConfig_();
  var sheet = getAccountSheet_();
  var followers = fetchFollowersCount_();

  var tz = Session.getScriptTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  var lastRow = sheet.getLastRow();
  var dates = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function (r) {
        return r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : String(r[0]);
      })
    : [];

  var idx = dates.indexOf(today);
  var row = [today, followers, new Date()];
  if (idx >= 0) {
    sheet.getRange(idx + 2, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  Logger.log('account 記録: ' + today + ' followers=' + followers);
  return followers;
}

function getAccountSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ACCOUNT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ACCOUNT_SHEET);
    sheet.getRange(1, 1, 1, 3)
         .setValues([['date', 'followers_count', 'updated_at']])
         .setFontWeight('bold')
         .setBackground('#1B2A4A')
         .setFontColor('#FFFFFF');
    sheet.setColumnWidth(1, 110);
    sheet.setColumnWidth(2, 130);
    sheet.setColumnWidth(3, 160);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * 日次トリガー（毎日 5:30。Insights回収の前に取る）。
 *
 * ★登録と同時に**その場で1件記録する**。トリガーだけ張って翌朝を待つと、
 *   初日のデータが丸ごと落ちる。followers_count は過去に遡れないため、
 *   落ちた1日は永久に埋まらない。
 */
function installAccountTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  var deleted = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'collectAccountDaily') {
      ScriptApp.deleteTrigger(existing[i]);
      deleted++;
    }
  }

  ScriptApp.newTrigger('collectAccountDaily')
    .timeBased()
    .atHour(5)
    .nearMinute(30)
    .everyDays(1)
    .create();

  // ★初回を今すぐ記録する（翌朝まで待たない）
  var followers = null;
  try {
    followers = collectAccountDaily();
  } catch (e) {
    alog_('⚠️ トリガーは登録できましたが初回記録に失敗: ' + e.message);
  }

  alog_('✅ 日次のフォロワー数記録を開始しました（毎日 5:30）'
      + ' / 既存トリガー削除: ' + deleted + '件'
      + (followers === null ? '' : ' / 本日分を記録: ' + followers + '人')
      + ' / ★履歴は今日から積み上がります。過去には遡れません');
}
