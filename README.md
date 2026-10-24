# mcp-movingimagearchive

MCP server for [Moving Image Archive](https://www.movingimagearchive.com): a searchable library of shots cut from public-domain archival films, all free to reuse. Built with the blessing of its creator, [Cova](https://x.com/covacut).

## Tools

| Tool | What it does | Site equivalent |
|---|---|---|
| `search_clips` | Semantic shot search by visual description, with color / aspect ratio / year filters. Empty query browses every shot. | Search box + Filter |
| `list_sources` | All source films, sorted featured / recent / A–Z, plus archive totals | Gallery |
| `get_source` | One film: synopsis, provenance & rights, full-film URL, shot list with per-shot URLs | `/sources/<slug>` |
| `list_collections` | Curated themed collections | Collections |
| `get_collection` | Shots in one collection | `/collection/<slug>` |
| `download` | Save a single shot, the full film, or a shot/time range (trimmed with ffmpeg) to a local MP4. Defaults to `~/Downloads`, never overwrites, cancellable | Download buttons, shift-click range download |

Every shot result includes `clipDownloadUrl` (the shot MP4) and `sourceDownloadUrl` (the full film).

## Setup

Requires Node ≥ 22.18. `ffmpeg` on PATH is only needed for range downloads.

```bash
git clone https://github.com/JoaquimCassano/mcp-movingimagearchive.git
cd mcp-movingimagearchive
pnpm install && pnpm build
```

Claude Code:

```bash
claude mcp add --scope user movingimagearchive -- node /absolute/path/to/mcp-movingimagearchive/dist/index.js
```

Claude Desktop / other clients:

```json
{
  "mcpServers": {
    "movingimagearchive": { "command": "node", "args": ["/absolute/path/to/mcp-movingimagearchive/dist/index.js"] }
  }
}
```

## How it talks to the site

- `POST /api/search` `{query, color, aspectRatio, yearMin?, yearMax?, offset}` — shot search (24/page)
- `GET /api/clips?color&aspectRatio&offset&yearMin&yearMax` — browse shots (100/page)
- `GET /api/sources?sort&direction&offset&limit` — gallery (max 100/page)
- `GET /api/clips/<id>/download`, `GET /api/sources/<slug>/download` — redirects to the MP4
- Source and collection pages have no JSON endpoint; their data is read from the Next.js RSC payload (`RSC: 1` header). If the site's markup changes, `get_source` / `get_collection` / `list_collections` are the tools that may break.

Range downloads replicate the site's shift-click feature: the site trims the full film in the browser between the first shot's start and the last shot's end; here ffmpeg does the same, using HTTP range requests so only that part of the film is fetched (a 300 MB excerpt of a 10 GB film needs ~300 MB of disk, not 10 GB).

```bash
pnpm test   # offline parser checks
```

The site's Feedback form is intentionally not exposed: its endpoint only accepts submissions from the website itself.
