// 記事内リンクのクリック（FunnelEvent.step = link_click）
//
// ★なぜ要るか（2026-07-23）
//   記事の目的は「メディア→受け皿→問い合わせ」の送客だが、
//   その途中の**どのリンクが踏まれたか**をどこにも持っていなかった。
//     ・リダイレクタ /r/{dest}/{source} の送り元は設置場所IDだけで、記事を持たない
//       → 「記事からの送客」は出せるが「どの記事から」は出せない
//     ・計測タグは data-mms を貼った要素しか見ていなかった
//       → 記事159本のどこにも data-mms が無く、実測は1件（lp_scroll）だけだった
//   計測タグ側で a[href] を自動で拾うようにしたので、ここで読む。
//
// ★未計測（データが来ていない）と実測ゼロ（誰も踏んでいない）を混同しない（§3）。
//   link_click は MeasurementCoverage に行が入って初めて「計測中」になる。
import { prisma } from "@mms/db";
import type { Range } from "./period";
import { decodeEntities } from "./content";

export const LINK_KIND_LABEL: Record<string, string> = {
  redirect: "送客リンク",
  outbound: "外部サイト",
  internal: "サイト内回遊",
  anchor: "ページ内",
  tel: "電話",
  mail: "メール",
};

export const LINK_AREA_LABEL: Record<string, string> = {
  body: "本文",
  footer: "フッタ",
  header: "ヘッダ",
  nav: "ナビ",
  sidebar: "サイドバー",
  unknown: "不明",
};

export type LinkRow = {
  href: string;
  text: string;
  kind: string;
  area: string;
  clicks: number;
  /** 何本の記事から踏まれたか。1本だけなら記事固有のリンク */
  articles: number;
};

export type ArticleLinkRow = {
  externalId: string;
  title: string;
  clicks: number;
  /** 送客（redirect）だけの数。ここが記事の成果に一番近い */
  outbound: number;
};

export type LinkClickSummary = {
  /** 計測が始まっているか。false のときは 0 を「実測ゼロ」と読んではいけない */
  measured: boolean;
  startedAt: Date | null;
  total: number;
  byKind: { kind: string; label: string; clicks: number }[];
  byArea: { area: string; label: string; clicks: number }[];
  links: LinkRow[];
  articles: ArticleLinkRow[];
};

const str = (v: unknown, fallback: string) => (typeof v === "string" && v ? v : fallback);

export async function getLinkClicks(range: Range): Promise<LinkClickSummary> {
  const [coverage, events] = await Promise.all([
    prisma.measurementCoverage.findFirst({
      where: { metric: "link_click" },
      select: { startedAt: true },
    }),
    prisma.funnelEvent.findMany({
      where: {
        step: "link_click",
        occurredAt: { gte: range.since, lt: range.until },
      },
      select: {
        meta: true,
        contentItem: { select: { externalId: true, title: true } },
      },
    }),
  ]);

  const kindMap = new Map<string, number>();
  const areaMap = new Map<string, number>();
  const linkMap = new Map<string, LinkRow & { _articles: Set<string> }>();
  const artMap = new Map<string, ArticleLinkRow>();

  for (const e of events) {
    const m = (e.meta ?? {}) as Record<string, unknown>;
    const kind = str(m.kind, "outbound");
    const area = str(m.area, "unknown");
    const href = str(m.href, "(不明)");
    const text = str(m.text, "");

    kindMap.set(kind, (kindMap.get(kind) ?? 0) + 1);
    areaMap.set(area, (areaMap.get(area) ?? 0) + 1);

    // ★同じ href でも設置場所が違えば別の打ち手。area まで含めて1行にする
    const key = `${href} ${area}`;
    const cur = linkMap.get(key);
    if (cur) {
      cur.clicks += 1;
      // 文言は最初に見たものを採る（同じリンクでも記事ごとに文言が違うことがある）
      if (!cur.text && text) cur.text = text;
    } else {
      linkMap.set(key, {
        href,
        text,
        kind,
        area,
        clicks: 1,
        articles: 0,
        _articles: new Set(),
      });
    }
    const ext = e.contentItem?.externalId;
    if (ext) {
      linkMap.get(key)!._articles.add(ext);
      const a = artMap.get(ext);
      if (a) {
        a.clicks += 1;
        if (kind === "redirect") a.outbound += 1;
      } else {
        artMap.set(ext, {
          externalId: ext,
          title: decodeEntities(e.contentItem?.title ?? ext),
          clicks: 1,
          outbound: kind === "redirect" ? 1 : 0,
        });
      }
    }
  }

  const links = [...linkMap.values()]
    .map(({ _articles, ...r }) => ({ ...r, articles: _articles.size }))
    .sort((a, b) => b.clicks - a.clicks);

  return {
    measured: coverage !== null,
    startedAt: coverage?.startedAt ?? null,
    total: events.length,
    byKind: [...kindMap.entries()]
      .map(([kind, clicks]) => ({ kind, label: LINK_KIND_LABEL[kind] ?? kind, clicks }))
      .sort((a, b) => b.clicks - a.clicks),
    byArea: [...areaMap.entries()]
      .map(([area, clicks]) => ({ area, label: LINK_AREA_LABEL[area] ?? area, clicks }))
      .sort((a, b) => b.clicks - a.clicks),
    links,
    articles: [...artMap.values()].sort((a, b) => b.outbound - a.outbound || b.clicks - a.clicks),
  };
}
