/**
 * Menu.gs — カスタムメニュー（v3.0 Insights追加）
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Threads')
    .addItem('選択行を今すぐ投稿', 'postSelectedRow')
    .addItem('キューを一括処理（手動実行）', 'runScheduledPosts')
    .addSeparator()
    .addItem('選択行のYMYLチェック', 'checkSelectedRowYMYL')
    .addItem('errorの行を再投稿対象に戻す', 'resetErrorRows')
    .addSeparator()
    .addItem('📊 Insights一括回収（全posted行）', 'collectAllInsights')
    .addItem('📊 週次サマリー更新', 'updateWeeklySummary')
    .addSeparator()
    .addItem('接続テスト（whoAmI）', 'runWhoAmI')
    .addItem('フォロワー数を確認', 'checkFollowersCount')
    .addItem('⏰ フォロワー数の日次記録を開始', 'installAccountTrigger')
    .addItem('⏰ 毎時トリガー登録（10投稿/日対応）', 'installTriggers')
    .addItem('⏰ Insightsトリガー登録（日次+週次）', 'installInsightsTriggers')
    .addItem('⏰ 旧トリガーに戻す（3回/日）', 'installTriggersLegacy')
    .addSeparator()
    .addItem('シートひな型を初期化', 'initSheetTemplate')
    .addToUi();
}

function runWhoAmI() {
  try {
    var me = whoAmI();
    SpreadsheetApp.getUi().alert(
      '接続OK\n\nid: ' + me.id +
      '\nusername: ' + (me.username || '(取得不可)')
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('接続NG: ' + e.message);
  }
}

function initSheetTemplate() {
  var sheet = getQueueSheet_();
  if (sheet.getLastRow() <= CONFIG.HEADER_ROW) {
    var now = new Date();
    var in5m = new Date(now.getTime() + 5 * 60 * 1000);
    var tz = Session.getScriptTimeZone();
    var sampleTime = Utilities.formatDate(in5m, tz, 'yyyy-MM-dd HH:mm');
    sheet.appendRow([
      'sample-001',
      sampleTime,
      '【テスト投稿】Threads自動投稿パイプラインの疎通確認です。',
      '',           // image_url
      '共通',       // target
      '柱①知識差',  // core_message
      '',           // article_link
      'pending',
      '', '', '', 'サンプル'
    ]);
  }
  SpreadsheetApp.getUi().alert('シート初期化完了（queueシートを確認してください）');
}