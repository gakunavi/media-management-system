#!/usr/bin/env node
// デプロイ前後の性能ゲート（§3.10.5 / docs/RULES.md §1.3 / P1.9）
//
//   npm run perf:gate -- before <リリース名>
//   npm run perf:gate -- after  <リリース名>
//
// ★過去の TTFB スパイク事故は「テーマ更新に紛れて入った」。
//   更新のたびに測れば当日中に気づける。
//
// ★after が基準を超えたら **exit 1** で終わる。
//   人が読む前提の警告だけだと、急いでいるときに読み飛ばされる。
//
// ★測れなかったときも不合格にする。合格にすると
//   ゲートが在るのに何も守っていない状態になる。
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

// ★.env を自分で読む（2026-07-24 の実測で判明）。
//   この CLI は **ホストで動く**ので、コンテナと違って .env が自動で入らない。
//   キーを .env に入れたのに「未設定」と言われて気づいた。
//   ★既に環境変数がある場合は上書きしない（一時的に差し替えて試せるように）
function loadEnv() {
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      // ★既にある環境変数を上書きしない。
      //   npm script が MMS_DATABASE_URL を **host 用（localhost:5433）** に
      //   差し替えて渡しているのに、.env の値（db:5432＝コンテナ用）で
      //   上書きしてしまい DB に繋がらなくなった（2026-07-24 実測）。
      if (m[2] !== "" && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    // .env が無くても動く（環境変数で渡す運用もありうる）
  }
}
loadEnv();

const prisma = new PrismaClient();

const TTFB_WORSE_RATIO = 0.2;
const LCP_WORSE_MS = 500;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function measure(url, strategy = "mobile") {
  const key = (process.env.MMS_PSI_API_KEY ?? "").trim();
  const q = new URLSearchParams({ url, strategy, category: "performance" });
  if (key) q.set("key", key);
  const empty = { lcp: null, inp: null, cls: null, ttfb: null, jsBytes: null, requestCount: null };
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, {
      signal: AbortSignal.timeout(120_000),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      const msg = json.error?.message ?? `HTTP ${res.status}`;
      return {
        ...empty,
        error: key
          ? `PSI が測れませんでした: ${msg.slice(0, 160)}`
          : `PSI が測れませんでした（MMS_PSI_API_KEY 未設定・共有クォータ切れ）: ${msg.slice(0, 100)}`,
      };
    }
    const a = json.lighthouseResult?.audits ?? {};
    const items = a["network-requests"]?.details?.items;
    return {
      lcp: num(a["largest-contentful-paint"]?.numericValue),
      // ★INP はラボに無い。実ユーザーのデータがあるときだけ入れる
      inp: num(json.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile),
      cls: num(a["cumulative-layout-shift"]?.numericValue),
      ttfb: num(a["server-response-time"]?.numericValue),
      jsBytes: num(a["total-byte-weight"]?.numericValue),
      requestCount: Array.isArray(items) ? items.length : null,
      error: null,
    };
  } catch (e) {
    return { ...empty, error: `PSI が測れませんでした: ${String(e).slice(0, 160)}` };
  }
}

function judge(before, after) {
  if (after.error) return { passed: false, blockedReason: after.error };
  if (after.ttfb === null && after.lcp === null)
    return { passed: false, blockedReason: "測定値が取得できませんでした（合格にはしません）" };
  if (!before)
    return { passed: false, blockedReason: "デプロイ前の測定がありません（before を先に測ってください）" };

  const reasons = [];
  if (before.ttfb !== null && after.ttfb !== null && before.ttfb > 0) {
    const r = (after.ttfb - before.ttfb) / before.ttfb;
    if (r >= TTFB_WORSE_RATIO)
      reasons.push(`TTFB ${Math.round(before.ttfb)}→${Math.round(after.ttfb)}ms（${(r * 100).toFixed(0)}%悪化・基準20%）`);
  }
  if (before.lcp !== null && after.lcp !== null) {
    const d = after.lcp - before.lcp;
    if (d >= LCP_WORSE_MS)
      reasons.push(`LCP ${(before.lcp / 1000).toFixed(2)}→${(after.lcp / 1000).toFixed(2)}秒（+${(d / 1000).toFixed(2)}秒・基準0.5秒）`);
  }
  return reasons.length ? { passed: false, blockedReason: reasons.join(" / ") } : { passed: true, blockedReason: null };
}

async function targets() {
  const site = (process.env.MMS_WP_BASE_URL ?? "https://asset-support.co.jp").replace(/\/+$/, "");
  const out = [{ target: "wp_theme", label: "サイトのトップ（テーマ）", url: `${site}/` }];
  const flagship = await prisma.contentItem.findFirst({
    where: { externalId: process.env.MMS_UPTIME_FLAGSHIP ?? "ART-002", url: { not: null } },
    select: { url: true },
  });
  if (flagship?.url) out.push({ target: "tracker", label: "代表記事（計測タグ）", url: flagship.url });
  const lps = await prisma.landingPage.findMany({
    where: { status: "live" },
    select: { name: true, url: true },
    orderBy: { slug: "asc" },
  });
  for (const lp of lps) if (lp.url) out.push({ target: "lp", label: `LP: ${lp.name}`, url: lp.url });
  return out;
}

async function main() {
  const phase = process.argv[2];
  const releaseTag = process.argv[3];
  if (phase !== "before" && phase !== "after") {
    console.error("使い方: npm run perf:gate -- before|after <リリース名>");
    console.error("  例: npm run perf:gate -- before theme-2026-07-24");
    return 2;
  }
  if (!releaseTag) {
    console.error("★リリース名が要ります（before と after を突き合わせるキー）");
    return 2;
  }

  const list = await targets();
  console.log(`${phase === "before" ? "デプロイ前" : "デプロイ後"}の計測: ${releaseTag}（${list.length}件）`);
  if (!process.env.MMS_PSI_API_KEY) {
    console.log("  ★MMS_PSI_API_KEY が未設定です。共有クォータのため失敗しやすくなります（キーは無料）");
  }

  let failed = 0;
  for (const t of list) {
    const m = await measure(t.url);
    // ★同じ target が複数（LPが2つ）だと @@unique([releaseTag,target,phase]) で
    //   後の1件が前を上書きする。URLを見分けられるよう releaseTag 側に混ぜる
    const tag = list.filter((x) => x.target === t.target).length > 1 ? `${releaseTag}#${t.url}` : releaseTag;

    let before = null;
    let verdict = { passed: phase === "before" && !m.error, blockedReason: m.error };
    if (phase === "after") {
      before = await prisma.perfGate.findFirst({
        where: { releaseTag: tag, target: t.target, phase: "before" },
        select: { ttfb: true, lcp: true },
      });
      verdict = judge(before, m);
    }

    await prisma.perfGate.upsert({
      where: { releaseTag_target_phase: { releaseTag: tag, target: t.target, phase } },
      create: {
        releaseTag: tag, target: t.target, phase, measuredAt: new Date(),
        lcp: m.lcp, inp: m.inp, cls: m.cls, ttfb: m.ttfb,
        jsBytes: m.jsBytes, requestCount: m.requestCount,
        passed: verdict.passed, blockedReason: verdict.blockedReason,
      },
      update: {
        measuredAt: new Date(),
        lcp: m.lcp, inp: m.inp, cls: m.cls, ttfb: m.ttfb,
        jsBytes: m.jsBytes, requestCount: m.requestCount,
        passed: verdict.passed, blockedReason: verdict.blockedReason,
      },
    });

    const mark = verdict.passed ? "OK " : "NG ";
    const val = m.error
      ? m.error
      : `TTFB ${m.ttfb === null ? "—" : Math.round(m.ttfb) + "ms"} / LCP ${m.lcp === null ? "—" : (m.lcp / 1000).toFixed(2) + "秒"}`;
    console.log(`  ${mark} ${t.label.padEnd(24)} ${val}`);
    if (!verdict.passed && verdict.blockedReason && !m.error) console.log(`       → ${verdict.blockedReason}`);
    if (!verdict.passed) failed += 1;
  }

  if (phase === "before") {
    console.log(`\nデプロイ前の記録を保存しました。デプロイ後に \`npm run perf:gate -- after ${releaseTag}\` を実行してください。`);
    return 0;
  }

  if (failed > 0) {
    console.log(`\n★${failed}件が基準を超えました（または測れませんでした）。段7に赤で出ます。`);
    console.log("  ロールバック手順: テーマzipの旧版に戻す ／ 計測タグは ContentVersion から復元");
    return 1; // ★失敗扱いで終わる
  }
  console.log("\n全て基準内です。");
  return 0;
}

main()
  .then(async (c) => { await prisma.$disconnect(); process.exit(c); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
