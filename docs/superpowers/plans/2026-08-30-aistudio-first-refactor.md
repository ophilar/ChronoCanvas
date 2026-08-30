# AI Studio–First Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ChronoCanvas a standard Google AI Studio full-stack React/Node project while removing bespoke runtime/parsing infrastructure and preserving all security, CV, persistence, and UI correctness fixes.

**Architecture:** Keep React + Vite + Firebase on the client and one Express 5 server for Firebase-token-protected Gemini/OpenCV operations. Use npm as the package contract, Zod for request/structured-response validation, Express 5 async error propagation, and direct framework APIs rather than thin wrappers.

**Tech Stack:** Node.js 24 LTS for CI, npm, React 19, Vite 8, Express 5, Zod, Firebase/Firebase Admin, `@google/genai`, `@techstark/opencv-js`, multer.

**Spec:** `docs/superpowers/specs/2026-08-30-aistudio-first-architecture-design.md`

## Global Constraints

- AI Studio is the primary development/runtime contract.
- Prefer existing platform/framework behavior over custom wrappers.
- Use npm with a committed `package-lock.json`; remove Bun-specific assumptions and `bun.lock`.
- Keep one Node/Express server only for Firebase-token-protected Gemini/OpenCV operations and production/static serving.
- Preserve verified Firebase ID tokens, owner-scoped Firestore/Storage access, upload/decoded-pixel limits, no SSRF proxy, no local persistent uploads, and no silent fallbacks.
- Keep Gemini server-side through `process.env.GEMINI_API_KEY`; do not expose secrets to the client.
- Preserve current UI behavior and names except where framework simplification requires change.
- No Next.js, Firebase Functions, provider abstraction layer, package-manager abstraction, microservice split, or generic forwarding wrappers.

---

### Task 1: Standardize the repository on npm and Node LTS

**Files:**
- Modify: `package.json`
- Create: `package-lock.json`
- Delete: `bun.lock`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Produces canonical commands: `npm run dev`, `npm run build`, `npm start`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run check`.
- Adds runtime dependency `zod` for Task 2.

- [ ] **Step 1: Change `package.json` to npm-neutral scripts and add Zod**

Use the existing script bodies but remove `bun run` chaining:

```json
{
  "scripts": {
    "dev": "tsx server.ts",
    "build": "vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
    "start": "node dist/server.cjs",
    "clean": "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\"",
    "typecheck": "tsc --noEmit",
    "test": "tsx --test tests/*.test.ts",
    "lint:rules": "eslint firestore.rules storage.rules",
    "lint": "npm run typecheck && npm run lint:rules",
    "check": "npm run lint && npm test && npm run build"
  }
}
```

Add `"zod": "^4.1.5"` to dependencies after verifying the current stable version before the edit.

- [ ] **Step 2: Generate and commit `package-lock.json` with npm**

Run on Node.js 24 LTS:

```bash
npm install --package-lock-only
npm ci
```

Expected: `package-lock.json` is generated and `npm ci` succeeds from it.

- [ ] **Step 3: Remove `bun.lock`**

Delete only `bun.lock`; do not retain dual lockfiles.

- [ ] **Step 4: Convert CI to standard Node/npm**

Replace Bun setup/install/run steps with:

```yaml
- name: Set up Node.js
  uses: actions/setup-node@v5
  with:
    node-version: '24'
    cache: npm

- name: Install dependencies
  run: npm ci

- name: Type-check and validate rules
  run: npm run lint

- name: Run regression tests
  run: npm test

- name: Build production artifacts
  run: npm run build
```

Keep the existing production smoke test unchanged until Task 3 extends it.

- [ ] **Step 5: Verify tooling**

Run:

```bash
npm ci
npm run lint
npm test
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .github/workflows/ci.yml README.md
git rm bun.lock
git commit -m "build: standardize AI Studio tooling on npm"
```

---

### Task 2: Replace hand-written server payload parsing with Zod

**Files:**
- Modify: `server.ts`
- Create: `src/server/schemas.ts`
- Modify: `tests/serverRuntime.test.ts`

**Interfaces:**
- `src/server/schemas.ts` exports:
  - `detectionMethodSchema`
  - `perspectivePointsSchema`
  - `geminiBoundsSchema`
  - `parseDataUrl(value: unknown, acceptedImageTypes: ReadonlySet<string>): { buffer: Buffer; mimeType: string } | undefined`
- Server handlers call schemas directly; no `requireRecord`, `parseDetectionMethod`, `parsePerspectivePoints`, or `parseGeminiBounds` functions remain in `server.ts`.

- [ ] **Step 1: Add failing schema tests**

Add tests that prove invalid values are rejected without defaults:

```ts
assert.equal(detectionMethodSchema.parse('opencv'), 'opencv');
assert.throws(() => detectionMethodSchema.parse(undefined));
assert.throws(() => perspectivePointsSchema.parse([{ x: 0, y: 0 }]));
assert.throws(() => perspectivePointsSchema.parse([
  { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
]));
assert.throws(() => geminiBoundsSchema.parse({ ymin: 0, xmin: 0, ymax: 1, xmax: 1 }));
```

Run `npm test`; expected: FAIL because `src/server/schemas.ts` does not exist.

- [ ] **Step 2: Implement Zod schemas**

Create `src/server/schemas.ts` with explicit normalized-coordinate constraints and no defaults:

```ts
import { z } from 'zod';

const normalized = z.number().finite().min(0).max(1);

export const detectionMethodSchema = z.enum(['opencv', 'gemini']);
export const perspectivePointsSchema = z.array(
  z.object({ x: normalized, y: normalized }).strict(),
).length(4);

export const geminiBoundsSchema = z.object({
  ymin: normalized,
  xmin: normalized,
  ymax: normalized,
  xmax: normalized,
  centerX: normalized,
  centerY: normalized,
  width: normalized.positive(),
  height: normalized.positive(),
}).strict().refine((value) => value.xmin < value.xmax && value.ymin < value.ymax, {
  message: 'Canvas bounds must have positive normalized extents.',
});
```

Implement strict data-URL parsing in the same file, returning `undefined` only when the field itself is absent and throwing `z.ZodError`/`Error` for malformed or unsupported supplied values.

- [ ] **Step 3: Refactor `server.ts` request parsing**

Use Express/multer output directly and Zod at the boundary:

```ts
const method = detectionMethodSchema.parse(request.body?.method ?? request.query.method);
const points = perspectivePointsSchema.parse(JSON.parse(request.body.points));
const bounds = geminiBoundsSchema.parse(JSON.parse(result.text));
```

Keep explicit JSON parse errors mapped to 400/502 through the terminal error middleware; do not swallow parse errors or substitute objects.

- [ ] **Step 4: Run tests**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server.ts src/server/schemas.ts tests/serverRuntime.test.ts
git commit -m "refactor: validate server payloads with zod"
```

---

### Task 3: Remove bespoke runtime helpers and collapse error plumbing into Express

**Files:**
- Modify: `server.ts`
- Delete: `src/server/runtime.ts`
- Delete: `src/server/httpErrorPolicy.ts`
- Modify: `src/server/computerVisionService.ts`
- Modify: `tests/serverRuntime.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Express owns SPA routing and async error propagation directly.
- CV domain failures use built-in `Error` with a small `status` property only where an expected HTTP status differs from 500; no separate error-policy module.
- Unexpected errors return `{ error: 'Internal server error.' }` with status 500.

- [ ] **Step 1: Rewrite tests around observable Express behavior rather than helper modules**

Remove tests for `parseRequiredPort`, `registerSpaFallback`, and `toHttpErrorResponse`. Replace them with server-observable assertions in the production smoke test and focused tests for CV failures and Zod validation.

The production smoke must continue to assert:

```text
GET /artwork/example -> 200 SPA
GET /api/missing -> 404 JSON
POST invalid JSON /api/detect-canvas-bounds -> 400 safe JSON
```

- [ ] **Step 2: Inline the standard platform behavior in `server.ts`**

Use the platform port directly without a wrapper:

```ts
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be configured as an integer between 1 and 65535.');
}
```

Use standard Express production SPA serving:

```ts
const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));
app.get('/{*splat}', (_request, response) => {
  response.sendFile(path.join(distPath, 'index.html'));
});
```

Do not add a routing wrapper.

- [ ] **Step 3: Use one terminal Express error middleware**

Classify only known framework/domain cases in-place:

```ts
app.use((error: unknown, _request, response, _next) => {
  console.error('Unhandled request error:', error);
  if (error instanceof multer.MulterError) {
    response.status(400).json({ error: 'Invalid multipart image upload.' });
    return;
  }
  if (error instanceof z.ZodError || isExpressJsonSyntaxError(error)) {
    response.status(400).json({ error: 'Invalid request payload.' });
    return;
  }
  if (error instanceof ImageProcessingError) {
    response.status(422).json({ error: error.message });
    return;
  }
  if (error instanceof UpstreamServiceError) {
    response.status(502).json({ error: error.message });
    return;
  }
  response.status(500).json({ error: 'Internal server error.' });
});
```

Keep the two semantic error classes only if they materially simplify `ComputerVisionService` and Gemini mapping; otherwise use one small `HttpError extends Error { status: number }` in `server.ts`. Do not create another policy file.

- [ ] **Step 4: Delete the obsolete helper modules**

Delete `src/server/runtime.ts` and `src/server/httpErrorPolicy.ts` after all imports/tests are removed.

- [ ] **Step 5: Verify the real production server**

Run:

```bash
npm run build
NODE_ENV=production PORT=4173 npm start
```

Then assert the existing CI smoke endpoints. Expected: nested SPA route 200, unknown API 404, malformed JSON 400, no internal exception text exposed.

- [ ] **Step 6: Commit**

```bash
git add server.ts src/server/computerVisionService.ts tests/serverRuntime.test.ts .github/workflows/ci.yml
git rm src/server/runtime.ts src/server/httpErrorPolicy.ts
git commit -m "refactor: use Express runtime contracts directly"
```

---

### Task 4: Reconcile AI Studio/Firebase metadata with the actual persisted schema

**Files:**
- Modify: `firebase-blueprint.json`
- Verify: `metadata.json`
- Verify: `firebase-applet-config.json`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- `firebase-blueprint.json` describes actual current documents: `Artwork.ownerId` remains canonical; nested `Layer` no longer declares redundant `artworkId`/`ownerId`; `Layer.order` is represented.
- `metadata.json` retains `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`.

- [ ] **Step 1: Update the Layer blueprint**

The Layer entity becomes:

```json
{
  "imageUrl": { "type": "string" },
  "notes": { "type": "string" },
  "techniques": { "type": "array", "items": { "type": "string" } },
  "colorPaletteSuggestions": { "type": "array", "items": { "type": "string" } },
  "createdAt": { "type": "string", "format": "timestamp" },
  "order": { "type": "number" }
}
```

Required fields: `imageUrl`, `createdAt`, `order`.

- [ ] **Step 2: Keep AI Studio metadata capability unchanged**

Verify `metadata.json` still contains:

```json
"majorCapabilities": ["MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API"]
```

Do not add unsupported/custom capability names.

- [ ] **Step 3: Keep server-side Gemini environment minimal**

`.env.example` documents local development only:

```dotenv
PORT=3000
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.7-flash
```

README must state that AI Studio supplies `GEMINI_API_KEY` automatically as a server-side secret, while local development may set it in `.env.local`.

- [ ] **Step 4: Update README commands to npm and Node 24 LTS**

Document `npm ci`, `npm run dev`, `npm run check`, `npm start`; remove Bun prerequisites/references.

- [ ] **Step 5: Commit**

```bash
git add firebase-blueprint.json metadata.json README.md .env.example
git commit -m "docs: align AI Studio and Firebase project metadata"
```

---

### Task 5: Final verification and PR cleanup

**Files:**
- Verify all PR files
- Modify PR body if needed

**Interfaces:**
- PR #4 remains the single remediation PR and reports the npm/AI Studio architecture accurately.

- [ ] **Step 1: Search the PR for obsolete/custom patterns**

Verify there are no remaining positive additions containing:

```text
bun run
bun install
setup-bun
bun.lock
parseRequiredPort
registerSpaFallback
requireRecord
catch(() => ({})
Access-Control-Allow-Origin
/api/proxy-image
/uploads
```

Any occurrence only in removed diff lines is acceptable.

- [ ] **Step 2: Run the complete clean verification**

Run from a clean checkout:

```bash
npm ci
npm run lint
npm test
npm run build
```

Then run the production smoke test from CI.

Expected: all commands/steps exit 0; tests report zero failures.

- [ ] **Step 3: Inspect bundle output**

Confirm `ArtworkPage` remains code-split and HEIC remains demand-loaded. Do not suppress Vite's chunk warning via `chunkSizeWarningLimit`.

- [ ] **Step 4: Verify PR state and head SHA**

Confirm PR #4 is mergeable and CI is green on the exact current head. Do not claim AI Studio rendered-preview verification unless it has actually been run inside AI Studio.

- [ ] **Step 5: Update PR description**

Summarize the final architecture: standard npm/Node AI Studio project, direct Firebase usage, one Express server, Zod boundary validation, OpenCV domain service, preserved security/UI fixes, and exact verification evidence.
