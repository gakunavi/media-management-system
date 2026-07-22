// LP の集計（診断LP と 代理店LP・設計書 §3.8.6 / PRJ-034）
//
// ★元は cowork の media-console（console.html）が持っていた画面。
//   PV/GSC/LP/代理店/PDCA を横断表示していたが、
//   ・データが週次で 7/13 から止まっていた
//   ・MMS 側に同じ数字が無く、判断が2箇所に分かれていた
//   MMS が一次ソース（GA4 / LP の export.php）を直接読むようにしたので、
//   画面もこちらへ移す。
//
// ★診断LP と 代理店LP は別物。混ぜない。
//   診断LP … 自社ドメイン。記事から送客し、問い合わせを取る
//   代理店LP … 外部ドメイン（防災防犯ライト）。代理店に配布したコード別の流入
import { prisma } from "@mms/db";

const DAY = 86400000;

export type DiagnosisVariant = {
  key: string;
  label: string;
  /** 実人数。イベント数と別物（同じ人の再訪で view は増える） */
  users: number;
  views: number;
  submits: number;
};

export type DailyPoint = { date: string; value: number };

/** 階段の1段。/line と同じ形にそろえる（読み方を毎回覚え直さないため） */
export type LpStage = {
  key: string;
  label: string;
  /** null = 未計測（§3）。0 とは意味が違う */
  value: number | null;
  hint: string;
  /** 落ちていたときに打つ手 */
  action: string;
};

export type DiagnosisLp = {
  variants: DiagnosisVariant[];
  totalUsers: number;
  totalViews: number;
  /** 記事PV → LP到達 → 送信 → 問い合わせ → 成約 */
  stages: LpStage[];
  transitions: (number | null)[];
  biggestDropIndex: number | null;
  /** LP経由のリード（Lead.sourceType=lp_diagnosis） */
  leads: number;
  won: number;
  wonAmount: number;
  /**
   * 問い合わせ。null は未計測。
   * ★2026-07-22 判明: 診断LPの送信計測は CF7 6.x でイベント名が変わって
   *   壊れていた（LP側は wpcf7mailsent を待つが 6.x は dispatch しない）。
   *   0 を実測として出すと「LPが悪い」という誤った結論になる。
   *   MeasurementCoverage に行が無い間は未計測として扱う（§3）。
   */
  submits: number | null;
  /** 記事PVの合計（同期間）。LP到達率の分母 */
  mediaPv: number;
  daily: DailyPoint[];
  days: number;
  /** 判定に必要な母数に届いているか。§16.5 の考え方 */
  verdict: string;
};

export type AgencyCode = {
  code: string;
  visits: number;
  inquiries: number;
  firstAt: Date;
  lastAt: Date;
  /** 最終流入からの日数。長いほど「配ったが動いていない」 */
  idleDays: number;
};

export type AgencyLp = {
  codes: AgencyCode[];
  totalVisits: number;
  totalInquiries: number;
  daily: DailyPoint[];
  /** 代理店LP経由のリード（Lead.sourceType=lp_agency） */
  leads: number;
  won: number;
  wonAmount: number;
  /** データが1行も無い＝未取得。0 とは別（§3） */
  measured: boolean;
};

export type LpData = { diagnosis: DiagnosisLp; agency: AgencyLp; days: number };

const VARIANT_LABEL: Record<string, string> = {
  a: "A（イラスト）",
  b: "B（写真）",
  c: "C（ハイブリッド）",
};

/** cowork の lp-ab-weekly-report.py と同じ判定基準 */
const MIN_USERS_PER_VARIANT = 100;
const MIN_SUBMITS_PER_VARIANT = 10;

function ymd(d: Date): string {
  return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

export async function getLpData(days = 30, now: Date = new Date()): Promise<LpData> {
  const since = new Date(now.getTime() - days * DAY);

  const [snaps, pvAgg, agencyRows, diagLeads, agencyLeads] = await Promise.all([
    prisma.metricSnapshot.findMany({
      where: { metric: { startsWith: "lp_" }, date: { gte: since } },
      select: { metric: true, value: true, date: true },
    }),
    prisma.contentMetric.aggregate({
      _sum: { value: true },
      where: { metric: "pv", date: { gte: since } },
    }),
    prisma.agencyLpDaily.findMany({
      where: { date: { gte: since } },
      select: { agencyCode: true, visits: true, inquiries: true, date: true },
    }),
    prisma.lead.findMany({
      where: { sourceType: "lp_diagnosis", occurredAt: { gte: since } },
      select: { status: true, closedAmount: true },
    }),
    prisma.lead.findMany({
      where: { sourceType: "lp_agency", occurredAt: { gte: since } },
      select: { status: true, closedAmount: true },
    }),
  ]);

  // ── 診断LP ──
  const byVariant = new Map<string, { users: number; views: number; submits: number }>();
  const dailyUsers = new Map<string, number>();
  for (const s of snaps) {
    const m = /^lp_(users|view|cta_click|form_submit)_([abc])$/.exec(s.metric);
    if (!m) continue;
    const [, kind, v] = m;
    const cur = byVariant.get(v) ?? { users: 0, views: 0, submits: 0 };
    if (kind === "users") {
      cur.users += s.value;
      const k = ymd(s.date);
      dailyUsers.set(k, (dailyUsers.get(k) ?? 0) + s.value);
    } else if (kind === "view") cur.views += s.value;
    else if (kind === "form_submit") cur.submits += s.value;
    byVariant.set(v, cur);
  }

  const variants: DiagnosisVariant[] = ["a", "b", "c"].map((k) => {
    const c = byVariant.get(k) ?? { users: 0, views: 0, submits: 0 };
    return {
      key: k,
      label: VARIANT_LABEL[k] ?? k,
      users: Math.round(c.users),
      views: Math.round(c.views),
      submits: Math.round(c.submits),
    };
  });

  const totalUsers = variants.reduce((s, v) => s + v.users, 0);
  const submitMeasured = await prisma.measurementCoverage.findFirst({
    where: { metric: { startsWith: "lp_form_submit_" } },
    select: { id: true },
  });
  const submits = submitMeasured ? variants.reduce((s, v) => s + v.submits, 0) : null;

  // ★「まだ足りない」ではなく「この母数では終わらない」ことを言う（§16.5）
  const short = variants.filter((v) => v.users < MIN_USERS_PER_VARIANT);
  const perDay = totalUsers / days;
  const needed = MIN_USERS_PER_VARIANT * variants.length - totalUsers;
  const verdict =
    submits === null
      ? "★送信の計測が動いていません。到達数だけでは判定できません（0件は実測ではありません）"
      : totalUsers === 0
      ? "直近期間にLPへの到達がありません"
      : short.length === 0 && submits >= MIN_SUBMITS_PER_VARIANT * variants.length
        ? "判定に必要な母数に到達しています"
        : perDay > 0
          ? `判定には各パターン ${MIN_USERS_PER_VARIANT}人・送信${MIN_SUBMITS_PER_VARIANT}件が必要。` +
            `いまのペース（1日 ${(Math.round(perDay * 10) / 10).toFixed(1)}人）だと残り${needed}人に約${Math.ceil(needed / perDay)}日かかります`
          : "到達が止まっており、判定の見込みが立ちません";

  // ── 代理店LP ──
  const byCode = new Map<string, { visits: number; inquiries: number; first: Date; last: Date }>();
  const agencyDaily = new Map<string, number>();
  for (const r of agencyRows) {
    const cur = byCode.get(r.agencyCode) ?? {
      visits: 0,
      inquiries: 0,
      first: r.date,
      last: r.date,
    };
    cur.visits += r.visits;
    cur.inquiries += r.inquiries;
    if (r.date < cur.first) cur.first = r.date;
    if (r.date > cur.last) cur.last = r.date;
    byCode.set(r.agencyCode, cur);
    const k = ymd(r.date);
    agencyDaily.set(k, (agencyDaily.get(k) ?? 0) + r.visits);
  }

  const codes: AgencyCode[] = [...byCode.entries()]
    .map(([code, c]) => ({
      code,
      visits: c.visits,
      inquiries: c.inquiries,
      firstAt: c.first,
      lastAt: c.last,
      idleDays: Math.floor((now.getTime() - c.last.getTime()) / DAY),
    }))
    .sort((a, b) => b.visits - a.visits);

  const toSeries = (m: Map<string, number>): DailyPoint[] => {
    const out: DailyPoint[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = ymd(new Date(now.getTime() - i * DAY));
      out.push({ date: k, value: Math.round(m.get(k) ?? 0) });
    }
    return out;
  };

  // ── 診断LPの階段（記事PV → 到達 → 送信 → 問い合わせ → 成約）──
  const mediaPv = Math.round(pvAgg._sum.value ?? 0);
  const diagWon = diagLeads.filter((l) => l.status === "won").length;
  const diagWonAmount = diagLeads.reduce(
    (s, l) => s + (l.status === "won" && l.closedAmount ? Number(l.closedAmount) : 0),
    0,
  );

  const stages: LpStage[] = [
    {
      key: "pv",
      label: "① 記事PV",
      value: mediaPv,
      hint: "LPへ送り出す母数（GA4）",
      action: "記事を増やす・検索順位を上げる",
    },
    {
      key: "reach",
      label: "② LP到達",
      value: totalUsers,
      hint: "実人数（イベント数ではない）",
      action: "記事内ボタンの文言・位置・目立ち方を直す",
    },
    {
      key: "submit",
      label: "③ 送信",
      value: submits,
      hint: "lp_form_submit イベント",
      action: "LPの構成を大きく変える（§3.7.0）",
    },
    {
      key: "lead",
      label: "④ 問い合わせ",
      value: diagLeads.length,
      hint: "LP経由として起票したリード",
      action: "送信内容の質・フォーム項目を見直す",
    },
    {
      key: "won",
      label: "⑤ 成約",
      value: diagWon,
      hint: "status=won",
      action: "オファー・価格を見直す",
    },
  ];

  const transitions: (number | null)[] = [null];
  let biggestDropIndex: number | null = null;
  let worst = Infinity;
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].value;
    const cur = stages[i].value;
    // ★どちらかが未計測なら率を出さない（§16.5）
    if (prev !== null && cur !== null && prev > 0) {
      const r = cur / prev;
      transitions.push(r);
      if (r < worst) {
        worst = r;
        biggestDropIndex = i;
      }
    } else {
      transitions.push(null);
    }
  }

  return {
    days,
    diagnosis: {
      variants,
      totalUsers,
      totalViews: variants.reduce((s, v) => s + v.views, 0),
      stages,
      transitions,
      biggestDropIndex,
      leads: diagLeads.length,
      won: diagWon,
      wonAmount: diagWonAmount,
      submits,
      mediaPv,
      daily: toSeries(dailyUsers),
      days,
      verdict,
    },
    agency: {
      codes,
      totalVisits: codes.reduce((s, c) => s + c.visits, 0),
      totalInquiries: codes.reduce((s, c) => s + c.inquiries, 0),
      daily: toSeries(agencyDaily),
      leads: agencyLeads.length,
      won: agencyLeads.filter((l) => l.status === "won").length,
      wonAmount: agencyLeads.reduce(
        (s, l) => s + (l.status === "won" && l.closedAmount ? Number(l.closedAmount) : 0),
        0,
      ),
      // ★1行も無いのは「訪問0」ではなく「まだ取得していない」（§3）
      measured: agencyRows.length > 0,
    },
  };
}
