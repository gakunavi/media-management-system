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
import type { CostSummary } from "@/lib/tools";
import type { UptimeSummary } from "@/lib/uptime";
import {
  type TelemetryHealth,
  EVENTS_PER_SESSION_WARN,
  EVENTS_PER_SESSION_BAD,
} from "@/lib/telemetry-volume";
import { resumeTracking } from "@/app/(app)/tracking-actions";
import { type IncidentSummary, severityLabel, categoryLabel } from "@/lib/incidents";
import { NOT_MEASURED } from "@mms/shared";

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

/**
 * コスト。
 *
 * ★なぜダッシュボードに出すか（2026-07-24 石井さん指摘）
 *   /costs を開かないと見えなかった。開かなければ気づかないので、
 *   「ツールは足すのは簡単で止めるのは忘れる」が起きる。
 *
 * ★1件あたりの獲得コストは出さない。ツール費 ÷ 問い合わせ件数 は
 *   **人件費と外注費を含まない**ので、獲得単価と読むと桁が2つ違う判断になる。
 *   出すのは「いくら払っているか」「増えていないか」「止まりそうか」の3つ。
 */
function CostPanel({ cost }: { cost: CostSummary }) {
  const diff = cost.prevMonthYen === null ? null : cost.monthlyYen - cost.prevMonthYen;
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="mb-3 flex items-baseline gap-2.5">
        <h2 className="text-[15px] font-semibold">コスト</h2>
        <Link href="/costs" className="ml-auto text-[12px] text-[var(--accent)] hover:underline">
          コスト画面 →
        </Link>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] px-3 py-2.5">
          <div className="text-[11px] text-[var(--muted)]">今月のメディア費用</div>
          <div className="tnum mt-0.5 text-xl font-bold leading-none">
            ¥{(cost.monthlyYen + cost.variableYen).toLocaleString("ja-JP")}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--muted)]">
            固定 ¥{cost.monthlyYen.toLocaleString("ja-JP")} ＋ 使った分 ¥
            {cost.variableYen.toLocaleString("ja-JP")}
          </div>
          <div className="mt-1 text-[10px] text-[var(--faint)]">
            {diff === null ? (
              <>前月は{NOT_MEASURED}（記録開始前）</>
            ) : diff === 0 ? (
              "前月から変化なし"
            ) : (
              <span className={diff > 0 ? "text-[var(--warn)]" : "text-[#1a7a2e]"}>
                前月比 {diff > 0 ? "+" : ""}
                {diff.toLocaleString("ja-JP")}円
              </span>
            )}
            ・自社既存（会社が元々払っているもの）は含まない
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] px-3 py-2.5">
          <div className="text-[11px] text-[var(--muted)]">検討中を全部入れると</div>
          <div className="tnum mt-0.5 text-xl font-bold leading-none">
            ¥{cost.potentialYen.toLocaleString("ja-JP")}
          </div>
          <div className="mt-1 text-[10px] text-[var(--faint)]">
            使用中 {cost.toolCount}件
            {cost.potentialYen > cost.monthlyYen && "・検討中を契約した場合の見込み"}
          </div>
        </div>

        <div
          className={`rounded-lg border px-3 py-2.5 ${
            cost.noDueDateCount > 0
              ? "border-[var(--warn)]/40 bg-[var(--warn)]/[0.08]"
              : "border-[var(--border)]"
          }`}
        >
          <div className="text-[11px] text-[var(--muted)]">見直し予定日</div>
          <div className="tnum mt-0.5 text-xl font-bold leading-none">
            {cost.noDueDateCount > 0 ? `未設定 ${cost.noDueDateCount}件` : "設定済み"}
          </div>
          <div className="mt-1 text-[10px] text-[var(--faint)]">
            {cost.noDueDateCount > 0
              ? "★続けるか止めるかを決める日が未定＝止めどきを判断できない"
              : "期日に判定する"}
          </div>
        </div>
      </div>

      {cost.runningOut.length > 0 && (
        <div className="mt-2 rounded-lg border border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] px-3 py-2.5 text-[13px] text-[var(--bad)]">
          {cost.runningOut.map((t) => (
            <div key={t.name}>
              {t.name}: 残高 {t.balance}
              {t.currency} — 次回の実行分に足りません
              {t.jobs.length > 0 && `（${t.jobs.join(" / ")} が途中で止まります）`}
            </div>
          ))}
        </div>
      )}

      <p className="mt-2 text-[11px] text-[var(--faint)]">
        ★<strong>1件あたりの獲得コストは出しません</strong>。ツール費だけでは
        人件費・外注費が抜けており、獲得単価として読むと判断を誤ります。
      </p>
    </section>
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
  cost,
  uptime,
  incidents,
  telemetry,
}: {
  health: JobHealth;
  freshness: MetricFreshness[];
  cost: CostSummary;
  uptime: UptimeSummary[];
  incidents: IncidentSummary;
  telemetry: TelemetryHealth;
}) {
  const stale = freshness.filter((f) => f.alert !== "ok");
  const unused = freshness.filter((f) => !f.used);

  return (
    <section className="grid gap-4">
      <CostPanel cost={cost} />

      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-3 flex items-baseline gap-2.5">
          <span className="inline-flex h-5 items-center rounded-md bg-[var(--ink)] px-1.5 text-[11px] font-semibold text-white">
            段7
          </span>
          <h2 className="text-[15px] font-semibold">止まっていないか</h2>
          <Link href="/jobs" className="ml-auto text-[12px] text-[var(--accent)] hover:underline">
            自動処理 →
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

      {/* ── 計測タグの発火（P2.11）──
          ★過去の TTFB スパイク事故で本当に問題だったのは遅さではなく、
            何千回発火しても誰も気づかなかったこと。ここが「気づく」側。 */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-1 flex items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold">計測タグの発火</h2>
          <span className="text-[12px] text-[var(--faint)]">
            1人あたり {EVENTS_PER_SESSION_WARN}件で黄 ／ {EVENTS_PER_SESSION_BAD}件で赤
          </span>
        </div>
        <Box alert={telemetry.alert} title="直近24時間">
          {telemetry.reason}
          <div className="mt-1 text-[12px] text-[var(--faint)]">
            {telemetry.sessions24h}人 ・ {telemetry.events24h}件
            {telemetry.dayOverDay !== null && ` ・ 前日比 ${telemetry.dayOverDay.toFixed(1)}倍`}
            {telemetry.duplicateRatio !== null &&
              ` ・ 重複 ${(telemetry.duplicateRatio * 100).toFixed(0)}%`}
          </div>
        </Box>
        {telemetry.disabledAt && (
          // ★止める導線だけ作って戻す導線を作らないと、止めたまま誰も戻せなくなる。
          //   止めている間は記事の行動が一切残らない。
          <form action={resumeTracking} className="mt-2">
            <button
              type="submit"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[13px] font-medium hover:bg-[var(--border)]"
            >
              計測の受信を再開する
            </button>
          </form>
        )}
      </section>

      {/* ── サイトが生きているか（P3.9）──
          ★ジョブが全部緑でも、サイトや問い合わせの受口が落ちていれば獲得は止まる。
            しかも問い合わせが来ないだけなので、誰も気づかないまま何日も過ぎる。 */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-1 flex items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold">サイトが開けるか</h2>
          <span className="text-[12px] text-[var(--faint)]">
            5分ごとに確認 ／ 15分続けて落ちたら通知
          </span>
        </div>
        {uptime.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">監視対象がありません</p>
        ) : (
          <>
            {/* ★異常の件数だけを出さない。動いている数を必ず並べる（§4-53） */}
            <p className="mb-2 text-[12px] text-[var(--faint)]">
              {uptime.filter((u) => u.ok === true).length} / {uptime.length} が応答しています
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-left text-[11px] text-[var(--faint)]">
                  <tr>
                    <th className="py-1 pr-2 font-medium">対象</th>
                    <th className="py-1 pr-2 text-right font-medium">状態</th>
                    <th className="py-1 pr-2 text-right font-medium">応答</th>
                    <th className="py-1 pr-2 text-right font-medium">24時間の稼働率</th>
                    <th className="py-1 text-right font-medium">最終確認</th>
                  </tr>
                </thead>
                <tbody>
                  {uptime.map((u) => (
                    <tr key={u.key} className="border-t border-[var(--border)]">
                      <td className="py-1.5 pr-2">{u.label}</td>
                      <td className="py-1.5 pr-2 text-right">
                        {u.ok === null ? (
                          <span className="text-[var(--warn)]">{NOT_MEASURED}</span>
                        ) : u.ok ? (
                          <span className="text-[#1a7a2e]">開ける</span>
                        ) : (
                          <span className="font-semibold text-[var(--bad)]">開けない</span>
                        )}
                      </td>
                      <td className="tnum py-1.5 pr-2 text-right text-[var(--faint)]">
                        {u.responseMs === null ? "—" : `${u.responseMs}ms`}
                      </td>
                      <td className="tnum py-1.5 pr-2 text-right">
                        {/* ★記録が無いときは 0% ではなく「—(未計測)」（§2-1） */}
                        {u.uptime24h === null ? (
                          <span className="text-[var(--warn)]">{NOT_MEASURED}</span>
                        ) : (
                          `${u.uptime24h.toFixed(1)}%`
                        )}
                      </td>
                      <td className="tnum py-1.5 text-right text-[var(--faint)]">
                        {jaDateTime(u.checkedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ── 過去の事故と再発防止（P3.10）──
          ★見るべきは件数ではなく「対策が入っているか」。
            done でない対策が残っている＝同じ事故がもう一度起きうる。 */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-1 flex items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold">過去の事故と再発防止</h2>
          <span className="text-[12px] text-[var(--faint)]">{incidents.total}件を記録</span>
        </div>
        <p className="mb-3 text-[12px] text-[var(--muted)]">
          {incidents.pendingActions === 0 ? (
            "再発防止策はすべて実装済みです。"
          ) : (
            <>
              <strong className="text-[var(--warn)]">
                まだ入っていない再発防止策が {incidents.pendingActions} 件
              </strong>
              （{incidents.withPending}件の事故）。入るまでは同じことが起こりえます。
            </>
          )}
        </p>
        <div className="grid gap-2">
          {incidents.rows.map((r) => (
            <details key={r.id} className="rounded-lg border border-[var(--border)] p-3">
              <summary className="cursor-pointer text-[13px]">
                <span
                  className={
                    r.pending > 0
                      ? "mr-2 rounded bg-[var(--warn)] px-1.5 py-0.5 text-[11px] font-semibold text-white"
                      : "mr-2 rounded bg-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]"
                  }
                >
                  {r.pending > 0 ? `対策 未${r.pending}件` : "対策済み"}
                </span>
                <span className="font-medium">{r.title}</span>
                <span className="ml-2 text-[11px] text-[var(--faint)]">
                  {jaDate(r.occurredAt)} ・ {severityLabel(r.severity)} ・ {categoryLabel(r.category)}
                </span>
              </summary>
              <ul className="mt-2 grid gap-1 text-[12px]">
                {r.actions.map((a, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={a.done ? "text-[#1a7a2e]" : "text-[var(--warn)]"}>
                      {a.done ? "✓" : "未"}
                    </span>
                    <span>
                      {a.action}
                      {a.ref && <span className="ml-1 text-[var(--faint)]">（{a.ref}）</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </section>
    </section>
  );
}
