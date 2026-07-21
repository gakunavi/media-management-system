// 投稿キューの補充（設計書 §12.3「AIが判断材料を完成させ、押すのは人」）
//
// ★なぜ要るか
//   2026-07-19 に投稿キューの在庫が尽きて配信が止まった。気づいたのは3日後。
//   一方でシートには **一度も投稿されていない本文が101件** 眠っていた。
//   書くものが無いのではなく、書いたものが承認導線を持たないまま
//   status=skip で止まっていただけだった。
//
// ★本文の自動生成はしない（YMYL）。
//   ここが扱うのは「既に人が書いた原稿を、公開待ち行列に載せるかどうか」だけ。
//   判断材料（YMYL判定・文字数・過去の同フォーマット実績）を揃えて出し、
//   押すのは石井さん。
//
// ★status=skip を勝手に pending へ戻さない理由
//   skip を書くコードは現行の GAS に存在せず、人が手で打った可能性が残る。
//   「没にした原稿が本人の知らないうちに公開される」のは取り返しがつかない。
//   だから一覧に出して1件ずつ（またはまとめて）承認してもらう。

import { checkYmyl, type YmylCheck } from "@/lib/ymyl";

/** GAS の1行 */
export type QueueRow = {
  rowIndex: number;
  id: string;
  scheduledAt: string;
  text: string;
  target: string;
  coreMessage: string;
  articleLink: string;
  status: string;
  notes: string;
};

export type DraftCandidate = QueueRow & {
  ymyl: YmylCheck;
  /** notes 先頭のフォーマット名（例: "早口 / 第2バッチ-Phase2" → "早口"） */
  format: string | null;
};

export type QueueOverview = {
  /** 取得できなかったときは null。0（本当に空）と区別する（§3） */
  pending: number | null;
  posted: number | null;
  candidates: DraftCandidate[];
  /** GAS に届かなかったときの理由。null なら正常 */
  error: string | null;
};

/** 実績の投稿時間帯（07〜22時に毎時1本。posted 579件の分布から） */
const SLOT_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

function gasConfig(): { url: string; key: string } | null {
  const url = (process.env.MMS_THREADS_GAS_URL ?? "").trim();
  const key = (process.env.MMS_THREADS_GAS_KEY ?? "").trim();
  return url && key ? { url, key } : null;
}

async function gasGet(action: string, params: Record<string, string> = {}) {
  const cfg = gasConfig();
  if (!cfg) throw new Error("MMS_THREADS_GAS_URL / MMS_THREADS_GAS_KEY が未設定です");
  const q = new URLSearchParams({ action, key: cfg.key, ...params });
  const res = await fetch(`${cfg.url}?${q}`, { cache: "no-store" });
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch {
    // API_KEY 不一致やデプロイのアクセス設定ミスだと HTML のログイン画面が返る
    throw new Error(`GAS の応答が JSON ではありません: ${raw.slice(0, 160)}`);
  }
}

async function gasPost(body: Record<string, unknown>) {
  const cfg = gasConfig();
  if (!cfg) throw new Error("MMS_THREADS_GAS_URL / MMS_THREADS_GAS_KEY が未設定です");
  const res = await fetch(`${cfg.url}?key=${encodeURIComponent(cfg.key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`GAS の応答が JSON ではありません: ${raw.slice(0, 160)}`);
  }
  const p = parsed as { error?: string };
  if (p?.error) throw new Error(`GAS: ${p.error}`);
  return parsed;
}

function toRow(r: Record<string, unknown>): QueueRow {
  const s = (k: string) => String(r[k] ?? "").trim();
  return {
    rowIndex: Number(r.row_index ?? 0),
    id: s("id"),
    scheduledAt: s("scheduled_at"),
    text: String(r.text ?? ""),
    target: s("target"),
    coreMessage: s("core_message"),
    articleLink: s("article_link"),
    status: s("status").toLowerCase(),
    notes: s("notes"),
  };
}

/** notes は「早口 / 第2バッチ-Phase2」の形。先頭がフォーマット名 */
function formatFromNotes(notes: string): string | null {
  const head = notes.split("/")[0]?.trim();
  return head && !/^第\d+バッチ/.test(head) ? head : null;
}

const normalize = (t: string) => t.replace(/\s+/g, "");

/**
 * 補充候補を集める。
 *
 * 条件は「本文があり、まだ一度も投稿されていない」こと。
 * 本文が posted 行と一致する行は**除外する**。シートには
 * dup auto-skip で落ちた重複が71件あり、これを候補に混ぜると
 * 同じ投稿が二度出る。
 */
export async function getQueueOverview(): Promise<QueueOverview> {
  let stats: { pending?: unknown; posted?: unknown } = {};
  let rows: QueueRow[] = [];
  try {
    const [s, list] = await Promise.all([gasGet("stats"), gasGet("list", { limit: "2000" })]);
    stats = s ?? {};
    const arr = Array.isArray(list?.posts) ? list.posts : [];
    rows = arr.map(toRow);
  } catch (e) {
    return {
      pending: null,
      posted: null,
      candidates: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const publishedTexts = new Set(
    rows.filter((r) => r.status === "posted" && r.text).map((r) => normalize(r.text)),
  );

  const seen = new Set<string>();
  const candidates: DraftCandidate[] = [];
  for (const r of rows) {
    // pending / posted / error は候補ではない（error は本文を直す対象）
    if (r.status !== "skip" && r.status !== "skipped") continue;
    const t = normalize(r.text);
    if (!t || publishedTexts.has(t) || seen.has(t)) continue;
    seen.add(t);
    candidates.push({ ...r, ymyl: checkYmyl(r.text), format: formatFromNotes(r.notes) });
  }

  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { pending: n(stats.pending), posted: n(stats.posted), candidates, error: null };
}

/**
 * 空いている投稿枠を必要数だけ作る。
 *
 * ★過去の時刻は割り当てない。過去日時を入れると、トリガーが
 *   「遅れた投稿」として一気に吐き出すか、skip されて静かに消える。
 * ★既に pending が使っている枠は避ける。
 */
export function nextSlots(count: number, taken: Set<string>, now = new Date()): string[] {
  const out: string[] = [];
  // JST の「今」
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const cursor = new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 0, 0, 0),
  );
  const nowKey = jst.toISOString().slice(0, 13);

  // 最大60日先まで探す（無限ループ防止）
  for (let day = 0; day < 60 && out.length < count; day++) {
    const d = new Date(cursor.getTime() + day * 86400000);
    const ymd = d.toISOString().slice(0, 10);
    for (const h of SLOT_HOURS) {
      if (out.length >= count) break;
      const hh = String(h).padStart(2, "0");
      const key = `${ymd}T${hh}`;
      if (key <= nowKey) continue; // 過去・現在の枠は使わない
      const label = `${ymd} ${hh}:00:00`;
      if (taken.has(label)) continue;
      out.push(label);
    }
  }
  return out;
}

/** 承認: skip の行を pending に戻し、未来の枠を割り当てる */
export async function approveDrafts(rowIndexes: number[]): Promise<{ approved: number }> {
  if (rowIndexes.length === 0) return { approved: 0 };

  // 既に埋まっている枠を集める（pending だけでなく posted も避ける）
  const list = await gasGet("list", { limit: "2000" });
  const rows: QueueRow[] = (Array.isArray(list?.posts) ? list.posts : []).map(toRow);
  const taken = new Set(
    rows.filter((r) => r.status === "pending" || r.status === "posted").map((r) => r.scheduledAt),
  );
  const byIndex = new Map(rows.map((r) => [r.rowIndex, r]));

  const slots = nextSlots(rowIndexes.length, taken);
  if (slots.length < rowIndexes.length) {
    throw new Error("空き枠を確保できませんでした（60日先まで埋まっています）");
  }

  let approved = 0;
  for (let i = 0; i < rowIndexes.length; i++) {
    const row = byIndex.get(rowIndexes[i]);
    if (!row) continue;
    // ★承認直前にもう一度 YMYL を見る。一覧表示から時間が経って
    //   本文がシート上で編集されている可能性がある
    const check = checkYmyl(row.text);
    if (!check.ok) {
      throw new Error(
        `行${rowIndexes[i]}は投稿できません（${[...check.violations, check.tooLong ? "文字数超過" : ""].filter(Boolean).join("・")}）`,
      );
    }
    await gasPost({
      action: "update",
      row_index: rowIndexes[i],
      fields: { status: "pending", scheduled_at: slots[i] },
    });
    approved += 1;
  }
  return { approved };
}

/**
 * 却下: 理由を必ず残す（§5.6 却下理由は学習データになる）。
 *
 * status には rejected を入れる。skip のまま放置すると、
 * 次回また候補として出てきて同じ判断を繰り返すことになる。
 */
export async function rejectDraft(rowIndex: number, reason: string): Promise<void> {
  const r = reason.trim();
  if (!r) throw new Error("却下理由は必須です（次の立案の材料になります）");
  await gasPost({
    action: "update",
    row_index: rowIndex,
    fields: {
      status: "rejected",
      notes: `却下 ${new Date().toISOString().slice(0, 10)}: ${r}`,
    },
  });
}
