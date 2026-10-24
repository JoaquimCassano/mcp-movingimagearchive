#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { ASPECTS, BASE, COLORS, SORTS, getCollection, getSource, listCollections, listSources, searchClips } from "./archive.ts";
import { DEFAULT_DIR, download } from "./download.ts";

const server = new McpServer(
  { name: "movingimagearchive", version: "0.1.0" },
  {
    instructions: `Moving Image Archive (${BASE}) is a searchable library of shots cut from public-domain archival films (Internet Archive, National Archives, Prelinger, etc.); list_sources returns live totals. All material is free to reuse.
A "source" is a whole film; a "shot"/"clip" is one cut within it. Every shot has its own MP4 (clipDownloadUrl) and the full film is at sourceDownloadUrl.
Typical flow: search_clips (describe the footage visually) → get_source for context/provenance and neighbouring shots → download (single shot, full film, or a time/shot range trimmed locally with ffmpeg).
Credit the original producer listed in get_source's provenance when reusing footage.`,
  },
);

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const readOnly = { readOnlyHint: true, openWorldHint: true };
const offset = z.number().int().min(0).default(0);

server.registerTool(
  "search_clips",
  {
    title: "Search shots",
    description:
      "Search the archive for individual shots by a visual description (semantic/CLIP search, e.g. 'red sunset over water', 'crowd at a 1930s world fair'). " +
      "Leave `query` empty to browse all shots in archive order. Returns shot timing, source film and direct MP4 links for the shot and the full film. " +
      "Pass `nextOffset` back as `offset` for more.",
    inputSchema: z.object({
      query: z.string().optional().describe("What the footage should show. Empty = browse."),
      color: z.enum(COLORS).default("all"),
      aspectRatio: z.enum(ASPECTS).default("all"),
      yearMin: z.number().int().min(1890).max(2030).optional().describe("Earliest film year. Any year bound excludes undated films, except 1890 (min) / 2021+ (max) which mean no bound, as on the site."),
      yearMax: z.number().int().min(1890).max(2030).optional().describe("Latest film year"),
      offset,
      limit: z.number().int().min(1).max(50).default(24),
    }),
    annotations: readOnly,
  },
  async (args) => json(await searchClips(args)),
);

server.registerTool(
  "list_sources",
  {
    title: "List films (gallery)",
    description:
      "List the source films in the archive (the site's Gallery), with archive totals. Each film has a slug for get_source and a full-film download link.",
    inputSchema: z.object({
      sort: z.enum(SORTS).default("featured").describe("featured = curated order, recent = recently added, alpha = by title (direction asc = A–Z)"),
      direction: z.enum(["asc", "desc"]).default("desc"),
      offset,
      limit: z.number().int().min(1).max(50).default(25),
    }),
    annotations: readOnly,
  },
  async (args) => json(await listSources(args)),
);

server.registerTool(
  "get_source",
  {
    title: "Get film details",
    description:
      "Get one source film: title, year, running time, synopsis, provenance & rights (original producer, collection, original Internet Archive link), " +
      "full-film download URL and its shot list with per-shot download URLs.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Source slug (e.g. 'space-shuttle-a-remarkable-flying-machine-b801653d') or a /sources/ page URL"),
      offset,
      limit: z.number().int().min(0).max(100).default(50).describe("Max shots to list (0 = metadata only)"),
    }),
    annotations: readOnly,
  },
  async ({ slug, ...page }) => json(await getSource(slug, page)),
);

server.registerTool(
  "list_collections",
  {
    title: "List collections",
    description: "List the archive's curated, themed collections of shots (e.g. Cats, Film Countdowns, Space Flight) with their slugs and shot counts.",
    inputSchema: z.object({}),
    annotations: readOnly,
  },
  async () => json(await listCollections()),
);

server.registerTool(
  "get_collection",
  {
    title: "Get collection",
    description: "Get the shots in one curated collection, with timing, source film and download links.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Collection slug from list_collections (e.g. 'cats') or a /collection/ page URL"),
      offset,
      limit: z.number().int().min(1).max(50).default(24),
    }),
    annotations: readOnly,
  },
  async ({ slug, ...page }) => json(await getCollection(slug, page)),
);

server.registerTool(
  "download",
  {
    title: "Download footage",
    description:
      "Save footage to a local MP4 (never overwrites an existing file). Pass exactly one of `clipId` (a single shot) or `sourceSlug` (the full film). " +
      "To get only part of it, add `startSeconds` and/or `endSeconds` (relative to that shot or film), or, with `sourceSlug`, `fromShot`/`toShot` " +
      "(1-based, inclusive, like shift-click on the site). Ranges need ffmpeg on PATH; only that part is fetched and it is re-encoded for frame-accurate cuts. " +
      "If you only need a link, use the URLs returned by the other tools instead.",
    inputSchema: z.object({
      clipId: z.string().optional(),
      sourceSlug: z.string().optional().describe("Source slug or /sources/ URL"),
      fromShot: z.number().int().min(1).optional(),
      toShot: z.number().int().min(1).optional(),
      startSeconds: z.number().min(0).optional(),
      endSeconds: z.number().min(0).optional(),
      outputPath: z.string().optional().describe(`Directory, or file path ending in an extension like .mp4 (default: ${DEFAULT_DIR})`),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async (args, ctx) => json(await download(args, ctx.mcpReq.signal)),
);

await server.connect(new StdioServerTransport());
