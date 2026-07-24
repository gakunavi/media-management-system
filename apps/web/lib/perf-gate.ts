// デプロイ前後の性能ゲート（設計書 §3.10.5 / docs/RULES.md §1.3 / P1.9）
//
// ★なぜ要るか
//   過去の TTFB スパイク事故は**テーマ更新に紛れて入った**。
//   更新のたびに測っていれば当日中に気づけた。
//   §3.10.6 の再発防止策のうち、まだ入っていなかった2件目がこれ。
//
// ★合格しないことより「測れないのに合格にする」ことの方が危ない。
//   PSI が叩けなかったときに passed=true にすると、ゲートは
//   **在るのに何も守っていない**状態になる。測れなければ必ず不合格にする（§2）。
import { prisma } from "@mms/db";

/** §1.3 の閾値 */
export const TTFB_WORSE_RATIO = 0.2; // 20%以上悪化で失敗
export const LCP_WORSE_MS = 500; // 0.5秒以上悪化で失敗

export type PerfTargetKind = "wp_theme" | "tracker" | "lp" | "plugin";

export type PerfMeasurement = {
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  ttfb: number | null;
  jsBytes: number | null;
  requestCount: number | null;
  /** 測れなかった理由。null なら測れている */
  error: string | null;
};

type PsiAudit = { numericValue?: number };
type PsiJson = {
  error?: { message?: string; code?: number };
  lighthouseResult?: {
    audits?: Record<string, PsiAudit & { details?: { items?: unknown[] } }>;
  };
  loadingExperience?: {
    metrics?: Record<string, { percentile?: number }>;
  };
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * PageSpeed Insights で1URLを測る。
 * ★APIキーが無いと共有クォータで 429 になる（実測。2026-07-24 に確認）。
 *   キーは無料。未設定でも試すが、失敗は握り潰さず error に残す。
 */
export async function measure(url: string, strategy: "mobile" | "desktop" = "mobile"): Promise<PerfMeasurement> {
  const key = (process.env.MMS_PSI_API_KEY ?? "").trim();
  const q = new URLSearchParams({ url, strategy, category: "performance" });
  if (key) q.set("key", key);

  const empty: PerfMeasurement = {
    lcp: null,
    inp: null,
    cls: null,
    ttfb: null,
    jsBytes: null,
    requestCount: null,
    error: null,
  };

  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, {
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
    const json = (await res.json()) as PsiJson;

    if (!res.ok || json.error) {
      const msg = json.error?.message ?? `HTTP ${res.status}`;
      return {
        ...empty,
        error: key
          ? `PSI が測れませんでした: ${msg.slice(0, 160)}`
          : `PSI が測れませんでした（MMS_PSI_API_KEY 未設定・共有クォータ）: ${msg.slice(0, 120)}`,
      };
    }

    const audits = json.lighthouseResult?.audits ?? {};
    // ★フィールドデータ（実ユーザー）がある場合のみ INP を入れる。
    //   ラボには INP が無く、代わりに TBT を入れると別の指標を同じ列に混ぜることになる
    const inpField = json.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile;

    const requests = audits["network-requests"]?.details?.items;

    return {
      lcp: num(audits["largest-contentful-paint"]?.numericValue),
      inp: num(inpField),
      cls: num(audits["cumulative-layout-shift"]?.numericValue),
      ttfb: num(audits["server-response-time"]?.numericValue),
      jsBytes: num(audits["total-byte-weight"]?.numericValue),
      requestCount: Array.isArray(requests) ? requests.length : null,
      error: null,
    };
  } catch (e) {
    return { ...empty, error: `PSI が測れませんでした: ${String(e).slice(0, 160)}` };
  }
}

/** 監視対象。★URLは台帳から引く（直書きすると増えたときに漏れる・§4-26） */
export async function perfTargets(): Promise<{ target: PerfTargetKind; label: string; url: string }[]> {
  const site = (process.env.MMS_WP_BASE_URL ?? "https://asset-support.co.jp").replace(/\/+$/, "");
  const out: { target: PerfTargetKind; label: string; url: string }[] = [
    { target: "wp_theme", label: "サイトのトップ（テーマ）", url: `${site}/` },
  ];

  // ★計測タグが載っているのは記事。タグの変更で重くなっていないかはここで見る
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
  for (const lp of lps) {
    if (lp.url) out.push({ target: "lp", label: `LP: ${lp.name}`, url: lp.url });
  }
  return out;
}

export type GateResult = {
  target: PerfTargetKind;
  label: string;
  passed: boolean;
  blockedReason: string | null;
  before: { ttfb: number | null; lcp: number | null } | null;
  after: { ttfb: number | null; lcp: number | null };
};

/**
 * before と after を比べて合否を出す。
 * ★「測れなかった」を合格にしない。ゲートが在るのに何も守らない状態になる。
 */
export function judge(
  before: { ttfb: number | null; lcp: number | null; error?: string | null } | null,
  after: PerfMeasurement,
): { passed: boolean; blockedReason: string | null } {
  if (after.error) return { passed: false, blockedReason: after.error };
  if (after.ttfb === null && after.lcp === null) {
    return { passed: false, blockedReason: "測定値が取得できませんでした（合格にはしません）" };
  }
  if (!before) {
    return { passed: false, blockedReason: "デプロイ前の測定がありません（before を先に測ってください）" };
  }

  const reasons: string[] = [];
  if (before.ttfb !== null && after.ttfb !== null && before.ttfb > 0) {
    const ratio = (after.ttfb - before.ttfb) / before.ttfb;
    if (ratio >= TTFB_WORSE_RATIO) {
      reasons.push(
        `TTFB が ${Math.round(before.ttfb)}ms → ${Math.round(after.ttfb)}ms（${(ratio * 100).toFixed(0)}%悪化・基準20%）`,
      );
    }
  }
  if (before.lcp !== null && after.lcp !== null) {
    const diff = after.lcp - before.lcp;
    if (diff >= LCP_WORSE_MS) {
      reasons.push(
        `LCP が ${(before.lcp / 1000).toFixed(2)}秒 → ${(after.lcp / 1000).toFixed(2)}秒（+${(diff / 1000).toFixed(2)}秒・基準0.5秒）`,
      );
    }
  }

  return reasons.length > 0
    ? { passed: false, blockedReason: reasons.join(" / ") }
    : { passed: true, blockedReason: null };
}

export type PerfGateStatus = {
  releaseTag: string | null;
  measuredAt: Date | null;
  passed: boolean | null;
  alert: "ok" | "red" | "unknown";
  reason: string;
  failures: { label: string; reason: string }[];
};

const TARGET_LABEL: Record<string, string> = {
  wp_theme: "サイトのトップ（テーマ）",
  tracker: "代表記事（計測タグ）",
  lp: "LP",
  plugin: "プラグイン",
};

/** 段7に出す。★最後に測った1回ぶんの結果を出す（古い合格を出し続けない） */
export async function getPerfGateStatus(): Promise<PerfGateStatus> {
  const latest = await prisma.perfGate.findFirst({
    where: { phase: "after" },
    orderBy: { measuredAt: "desc" },
    select: { releaseTag: true, measuredAt: true },
  });
  if (!latest) {
    return {
      releaseTag: null,
      measuredAt: null,
      passed: null,
      alert: "unknown",
      // ★0件を「問題なし」と読ませない（§2-1）
      reason: "まだ一度も測っていません（デプロイ前後に npm run perf:gate を実行）",
      failures: [],
    };
  }

  const rows = await prisma.perfGate.findMany({
    where: { releaseTag: latest.releaseTag, phase: "after" },
    select: { target: true, passed: true, blockedReason: true },
  });
  const failures = rows
    .filter((r) => !r.passed)
    .map((r) => ({ label: TARGET_LABEL[r.target] ?? r.target, reason: r.blockedReason ?? "不合格" }));

  return {
    releaseTag: latest.releaseTag,
    measuredAt: latest.measuredAt,
    passed: failures.length === 0,
    alert: failures.length === 0 ? "ok" : "red",
    reason:
      failures.length === 0
        ? `${rows.length}件すべて基準内（${latest.releaseTag}）`
        : `${failures.length}/${rows.length}件が基準を超えました（${latest.releaseTag}）`,
    failures,
  };
}
