// 代理店（Threads DM ＋ 代理店LP）を1つにまとめる
//
// ★なぜ統合するか
//   代理店開拓は1つの目的なのに、経路が2つある:
//     Threads DM … 代理店募集の投稿 → DM → 選別 → 契約
//     代理店LP    … 配布コード付きURL → 訪問 → 問い合わせ → 契約
//   これが /threads と /lp に分かれていたため、
//   「代理店開拓が進んでいるか」を1画面で判断できなかった。
//
// ★2つの階段を並べる。合算しない。
//   母数の単位が違う（投稿views と LP訪問）ので、足すと意味が壊れる。
import { prisma } from "@mms/db";
import type { StageItem } from "@/components/stages";

const DAY = 86400000;

export type AngleRow = {
  angle: string;
  posts: number;
  dms: number;
  /** 1投稿あたりのDM数。投稿数が違う angle を並べるために要る */
  dmsPerPost: number | null;
};

export type CodeRow = {
  code: string;
  visits: number;
  inquiries: number;
  lastAt: Date;
  idleDays: number;
};

export type Track = {
  key: "dm" | "lp";
  label: string;
  stages: StageItem[];
  transitions: (number | null)[];
  biggestDropIndex: number | null;
};

export type AgencyChannel = {
  days: number;
  tracks: Track[];
  byAngle: AngleRow[];
  byCode: CodeRow[];
  /** 代理店リードの合計（両経路）。成約と金額 */
  totals: { leads: number; won: number; wonAmount: number };
  trends: {
    dms: { date: string; value: number | null }[];
    visits: { date: string; value: number | null }[];
  };
  notes: string[];
};

const ymd = (d: Date) => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);

function buildTransitions(stages: StageItem[]) {
  const transitions: (number | null)[] = [null];
  let biggestDropIndex: number | null = null;
  let worst = Infinity;
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].value;
    const cur = stages[i].value;
    // ★どちらかが未計測なら率を出さない（§3・§16.5）
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
  return { transitions, biggestDropIndex };
}

export async function getAgencyChannel(
  days = 30,
  now: Date = new Date(),
): Promise<AgencyChannel> {
  const since = new Date(now.getTime() - days * DAY);

  const [agencyPosts, postMetrics, agencyLeads, lpRows, leads] = await Promise.all([
    prisma.contentItem.findMany({
      where: { type: "post", channel: { type: "threads" }, targetLabel: "代理店候補" },
      select: { id: true, note: true },
    }),
    prisma.contentMetric.groupBy({
      by: ["contentItemId"],
      where: { metric: "threads_views" },
      _max: { value: true },
    }),
    prisma.agencyLead.findMany({
      select: { stage: true, receivedAt: true, screeningAnswers: true },
    }),
    prisma.agencyLpDaily.findMany({
      where: { date: { gte: since } },
      select: { agencyCode: true, visits: true, inquiries: true, date: true },
    }),
    prisma.lead.findMany({
      where: { sourceType: { in: ["threads_dm", "lp_agency"] } },
      select: { status: true, closedAmount: true, sourceType: true },
    }),
  ]);

  // ── Threads DM の階段 ──
  const viewsByItem = new Map(postMetrics.map((m) => [m.contentItemId, m._max.value ?? 0]));
  const agencyViews = agencyPosts.reduce((s, p) => s + (viewsByItem.get(p.id) ?? 0), 0);

  const dmsInPeriod = agencyLeads.filter((l) => l.receivedAt >= since);
  const qualified = agencyLeads.filter((l) => l.stage === "qualified").length;
  const contracted = agencyLeads.filter((l) => l.stage === "contracted").length;

  const dmStages: StageItem[] = [
    {
      key: "views",
      label: "① 投稿の表示",
      value: Math.round(agencyViews),
      hint: `代理店募集トラック ${agencyPosts.length}投稿の累計views`,
      action: "投稿数を増やす・アングルを見直す",
    },
    {
      key: "dm",
      label: "② DM受信",
      value: agencyLeads.length,
      hint: "cowork の日次監視が検知した累計",
      action: "自己選別フレーズと反応導線（DMで教えてください）を強める",
    },
    {
      key: "qualified",
      label: "③ 有効",
      value: qualified,
      hint: "経営者に接点があると確認できたもの",
      action: "選別質問の当て方を見直す（客を持つ人だけが手を挙げる設計）",
    },
    {
      key: "contracted",
      label: "④ 契約",
      value: contracted,
      hint: "代理店契約に至ったもの",
      action: "百瀬さんへの受け渡しと条件提示を見直す",
    },
  ];
  const dmT = buildTransitions(dmStages);

  // ── 代理店LP の階段 ──
  const visits = lpRows.reduce((s, r) => s + r.visits, 0);
  const coded = lpRows.filter((r) => r.agencyCode !== "direct");
  const codedVisits = coded.reduce((s, r) => s + r.visits, 0);
  const lpInquiries = lpRows.reduce((s, r) => s + r.inquiries, 0);
  const lpLeads = leads.filter((l) => l.sourceType === "lp_agency");
  const lpMeasured = lpRows.length > 0;

  const lpStages: StageItem[] = [
    {
      key: "visits",
      label: "① LP訪問",
      value: lpMeasured ? visits : null,
      hint: "総訪問（コード無しを含む）",
      action: "代理店に配布URLの使用を促す",
    },
    {
      key: "coded",
      label: "② コード付き",
      value: lpMeasured ? codedVisits : null,
      hint: "どの代理店の貢献か識別できた訪問",
      action: "コードは sessionStorage 保持でタブを閉じると消える。localStorage+Cookie 化が要る",
    },
    {
      key: "inquiry",
      label: "③ 問い合わせ",
      value: lpMeasured ? lpInquiries : null,
      hint: "LP のフォーム送信（テスト送信は除外）",
      action: "LPの構成・オファーを見直す",
    },
    {
      key: "lead",
      label: "④ リード起票",
      value: lpLeads.length,
      hint: "代理店LP経由として MMS に起票したもの",
      action: "問い合わせをリードとして起票する運用を作る",
    },
  ];
  const lpT = buildTransitions(lpStages);

  // ── アングル別 ──
  const postsPerAngle = new Map<string, number>();
  for (const p of agencyPosts) {
    const a = p.note?.trim() || "unknown";
    postsPerAngle.set(a, (postsPerAngle.get(a) ?? 0) + 1);
  }
  const dmsPerAngle = new Map<string, number>();
  for (const l of agencyLeads) {
    const ans = l.screeningAnswers as { angle?: unknown } | null;
    const a = typeof ans?.angle === "string" && ans.angle ? ans.angle : "不明";
    dmsPerAngle.set(a, (dmsPerAngle.get(a) ?? 0) + 1);
  }
  const angles = new Set([...postsPerAngle.keys(), ...dmsPerAngle.keys()]);
  const byAngle: AngleRow[] = [...angles]
    .map((angle) => {
      const posts = postsPerAngle.get(angle) ?? 0;
      const dms = dmsPerAngle.get(angle) ?? 0;
      return { angle, posts, dms, dmsPerPost: posts > 0 ? dms / posts : null };
    })
    .sort((a, b) => b.dms - a.dms || b.posts - a.posts);

  // ── コード別 ──
  const byCodeMap = new Map<string, { visits: number; inquiries: number; last: Date }>();
  for (const r of lpRows) {
    const cur = byCodeMap.get(r.agencyCode) ?? { visits: 0, inquiries: 0, last: r.date };
    cur.visits += r.visits;
    cur.inquiries += r.inquiries;
    if (r.date > cur.last) cur.last = r.date;
    byCodeMap.set(r.agencyCode, cur);
  }
  const byCode: CodeRow[] = [...byCodeMap.entries()]
    .map(([code, c]) => ({
      code,
      visits: c.visits,
      inquiries: c.inquiries,
      lastAt: c.last,
      idleDays: Math.floor((now.getTime() - c.last.getTime()) / DAY),
    }))
    .sort((a, b) => b.visits - a.visits);

  // ── 推移 ──
  const dmByDay = new Map<string, number>();
  for (const l of dmsInPeriod) {
    const k = ymd(l.receivedAt);
    dmByDay.set(k, (dmByDay.get(k) ?? 0) + 1);
  }
  const visitByDay = new Map<string, number>();
  for (const r of lpRows) {
    const k = ymd(r.date);
    visitByDay.set(k, (visitByDay.get(k) ?? 0) + r.visits);
  }
  const toSeries = (m: Map<string, number>) => {
    const out: { date: string; value: number | null }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = ymd(new Date(now.getTime() - i * DAY));
      out.push({ date: k, value: m.get(k) ?? 0 });
    }
    return out;
  };

  const notes: string[] = [];
  const directVisits = visits - codedVisits;
  if (lpMeasured && visits > 0 && directVisits / visits > 0.5) {
    notes.push(
      `LP訪問の ${Math.round((directVisits / visits) * 100)}% がコード無し。` +
        "どの代理店の貢献か識別できていない（コードが sessionStorage 保持のため、" +
        "タブを閉じると消える）",
    );
  }
  const idle = byCode.filter((c) => c.code !== "direct" && c.idleDays >= 7);
  if (idle.length > 0) {
    notes.push(`配布済みコードのうち ${idle.length}件 が7日以上流入なし（配ったが動いていない）`);
  }

  return {
    days,
    tracks: [
      { key: "dm", label: "Threads DM", stages: dmStages, ...dmT },
      { key: "lp", label: "代理店LP（防災防犯ライト）", stages: lpStages, ...lpT },
    ],
    byAngle,
    byCode,
    totals: {
      leads: leads.length,
      won: leads.filter((l) => l.status === "won").length,
      wonAmount: leads.reduce(
        (s, l) => s + (l.status === "won" && l.closedAmount ? Number(l.closedAmount) : 0),
        0,
      ),
    },
    trends: { dms: toSeries(dmByDay), visits: toSeries(visitByDay) },
    notes,
  };
}
