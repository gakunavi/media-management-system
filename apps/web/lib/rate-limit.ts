// /api/ingest のレート制限（設計書 §3.10.4 / docs/RULES.md §1.1）
//
//   「/api/ingest 側にレート制限（同一セッションから毎分N件超は429）を置き、
//     サーバー側でも暴走を止める（二重の歯止め）」
//
// 過去の事故（TTFBスパイク）で本当に問題だったのは「何千回発火しても
// 誰も気づかなかったこと」。JS 側の自己遮断（§3.10.3-⑦）だけに頼らず、
// サーバー側にも歯止めを置く。
//
// ★P2 時点では単一プロセスなのでインメモリで足りる。
//   将来 web を複数プロセスにするなら Postgres か Redis に移す。

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

/** 古いバケットを掃除する（メモリを無限に太らせない） */
function sweep(now: number): void {
  if (buckets.size < 5_000) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * @param key   識別子（sessionId があればそれ、無ければ IP）
 * @param limit 1分あたりの上限
 */
export function rateLimit(key: string, limit: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }
  return {
    allowed: true,
    remaining: limit - bucket.count,
    retryAfterSeconds: 0,
  };
}

/** テスト用 */
export function resetRateLimits(): void {
  buckets.clear();
}
