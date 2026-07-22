// LP台帳（設計書 §3.8.6 LandingPage）
//
// ★なぜ台帳にするか（2026-07-23 石井さん）
//   LPは今後増える。商材ごと（防災防犯ライト…）、総合窓口（節税に興味がある人用）、
//   代理店募集LP。ものによっては代理店コード（?ag=AG-XXXX）を紐づける。
//   旧実装は「診断LP」と「代理店LP」を画面に直書きしていたので、
//   3本目を足した瞬間に破綻する作りだった。
//
// ★どのLPも同じ読み方にする。到達 → CTA → 送信 → リード → 成約 の階段は
//   LPが変わっても同じ。読み方が毎回変わると、比較も判断もできない。
//
// ★A/Bは「1つのLPのバリアント」として持つ（variantKeys）。
//   別URLでも実態は1つのLPのテスト。LPを3件に割ると勝ち負けを判定できない。
import { prisma } from "@mms/db";
import { buildFlow, type Stage, type StageFlow } from "./stages";
import { dayKeys, jstDayKey, type Range } from "./period";

export const LP_TYPE_LABEL: Record<string, string> = {
  consultation: "総合窓口（相談）",
  product: "商材別",
  comparison_hub: "比較ハブ",
  agency: "代理店募集",
};

export const LP_STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  live: "公開中",
  paused: "停止",
  retired: "終了",
};

export type LpRow = {
  slug: string;
  name: string;
  url: string;
  lpType: string;
  status: string;
  offer: string;
  /** 到達（実人数）。null = 自動計測が無い */
  reach: number | null;
  /** 問い合わせ。null = 未計測（計測が壊れている場合を含む） */
  inquiries: number | null;
  /** 到達→問い合わせ。両方が実測のときだけ出す（§16.5） */
  cvr: number | null;
  /** そのLP経由で起票されたリード */
  leads: number;
  won: number;
  wonAmount: number;
  variantCount: number;
  hasAgencyCodes: boolean;
  /** 実測が入っている最終日。反映の遅れを見るため */
  lastDataAt: Date | null;
  /** 数字が出せない理由。空なら問題なし */
  note: string;
  /** 台帳の生値（編集フォームの初期値） */
  registry: {
    slug: string;
    name: string;
    url: string;
    lpType: string;
    offer: string;
    status: string;
    variantKeys: string[];
    metricPrefix: string | null;
    hasAgencyCodes: boolean;
  };
};

/** LP と Lead.sourceType の対応。台帳の slug から引く */
const SOURCE_TYPE_BY_SLUG: Record<string, string> = {
  "setsuzei-diagnosis": "lp_diagnosis",
  "bousai-bouhan-light": "lp_agency",
};

/** LP と Lead.origin の対応 */
const ORIGIN_BY_SLUG: Record<string, string> = {
  "setsuzei-diagnosis": "lp_diagnosis",
  "bousai-bouhan-light": "lp_product",
};

async function leadStats(slug: string, range: Range) {
  const sourceType = SOURCE_TYPE_BY_SLUG[slug];
  if (!sourceType) return { leads: 0, won: 0, wonAmount: 0 };
  const rows = await prisma.lead.findMany({
    where: {
      occurredAt: { gte: range.since, lt: range.until },
      OR: [
        { sourceType: sourceType as never },
        ...(ORIGIN_BY_SLUG[slug] ? [{ origin: ORIGIN_BY_SLUG[slug] as never }] : []),
      ],
    },
    select: { status: true, closedAmount: true },
  });
  return {
    leads: rows.length,
    won: rows.filter((r) => r.status === "won").length,
    wonAmount: rows
      .filter((r) => r.status === "won")
      .reduce((s, r) => s + (r.closedAmount ? Number(r.closedAmount) : 0), 0),
  };
}

/**
 * 自動計測（GA4）の集計。metricPrefix を持つLPだけ。
 * ★送信（form_submit）は MeasurementCoverage に行が無ければ未計測（§3）。
 *   実際、診断LPの送信は CF7 6.x でイベント名が変わって壊れていた。
 *   0 を実測として出すと「LPが悪い」という誤った結論になる。
 */
async function ga4Stats(prefix: string, range: Range) {
  const win = { gte: range.since, lt: range.until };
  const [users, views, ctaClicks, submits, coverage, latest] = await Promise.all([
    prisma.metricSnapshot.aggregate({
      _sum: { value: true },
      where: { metric: { startsWith: `${prefix}_users_` }, date: win },
    }),
    prisma.metricSnapshot.aggregate({
      _sum: { value: true },
      where: { metric: { startsWith: `${prefix}_view_` }, date: win },
    }),
    prisma.metricSnapshot.aggregate({
      _sum: { value: true },
      where: { metric: { startsWith: `${prefix}_cta_click_` }, date: win },
    }),
    prisma.metricSnapshot.aggregate({
      _sum: { value: true },
      where: { metric: { startsWith: `${prefix}_form_submit_` }, date: win },
    }),
    prisma.measurementCoverage.findFirst({
      where: { metric: { startsWith: `${prefix}_form_submit_` } },
      select: { id: true },
    }),
    prisma.metricSnapshot.findFirst({
      where: { metric: { startsWith: `${prefix}_` } },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
  ]);
  return {
    users: Math.round(users._sum.value ?? 0),
    views: Math.round(views._sum.value ?? 0),
    ctaClicks: Math.round(ctaClicks._sum.value ?? 0),
    submits: coverage ? Math.round(submits._sum.value ?? 0) : null,
    lastDataAt: latest?.date ?? null,
  };
}

/** 代理店コード付きLP（AgencyLpDaily）の集計 */
async function agencyLpStats(slug: string, range: Range) {
  const win = { gte: range.since, lt: range.until };
  const rows = await prisma.agencyLpDaily.findMany({
    where: { lp: slug, date: win },
    select: { agencyCode: true, visits: true, inquiries: true, date: true },
  });
  const latest = rows.length ? rows.reduce((a, b) => (a.date > b.date ? a : b)).date : null;
  return {
    visits: rows.reduce((s, r) => s + r.visits, 0),
    inquiries: rows.reduce((s, r) => s + r.inquiries, 0),
    rows,
    lastDataAt: latest,
  };
}

export type LpSummary = {
  rows: LpRow[];
  /** 合計。★未計測を含む列は「実測だけの合計」と分けて出す（§3） */
  totals: {
    lps: number;
    live: number;
    reach: number | null;
    inquiries: number | null;
    cvr: number | null;
    leads: number;
    won: number;
    wonAmount: number;
    /** 問い合わせが未計測のLPの数。合計の読み方を誤らせないため */
    unmeasuredLps: number;
  };
  /** 到達の日次推移（LP別・合計を重ねて見る） */
  trends: { slug: string; label: string; points: { date: string; value: number | null }[] }[];
};

/**
 * 一覧＋合計＋推移。
 * ★他の獲得画面（/threads・/line）と同じく、開いた瞬間に全体像が見えるようにする。
 *   表だけだと「で、合計どうなの」が読み取れない。
 */
export async function getLpSummary(range: Range): Promise<LpSummary> {
  const rows = await getLpList(range);
  const keys = dayKeys(range.since, range.until);

  const measuredReach = rows.filter((r) => r.reach !== null);
  const measuredInq = rows.filter((r) => r.inquiries !== null);
  const reach = measuredReach.length
    ? measuredReach.reduce((s2, r) => s2 + (r.reach ?? 0), 0)
    : null;
  const inquiries = measuredInq.length
    ? measuredInq.reduce((s2, r) => s2 + (r.inquiries ?? 0), 0)
    : null;

  const trends = await Promise.all(
    rows.map(async (r) => ({
      slug: r.slug,
      label: r.name,
      points: await reachTrend(r.registry, keys, range),
    })),
  );

  return {
    rows,
    totals: {
      lps: rows.length,
      live: rows.filter((r) => r.status === "live").length,
      reach,
      inquiries,
      // ★両方が実測のときだけ率を出す（§16.5）
      cvr: reach !== null && inquiries !== null && reach > 0 ? inquiries / reach : null,
      leads: rows.reduce((s2, r) => s2 + r.leads, 0),
      won: rows.reduce((s2, r) => s2 + r.won, 0),
      wonAmount: rows.reduce((s2, r) => s2 + r.wonAmount, 0),
      unmeasuredLps: rows.filter((r) => r.inquiries === null).length,
    },
    trends,
  };
}

/** LPごとの到達の日次推移。計測が無いLPは null で返す（0で線を引かない・§3） */
async function reachTrend(
  reg: LpRow["registry"],
  keys: string[],
  range: Range,
): Promise<{ date: string; value: number | null }[]> {
  const win = { gte: range.since, lt: range.until };
  const byDay = new Map<string, number>();

  if (reg.metricPrefix) {
    const snaps = await prisma.metricSnapshot.findMany({
      where: { metric: { startsWith: `${reg.metricPrefix}_users_` }, date: win },
      select: { value: true, date: true },
    });
    for (const s2 of snaps) {
      const k = jstDayKey(s2.date);
      byDay.set(k, (byDay.get(k) ?? 0) + s2.value);
    }
  } else if (reg.hasAgencyCodes) {
    const rows = await prisma.agencyLpDaily.findMany({
      where: { lp: reg.slug, date: win },
      select: { visits: true, date: true },
    });
    for (const r of rows) {
      const k = jstDayKey(r.date);
      byDay.set(k, (byDay.get(k) ?? 0) + r.visits);
    }
  } else {
    return keys.map((k) => ({ date: k, value: null }));
  }

  return keys.map((k) => ({ date: k, value: byDay.has(k) ? Math.round(byDay.get(k)!) : null }));
}

export async function getLpList(range: Range): Promise<LpRow[]> {
  const pages = await prisma.landingPage.findMany({ orderBy: { lpType: "asc" } });

  return Promise.all(
    pages.map(async (p) => {
      const leads = await leadStats(p.slug, range);
      let reach: number | null = null;
      let inquiries: number | null = null;
      let lastDataAt: Date | null = null;
      let note = "";

      if (p.metricPrefix) {
        const g = await ga4Stats(p.metricPrefix, range);
        reach = g.users;
        inquiries = g.submits;
        lastDataAt = g.lastDataAt;
        if (g.submits === null) note = "送信の計測が動いていない（0件ではない）";
      } else if (p.hasAgencyCodes) {
        const a = await agencyLpStats(p.slug, range);
        reach = a.visits;
        inquiries = a.inquiries;
        lastDataAt = a.lastDataAt;
      } else {
        note = "自動計測が未設定（台帳に metricPrefix を入れると数字が出る）";
      }

      return {
        slug: p.slug,
        name: p.name,
        url: p.url,
        lpType: p.lpType,
        status: p.status,
        offer: p.offer,
        reach,
        inquiries,
        // ★両方が実測のときだけ率を出す（§16.5）
        cvr: reach !== null && inquiries !== null && reach > 0 ? inquiries / reach : null,
        leads: leads.leads,
        won: leads.won,
        wonAmount: leads.wonAmount,
        variantCount: p.variantKeys.length,
        hasAgencyCodes: p.hasAgencyCodes,
        lastDataAt,
        note,
        registry: {
          slug: p.slug,
          name: p.name,
          url: p.url,
          lpType: p.lpType,
          offer: p.offer,
          status: p.status,
          variantKeys: p.variantKeys,
          metricPrefix: p.metricPrefix,
          hasAgencyCodes: p.hasAgencyCodes,
        },
      };
    }),
  );
}

export type VariantRow = {
  key: string;
  label: string;
  users: number;
  views: number;
  /** null = 送信の計測が動いていない */
  submits: number | null;
  cvr: number | null;
};

export type CodeRow = {
  code: string;
  visits: number;
  inquiries: number;
  lastAt: Date;
  idleDays: number;
};

export type LpDetail = {
  row: LpRow;
  flow: StageFlow;
  variants: VariantRow[];
  /** A/Bの判定。母数が足りないうちは勝敗を言わない（§16.5） */
  verdict: string;
  codes: CodeRow[];
  /** 代理店コード付きLPで、コードが付いていない訪問の割合 */
  uncodedRate: number | null;
  trend: { date: string; value: number | null }[];
  days: number;
};

/** A/Bの判定に要る母数（cowork の lp-ab-weekly-report.py と同じ基準） */
const MIN_USERS_PER_VARIANT = 100;
const MIN_SUBMITS_PER_VARIANT = 10;
/** 配布したコードが「動いていない」とみなす日数 */
const CODE_IDLE_DAYS = 7;

export async function getLpDetail(slug: string, range: Range): Promise<LpDetail | null> {
  const p = await prisma.landingPage.findFirst({ where: { slug } });
  if (!p) return null;

  const list = await getLpList(range);
  const row = list.find((r) => r.slug === slug);
  if (!row) return null;

  const keys = dayKeys(range.since, range.until);
  const variants: VariantRow[] = [];
  let trend: { date: string; value: number | null }[] = [];
  let codes: CodeRow[] = [];
  let uncodedRate: number | null = null;
  let verdict = "";
  let ctaClicks: number | null = null;

  if (p.metricPrefix) {
    const prefix = p.metricPrefix;
    const win = { gte: range.since, lt: range.until };
    const [snaps, coverage] = await Promise.all([
      prisma.metricSnapshot.findMany({
        where: { metric: { startsWith: `${prefix}_` }, date: win },
        select: { metric: true, value: true, date: true },
      }),
      prisma.measurementCoverage.findFirst({
        where: { metric: { startsWith: `${prefix}_form_submit_` } },
        select: { id: true },
      }),
    ]);

    const acc = new Map<string, { users: number; views: number; submits: number }>();
    const byDay = new Map<string, number>();
    let cta = 0;
    for (const s of snaps) {
      const m = new RegExp(`^${prefix}_(users|view|cta_click|form_submit)_(.+)$`).exec(s.metric);
      if (!m) continue;
      const [, kind, v] = m;
      const cur = acc.get(v) ?? { users: 0, views: 0, submits: 0 };
      if (kind === "users") {
        cur.users += s.value;
        byDay.set(jstDayKey(s.date), (byDay.get(jstDayKey(s.date)) ?? 0) + s.value);
      } else if (kind === "view") cur.views += s.value;
      else if (kind === "form_submit") cur.submits += s.value;
      else if (kind === "cta_click") cta += s.value;
      acc.set(v, cur);
    }
    ctaClicks = cta > 0 ? Math.round(cta) : null;

    for (const k of p.variantKeys) {
      const c = acc.get(k) ?? { users: 0, views: 0, submits: 0 };
      const submits = coverage ? Math.round(c.submits) : null;
      variants.push({
        key: k,
        label: k.toUpperCase(),
        users: Math.round(c.users),
        views: Math.round(c.views),
        submits,
        cvr: submits !== null && c.users > 0 ? submits / c.users : null,
      });
    }

    // ★「まだ足りない」ではなく「この母数だといつ終わるか」を出す（§16.5）
    const totalUsers = variants.reduce((s, v) => s + v.users, 0);
    const totalSubmits = variants.reduce((s, v) => s + (v.submits ?? 0), 0);
    const perDay = totalUsers / Math.max(1, range.days);
    const needed = MIN_USERS_PER_VARIANT * Math.max(1, variants.length) - totalUsers;
    verdict = !coverage
      ? "★送信の計測が動いていません。到達数だけでは勝敗を判定できません（0件は実測ではない）"
      : variants.length === 0
        ? "A/Bしていません（バリアント未登録）"
        : needed <= 0 && totalSubmits >= MIN_SUBMITS_PER_VARIANT * variants.length
          ? "判定に必要な母数に到達しています"
          : perDay > 0
            ? `判定には各パターン ${MIN_USERS_PER_VARIANT}人・送信${MIN_SUBMITS_PER_VARIANT}件が必要。いまのペース（1日 ${(Math.round(perDay * 10) / 10).toFixed(1)}人）だと残り${Math.max(0, needed)}人に約${Math.ceil(Math.max(1, needed) / perDay)}日かかります`
            : "到達が止まっており、判定の見込みが立ちません";

    trend = keys.map((k) => ({ date: k, value: byDay.has(k) ? Math.round(byDay.get(k)!) : null }));
  }

  if (p.hasAgencyCodes) {
    const a = await agencyLpStats(slug, range);
    const byCode = new Map<string, { visits: number; inquiries: number; last: Date }>();
    for (const r of a.rows) {
      const cur = byCode.get(r.agencyCode) ?? { visits: 0, inquiries: 0, last: r.date };
      cur.visits += r.visits;
      cur.inquiries += r.inquiries;
      if (r.date > cur.last) cur.last = r.date;
      byCode.set(r.agencyCode, cur);
    }
    const now = Date.now();
    codes = [...byCode.entries()]
      // ★"direct" はコード無しの訪問。代理店の実績ではないので一覧から外し、
      //   代わりに「識別できていない割合」として出す
      .filter(([code]) => code !== "direct")
      .map(([code, c]) => ({
        code,
        visits: c.visits,
        inquiries: c.inquiries,
        lastAt: c.last,
        idleDays: Math.floor((now - c.last.getTime()) / 86400000),
      }))
      .sort((x, y) => y.visits - x.visits);

    const direct = byCode.get("direct")?.visits ?? 0;
    uncodedRate = a.visits > 0 ? direct / a.visits : null;

    const dayMap = new Map<string, number>();
    for (const r of a.rows) {
      const k = jstDayKey(r.date);
      dayMap.set(k, (dayMap.get(k) ?? 0) + r.visits);
    }
    trend = keys.map((k) => ({ date: k, value: dayMap.has(k) ? dayMap.get(k)! : null }));
  }

  // ── 階段（どのLPも同じ読み方）──
  const stages: Stage[] = [
    {
      key: "reach",
      label: "① 到達",
      value: row.reach,
      hint: p.metricPrefix ? "GA4 実人数" : "LPの流入計測",
      action: "記事・投稿からの導線を増やす",
    },
    {
      key: "cta",
      label: "② LP内CTAクリック",
      value: ctaClicks,
      hint: p.metricPrefix ? "GA4 cta_click" : "未計装",
      action: "オファー・CTAの位置を見直す",
    },
    {
      key: "submit",
      label: "③ 問い合わせ",
      value: row.inquiries,
      hint: row.note || "フォーム送信",
      action: "フォームの項目を減らす",
    },
    {
      key: "lead",
      label: "④ リード起票",
      value: row.leads,
      hint: "MMS に起票されたもの",
      action: "問い合わせをリードとして起票する運用を作る",
    },
    {
      key: "won",
      label: "⑤ 成約",
      value: row.won,
      hint: "status=won",
      action: "オファー・価格を見直す",
    },
  ];

  return {
    row,
    flow: buildFlow(stages),
    variants,
    verdict,
    codes,
    uncodedRate,
    trend,
    days: range.days,
  };
}

export { CODE_IDLE_DAYS };
