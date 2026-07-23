// 段7: ジョブ健全性・配信・欠測
//
// ★「ジョブが緑」と「数字が入っている」は別。
//   2026-07-22 の点検で、全ジョブ success のまま pv が9日間・weekly_* 6指標が
//   9日間止まっていた。段7 がジョブの成否しか見ていなかったので誰も気づけない。
//   ここでは (1)ジョブの成否 (2)指標の鮮度 (3)配信が続いているか
//   (4)結果が回収できているか の4つを別々に出す。
//
// ★insights（Threads実績の回収）は集計していたのに画面に出していなかった。
//   投稿が出ていることと、その結果が測れていることは別の障害。
import Link from "next/link";
import type { JobHealth, MetricFreshness } from "@/lib/dashboard";

const jaDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" })
    : "—";
const jaDateTime = (d: Date | null) =>
  d
    ? d.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "未実行";

type Alert = "ok" | "warn" | "red" | "unknown";

const boxStyle = (a: Alert) =>
  a === "red"
    ? "border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] text-[var(--bad)]"
    : a === "warn"
      ? "border-[var(--warn)]/40 bg-[var(--warn)]/[0.08] text-[#9a6a00]"
      : a === "unknown"
        ? "border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"
        : "border-[var(--ok)]/40 bg-[var(--ok)]/[0.08] text-[#1a7a2e]";

function Box({ alert, title, children }: { alert: Alert; title: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-[13px] leading-snug ${boxStyle(alert)}`}>
      <div className="text-[11px] font-semibold opacity-80">{title}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

/** 上部の警告バッジ用。赤/黄の項目だけを短文で返す */
export function healthAlerts(health: JobHealth, stale: MetricFreshness[]): string[] {
  const out: string[] = [];
  if (health.gsc.alert === "red") out.push(`GSC が${health.gsc.gapDays}日欠測`);
  if (health.threads.alert === "red")
    out.push(
      health.threads.gapDays !== null && health.threads.gapDays >= 2
        ? `Threads 投稿が${health.threads.gapDays}日停止`
        : `Threads キュー残り${health.threads.queuePending}本`,
    );
  if (health.insights.alert === "red") out.push("Threads 実績の回収が止まっている");
  // ★満杯になると DB が止まり、全部が同時に落ちる。最優先で気づきたい
  if (health.storage.alert === "red") out.push(health.storage.reason);
  for (const t of health.tools) out.push(t.message);
  const red = stale.filter((s) => s.alert === "red");
  if (red.length > 0) out.push(`${red.length}指標が更新停止`);
  return out;
}

export function HealthPanel({
  health,
  freshness,
}: {
  health: JobHealth;
  freshness: MetricFreshness[];
}) {
  const stale = freshness.filter((f) => f.alert !== "ok");
  const unused = freshness.filter((f) => !f.used);

  return (
    <section className="grid gap-4">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-3 flex items-baseline gap-2.5">
          <span className="inline-flex h-5 items-center rounded-md bg-[var(--ink)] px-1.5 text-[11px] font-semibold text-white">
            段7
          </span>
          <h2 className="text-[15px] font-semibold">止まっていないか</h2>
          <Link href="/jobs" className="ml-auto text-[12px] text-[var(--accent)] hover:underline">
            ジョブ画面 →
          </Link>
        </div>

        <div className="grid gap-2 lg:grid-cols-2">
          <Box alert={health.gsc.alert} title="検索データ（GSC）">
            {health.gsc.latestDate === null ? (
              "GSC 実測データがありません"
            ) : health.gsc.alert === "red" ? (
              <>
                <strong className="tnum">{health.gsc.gapDays}日欠測</strong>（最終{" "}
                {jaDate(health.gsc.latestDate)}）。日次ジョブが止まっている
              </>
            ) : health.gsc.alert === "warn" ? (
              <>反映がやや遅れ（最終 {jaDate(health.gsc.latestDate)}）</>
            ) : (
              <>最新（{jaDate(health.gsc.latestDate)}）。2〜3日の遅れは正常</>
            )}
          </Box>

          <Box alert={health.threads.alert} title="Threads の配信">
            {health.threads.alert === "unknown" ? (
              health.threads.reason
            ) : (
              <>
                {health.threads.reason}
                {health.threads.lastPostedAt && (
                  <span className="opacity-70">（最終 {jaDate(health.threads.lastPostedAt)}）</span>
                )}
              </>
            )}
          </Box>

          {/* ★配信が出ていることと、その結果が測れていることは別の障害 */}
          <Box alert={health.insights.alert} title="Threads 実績の回収">
            {health.insights.reason}
          </Box>

          {/* ★2026-07-23 にディスク99%で Postgres がクラッシュループした。
              ジョブの成否では分からない（ジョブ自体が動けない） */}
          <Box alert={health.storage.alert} title="ディスクの空き">
            {health.storage.reason}
          </Box>

          <Box alert={stale.some((s) => s.alert === "red") ? "red" : stale.length ? "warn" : "ok"} title="指標の鮮度">
            {stale.length === 0 ? (
              <>全 {freshness.length} 指標が想定どおりの間隔で更新されている</>
            ) : (
              <>
                <strong className="tnum">{stale.length}指標</strong>が想定間隔を超えて未更新（
                {stale
                  .slice(0, 4)
                  .map((s) => `${s.metric} ${s.ageDays}日`)
                  .join(" / ")}
                {stale.length > 4 ? " …" : ""}）
              </>
            )}
          </Box>
        </div>

        {health.tools.length > 0 && (
          <div className="mt-2 rounded-lg border border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] px-3 py-2.5 text-[13px] text-[var(--bad)]">
            {health.tools.map((t, i) => (
              <div key={i}>{t.message}</div>
            ))}
            <Link href="/costs" className="mt-1 inline-block text-[12px] underline opacity-80">
              コスト画面で確認
            </Link>
          </div>
        )}
      </section>

      {/* ── ジョブ一覧 ── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="mb-3 text-[15px] font-semibold">定期ジョブ（{health.jobs.length}）</h2>
        {health.jobs.length === 0 ? (
          <p className="text-[12px] text-[var(--faint)]">
            登録ジョブなし。worker は稼働中だが定期ジョブは未登録。
          </p>
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {health.jobs.map((j) => (
              <li key={j.name} className="flex items-center gap-2 text-[13px]">
                <span aria-hidden>
                  {j.lastStatus === "success" ? "🟢" : j.lastStatus === "failed" ? "🔴" : "⏳"}
                </span>
                <span className="font-mono text-[12px]">{j.name}</span>
                <span className="ml-auto text-[12px] text-[var(--faint)]">
                  {jaDateTime(j.lastRunAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 指標の鮮度（詳細）── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="mb-1 text-[15px] font-semibold">指標の鮮度</h2>
        <p className="mb-3 text-[12px] text-[var(--faint)]">
          期待間隔はその指標自身の履歴（中央値）から求める。中央値の3倍を超えたら警告。
          {unused.length > 0 &&
            `　★${unused.length}指標はどの画面からも参照されていない（貯めているだけ）`}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[11px] text-[var(--muted)]">
                <th className="py-1.5 pr-2 font-medium">指標</th>
                <th className="py-1.5 pr-2 text-right font-medium">最終</th>
                <th className="py-1.5 pr-2 text-right font-medium">経過</th>
                <th className="py-1.5 pr-2 text-right font-medium">間隔</th>
                <th className="py-1.5 pr-2 text-right font-medium">行数</th>
                <th className="py-1.5 font-medium">利用</th>
              </tr>
            </thead>
            <tbody>
              {freshness.map((f) => (
                <tr key={f.metric} className="border-b border-[var(--border)]/60">
                  <td className="py-1.5 pr-2 font-mono text-[12px]">
                    <span aria-hidden>
                      {f.alert === "red" ? "🔴" : f.alert === "warn" ? "🟡" : "🟢"}
                    </span>{" "}
                    {f.metric}
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right">{jaDate(f.lastDate)}</td>
                  <td className="tnum py-1.5 pr-2 text-right">{f.ageDays}日</td>
                  <td className="tnum py-1.5 pr-2 text-right text-[var(--faint)]">
                    {f.intervalDays === null ? "—" : `${f.intervalDays}日`}
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right text-[var(--faint)]">{f.rows}</td>
                  <td className="py-1.5 text-[11px]">
                    {f.used ? (
                      <span className="text-[#1a7a2e]">使用中</span>
                    ) : (
                      <span className="text-[var(--faint)]">未使用</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
