import Link from "next/link";
import { getLinkAnalysis, linkTypeLabel, type HubRow } from "@/lib/clusters";

// トピッククラスタ（設計書 §4.2 /clusters・§3.5.2 リンク構造）
// ★ツリー表示はクラスタ割当（P4.5/P4.9）後。今は内部リンク構造の分析を出す。
export const dynamic = "force-dynamic";

export default async function ClustersPage() {
  const { stats, hubs } = await getLinkAnalysis();
  const maxIncoming = hubs[0]?.incoming ?? 1;
  const weakPillars = hubs.filter((h) => h.flag === "weak_pillar");
  const hubCandidates = hubs.filter((h) => h.flag === "hub_candidate");

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">トピッククラスタ</h1>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">
          ★本質は「数」ではなく「リンク構造」（§3.5.2）。内部リンク {stats.totalLinks}本を分析
        </p>
      </div>

      {/* サマリー */}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="記事" value={stats.articles} />
        <Stat label="内部リンク" value={stats.totalLinks} />
        <Stat label="ピラー（宣言）" value={stats.pillars} accent />
        <Stat
          label="孤児記事"
          value={stats.orphans}
          tone={stats.orphans > 0 ? "bad" : "ok"}
          hint={stats.orphans === 0 ? "全記事がリンクを持つ" : "リンクが1本も無い"}
        />
      </div>

      {/* リンク種別 */}
      <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="mb-3 text-[15px] font-semibold">リンク種別の分布</h2>
        <div className="grid gap-2">
          {stats.byType.map((t) => {
            const pct = Math.round((t.count / stats.totalLinks) * 100);
            return (
              <div key={t.type} className="flex items-center gap-3 text-[13px]">
                <span className="w-44 shrink-0 text-[var(--muted)]">{linkTypeLabel(t.type)}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="tnum w-16 text-right text-[var(--muted)]">
                  {t.count}
                  <span className="ml-1 text-[11px] text-[var(--faint)]">{pct}%</span>
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[12px] text-[var(--faint)]">
          クラスター→ピラーが少ないと権威がピラーに集約されない。クラスター↔クラスターが過剰だと権威が横に分散する（§3.5.2）。
        </p>
      </section>

      {/* 構造上の注意 */}
      {(weakPillars.length > 0 || hubCandidates.length > 0) && (
        <section className="mb-4 grid gap-3 sm:grid-cols-2">
          {weakPillars.length > 0 && (
            <Alert
              tone="bad"
              title={`弱いピラー ${weakPillars.length}件`}
              desc="宣言ピラーだが被リンクが中央値未満＝権威が集約されていない（§3.5.2 アンチパターン）"
              items={weakPillars.slice(0, 5)}
            />
          )}
          {hubCandidates.length > 0 && (
            <Alert
              tone="warn"
              title={`実質ハブ（ピラー候補）${hubCandidates.length}件`}
              desc="非ピラーだが被リンクが多い＝リンク構造上の実際の権威。ピラー化を検討"
              items={hubCandidates.slice(0, 5)}
            />
          )}
        </section>
      )}

      {/* ハブランキング */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="mb-1 text-[15px] font-semibold">被リンクランキング（権威の集まり具合）</h2>
        <p className="mb-3 text-[12px] text-[var(--faint)]">
          被リンクが多い記事＝リンク構造上のハブ。宣言ピラーと実態が一致しているかを見る。
        </p>
        <div className="grid gap-1.5">
          {hubs.slice(0, 20).map((h) => (
            <HubBar key={h.id} h={h} max={maxIncoming} />
          ))}
        </div>
      </section>

      <p className="mt-3 text-[12px] text-[var(--faint)]">
        クラスタのツリー表示・市場規模・シェアは、記事のクラスタ割当（P4.5/P4.9）と
        市場データ（P6.8）が入ってから。今は移行済みリンクの構造分析のみ。
      </p>
    </div>
  );
}

function HubBar({ h, max }: { h: HubRow; max: number }) {
  const pct = Math.round((h.incoming / max) * 100);
  return (
    <div className="flex items-center gap-3 text-[13px]">
      <Link
        href={`/content/${h.externalId}`}
        className="w-20 shrink-0 font-mono text-[12px] text-[var(--accent)] hover:underline"
      >
        {h.externalId}
      </Link>
      {h.isPillar ? (
        <span className="w-12 shrink-0 rounded bg-[var(--accent-weak)] px-1 py-0.5 text-center text-[10px] font-medium text-[var(--accent)]">
          ピラー
        </span>
      ) : (
        <span className="w-12 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate text-[var(--muted)]">{h.title}</span>
      <div className="hidden w-40 sm:block">
        <div className="h-2 overflow-hidden rounded-full bg-[var(--panel-2)]">
          <div
            className={`h-full rounded-full ${h.flag === "weak_pillar" ? "bg-[var(--bad)]" : h.flag === "hub_candidate" ? "bg-[var(--warn)]" : "bg-[var(--ink)]"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className="tnum w-20 shrink-0 text-right">
        {h.incoming}
        <span className="text-[var(--faint)]"> ← / {h.outgoing} →</span>
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  tone,
  hint,
}: {
  label: string;
  value: number;
  accent?: boolean;
  tone?: "ok" | "bad";
  hint?: string;
}) {
  const color = accent
    ? "text-[var(--accent)]"
    : tone === "bad"
      ? "text-[var(--bad)]"
      : tone === "ok"
        ? "text-[#1a7a2e]"
        : "";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div className={`tnum mt-1 text-2xl font-bold leading-none ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-[10px] text-[var(--faint)]">{hint}</div>}
    </div>
  );
}

function Alert({
  tone,
  title,
  desc,
  items,
}: {
  tone: "bad" | "warn";
  title: string;
  desc: string;
  items: HubRow[];
}) {
  const border = tone === "bad" ? "border-[var(--bad)]/30" : "border-[var(--warn)]/40";
  const head = tone === "bad" ? "text-[var(--bad)]" : "text-[#9a6a00]";
  return (
    <div className={`rounded-xl border ${border} bg-[var(--panel)] p-4`}>
      <div className={`text-[13px] font-semibold ${head}`}>{title}</div>
      <p className="mt-1 text-[12px] text-[var(--muted)]">{desc}</p>
      <ul className="mt-2 space-y-1">
        {items.map((h) => (
          <li key={h.id} className="flex items-center gap-2 text-[12px]">
            <Link
              href={`/content/${h.externalId}`}
              className="font-mono text-[var(--accent)] hover:underline"
            >
              {h.externalId}
            </Link>
            <span className="truncate text-[var(--muted)]">{h.title}</span>
            <span className="tnum ml-auto shrink-0 text-[var(--faint)]">被{h.incoming}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
