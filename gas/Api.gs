/**
 * Api.gs — Web App エンドポイント（外部からのHTTP読み書き）
 *
 * デプロイ手順:
 *   1. GASエディタ → デプロイ → 新しいデプロイ
 *   2. 種類: ウェブアプリ
 *   3. 実行ユーザー: 自分
 *   4. アクセス: 全員（匿名含む）
 *   5. デプロイ → URLをコピー
 *   6. スクリプトプロパティに API_KEY を追加（任意の長い文字列）
 *
 * 認証: クエリパラメータ ?key=API_KEY
 */

// ─── GET: 読み取り系 ───────────────────────────────
function doGet(e) {
  try {
    if (!authenticateRequest_(e)) {
      return jsonResponse_({ error: '認証失敗: API_KEY が不正です' }, 401);
    }

    var action = (e.parameter.action || 'list').toLowerCase();

    switch (action) {
      case 'list':
        return handleList_(e);
      case 'stats':
        return handleStats_();
      case 'report':
        return handleReport_(e);
      case 'top_posts':
        return handleTopPosts_(e);
      case 'format_analysis':
        return handleFormatAnalysis_();
      case 'account':
        return handleAccount_(e);
      case 'ping':
        return jsonResponse_({ ok: true, timestamp: new Date().toISOString() });
      default:
        return jsonResponse_({ error: '不明なaction: ' + action }, 400);
    }
  } catch (err) {
    return jsonResponse_({ error: err.message }, 500);
  }
}

// ─── POST: 書き込み系 ──────────────────────────────
function doPost(e) {
  try {
    if (!authenticateRequest_(e)) {
      return jsonResponse_({ error: '認証失敗: API_KEY が不正です' }, 401);
    }

    var body = JSON.parse(e.postData.contents);
    var action = (body.action || '').toLowerCase();

    switch (action) {
      case 'add':
        return handleAdd_(body);
      case 'add_bulk':
        return handleAddBulk_(body);
      case 'update':
        return handleUpdate_(body);
      case 'clear_pending':
        return handleClearPending_();
      default:
        return jsonResponse_({ error: '不明なaction: ' + action }, 400);
    }
  } catch (err) {
    return jsonResponse_({ error: err.message }, 500);
  }
}

// ─── 認証 ──────────────────────────────────────────
function authenticateRequest_(e) {
  var props = PropertiesService.getScriptProperties();
  var validKey = props.getProperty('API_KEY');
  if (!validKey) return false;
  var provided = e.parameter.key || '';
  return provided === validKey;
}

// ─── GET handlers ──────────────────────────────────

/**
 * 投稿一覧を返す
 * ?action=list&status=pending  (optional filter)
 * ?action=list&limit=20        (optional limit, default=100)
 */
function handleList_(e) {
  var sheet = getQueueSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= CONFIG.HEADER_ROW) {
    return jsonResponse_({ posts: [], total: 0 });
  }

  var filterStatus = (e.parameter.status || '').toLowerCase();
  var limit = parseInt(e.parameter.limit || '100', 10);

  var values = sheet.getRange(
    CONFIG.HEADER_ROW + 1, 1,
    lastRow - CONFIG.HEADER_ROW, CONFIG.TOTAL_COLS
  ).getValues();

  var posts = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var status = String(row[CONFIG.COL.STATUS - 1] || '').trim().toLowerCase();

    if (filterStatus && status !== filterStatus) continue;

    posts.push({
      row_index: CONFIG.HEADER_ROW + 1 + i,
      id:            String(row[CONFIG.COL.ID - 1] || ''),
      scheduled_at:  formatDateForJson_(row[CONFIG.COL.SCHEDULED_AT - 1]),
      text:          String(row[CONFIG.COL.TEXT - 1] || ''),
      image_url:     String(row[CONFIG.COL.IMAGE_URL - 1] || ''),
      target:        String(row[CONFIG.COL.TARGET - 1] || ''),
      core_message:  String(row[CONFIG.COL.CORE_MESSAGE - 1] || ''),
      article_link:  String(row[CONFIG.COL.ARTICLE_LINK - 1] || ''),
      status:        status || 'pending',
      posted_at:     formatDateForJson_(row[CONFIG.COL.POSTED_AT - 1]),
      post_id:       String(row[CONFIG.COL.POST_ID - 1] || ''),
      error:         String(row[CONFIG.COL.ERROR - 1] || ''),
      notes:         String(row[CONFIG.COL.NOTES - 1] || '')
    });

    if (posts.length >= limit) break;
  }

  return jsonResponse_({ posts: posts, total: posts.length });
}

/**
 * 統計サマリーを返す
 */
function handleStats_() {
  var sheet = getQueueSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= CONFIG.HEADER_ROW) {
    return jsonResponse_({ total: 0, pending: 0, posted: 0, error: 0, skipped: 0 });
  }

  var statuses = sheet.getRange(
    CONFIG.HEADER_ROW + 1, CONFIG.COL.STATUS,
    lastRow - CONFIG.HEADER_ROW, 1
  ).getValues();

  var counts = { pending: 0, posted: 0, error: 0, skipped: 0, other: 0 };
  for (var i = 0; i < statuses.length; i++) {
    var s = String(statuses[i][0] || '').trim().toLowerCase();
    if (!s || s === 'pending') counts.pending++;
    else if (s === 'posted') counts.posted++;
    else if (s === 'error') counts.error++;
    else if (s === 'skipped') counts.skipped++;
    else counts.other++;
  }

  return jsonResponse_({
    total: statuses.length,
    pending: counts.pending,
    posted: counts.posted,
    error: counts.error,
    skipped: counts.skipped
  });
}

// ─── POST handlers ─────────────────────────────────

/**
 * 1行追加
 * body: { action: "add", post: { id, scheduled_at, text, ... } }
 */
function handleAdd_(body) {
  var post = body.post;
  if (!post || !post.text) {
    return jsonResponse_({ error: 'post.text は必須です' }, 400);
  }

  var sheet = getQueueSheet_();
  var rowData = buildRowArray_(post);
  sheet.appendRow(rowData);

  return jsonResponse_({
    ok: true,
    message: '1行追加しました',
    id: post.id || '',
    row_index: sheet.getLastRow()
  });
}

/**
 * 一括追加（最大200行）
 * body: { action: "add_bulk", posts: [ { id, scheduled_at, text, ... }, ... ] }
 */
function handleAddBulk_(body) {
  var posts = body.posts;
  if (!posts || !Array.isArray(posts) || posts.length === 0) {
    return jsonResponse_({ error: 'posts 配列が空です' }, 400);
  }
  if (posts.length > 200) {
    return jsonResponse_({ error: '一括追加は最大200行です' }, 400);
  }

  var sheet = getQueueSheet_();
  var rows = [];
  for (var i = 0; i < posts.length; i++) {
    if (!posts[i].text) {
      return jsonResponse_({ error: 'posts[' + i + '].text が空です' }, 400);
    }
    rows.push(buildRowArray_(posts[i]));
  }

  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, CONFIG.TOTAL_COLS).setValues(rows);

  return jsonResponse_({
    ok: true,
    message: rows.length + '行を一括追加しました',
    start_row: startRow,
    end_row: startRow + rows.length - 1
  });
}

/**
 * 行の更新（status / error / notes 等）
 * body: { action: "update", row_index: 5, fields: { status: "skipped", notes: "..." } }
 * または
 * body: { action: "update", id: "THR-007", fields: { status: "skipped" } }
 */
function handleUpdate_(body) {
  var sheet = getQueueSheet_();
  var rowIndex = body.row_index;

  // ID指定の場合は行を検索
  if (!rowIndex && body.id) {
    rowIndex = findRowById_(sheet, body.id);
    if (!rowIndex) {
      return jsonResponse_({ error: 'id=' + body.id + ' が見つかりません' }, 404);
    }
  }

  if (!rowIndex || rowIndex <= CONFIG.HEADER_ROW) {
    return jsonResponse_({ error: 'row_index または id を指定してください' }, 400);
  }

  var fields = body.fields || {};
  var updated = [];

  var fieldMap = {
    'id':           CONFIG.COL.ID,
    'scheduled_at': CONFIG.COL.SCHEDULED_AT,
    'text':         CONFIG.COL.TEXT,
    'image_url':    CONFIG.COL.IMAGE_URL,
    'target':       CONFIG.COL.TARGET,
    'core_message': CONFIG.COL.CORE_MESSAGE,
    'article_link': CONFIG.COL.ARTICLE_LINK,
    'status':       CONFIG.COL.STATUS,
    'notes':        CONFIG.COL.NOTES,
    'error':        CONFIG.COL.ERROR
  };

  for (var key in fields) {
    if (fieldMap[key]) {
      sheet.getRange(rowIndex, fieldMap[key]).setValue(fields[key]);
      updated.push(key);
    }
  }

  return jsonResponse_({
    ok: true,
    message: 'row ' + rowIndex + ' を更新しました',
    updated_fields: updated
  });
}

/**
 * pending 行をすべて skipped に変更（リセット用）
 */
function handleClearPending_() {
  var sheet = getQueueSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= CONFIG.HEADER_ROW) {
    return jsonResponse_({ ok: true, cleared: 0 });
  }

  var statuses = sheet.getRange(
    CONFIG.HEADER_ROW + 1, CONFIG.COL.STATUS,
    lastRow - CONFIG.HEADER_ROW, 1
  ).getValues();

  var cleared = 0;
  for (var i = 0; i < statuses.length; i++) {
    var s = String(statuses[i][0] || '').trim().toLowerCase();
    if (!s || s === 'pending') {
      sheet.getRange(CONFIG.HEADER_ROW + 1 + i, CONFIG.COL.STATUS).setValue('skipped');
      cleared++;
    }
  }

  return jsonResponse_({ ok: true, cleared: cleared });
}

// ─── ヘルパー ──────────────────────────────────────

function buildRowArray_(post) {
  return [
    post.id           || '',
    post.scheduled_at || '',
    post.text         || '',
    post.image_url    || '',
    post.target       || '',
    post.core_message || '',
    post.article_link || '',
    // ★既定を pending から draft に変更した。
    //   API で流し込まれた原稿がそのまま公開されるのは、生成の自動化と
    //   相性が悪い（YMYL領域で人の確認を挟めない）。draft で入れておけば
    //   MMS の /threads で承認したものだけが pending になる。
    //   自分で書いた行をすぐ流したいときは status: "pending" を明示する。
    post.status       || 'draft',
    '',  // posted_at  (自動記録)
    '',  // post_id    (自動記録)
    '',  // error      (自動記録)
    post.notes        || ''
  ];
}

function findRowById_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= CONFIG.HEADER_ROW) return null;

  var ids = sheet.getRange(
    CONFIG.HEADER_ROW + 1, CONFIG.COL.ID,
    lastRow - CONFIG.HEADER_ROW, 1
  ).getValues();

  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) {
      return CONFIG.HEADER_ROW + 1 + i;
    }
  }
  return null;
}

function formatDateForJson_(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    var tz = Session.getScriptTimeZone();
    return Utilities.formatDate(val, tz, 'yyyy-MM-dd HH:mm:ss');
  }
  return String(val);
}

/**
 * ★v2.1: 旧実装は引数 statusCode を受け取りながら**一切使っていなかった**ため、
 *   認証失敗(401)でもサーバーエラー(500)でも常に HTTP 200 が返っていた。
 *   呼び出し側はエラーを検知できず、失敗を成功として処理してしまう。
 *
 *   GAS の ContentService は任意の HTTP ステータスを設定できない仕様なので、
 *   **本文に ok と status を必ず載せて**判別可能にする。
 */
function jsonResponse_(data, statusCode) {
  var body = (data && typeof data === 'object' && !Array.isArray(data)) ? data : { data: data };
  if (body.ok === undefined) {
    body.ok = !statusCode || statusCode < 400;
  }
  body.status = statusCode || 200;
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * アカウント指標の履歴（フォロワー数）。★v2.2 で追加
 * ?action=account&days=180
 *
 * MMS が views/follower を出して配信制限の兆候を見るために使う。
 * ★シートが無い/空なら空配列を返す。0 を返してはいけない（未計測とゼロの区別）。
 */
function handleAccount_(e) {
  var days = parseInt(e.parameter.days || '365', 10);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(typeof ACCOUNT_SHEET !== 'undefined' ? ACCOUNT_SHEET : 'account');
  if (!sheet || sheet.getLastRow() <= 1) {
    return jsonResponse_({ account: [], total: 0, note: 'まだ記録がありません（Account.gs 未稼働）' });
  }

  var tz = Session.getScriptTimeZone();
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  var out = [];
  for (var i = 0; i < values.length; i++) {
    var d = values[i][0];
    var followers = values[i][1];
    if (followers === '' || followers === null) continue; // 未計測は返さない
    var dt = (d instanceof Date) ? d : new Date(String(d));
    if (isNaN(dt.getTime()) || dt < cutoff) continue;
    out.push({
      date: Utilities.formatDate(dt, tz, 'yyyy-MM-dd'),
      followers_count: Number(followers)
    });
  }
  return jsonResponse_({ account: out, total: out.length });
}

// ─── 分析系 GET handlers ───────────────────────────────

/**
 * 総合レポート
 * ?action=report&days=7 (直近N日, default=7)
 */
function handleReport_(e) {
  var days = parseInt(e.parameter.days || '7', 10);
  var rows = getPostedRowsWithInsights_();

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  var filtered = rows.filter(function (r) {
    return r.postedAt && r.postedAt >= cutoff;
  });

  var totalViews = 0, totalLikes = 0, totalReplies = 0, totalReposts = 0, totalQuotes = 0;
  var imgStats = { count: 0, views: 0, eng: 0 };
  var txtStats = { count: 0, views: 0, eng: 0 };
  var hourStats = {};  // 時間帯別集計

  for (var i = 0; i < filtered.length; i++) {
    var r = filtered[i];
    totalViews   += r.views;
    totalLikes   += r.likes;
    totalReplies += r.replies;
    totalReposts += r.reposts;
    totalQuotes  += r.quotes;

    var rowEng = r.likes + r.replies + r.reposts + r.quotes;
    if (r.hasImage) {
      imgStats.count++; imgStats.views += r.views; imgStats.eng += rowEng;
    } else {
      txtStats.count++; txtStats.views += r.views; txtStats.eng += rowEng;
    }

    // 時間帯別集計
    if (r.postedAt) {
      var hour = r.postedAt.getHours();
      var hKey = String(hour);
      if (!hourStats[hKey]) hourStats[hKey] = { count: 0, views: 0, engagement: 0 };
      hourStats[hKey].count++;
      hourStats[hKey].views += r.views;
      hourStats[hKey].engagement += rowEng;
    }
  }

  var totalEng = totalLikes + totalReplies + totalReposts + totalQuotes;
  var avgEng = filtered.length > 0 ? Math.round(totalEng / filtered.length * 10) / 10 : 0;
  var engRate = totalViews > 0 ? Math.round(totalEng / totalViews * 10000) / 100 : 0;

  return jsonResponse_({
    period_days: days,
    total_posts: filtered.length,
    total_views: totalViews,
    total_engagement: totalEng,
    avg_engagement_per_post: avgEng,
    engagement_rate_pct: engRate,
    breakdown: {
      likes: totalLikes,
      replies: totalReplies,
      reposts: totalReposts,
      quotes: totalQuotes
    },
    by_image: {
      with_image: {
        count: imgStats.count,
        total_views: imgStats.views,
        total_engagement: imgStats.eng,
        avg_views: imgStats.count > 0 ? Math.round(imgStats.views / imgStats.count) : 0,
        avg_engagement: imgStats.count > 0 ? Math.round(imgStats.eng / imgStats.count * 10) / 10 : 0,
        eng_rate_pct: imgStats.views > 0 ? Math.round(imgStats.eng / imgStats.views * 10000) / 100 : 0
      },
      text_only: {
        count: txtStats.count,
        total_views: txtStats.views,
        total_engagement: txtStats.eng,
        avg_views: txtStats.count > 0 ? Math.round(txtStats.views / txtStats.count) : 0,
        avg_engagement: txtStats.count > 0 ? Math.round(txtStats.eng / txtStats.count * 10) / 10 : 0,
        eng_rate_pct: txtStats.views > 0 ? Math.round(txtStats.eng / txtStats.views * 10000) / 100 : 0
      }
    },
    by_hour: (function () {
      var arr = [];
      for (var h in hourStats) {
        var s = hourStats[h];
        arr.push({
          hour: Number(h),
          label: h + ':00',
          count: s.count,
          total_views: s.views,
          total_engagement: s.engagement,
          avg_views: s.count > 0 ? Math.round(s.views / s.count) : 0,
          avg_engagement: s.count > 0 ? Math.round(s.engagement / s.count * 10) / 10 : 0,
          eng_rate_pct: s.views > 0 ? Math.round(s.engagement / s.views * 10000) / 100 : 0
        });
      }
      arr.sort(function (a, b) { return a.hour - b.hour; });
      return arr;
    })()
  });
}

/**
 * エンゲージメントTOP N投稿
 * ?action=top_posts&limit=10&sort=engagement (default)
 */
function handleTopPosts_(e) {
  var limit = parseInt(e.parameter.limit || '10', 10);
  var sortBy = (e.parameter.sort || 'engagement').toLowerCase();
  var rows = getPostedRowsWithInsights_();

  rows.sort(function (a, b) {
    if (sortBy === 'views') return b.views - a.views;
    if (sortBy === 'likes') return b.likes - a.likes;
    var engA = a.likes + a.replies + a.reposts + a.quotes;
    var engB = b.likes + b.replies + b.reposts + b.quotes;
    return engB - engA;
  });

  var top = rows.slice(0, limit).map(function (r) {
    return {
      id: r.id,
      text: r.text.substring(0, 80),
      format: r.format,
      target: r.target,
      core_message: r.coreMessage,
      has_image: r.hasImage,
      posted_at: r.postedAt ? Utilities.formatDate(r.postedAt, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : null,
      posted_hour: r.postedAt ? r.postedAt.getHours() : null,
      views: r.views,
      likes: r.likes,
      replies: r.replies,
      reposts: r.reposts,
      quotes: r.quotes,
      engagement: r.likes + r.replies + r.reposts + r.quotes,
      // 空文字なら未計測。上の views 等は 0 が入るが「0だった」ではない
      insights_updated_at: formatDateForJson_(r.insightsUpdatedAt)
    };
  });

  return jsonResponse_({ top_posts: top, total_posted: rows.length });
}

/**
 * フォーマット別・ターゲット別・コアメッセージ別のクロス分析
 * ?action=format_analysis
 */
function handleFormatAnalysis_() {
  var rows = getPostedRowsWithInsights_();

  var byFormat = {};
  var byTarget = {};
  var byCore = {};
  var byImage = {};
  var byFormatImage = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var eng = r.likes + r.replies + r.reposts + r.quotes;
    var imgLabel = r.hasImage ? '画像あり' : 'テキストのみ';

    aggregate_(byFormat, r.format, r.views, eng);
    aggregate_(byTarget, r.target, r.views, eng);
    aggregate_(byCore, r.coreMessage, r.views, eng);
    aggregate_(byImage, imgLabel, r.views, eng);
    aggregate_(byFormatImage, r.format + ' × ' + imgLabel, r.views, eng);
  }

  return jsonResponse_({
    total_posted: rows.length,
    by_format: summarize_(byFormat),
    by_target: summarize_(byTarget),
    by_core_message: summarize_(byCore),
    by_image: summarize_(byImage),
    by_format_x_image: summarize_(byFormatImage)
  });
}

function aggregate_(map, key, views, eng) {
  if (!key) key = 'unknown';
  if (!map[key]) map[key] = { count: 0, views: 0, engagement: 0 };
  map[key].count++;
  map[key].views += views;
  map[key].engagement += eng;
}

function summarize_(map) {
  var result = [];
  for (var key in map) {
    var m = map[key];
    result.push({
      name: key,
      count: m.count,
      total_views: m.views,
      total_engagement: m.engagement,
      avg_views: m.count > 0 ? Math.round(m.views / m.count) : 0,
      avg_engagement: m.count > 0 ? Math.round(m.engagement / m.count * 10) / 10 : 0
    });
  }
  result.sort(function (a, b) { return b.avg_engagement - a.avg_engagement; });
  return result;
}

/**
 * posted行をInsights付きで全件取得（内部ヘルパ）
 */
function getPostedRowsWithInsights_() {
  var sheet = getQueueSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= CONFIG.HEADER_ROW) return [];

  var maxCols = Math.max(CONFIG.TOTAL_COLS, typeof INSIGHTS_TOTAL_COLS !== 'undefined' ? INSIGHTS_TOTAL_COLS : CONFIG.TOTAL_COLS);
  var values = sheet.getRange(CONFIG.HEADER_ROW + 1, 1, lastRow - CONFIG.HEADER_ROW, maxCols).getValues();

  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var status = String(row[CONFIG.COL.STATUS - 1] || '').trim().toLowerCase();
    if (status !== 'posted') continue;

    // ★v2.1: 旧実装は notes.split(' / ')[0]。notes には2書式が混在しており
    //     旧: "比較型 / 補足"
    //     新: "比較型 | champion" / "A01 代理店募集 | track=agency;…;angle=A01;…"
    //   ' | ' 区切りを分割できず、notes 全体がフォーマット名になっていた。
    //   Insights.gs v2.0 の extractFormat_ に統一する（未導入時は旧挙動に退避）。
    var notes = String(row[CONFIG.COL.NOTES - 1] || '');
    var format = (typeof extractFormat_ === 'function')
      ? extractFormat_(notes)
      : (notes.split(' / ')[0] || 'unknown');

    var postedAt = row[CONFIG.COL.POSTED_AT - 1];
    if (postedAt && Object.prototype.toString.call(postedAt) === '[object Date]') {
      // ok
    } else {
      postedAt = null;
    }

    var imageUrl = String(row[CONFIG.COL.IMAGE_URL - 1] || '').trim();

    rows.push({
      id:          String(row[CONFIG.COL.ID - 1] || ''),
      text:        String(row[CONFIG.COL.TEXT - 1] || ''),
      target:      String(row[CONFIG.COL.TARGET - 1] || ''),
      coreMessage: String(row[CONFIG.COL.CORE_MESSAGE - 1] || ''),
      format:      format,
      hasImage:    imageUrl.length > 0,
      postedAt:    postedAt,
      views:       Number(row[12] || 0),  // INSIGHTS_COL.VIEWS - 1 = 12
      likes:       Number(row[13] || 0),
      replies:     Number(row[14] || 0),
      reposts:     Number(row[15] || 0),
      quotes:      Number(row[16] || 0),
      // ★v2.1: R列(18)= insights_updated_at。空なら「まだ計測していない」。
      //   これが無いと受け手は views=0 を「0だった」と誤解する（設計書§3
      //   「欠測とゼロの区別」）。実際 MMS 側で190件が0として記録されていた。
      insightsUpdatedAt: row[17] || null
    });
  }
  return rows;
}