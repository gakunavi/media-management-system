// 運用ツールの契約管理（2026-07-21 追加・設計書には無い）
//
// ★なぜ作ったか（実害が2件出た日に追加）
//   1) ラッコのプランを誤認し、使えない機能で作業させてしまった
//   2) DataForSEO の残高が $0.137 まで枯渇し、週次のSERP取得が止まる寸前だった
//   どちらも「今どのプランで、いくら払い、あといくら残っているか」が
//   どこにも無かったことが原因。
//
// ★効果（ROI）は自動算出しない。
//   「このツールが何円の売上を生んだか」は分解不能で、算出すれば
//   根拠のない数字が出る。導入時に purpose / expectedOutcome / decideBy を
//   書き、期日に人が判定する（Action → Intervention → Learning と同じ形）。
import { prisma } from "@mms/db";

export const TOOL_STATE_LABEL: Record<string, string> = {
  considering: "検討中",
  trial: "トライアル",
  active: "契約中",
  stopped: "停止",
};

export const BILLING_LABEL: Record<string, string> = {
  monthly: "月額",
  prepaid: "前払い/従量",
  free: "無料",
};

/**
 * そのツールの残高で動いている処理と、1回あたりの消費。
 *
 * ★なぜ要るか（2026-07-24）
 *   残高 $0.1372 と書いてあっても、それが多いのか少ないのか判断できない。
 *   実際 DataForSEO は **次回（週次）の実行に $0.24 かかる**ので、いまの残高では
 *   途中で止まる。だが画面には「残高 0.1372 USD」としか出ていなかった。
 *   **金額そのものではなく「あと何回動くか」「尽きると何が止まるか」**が判断材料。
 *
 * ★ここに書くのは静的な対応関係（どのツールがどの処理を動かすか）。
 *   実測（残高）は DB、単価は各ジョブの仕様。混ぜない。
 */
export type ToolPower = {
  /** このツールが無いと止まる処理（自動処理画面の名前） */
  jobs: { name: string; label: string }[];
  /** 1回の実行でかかる概算費用 */
  costPerRun: number | null;
  costNote: string;
  /** 止まると何が測れなくなるか */
  losesWhat: string;
};

export const TOOL_POWERS: Record<string, ToolPower> = {
  DataForSEO: {
    jobs: [{ name: "serp-fetch-weekly", label: "検索結果の順位を取り込む（毎週月曜 03:00）" }],
    // 最大400KW × $0.0006（AIO引用元まで取ると $0.0030）
    costPerRun: 0.24,
    costNote: "1SERP $0.0006 × 最大400KW。AIO引用元まで取るKWは $0.0030",
    losesWhat: "競合の順位が取れなくなる。GSCは自社しか見えないので「誰に負けているか」が消える",
  },
  "OpenAI API": {
    jobs: [
      { name: "aio-hot-weekly", label: "AI検索の被引用を測る・主戦場KW（毎週木曜）" },
      { name: "aio-warm-biweekly", label: "同・中位KW（隔週）" },
      { name: "aio-cold-monthly", label: "同・下位KW（毎月）" },
    ],
    costPerRun: null,
    costNote: "従量。OpenAI は残高APIを公開していないため自動取得できない",
    losesWhat:
      "AI検索（ChatGPT）に引用されているかが測れない。実測では 1966試行中71ヒット（3.6%）",
  },
  "Google Search Console": {
    jobs: [
      { name: "gsc-fetch-daily", label: "検索の実測を毎日取り込む" },
      { name: "gsc-queries-weekly", label: "記事が来ている検索語を取り込む" },
    ],
    costPerRun: 0,
    costNote: "無料",
    losesWhat: "記事ごとの実測が入らなくなる。PDCAの判定が全部できなくなる",
  },
  "Threads API（GAS経由）": {
    jobs: [
      { name: "threads-sync-daily", label: "投稿と実績を取り込む" },
      { name: "queue-refill-daily", label: "投稿キューを補充する" },
    ],
    costPerRun: 0,
    costNote: "無料",
    losesWhat: "投稿が配信されなくなり、実績も取れなくなる",
  },
  Cloudflare: {
    // ★ジョブは動かさないが、**全ページの配信**がここを通る。
    //   止まればサイト全体が落ちる。ジョブが無い＝影響が無い ではない
    jobs: [],
    costPerRun: 0,
    costNote: "月額（¥909・内訳は請求画面で要確認）",
    losesWhat:
      "サイトの配信そのもの。★APOはHTMLをエッジでキャッシュするため、WordPressで301を直しても古い応答が残ることがある（url_health.py がクエリを足して迂回しているのはこのため）",
  },
  ラッコキーワード: {
    jobs: [{ name: "rakko-import-daily", label: "KW調査結果を取り込む" }],
    costPerRun: 0,
    costNote: "フリープラン。一括調査（12ヶ月推移）はエントリー¥660以上",
    losesWhat: "新しいKW候補とネタが入らなくなる",
  },
};

export type ToolRow = {
  id: string;
  name: string;
  vendor: string | null;
  plan: string | null;
  billingType: string;
  monthlyYen: number | null;
  balance: number | null;
  balanceCurrency: string | null;
  balanceCheckedAt: Date | null;
  state: string;
  purpose: string;
  expectedOutcome: string | null;
  decideBy: Date | null;
  decision: string | null;
  decidedAt: Date | null;
  note: string | null;
  /** 判定期日を過ぎているのに未判定 */
  overdue: boolean;
  /** このツールで動いている処理（静的な対応関係） */
  power: ToolPower | null;
  /**
   * あと何回動くか。残高 ÷ 1回あたりの費用。
   * ★残高か単価が無ければ null。**0 を返さない**（未計測と実測ゼロの区別・§3）
   */
  runsLeft: number | null;
};

export type ToolsView = {
  rows: ToolRow[];
  /** 契約中＋トライアルの月額合計（円）。前払い/無料は含めない */
  monthlyTotalYen: number;
  /** 月額が未入力の契約中ツール数。合計が過少に見えるのを防ぐため出す */
  monthlyUnknown: number;
  overdueCount: number;
  /**
   * ★判定期日そのものが未設定の件数。
   *   これを出さないと「判定期日超過 0＝期限切れなし」と読めてしまうが、
   *   実際は**1件も期日を決めていないから0**だった（実測 5件中5件が未設定）。
   */
  noDueDateCount: number;
  /** 次回の実行に足りない（残高切れで止まる）ツール */
  runningOut: ToolRow[];
};

export async function getTools(now: Date = new Date()): Promise<ToolsView> {
  const rows = await prisma.toolSubscription.findMany({
    orderBy: [{ state: "asc" }, { name: "asc" }],
  });

  const view: ToolRow[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    vendor: t.vendor,
    plan: t.plan,
    billingType: t.billingType,
    monthlyYen: t.monthlyYen === null ? null : Number(t.monthlyYen),
    balance: t.balance === null ? null : Number(t.balance),
    balanceCurrency: t.balanceCurrency,
    balanceCheckedAt: t.balanceCheckedAt,
    state: t.state,
    purpose: t.purpose,
    expectedOutcome: t.expectedOutcome,
    decideBy: t.decideBy,
    decision: t.decision,
    decidedAt: t.decidedAt,
    note: t.note,
    overdue:
      t.decideBy !== null && t.decidedAt === null && t.decideBy.getTime() < now.getTime(),
    power: TOOL_POWERS[t.name] ?? null,
    runsLeft: runsLeftOf(
      t.balance === null ? null : Number(t.balance),
      TOOL_POWERS[t.name]?.costPerRun ?? null,
    ),
  }));

  const paying = view.filter((t) => t.state === "active" || t.state === "trial");
  return {
    rows: view,
    monthlyTotalYen: paying.reduce((s, t) => s + (t.monthlyYen ?? 0), 0),
    // ★月額未入力を黙って0円として合計すると「安く見える」。件数を別に出す
    monthlyUnknown: paying.filter((t) => t.billingType === "monthly" && t.monthlyYen === null)
      .length,
    overdueCount: view.filter((t) => t.overdue).length,
    noDueDateCount: paying.filter((t) => t.decideBy === null).length,
    // ★次回の実行ぶんに足りないもの。「残高がある」と「次回動く」は別
    runningOut: view.filter((t) => t.runsLeft !== null && t.runsLeft < 1),
  };
}

/**
 * あと何回動くか。
 * ★単価が 0（無料）や未設定のときは null を返す。0 と混同させない（§3）。
 */
function runsLeftOf(balance: number | null, costPerRun: number | null): number | null {
  if (balance === null || costPerRun === null || costPerRun <= 0) return null;
  return Math.floor((balance / costPerRun) * 100) / 100;
}

/** 段7に出す警告（残高不足・判定期日超過） */
export type ToolAlert = { kind: "balance" | "overdue"; message: string };

export async function getToolAlerts(now: Date = new Date()): Promise<ToolAlert[]> {
  const { rows } = await getTools(now);
  const out: ToolAlert[] = [];

  for (const t of rows) {
    if (t.overdue && t.decideBy) {
      out.push({
        kind: "overdue",
        message: `${t.name}: 判定期日（${t.decideBy.toLocaleDateString("ja-JP")}）を過ぎています`,
      });
    }
    // ★残高は「未取得」と「0」を区別する。null は警告しない（測っていないだけ）
    //
    // ★閾値を金額で決めない（旧実装は 0.3 USD 固定）。いくらから危ないかは
    //   ツールごとに違う。**次回の実行ぶんに足りるか**で判定し、
    //   止まる処理の名前まで出す。名前が無いと重大さが判断できない。
    if (t.state !== "stopped" && t.runsLeft !== null && t.runsLeft < 1) {
      const jobs = t.power?.jobs.map((j) => j.name).join(" / ") ?? "";
      out.push({
        kind: "balance",
        message:
          `${t.name}: 残高 ${t.balance}${t.balanceCurrency ?? ""} で次回の実行に足りません` +
          (jobs ? `（${jobs} が途中で止まります）` : ""),
      });
    }
  }
  return out;
}
