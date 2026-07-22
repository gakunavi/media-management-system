// 送客 × 受け皿のマトリクス（2026-07-22 石井さんと整理した構造）
//
//   [送客]   HP ／ メディア ／ 記事 ／ Threads
//                        ↓
//   [受け皿] LINE ／ 診断LP ／ 代理店LP ／ HPの問い合わせ ／ 電話 ／
//            Threads DM ／ info メール直接
//                        ↓
//   [結果]   リード → 成約 → 金額
//
// ★このマトリクスの目的は「どこが埋まっていないか」を出すこと。
//   いま MMS はほとんどのマスを測れておらず、その事実自体が
//   次に何を計装すべきかを示している。空欄を 0 で埋めると
//   「送客していない」のか「測っていない」のか分からなくなる（§3）。
//
// ★測れないマスもある（名刺・QR・LINE内検索・電話の発信元）。
//   それは「未計測」ではなく「測定不能」として区別する。
//   未計測は直せるが、測定不能は直せない。混ぜると打ち手を誤る。
import { prisma } from "@mms/db";
import type { Range } from "./period";

/** 送客元（人を送り出す側） */
export const SENDERS = [
  { key: "hp", label: "HP" },
  { key: "media", label: "メディア" },
  { key: "article", label: "記事" },
  { key: "threads", label: "Threads" },
] as const;

/** 受け皿（問い合わせが着地する側）。Lead.sourceType と対応 */
export const RECEIVERS = [
  { key: "line", label: "公式LINE" },
  { key: "lp_diagnosis", label: "診断LP" },
  { key: "lp_agency", label: "商品LP（代理店経由）" },
  { key: "form", label: "HPの問い合わせ" },
  { key: "threads_dm", label: "Threads DM" },
  { key: "phone_manual", label: "電話" },
  { key: "email", label: "info メール" },
] as const;

export type CellState =
  /** 実測値がある */
  | "measured"
  /** 計装すれば測れるが、まだ測っていない */
  | "not_measured"
  /** 仕組み上そもそも到達しない組み合わせ */
  | "n/a"
  /**
   * 自動取得はできないが、ヒアリングして手で記録すれば測れる（電話・info メール）。
   *
   * ★2026-07-23 石井さんの指摘で「測定不能」から格上げした。
   *   いきなり電話してくる人はほとんどおらず、何かの施策に触れている。
   *   「自動で取れない」を「測れない」と書くと、記録する動機まで消える。
   *   Lead.origin（きっかけ）に記録すれば、電話も施策の成果として数えられる。
   */
  | "manual"
  /** 原理的に測れない（LINE内検索など、本人も出所を言えない類） */
  | "unmeasurable";

export type Cell = {
  sender: string;
  receiver: string;
  state: CellState;
  /** state=measured のときの値 */
  value: number | null;
  /** なぜその状態なのか。空欄の理由を必ず持たせる */
  reason: string;
};

export type AcquisitionMatrix = {
  days: number;
  cells: Cell[];
  /** 受け皿ごとの合計（送客元を問わない実測。Lead 件数） */
  receiverTotals: Record<string, number>;
  /** 測れているマスの数 / 測るべきマスの数 */
  coverage: { measured: number; target: number };
};

/**
 * どの組み合わせが成立しうるか。
 * ★成立しない組み合わせを「未計測」と出すと、直すべき箇所の数が水増しされる。
 */
const CELL_RULES: Record<string, Record<string, { state: CellState; reason: string }>> = {
  hp: {
    line: { state: "not_measured", reason: "テーマの lin.ee が生リンク。/r/line/ 経由にすれば測れる" },
    lp_diagnosis: { state: "not_measured", reason: "HPからLPへの導線が未計測" },
    lp_agency: { state: "n/a", reason: "代理店LPは外部ドメイン。HPからの導線は無い" },
    form: { state: "not_measured", reason: "フォーム送信のWebhookが未設置" },
    threads_dm: { state: "n/a", reason: "HPからThreads DMへは繋がらない" },
    phone_manual: { state: "manual", reason: "ヒアリングして手入力（リード登録の「きっかけ」）" },
    email: { state: "manual", reason: "ヒアリングして手入力（リード登録の「きっかけ」）" },
  },
  media: {
    line: { state: "not_measured", reason: "記事内の lin.ee が生リンク（/media/ 9箇所）" },
    lp_diagnosis: { state: "measured", reason: "GA4 の lp_view（記事→LP到達）" },
    lp_agency: { state: "n/a", reason: "代理店LPは外部ドメイン" },
    form: { state: "not_measured", reason: "段2ファネル（CTA表示→クリック→送信）が未計測" },
    threads_dm: { state: "n/a", reason: "メディアからThreads DMへは繋がらない" },
    phone_manual: { state: "manual", reason: "ヒアリングして手入力（リード登録の「きっかけ」）" },
    email: { state: "manual", reason: "ヒアリングして手入力（リード登録の「きっかけ」）" },
  },
  article: {
    line: { state: "not_measured", reason: "記事CTAの lin.ee が生リンク" },
    lp_diagnosis: { state: "not_measured", reason: "LP到達は取れているが記事別に分解していない" },
    lp_agency: { state: "n/a", reason: "代理店LPは外部ドメイン" },
    form: { state: "not_measured", reason: "段2ファネルが未計測" },
    threads_dm: { state: "n/a", reason: "記事からThreads DMへは繋がらない" },
    // ★きっかけは記事単位まで分解できない（電話で記事IDまで聞けない）。メディア行に含める
    phone_manual: { state: "n/a", reason: "メディア行に含む（きっかけは記事単位まで聞けない）" },
    email: { state: "n/a", reason: "メディア行に含む（きっかけは記事単位まで聞けない）" },
  },
  threads: {
    line: { state: "measured", reason: "/r/line/<投稿ID> のクリック" },
    lp_diagnosis: { state: "measured", reason: "/r/lp/<投稿ID> のクリック" },
    lp_agency: { state: "n/a", reason: "代理店LPへはThreadsから送っていない" },
    form: { state: "measured", reason: "/r/soken/<投稿ID> のクリック（記事経由）" },
    threads_dm: { state: "measured", reason: "cowork の dm-log.md（アングル別）" },
    phone_manual: { state: "manual", reason: "ヒアリングして手入力（リード登録の「きっかけ」）" },
    email: { state: "manual", reason: "ヒアリングして手入力（リード登録の「きっかけ」）" },
  },
};

/**
 * 送客元 → Lead.origin。手入力の受け皿（電話・info メール）を埋めるのに使う。
 * ★「きっかけ」を聞いて記録すれば、電話も施策の成果として数えられる。
 */
const SENDER_ORIGIN: Record<string, string> = {
  hp: "hp",
  media: "media_article",
  threads: "threads",
};

/** 送客元 → 実測に使う指標 */
const SENDER_METRIC: Record<string, Record<string, string>> = {
  threads: {
    line: "threads_link_clicks_line",
    lp_diagnosis: "threads_link_clicks_lp",
    form: "threads_link_clicks_soken",
  },
};

export async function getAcquisitionMatrix(range: Range): Promise<AcquisitionMatrix> {
  const win = { gte: range.since, lt: range.until };

  const [clickAgg, lpViews, dmLeads, leads, manualLeads, coverages] = await Promise.all([
    prisma.contentMetric.groupBy({
      by: ["metric"],
      where: { metric: { startsWith: "threads_link_clicks_" }, date: win },
      _sum: { value: true },
    }),
    prisma.metricSnapshot.aggregate({
      _sum: { value: true },
      where: { metric: { startsWith: "lp_users_" }, date: win },
    }),
    prisma.agencyLead.count({ where: { receivedAt: win } }),
    prisma.lead.groupBy({
      by: ["sourceType"],
      where: { occurredAt: win },
      _count: { _all: true },
    }),
    // ★手入力の受け皿（電話・info メール）を送客元別に埋める
    prisma.lead.groupBy({
      by: ["sourceType", "origin"],
      where: { occurredAt: win, sourceType: { in: ["phone_manual", "email"] } },
      _count: { _all: true },
    }),
    // ★「まだ1度も計測していない」と「計測しているが期間内0件」を分けるための材料。
    //   リダイレクタ（/r/）は初回クリックで MeasurementCoverage を作る（§3）
    prisma.measurementCoverage.findMany({ select: { metric: true } }),
  ]);

  const clicks = new Map(clickAgg.map((r) => [r.metric, Math.round(r._sum.value ?? 0)]));
  const covered = new Set(coverages.map((c) => c.metric));

  const cells: Cell[] = [];
  let measured = 0;
  let target = 0;

  for (const s of SENDERS) {
    for (const r of RECEIVERS) {
      const rule = CELL_RULES[s.key]?.[r.key] ?? {
        state: "not_measured" as CellState,
        reason: "未定義",
      };
      let value: number | null = null;
      let state = rule.state;
      let reason = rule.reason;

      if (state === "manual") {
        const origin = SENDER_ORIGIN[s.key];
        value = manualLeads
          .filter((m) => m.sourceType === r.key && m.origin === origin)
          .reduce((sum, m) => sum + m._count._all, 0);
      }

      if (state === "measured") {
        if (s.key === "threads") {
          if (r.key === "threads_dm") value = dmLeads;
          else {
            const m = SENDER_METRIC.threads[r.key];
            // ★計測開始が記録されていない経路に 0 を出さない（§3）。
            //   0 と書くと「送ったが誰も踏まなかった」に見えるが、実際は
            //   リダイレクタを一度も通っていない＝測っていない状態。
            if (m && covered.has(m)) value = clicks.get(m) ?? 0;
            else {
              state = "not_measured";
              reason = `${m} の計測がまだ始まっていない（/r/ 経由のリンクが未使用）`;
            }
          }
        } else if (s.key === "media" && r.key === "lp_diagnosis") {
          value = Math.round(lpViews._sum.value ?? 0);
        }
      }

      // ★手入力でも「記録する仕組みがある」なら計測できているマスに数える。
      //   自動で取れないことと、測れないことは別（2026-07-23）
      if (state === "measured" || state === "manual") measured += 1;
      if (state === "measured" || state === "not_measured" || state === "manual") target += 1;

      cells.push({ sender: s.key, receiver: r.key, state, value, reason });
    }
  }

  const receiverTotals: Record<string, number> = {};
  for (const l of leads) receiverTotals[l.sourceType] = l._count._all;

  return { days: range.days, cells, receiverTotals, coverage: { measured, target } };
}
