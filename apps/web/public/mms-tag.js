/*!
 * MMS 計測タグ（設計書 §14.2 ファネル7段 / §3.10.3 計測タグ設計原則7項目）
 *
 * ★過去のサイト重量化事故（TTFBスパイク）の再発防止。7原則を厳守する:
 *   ① 1ページの送信は原則1回（sessionStorage にバッファ → 離脱時に sendBeacon 1発）
 *   ② スクロールは throttle 250ms、深度は 25/50/75/100% の4段のみ
 *   ③ 冪等キー (sessionId, step, contentId, 分単位ts) は受信側で重複排除
 *   ④ 送信は必ず非同期（sendBeacon / fetch keepalive）。同期XHR禁止
 *   ⑤ WordPress 側では一切DB書込みをしない（このタグは MMS へ送るだけ）
 *   ⑥ defer / 遅延読込。document.write 禁止
 *   ⑦ 1セッションのイベント上限（既定50）。超えたら送信を止める（暴走の自己遮断）
 *
 * 設置方法（docs/INTEGRATIONS.md §2）:
 *   <script defer src="https://mms.example.com/mms-tag.js"
 *           data-endpoint="https://mms.example.com/api/ingest/events"
 *           data-article="ART-088"></script>
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;

  var ENDPOINT = script.getAttribute("data-endpoint");
  if (!ENDPOINT) return;

  var ARTICLE = script.getAttribute("data-article") || null; // ContentItem.externalId
  var LP = script.getAttribute("data-lp") || null;
  var EVENT_CAP = parseInt(script.getAttribute("data-cap") || "50", 10); // ⑦
  var SCROLL_THROTTLE_MS = 250; // ②

  // ── 訪問者ID（1st-party・13ヶ月）とセッションID（30分）──
  function uid() {
    // crypto.randomUUID があれば使う。無ければ簡易生成
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
    ).slice(0, 32);
  }

  function getCookie(name) {
    var m = document.cookie.match("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)");
    return m ? m.pop() : null;
  }
  function setCookie(name, value, days) {
    var d = new Date();
    d.setTime(d.getTime() + days * 864e5);
    document.cookie =
      name + "=" + value + ";expires=" + d.toUTCString() + ";path=/;SameSite=Lax";
  }

  var visitorId = getCookie("mms_vid");
  if (!visitorId) {
    visitorId = uid();
    setCookie("mms_vid", visitorId, 396); // 13ヶ月（§16.2）
  }

  // セッションは30分の非活動でリセット
  var SESSION_KEY = "mms_sid";
  var SESSION_TS_KEY = "mms_sid_ts";
  var now = Date.now();
  var sid = null;
  try {
    sid = sessionStorage.getItem(SESSION_KEY);
    var lastTs = parseInt(sessionStorage.getItem(SESSION_TS_KEY) || "0", 10);
    if (!sid || now - lastTs > 30 * 6e4) {
      sid = uid();
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    sessionStorage.setItem(SESSION_TS_KEY, String(now));
  } catch (e) {
    sid = uid(); // sessionStorage 不可の環境
  }

  // ── バッファ（① 離脱時にまとめて1発）──
  var BUF_KEY = "mms_buf";
  function loadBuf() {
    try {
      return JSON.parse(sessionStorage.getItem(BUF_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function saveBuf(buf) {
    try {
      sessionStorage.setItem(BUF_KEY, JSON.stringify(buf));
    } catch (e) {
      /* 容量超過などは黙って捨てる（サイトを壊さない） */
    }
  }

  var sessionCount = 0; // ⑦ セッション累計
  try {
    sessionCount = parseInt(sessionStorage.getItem("mms_cnt") || "0", 10);
  } catch (e) {}

  var firstSend = true;

  function track(step, extra) {
    if (sessionCount >= EVENT_CAP) return; // ⑦ 自己遮断
    sessionCount++;
    try {
      sessionStorage.setItem("mms_cnt", String(sessionCount));
    } catch (e) {}

    var ev = {
      step: step,
      occurredAt: new Date().toISOString(),
    };
    if (ARTICLE) ev.contentExternalId = ARTICLE;
    if (LP) ev.lpId = LP;
    if (extra) {
      for (var k in extra) if (extra.hasOwnProperty(k)) ev[k] = extra[k];
    }
    var buf = loadBuf();
    buf.push(ev);
    saveBuf(buf);
  }

  function flush() {
    var buf = loadBuf();
    if (!buf.length) return;

    var payload = {
      visitorId: visitorId,
      sessionId: sid,
      events: buf,
    };
    // セッションの landing 情報は初回送信にだけ載せる
    if (firstSend) {
      payload.session = {
        landingContentExternalId: ARTICLE || undefined,
        referrer: document.referrer || undefined,
        fromParam: new URLSearchParams(location.search).get("from") || undefined,
      };
    }

    // ④ 非同期送信。text/plain で CORS プリフライトを避ける
    var blob = new Blob([JSON.stringify(payload)], { type: "text/plain" });
    var sent = false;
    if (navigator.sendBeacon) {
      sent = navigator.sendBeacon(ENDPOINT, blob);
    }
    if (!sent) {
      // フォールバック（keepalive つき fetch）
      try {
        fetch(ENDPOINT, {
          method: "POST",
          body: blob,
          keepalive: true,
          mode: "no-cors",
        });
      } catch (e) {}
    }
    firstSend = false;
    saveBuf([]); // 送ったら空にする
  }

  // ── ① 離脱時にまとめて送る ──
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);

  // ── LP 到達（このタグが読み込まれた＝lp_view）──
  // 記事側では cta_view / cta_click を、LP側では lp_view / lp_scroll / form_* を送る想定。
  // data-lp があれば LP ページとみなす。
  if (LP) {
    track("lp_view");
  }

  // ── ② スクロール深度（throttle 250ms・25/50/75/100 の4段のみ）──
  var reached = {};
  var scrollTimer = null;
  function onScroll() {
    if (scrollTimer) return;
    scrollTimer = setTimeout(function () {
      scrollTimer = null;
      var doc = document.documentElement;
      var scrolled = window.scrollY + window.innerHeight;
      var height = doc.scrollHeight;
      if (height <= 0) return;
      var pct = (scrolled / height) * 100;
      [25, 50, 75, 100].forEach(function (d) {
        if (pct >= d && !reached[d]) {
          reached[d] = true;
          track("lp_scroll", { meta: { depth: d } });
        }
      });
    }, SCROLL_THROTTLE_MS);
  }
  if (LP) window.addEventListener("scroll", onScroll, { passive: true });

  // ── 記事内リンクの自動計測（data 属性が無くても拾う）──
  //
  // ★なぜ自動にするか（2026-07-23）
  //   data-mms を貼った要素しか見ていなかったため、記事159本のどこにも
  //   data-mms が無く、**受け口はあるのにイベントが1件も来ていなかった**。
  //   159本にひとつずつ属性を貼らせるのは現実的でなく、貼り漏れも見えない。
  //   記事には既に data-article が入っているので、タグ側で a[href] を
  //   拾えば WordPress を触らずに記事別のリンク実績が取れる。
  //
  // ★どこを踏んだかは href だけでは足りない（同じ /r/line/ が本文にも
  //   フッタにもある）。祖先要素から area を出して一緒に送る。
  var LINK_CAP = parseInt(script.getAttribute("data-link-cap") || "12", 10);
  var linkCount = 0;

  function linkArea(el) {
    // 明示指定が最優先
    var marked = el.closest ? el.closest("[data-mms-area]") : null;
    if (marked) return marked.getAttribute("data-mms-area");
    if (!el.closest) return "unknown";
    if (el.closest("footer, .footer, #footer")) return "footer";
    if (el.closest("header, .site-header, #masthead")) return "header";
    if (el.closest("nav, .nav, .breadcrumb")) return "nav";
    if (el.closest("aside, .sidebar, #sidebar, .widget-area")) return "sidebar";
    if (el.closest("article, .entry-content, .post-content, main")) return "body";
    return "unknown";
  }

  function linkKind(a) {
    var href = a.getAttribute("href") || "";
    if (href.charAt(0) === "#") return "anchor";
    if (/^tel:/i.test(href)) return "tel";
    if (/^mailto:/i.test(href)) return "mail";
    var u;
    try {
      u = new URL(a.href, location.href);
    } catch (e) {
      return "outbound";
    }
    if (!/^https?:$/.test(u.protocol)) return null; // javascript: 等は数えない
    // 自前のリダイレクタ＝送客の本命。ホストが違っても redirect として扱う
    if (/^\/r\/[^/]+\//.test(u.pathname)) return "redirect";
    if (u.host === location.host) {
      return u.pathname === location.pathname ? "anchor" : "internal";
    }
    return "outbound";
  }

  document.addEventListener(
    "click",
    function (e) {
      if (!e.target || !e.target.closest) return;
      var a = e.target.closest("a[href]");
      if (!a) return;
      // data-mms が付いている要素は下のハンドラが担当する（二重に数えない）
      if (a.closest("[data-mms]")) return;
      if (linkCount >= LINK_CAP) return; // ページ内で数えるリンク数の上限
      var kind = linkKind(a);
      if (!kind) return;
      linkCount++;

      var text = (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
      var href = a.getAttribute("href") || "";
      try {
        var u2 = new URL(a.href, location.href);
        // ★クエリは落とす。UTM や個人を含みうる値を溜めない。
        //   ★#断片は残す。目次リンクはこれが無いと全部同じ href になり、
        //     「どの見出しへ飛んだか」が分からない（実測で最初の2件がこれだった）。
        if (/^https?:$/.test(u2.protocol)) href = u2.host + u2.pathname + (u2.hash || "");
      } catch (e2) {}

      track("link_click", { meta: { kind: kind, area: linkArea(a), href: href, text: text } });

      // ★target=_blank や tel: は pagehide が起きない。取りこぼすので即送る。
      //   sendBeacon なので遷移はブロックしない。
      flush();
    },
    true,
  );

  // ── CTA・フォームの自動計測（data 属性で宣言）──
  // <a data-mms="cta_click" data-cta-id="hero"> のようにマークするだけで送れる。
  document.addEventListener(
    "click",
    function (e) {
      var el = e.target && e.target.closest ? e.target.closest("[data-mms]") : null;
      if (!el) return;
      var step = el.getAttribute("data-mms");
      var ctaId = el.getAttribute("data-cta-id") || undefined;
      track(step, ctaId ? { ctaId: ctaId } : null);
      // ★tel: リンクは phone_click（§3.8.3）
    },
    true,
  );

  // CTA 表示（IntersectionObserver で1回だけ）
  if (window.IntersectionObserver) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            var ctaId = en.target.getAttribute("data-cta-id") || undefined;
            track("cta_view", ctaId ? { ctaId: ctaId } : null);
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.5 },
    );
    var ctas = document.querySelectorAll('[data-mms-view="cta"]');
    for (var i = 0; i < ctas.length; i++) io.observe(ctas[i]);
  }

  // フォーム到達・項目・送信
  var forms = document.querySelectorAll("form[data-mms-form]");
  for (var f = 0; f < forms.length; f++) {
    (function (form) {
      var seenForm = false;
      form.addEventListener(
        "focusin",
        function () {
          if (!seenForm) {
            seenForm = true;
            track("form_view");
          }
        },
        true,
      );
      form.addEventListener(
        "change",
        function () {
          track("form_field");
        },
        true,
      );
      form.addEventListener("submit", function () {
        track("submit");
        flush(); // 送信は取りこぼしたくないので即 flush
      });
    })(forms[f]);
  }

  // グローバル API（手動計測用）
  window.mms = window.mms || {};
  window.mms.track = track;
  window.mms.flush = flush;
})();
