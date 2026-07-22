// 表示期間（全画面共通）
//
// ★なぜ共通化するか
//   画面ごとに「直近30日」を各libが勝手に決めていたため、
//   ダッシュボードの表示（GSC 28日）と LP到達（GA4 28日）が
//   **別々の28日間**を指していた。同じ画面に並ぶ数字が別の期間を
//   指しているのは、そもそも比較になっていない。
//   期間は1か所で決め、全ての集計に同じ since/until を渡す。
//
// ★目標（Target）は月次で持っている。だから期間の既定は「今月」。
//   ちょうど1暦月に一致するときだけ目標と比べる（period != null）。
//   任意の30日と月次目標を比べると、未達/達成の判定が嘘になる。
//
// ★全ての境界は JST。UTCで切ると日本の1日とズレる。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86400000;

/** その時刻の JST 日付キー（"YYYY-MM-DD"） */
export function jstDayKey(d: Date): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST日付キー → その日の 00:00 JST を指す Date */
export function jstMidnight(key: string): Date {
  return new Date(`${key}T00:00:00+09:00`);
}

/** JST日付キーに日数を足す */
export function addDays(key: string, n: number): string {
  return jstDayKey(new Date(jstMidnight(key).getTime() + n * DAY_MS));
}

/** since〜until(排他) の JST 日付キー列 */
export function dayKeys(since: Date, until: Date): string[] {
  const out: string[] = [];
  let k = jstDayKey(since);
  const end = jstDayKey(new Date(until.getTime() - 1));
  while (k <= end) {
    out.push(k);
    k = addDays(k, 1);
  }
  return out;
}

/**
 * `@db.Date` 列に渡す境界。
 *
 * ★Prisma は `@db.Date` 列のフィルタ値を**日付に切り捨てる**。
 *   JSTの0時（＝UTCでは前日15:00）をそのまま渡すと前日として扱われ、
 *   期間の頭が1日多く入り、末尾は当日が丸ごと落ちる。
 *   実測: `clicks` を「今月」で数えると 6/30 の1日が混入していた。
 *   日付列には **UTCの0時で表した日付** を渡す。
 */
export function dateOnly(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00Z`);
}

export type Range = {
  /** クエリに載る値（?range=）*/
  key: string;
  /** 見出しに出す文言 */
  label: string;
  /** 期間の開始（含む） */
  since: Date;
  /** 期間の終了（**含まない**）。today を含めるため翌日0時 */
  until: Date;
  /** 日数（グラフの点数） */
  days: number;
  /** ちょうど1暦月ならその "YYYY-MM"。目標比較の可否を兼ねる */
  period: string | null;
  /** 直前の同じ長さの期間（増減の比較用） */
  prev: { since: Date; until: Date };
  /**
   * `@db.Date` 列（MetricSnapshot.date / ContentMetric.date / SnsAccountHealth.date …）
   * 用の境界。★タイムスタンプ列には使わない（意味がずれる）
   */
  dateWindow: { gte: Date; lt: Date };
  prevDateWindow: { gte: Date; lt: Date };
};

export const RANGE_PRESETS = [
  { key: "d7", label: "7日" },
  { key: "d28", label: "28日" },
  { key: "d90", label: "90日" },
  { key: "month", label: "今月" },
  { key: "prev_month", label: "先月" },
] as const;

export const DEFAULT_RANGE = "month";

const jaSpan = (since: Date, until: Date) => {
  const f = (d: Date) =>
    d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
  return `${f(since)}〜${f(new Date(until.getTime() - 1))}`;
};

function build(key: string, label: string, since: Date, until: Date, period: string | null): Range {
  const span = until.getTime() - since.getTime();
  const prevSince = new Date(since.getTime() - span);
  return {
    key,
    label: `${label}（${jaSpan(since, until)}）`,
    since,
    until,
    days: Math.max(1, Math.round(span / DAY_MS)),
    period,
    prev: { since: prevSince, until: new Date(since.getTime()) },
    // ★日付列は JST の日付をそのまま（UTC0時で）渡す
    dateWindow: { gte: dateOnly(jstDayKey(since)), lt: dateOnly(jstDayKey(until)) },
    prevDateWindow: {
      gte: dateOnly(jstDayKey(prevSince)),
      lt: dateOnly(jstDayKey(since)),
    },
  };
}

const isDayKey = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * URL のクエリから期間を決める。
 *
 *   ?range=d28              直近28日（今日を含む）
 *   ?range=month            今月（1日〜今日）
 *   ?range=prev_month       先月（1日〜末日）
 *   ?from=2026-06-01&to=2026-06-30   任意区間（to を含む）
 *
 * ★不正な値は既定に落とす。エラーで画面を落とすほどのことではない。
 */
export function resolveRange(
  sp: Record<string, string | string[] | undefined> | undefined,
  now: Date = new Date(),
): Range {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const from = one(sp?.from);
  const to = one(sp?.to);
  const todayKey = jstDayKey(now);

  if (from && to && isDayKey(from) && isDayKey(to) && from <= to) {
    const since = jstMidnight(from);
    const until = jstMidnight(addDays(to, 1));
    // ちょうど1暦月に一致するなら目標と比較できる
    const isFullMonth =
      from.endsWith("-01") && addDays(to, 1).slice(8) === "01" && from.slice(0, 7) === to.slice(0, 7);
    return build("custom", "指定期間", since, until, isFullMonth ? from.slice(0, 7) : null);
  }

  const key = one(sp?.range) ?? DEFAULT_RANGE;
  const tomorrow = jstMidnight(addDays(todayKey, 1));

  if (key === "month" || key === "prev_month") {
    const ym = todayKey.slice(0, 7);
    if (key === "month") {
      const since = jstMidnight(`${ym}-01`);
      return build("month", "今月", since, tomorrow, ym);
    }
    const [y, m] = ym.split("-").map(Number);
    const prevY = m === 1 ? y - 1 : y;
    const prevM = m === 1 ? 12 : m - 1;
    const pym = `${prevY}-${String(prevM).padStart(2, "0")}`;
    const since = jstMidnight(`${pym}-01`);
    const until = jstMidnight(`${ym}-01`);
    return build("prev_month", "先月", since, until, pym);
  }

  const m = /^d(\d+)$/.exec(key);
  const days = m ? Math.min(365, Math.max(1, Number(m[1]))) : 0;
  if (days > 0) {
    const since = jstMidnight(addDays(todayKey, -(days - 1)));
    return build(`d${days}`, `直近${days}日`, since, tomorrow, null);
  }

  // 既定（今月）
  const ym = todayKey.slice(0, 7);
  return build("month", "今月", jstMidnight(`${ym}-01`), tomorrow, ym);
}
