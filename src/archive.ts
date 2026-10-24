// Client for movingimagearchive.com. Search/browse/gallery use the site's JSON API;
// source and collection pages have no JSON endpoint, so we read their React Server
// Component (RSC) payload, which carries the same props the page renders.

export const BASE = "https://www.movingimagearchive.com";
const USER_AGENT = "mcp-movingimagearchive/0.1.0 (+https://github.com/JoaquimCassano/mcp-movingimagearchive)";

export const COLORS = ["all", "color", "black_and_white"] as const;
export const ASPECTS = ["all", "4:3", "3:2", "16:9"] as const;
export const SORTS = ["featured", "recent", "alpha"] as const;

interface RawClip {
  id: string;
  sourceSlug: string;
  sourceTitle: string;
  sourceYear: number | null;
  position: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  thumbnailUrl: string;
  colorMode?: string;
  aspectRatio?: string;
  score?: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export const sourcePageUrl = (slug: string) => `${BASE}/sources/${slug}`;
export const collectionPageUrl = (slug: string) => `${BASE}/collection/${slug}`;
export const sourceDownloadUrl = (slug: string) => `${BASE}/api/sources/${slug}/download`;
export const clipDownloadUrl = (id: string) => `${BASE}/api/clips/${id}/download`;

// Accepts a slug or any site URL containing one. Slugs are interpolated into URLs and
// file names, so anything beyond [A-Za-z0-9_-] is rejected.
export function toSlug(s: string, kind: "sources" | "collection") {
  const slug = (new RegExp(`/${kind}/([^/?#]+)`).exec(s)?.[1] ?? s).trim();
  if (!/^[\w-]+$/.test(slug)) throw new Error(`Invalid ${kind === "sources" ? "source" : "collection"} slug: ${JSON.stringify(s)}`);
  return slug;
}

// A shot within its film. Download links are the site's own redirect URLs (same as its Download buttons).
const shapeShot = (c: RawClip) => ({
  id: c.id,
  startSeconds: round(c.startSeconds),
  endSeconds: round(c.endSeconds),
  clipDownloadUrl: clipDownloadUrl(c.id),
});

// A shot on its own (search results, collections): everything needed to preview or download it.
const shapeClip = (c: RawClip) => ({
  ...shapeShot(c),
  sourceSlug: c.sourceSlug,
  sourceTitle: c.sourceTitle,
  year: c.sourceYear,
  durationSeconds: round(c.durationSeconds),
  colorMode: c.colorMode,
  aspectRatio: c.aspectRatio,
  score: c.score, // search only; JSON.stringify drops it when undefined
  pageUrl: `${sourcePageUrl(c.sourceSlug)}?clip=${c.id}`,
  sourceDownloadUrl: sourceDownloadUrl(c.sourceSlug),
  thumbnailUrl: c.thumbnailUrl,
});

export async function request(url: string, init: RequestInit = {}) {
  const signal = init.signal ?? AbortSignal.timeout(30_000);
  const res = await fetch(url, { ...init, signal, headers: { "User-Agent": USER_AGENT, ...init.headers } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} from ${url}${body.startsWith("{") ? `: ${body.slice(0, 300)}` : ""}`);
  }
  return res;
}

const getJson = async (path: string) => (await request(BASE + path)).json();
const postJson = async (path: string, body: unknown) =>
  (await request(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const query = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])));

export interface ClipQuery {
  query?: string;
  color: (typeof COLORS)[number];
  aspectRatio: (typeof ASPECTS)[number];
  yearMin?: number;
  yearMax?: number;
  offset: number;
  limit: number;
}

// With a query: semantic shot search (pages of 24). Without: browse every shot (pages of 100).
// Both accept any offset, so pages are sliced to `limit` to keep responses small.
export async function searchClips({ query: text = "", limit, yearMin, yearMax, ...rest }: ClipQuery) {
  // Like the site's year slider: a bound at its ends (1890/2021) means "no bound", so undated films stay in.
  const filters = { ...rest, yearMin: (yearMin ?? 0) > 1890 ? yearMin : undefined, yearMax: (yearMax ?? 9999) < 2021 ? yearMax : undefined };
  const q = text.trim();
  const data = q ? await postJson("/api/search", { query: q, ...filters }) : await getJson(`/api/clips?${query(filters)}`);
  const clips = (data.clips as RawClip[]).slice(0, limit).map(shapeClip);
  const more = data.hasMore || data.clips.length > limit;
  return { clips, nextOffset: more ? rest.offset + clips.length : null };
}

export async function listSources(params: { sort: (typeof SORTS)[number]; direction: "asc" | "desc"; offset: number; limit: number }) {
  const data = await getJson(`/api/sources?${query(params)}`);
  return {
    totalSources: data.total,
    totalShots: data.totalClips,
    nextOffset: data.hasMore ? params.offset + data.sources.length : null,
    sources: data.sources.map((s: any) => ({
      slug: s.slug,
      title: s.title,
      year: s.year,
      durationSeconds: round(s.durationSeconds),
      shotCount: s.shotCount,
      publishedAt: s.publishedAt,
      pageUrl: sourcePageUrl(s.slug),
      sourceDownloadUrl: sourceDownloadUrl(s.slug),
      thumbnailUrl: s.thumbnailUrl,
    })),
  };
}

// --- RSC payload -----------------------------------------------------------
// Rows look like `<hexId>:<json>\n`, except text rows `<hexId>:T<hexByteLen>,<raw text>` (no newline).
export function parseRsc(payload: string) {
  const buf = Buffer.from(payload, "utf8");
  const rows = new Map<string, unknown>();
  let i = 0;
  while (i < buf.length) {
    const colon = buf.indexOf(0x3a, i); // ':'
    if (colon < 0) break;
    const id = buf.toString("utf8", i, colon);
    if (buf[colon + 1] === 0x54) { // 'T'
      const comma = buf.indexOf(0x2c, colon); // ','
      const len = parseInt(buf.toString("utf8", colon + 2, comma), 16);
      rows.set(id, buf.toString("utf8", comma + 1, comma + 1 + len));
      i = comma + 1 + len;
      continue;
    }
    let nl = buf.indexOf(0x0a, colon);
    if (nl < 0) nl = buf.length;
    try { rows.set(id, JSON.parse(buf.toString("utf8", colon + 1, nl))); } catch { /* module/hint rows aren't JSON */ }
    i = nl + 1;
  }
  return rows;
}

// Pre-order walk over every row (document order); `$<id>` strings that point at text rows are resolved.
export function* walk(rows: Map<string, unknown>): Generator<Record<string, any>> {
  const stack = [...rows.values()].reverse();
  while (stack.length) {
    const v = stack.pop();
    if (Array.isArray(v)) stack.push(...[...v].reverse());
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        const ref = typeof x === "string" && /^\$([0-9a-f]+)$/.exec(x);
        if (ref && typeof rows.get(ref[1]) === "string") (v as any)[k] = rows.get(ref[1]);
      }
      yield v as Record<string, any>;
      stack.push(...Object.values(v).reverse());
    }
  }
}

const pageObjects = async (path: string) => walk(parseRsc(await (await request(BASE + path, { headers: { RSC: "1" } })).text()));
// Unknown slugs still answer 200 (with a not-found page), so "nothing matched" is the 404 signal.
const notFound = (path: string) => new Error(`Nothing found at ${BASE}${path} (wrong slug, or the site layout changed)`);

async function findProps(path: string, match: (o: Record<string, any>) => boolean) {
  for (const o of await pageObjects(path)) if (match(o)) return o;
  throw notFound(path);
}

export async function getSource(slugOrUrl: string, { offset, limit }: { offset: number; limit: number }) {
  const slug = toSlug(slugOrUrl, "sources");
  const props = await findProps(`/sources/${slug}`, (o) => Array.isArray(o.clips) && "sourceUrl" in o);
  const clips = (props.clips as RawClip[]).toSorted((a, b) => a.position - b.position);
  const m = props.metadata ?? {};
  return {
    slug,
    title: props.title as string,
    year: props.year as number | null,
    runningTime: props.runningTime as string,
    synopsis: props.synopsis as string,
    provenance: {
      originalProducer: m.creator,
      collection: m.original_collection,
      date: m.source_date,
      originalLink: m.source_url,
      rights: m.public_domain_status,
    },
    pageUrl: sourcePageUrl(slug),
    sourceDownloadUrl: sourceDownloadUrl(slug),
    shotCount: clips.length,
    nextOffset: offset + limit < clips.length ? offset + limit : null,
    // The site labels shots by display order; `position` has gaps where shots were dropped.
    shots: clips.slice(offset, offset + limit).map((c, i) => ({ shotNumber: offset + i + 1, ...shapeShot(c) })),
  };
}

export async function listCollections() {
  const props = await findProps("/collections", (o) => Array.isArray(o.collections));
  return props.collections.map((c: any) => ({ name: c.name, slug: c.slug, shotCount: c.shotCount, pageUrl: collectionPageUrl(c.slug) }));
}

export async function getCollection(slugOrUrl: string, { offset, limit }: { offset: number; limit: number }) {
  const slug = toSlug(slugOrUrl, "collection");
  const path = `/collection/${slug}`;
  let name = slug;
  const byId = new Map<string, RawClip>();
  for (const o of await pageObjects(path)) {
    if (o.className === "collection__title" && typeof o.children === "string") name = o.children;
    if (o.clip?.id && "startSeconds" in o.clip) byId.set(o.clip.id, o.clip);
  }
  const all = [...byId.values()];
  if (!all.length) throw notFound(path);
  return {
    slug,
    name,
    pageUrl: collectionPageUrl(slug),
    shotCount: all.length,
    filmCount: new Set(all.map((c) => c.sourceSlug)).size,
    totalSeconds: round(all.reduce((s, c) => s + c.durationSeconds, 0)),
    nextOffset: offset + limit < all.length ? offset + limit : null,
    shots: all.slice(offset, offset + limit).map(shapeClip),
  };
}
