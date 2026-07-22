// 経路の階段（どこで落ちているか）
//
// ★経路ごとに画面を作るなら、読み方は全画面で同じにする。
//   バラバラだと毎回読み方を覚え直すことになり、判断が遅くなる。
//
// ★段間の転換率は、両端が実測のときだけ出す。
//   片方が未計測のまま率を出すと、壊れた計測が「成果ゼロ」に化ける（§3・§16.5）。

import type { Stage } from "@/lib/stages";

export type StageItem = Stage;

export function Stages({
  stages,
  transitions,
  biggestDropIndex,
  comparableSegments,
}: {
  stages: StageItem[];
  transitions: (number | null)[];
  biggestDropIndex: number | null;
  /** 転換率を出せた区間の数。1以下なら「落ち込み」は比較できない */
  comparableSegments?: number;
}) {
  return (
    <>
      <div className="mb-2 flex flex-wrap items-stretch gap-1.5">
        {stages.map((s, i) => (
          <div key={s.key} className="flex items-stretch gap-1.5">
            {i > 0 && (
              <div className="flex flex-col items-center justify-center px-1">
                <span className="text-[var(--faint)]">→</span>
                <span
                  className={`tnum text-[11px] ${
                    biggestDropIndex === i ? "font-bold text-[var(--bad)]" : "text-[var(--faint)]"
                  }`}
                >
                  {transitions[i] === null ? "—" : `${(transitions[i]! * 100).toFixed(1)}%`}
                </span>
              </div>
            )}
            <div
              className={`flex min-w-[124px] flex-col rounded-lg border px-3 py-2.5 ${
                biggestDropIndex === i
                  ? "border-[var(--bad)]/50 bg-[var(--bad)]/[0.05]"
                  : "border-[var(--border)] bg-[var(--panel-2)]"
              }`}
              title={s.hint}
            >
              <div className="text-[11px] text-[var(--muted)]">{s.label}</div>
              <div className="mt-1">
                {s.value === null ? (
                  <span className="text-xs font-medium text-[var(--warn)]">—(未計測)</span>
                ) : (
                  <span className="tnum text-lg font-bold leading-none">
                    {s.value.toLocaleString("ja-JP")}
                  </span>
                )}
              </div>
              <div className="mt-1 text-[10px] leading-tight text-[var(--faint)]">{s.hint}</div>
            </div>
          </div>
        ))}
      </div>

      {biggestDropIndex !== null ? (
        <p className="rounded-md bg-[var(--panel-2)] px-3 py-2 text-[12px] text-[var(--muted)]">
          最大の落ち込みは <strong>{stages[biggestDropIndex].label}</strong>。 打つ手:{" "}
          {stages[biggestDropIndex].action}
        </p>
      ) : (
        <p className="rounded-md bg-[var(--panel-2)] px-3 py-2 text-[12px] text-[var(--muted)]">
          {comparableSegments === 1
            ? // ★区間が1つだけのとき、その区間は必ず「最大」になる。名指ししても意味がない
              "転換率を出せた区間が1つだけです。比較対象が無いので、どこが落ちているかは判定しません（他の段を計測すると判定できます）。"
            : "転換率を出せる段がまだありません（未計測か母数0）。落ち込みの判定はできません。"}
        </p>
      )}
    </>
  );
}
