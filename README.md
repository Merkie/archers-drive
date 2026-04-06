# archers-drive

An open, AI-friendly file storage service. Think Google Drive, but built from day one for AI agents to read and write your files via a clean HTTP API (and, eventually, MCP).

The pitch in one line: **upload your files, get an API key, hand it to your agent.**

---

## Why does this exist?

Most consumer file-storage services are walled gardens. Their APIs are gated behind OAuth dances, app-review processes, and token costs that make casual agent use painful.

archers-drive flips this on its head:

- **Free, generous API tokens** issued directly by the user, in seconds, from a settings page.
- **A small, predictable HTTP API** that an agent can drive without an SDK.
- **Path-based addressing** (`/users/path/to/file.ext`) that mirrors how a human and an LLM both think about a filesystem.
- **Built-in conversion** so an agent that only speaks text can still meaningfully read a `.docx` or `.xlsx`.
- **Granular keys** with read-only and read-write scopes, so you can hand a key to a third-party agent without giving up the farm.

The trust model is explicit: users issue keys, users revoke keys, users own their data. No surprises.

---

## MVP scope (this prototype)

The first pass ships the smallest thing that is genuinely useful end-to-end:

1. **Auth** — email + password, sessions via httpOnly cookie. Argon2-hashed passwords. Zod-validated input.
2. **File browser (web UI)** — log in, see your files and folders, upload, create folders, delete, rename, move.
3. **Storage** — files live in Cloudflare R2. Folder/file relationships live in SQLite. Public URLs are security-through-obscurity (`https://archers-cdn.com/{cuid}/{filename}`) so no directory walking is possible.
4. **API keys** — issue, list, and revoke keys. Two scopes for now:
   - `read` — *Allows read-only access. This key cannot be used to modify or delete files in your drive.*
   - `write` — *Allows reading, writing, and modifying files in your drive.*
5. **Public HTTP API** — drive your drive from anywhere with a key. Path-based access. Includes on-demand conversion to `text` or `pdf` for the file types where that makes sense, so an agent can read a spreadsheet as CSV or a deck as plain text without doing the conversion itself.

That's it for v1. Everything else is on the roadmap.

---

## Roadmap

Items below are **planned**, not built.

### Near-term

- **Scoped API keys** — limit a key to a specific folder subtree, set rate / quota / expiry, and let users see per-key activity logs.
- **OAuth-style integrations** — let third-party apps prompt a user to "Connect your Drive," similar to "Sign in with Google." Users approve scope (read vs. write) and folder restrictions at consent time. The connecting app then receives a delegated token instead of the user pasting a raw key.
- **MCP server** — a first-class [Model Context Protocol](https://modelcontextprotocol.io) server so AI agents can attach archers-drive natively as a tool source (list, read, write, search, convert) without the agent author writing any HTTP plumbing. An API key is still the credential — MCP is the transport.
- **Sharing & public links** — share a single file or folder with another user, or generate a public link with optional expiry / password.
- **Search** — full-text search over text-extractable files (docs, sheets, slides, PDFs, code).

### Conversion (partially in MVP, expanding later)

The MVP ships with **CloudConvert-backed on-demand conversion** for the file types agents most need to read:

- `convertTo: "text"` returns the file as plain text (or CSV for spreadsheet inputs).
- `convertTo: "pdf"` returns a PDF render.

Planned expansion:

- More output formats (HTML, Markdown, JSON tabular).
- Cached conversions, so repeated reads of the same file don't re-bill CloudConvert.
- Server-side OCR for image and scanned-PDF inputs.
- Async conversion jobs for very large files, with webhook + polling endpoints.

### Further out

- **Versioning** — keep N revisions of a file, restore on demand.
- **Trash / soft-delete** with a grace period.
- **Webhooks** — notify your app when files in a watched folder change.
- **Storage quotas** and per-user usage dashboards.
- **End-to-end encrypted vault folders** for users who don't want server-side reads.
- **Self-hostable** distribution (Docker image, single binary).

---

## Tech stack

| Layer        | Choice                                                  |
|--------------|---------------------------------------------------------|
| Server       | Express 5 + TypeScript (tsx in dev)                     |
| Database     | SQLite via Prisma 6                                     |
| Storage      | Cloudflare R2 (S3-compatible) + `archers-cdn.com` CDN   |
| Auth (web)   | Argon2 password hashes, JWT in httpOnly cookie          |
| Auth (API)   | User-issued bearer tokens (`Authorization: Bearer …`)   |
| Validation   | Zod                                                     |
| Conversion   | CloudConvert (sync `jobs.wait` flow)                    |
| Client       | SolidJS + Vite + TailwindCSS                            |

The server is a single Express app exposing two surfaces:

- `/auth/*`, `/drive/*`, `/api-keys/*` — cookie-authenticated, used by the web UI.
- `/v1/*` — bearer-token-authenticated, used by external agents and apps.

---

## Public API (MVP shape)

All `/v1` requests must include `Authorization: Bearer <api_key>`. The key's scope determines whether write operations are allowed.

### List a folder

```http
GET /v1/files?path=/notes
Authorization: Bearer adk_live_…
```

```json
{
  "path": "/notes",
  "entries": [
    { "type": "folder", "name": "ideas",         "path": "/notes/ideas" },
    { "type": "file",   "name": "todo.md",       "path": "/notes/todo.md", "size": 412, "mimeType": "text/markdown" },
    { "type": "file",   "name": "budget.xlsx",   "path": "/notes/budget.xlsx", "size": 18233, "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
  ]
}
```

### Read a file

```http
POST /v1/files/read
Authorization: Bearer adk_live_…
Content-Type: application/json

{
  "path": "/notes/budget.xlsx",
  "returnType": "url",
  "convertTo": "text"
}
```

- `returnType`:
  - `"url"` — returns a short-lived signed URL the agent can fetch directly.
  - `"blob"` — returns the file body inline (base64) in the JSON response.
- `convertTo` (optional): `"text"` or `"pdf"`. Only valid for supported input types (docs, sheets, slides, PDFs, HTML). Spreadsheets converted to text come back as CSV. Files that are already plaintext are returned as-is with no CloudConvert round-trip.

### Write / upload a file (write-scope keys only)

```http
POST /v1/files/write
Authorization: Bearer adk_live_…
Content-Type: application/json

{
  "path": "/notes/agent-output.md",
  "content": "…base64 or utf8 string…",
  "encoding": "utf8",
  "overwrite": true
}
```

### Other v1 endpoints

- `POST /v1/folders/create` — `{ "path": "/projects/new" }`
- `POST /v1/files/delete` — `{ "path": "/notes/old.md" }`
- `POST /v1/files/move` — `{ "from": "/a.md", "to": "/archive/a.md" }`
- `POST /v1/files/info` — metadata only, no body fetch.

The write/delete/move endpoints reject keys with `read` scope.

---

## Storage & URL design

Files are stored in R2 under a per-user, randomly-keyed prefix:

```
{userCuid}/{fileCuid}/{originalFilename}
```

…and surfaced through the CDN as:

```
https://archers-cdn.com/{fileCuid}/{originalFilename}
```

The `fileCuid` is unguessable. The bucket has no listable index. Folder and parent/child relationships exist **only in the database**, never in the object key, so an attacker who somehow guesses one CDN URL learns nothing about the rest of the user's tree. CUID-length identifiers make brute force computationally infeasible.

When the database row is deleted, the object is deleted from R2. There is no orphaned object cleanup job in the MVP — deletion is synchronous.

---

## Project layout

```
archers-drive/
├── server/                 # Express + Prisma + R2 + CloudConvert
│   ├── prisma/
│   │   └── schema.prisma
│   └── src/
│       ├── index.ts
│       ├── lib/            # r2, cloudconvert, paths, ids
│       ├── middlewares/    # session auth, api-key auth
│       ├── resources/      # prisma client
│       └── routes/         # auth, drive, api-keys, v1
└── client/                 # SolidJS + Vite + Tailwind
    └── src/
        ├── pages/          # Login, Register, Drive, ApiKeys
        ├── lib/api.ts
        └── state/
```

---

## Running locally

```bash
# server
cd server
cp .env.example .env       # fill in R2 + CloudConvert keys
npm install
npm run db:push
npm run dev                # http://localhost:3700

# client (in another terminal)
cd client
npm install
npm run dev                # http://localhost:3701
```

The Vite dev server proxies `/api/*` to the server on port 3700, so the client can talk to the API without CORS hassle.

### Required environment variables

```
DATABASE_URL=file:./dev.db
JWT_SECRET=change-me

R2_ACCESS_KEY_ID=…
R2_SECRET_ACCESS_KEY=…
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_BUCKET=archers-cdn
R2_CDN_URL=https://archers-cdn.com

CLOUD_CONVERT_KEY=…
```

See `server/.env.example` for the canonical list.

---

## Status

**Prototype.** APIs will change. Don't put anything in here you can't lose.
