// 推移グラフ（インラインSVG・外部ライブラリなし）
//
// ★Chart.js を入れない理由（§2.1「バージョン依存で壊れない」）
//   元の media-console は Chart.js を CDN から読んでいた。見た目は良いが、
//   外部CDNに依存すると、オフラインやCDN障害で「画面が真っ白」になる。
//   ここで必要なのは「増えているか減っているか」が読めることで、
//   それはSVGで足りる。
//
// ★桁が違う系列を1本の軸に載せない。
//   表示4,556 とクリック154 を同じ軸に置くと、クリックが常に底に張り付いて
//   増減が読めない。系列ごとに軸（left/right）を分け、目盛りも両側に出す。
//
// ★掲載順位は小さいほど良い。invert で上下を反転させないと、
//   「順位が上がった」グラフが下がって見える。

export type Series = {
  label: string;
  /** CSS変数などの色。系列の識別に使う */
  color: string;
  points: { date: string; value: number | null }[];
  axis?: "left" | "right";
  /** 小さい値ほど良い指標（掲載順位）。上下を反転する */
  invert?: boolean;
};

const W = 720;
const H = 200;
const PAD_L = 40;
const PAD_R = 42;
const PAD_T = 12;
const PAD_B = 24;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

export function TrendChart({ series, height = H }: { series: Series[]; height?: number }) {
  const len = Math.max(0, ...series.map((s) => s.points.length));
  if (len === 0 || series.length === 0) {
    return <p className="py-6 text-center text-[12px] text-[var(--faint)]">データがありません</p>;
  }

  const scaleOf = (axis: "left" | "right") => {
    const vals = series
      .filter((s) => (s.axis ?? "left") === axis)
      .flatMap((s) => s.points.map((p) => p.value))
      .filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    const inverted = series.some((s) => (s.axis ?? "left") === axis && s.invert);
    if (inverted) {
      // 順位は 1 が最上。最大値を上限にして反転する
      return { min: 1, max: niceMax(Math.max(...vals)), invert: true };
    }
    return { min: 0, max: niceMax(Math.max(...vals, 1)), invert: false };
  };

  const left = scaleOf("left");
  const right = scaleOf("right");

  const x = (i: number) => PAD_L + (i * (W - PAD_L - PAD_R)) / Math.max(1, len - 1);
  const y = (v: number, sc: { min: number; max: number; invert: boolean }) => {
    const r = (v - sc.min) / Math.max(1e-9, sc.max - sc.min);
    const t = sc.invert ? r : 1 - r;
    return PAD_T + t * (height - PAD_T - PAD_B);
  };

  const dates = series[0].points.map((p) => p.date);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img">
        {/* 目盛り線 */}
        {[0, 0.25, 0.5, 0.75, 1].map((r) => {
          const yy = PAD_T + r * (height - PAD_T - PAD_B);
          return (
            <g key={r}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={yy}
                y2={yy}
                stroke="currentColor"
                strokeWidth={0.5}
                className="text-[var(--border)]"
              />
              {left && (
                <text
                  x={PAD_L - 4}
                  y={yy + 3}
                  fontSize={9}
                  textAnchor="end"
                  fill="currentColor"
                  className="text-[var(--faint)]"
                >
                  {Math.round(
                    left.invert
                      ? left.min + r * (left.max - left.min)
                      : left.max - r * (left.max - left.min),
                  )}
                </text>
              )}
              {right && (
                <text
                  x={W - PAD_R + 4}
                  y={yy + 3}
                  fontSize={9}
                  fill="currentColor"
                  className="text-[var(--faint)]"
                >
                  {Math.round(right.max - r * (right.max - right.min))}
                </text>
              )}
            </g>
          );
        })}

        {/* 系列 */}
        {series.map((s) => {
          const sc = (s.axis ?? "left") === "right" ? right : left;
          if (!sc) return null;
          // ★null（未計測）で線を切る。0 として繋ぐと「落ち込んだ」に見える（§3）
          const segments: string[] = [];
          let cur: string[] = [];
          s.points.forEach((p, i) => {
            if (p.value === null) {
              if (cur.length > 1) segments.push(cur.join(" "));
              cur = [];
              return;
            }
            cur.push(`${cur.length === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value, sc).toFixed(1)}`);
          });
          if (cur.length > 1) segments.push(cur.join(" "));
          return (
            <g key={s.label}>
              {segments.map((d, i) => (
                <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={1.6} />
              ))}
              {s.points.map((p, i) =>
                p.value === null ? null : (
                  <circle key={i} cx={x(i)} cy={y(p.value, sc)} r={1.8} fill={s.color}>
                    <title>{`${p.date} ${s.label}: ${p.value.toLocaleString("ja-JP")}`}</title>
                  </circle>
                ),
              )}
            </g>
          );
        })}

        {/* 日付（両端と中央） */}
        {[0, Math.floor(len / 2), len - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={height - 6}
            fontSize={9}
            textAnchor={i === 0 ? "start" : i === len - 1 ? "end" : "middle"}
            fill="currentColor"
            className="text-[var(--faint)]"
          >
            {dates[i]?.slice(5)}
          </text>
        ))}
      </svg>

      <div className="mt-1 flex flex-wrap gap-3">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
            <span className="inline-block h-[2px] w-3" style={{ background: s.color }} />
            {s.label}
            {s.axis === "right" && <span className="text-[var(--faint)]">（右軸）</span>}
            {s.invert && <span className="text-[var(--faint)]">（上が良い）</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
