# AI Studio–First Architecture Design

## Goal

Keep ChronoCanvas fully compatible with Google AI Studio while reducing bespoke infrastructure and preserving the security, persistence, correctness, and UI fixes already made in PR #4.

## Principles

- AI Studio is the primary development/runtime contract.
- Prefer existing platform/framework behavior over custom wrappers.
- Keep React + Vite for the client.
- Keep a single small Node/Express server only for privileged Gemini and OpenCV work.
- Use Firebase client SDK, Firebase Admin, Firestore, and Firebase Storage directly.
- Do not add framework layers unless they materially remove more code than they introduce.
- Preserve current names and user-facing behavior unless a change is required for correctness or AI Studio compatibility.
- Preserve the existing security fixes: verified Firebase ID tokens, owner-scoped Firestore/Storage access, bounded uploads and decoded image sizes, no SSRF proxy, no local ephemeral uploads, and no silent fallbacks.

## Package and Tooling Contract

Use npm as the canonical package manager because AI Studio projects are generated and imported around standard Node/npm conventions.

- `package.json` remains the source of dependency and script truth.
- `package-lock.json` is committed and canonical.
- Remove Bun-specific scripts/workflow assumptions and `bun.lock`.
- CI uses `npm ci` and npm scripts.
- Keep current dependency versions unless compatibility requires a specific adjustment.
- Do not introduce an alternate package manager abstraction.

## Client Architecture

Keep the current React 19 + Vite structure.

Use existing libraries directly:

- React Router for routing.
- Firebase Auth for sign-in state and ID tokens.
- Firestore for artwork/layer metadata.
- Firebase Storage for images.
- `react-dropzone` for file selection/drop behavior.
- `react-easy-crop` for crop UI.
- WebGPU API directly through the existing focused renderer object.

Do not introduce Next.js, Remix, Firebase Functions, Redux, or another application framework.

## Server Architecture

Retain one Express server because OpenCV processing and privileged Gemini access must remain server-side.

The server responsibilities are limited to:

1. Verify Firebase ID tokens on protected CV/AI endpoints.
2. Run Gemini canvas-boundary detection.
3. Run OpenCV canvas detection, perspective correction, and image alignment.
4. Serve the Vite application in production and Vite middleware in development.

Everything else stays in Firebase/client frameworks.

### Remove custom runtime abstraction

Delete bespoke runtime helpers where Express/Node already provide the behavior. The server reads `process.env.PORT`; AI Studio/Cloud Run supplies it in deployed environments. Local development may define `PORT` in `.env.local`.

SPA serving uses standard Express static middleware and an Express 5-compatible catch-all route without a separate runtime wrapper.

### Environment and secrets

- `GEMINI_API_KEY` is read only on the server from `process.env`.
- AI Studio provides the secret in its server-side environment; local `.env.local` remains supported for local development.
- `GEMINI_MODEL` may remain configurable, but model selection must not silently fall back.
- Firebase Admin uses Application Default Credentials in deployed Google environments.
- No client-side Gemini secret exposure.

## Validation and Error Handling

Use established validation rather than hand-written shape parsers.

Adopt Zod for request payloads and Gemini structured response validation where schema validation materially removes custom code.

- Request parsing uses Express/multer plus Zod schemas.
- Invalid user input returns explicit 400 responses.
- Image-processing/domain failures return explicit 422 responses.
- Upstream Gemini failures return a safe 502 response.
- Unexpected failures return a generic 500 response and keep details in server logs.
- Do not reintroduce silent catches or default objects.

Use normal Express 5 async error propagation and one terminal error middleware. Avoid an additional custom error framework; only the minimal typed distinctions needed to map expected failure classes are retained.

## Computer Vision

Keep the custom OpenCV domain implementation because it is application-specific and no higher-level existing framework replaces it without reducing control or correctness.

- Use the installed `@techstark/opencv-js` package only; no CDN copy or duplicate client/server implementation.
- Keep one `ComputerVisionService` for OpenCV initialization and resource lifetime management.
- Keep explicit decoded-pixel limits before large allocations.
- Keep explicit failures for undetectable canvas boundaries, invalid perspective coordinates, insufficient features, and invalid homographies.
- Do not fabricate results or fall back to alternate algorithms after a requested algorithm fails.

## Firebase Data and Storage

Use Firebase directly rather than custom persistence services.

- Firestore remains the metadata store.
- Firebase Storage remains the image store.
- Firestore rules restrict artworks to `ownerId == request.auth.uid` and subcollections to the parent owner.
- Storage paths remain scoped to authenticated user and artwork.
- Existing image lifecycle operations must not return success when a Firestore or Storage mutation failed.
- Preserve atomic/batched Firestore operations where multiple metadata writes form one logical operation.

`firebase-applet-config.json`, `firebase-blueprint.json`, and `metadata.json` remain AI Studio/Firebase integration artifacts and must remain compatible with the project schema.

## AI Studio Compatibility

The repository must continue to import and run as an AI Studio full-stack app.

Required compatibility characteristics:

- Standard npm project with `package.json` and `package-lock.json`.
- `npm run dev` starts the full-stack app.
- `npm run build` produces the client and server production artifacts.
- `npm start` starts the production server using the injected `PORT`.
- `metadata.json` continues to declare `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`.
- Gemini remains server-side only.
- Firebase configuration files remain at the repository root.
- No dependency on a local filesystem for persistent user data.

## UI

Do not redesign the visual language in this refactor.

Preserve the current UI correctness fixes:

- valid interactive element structure;
- explicit loading/error states;
- multi-file upload queue;
- exact crop/perspective geometry;
- no automatic WebGPU disabling after failure;
- accessible tabs/buttons/status messaging;
- HEIC codec loaded only when a HEIC/HEIF file is selected.

Any UI change in this work must be directly required by framework/API simplification or AI Studio compatibility.

## Testing and Verification

Retain regression coverage and convert project commands to npm.

CI must verify:

1. `npm ci` succeeds from the committed lockfile.
2. TypeScript type-check passes.
3. Firebase rules lint passes.
4. Regression tests pass, including OpenCV 5 initialization, no fabricated bounds, decoded-pixel limit, perspective validation, safe error mapping, storage path scoping, crop conversion, and timelapse timing.
5. Production build succeeds.
6. Production server smoke test serves a nested SPA route, returns 404 for unknown API routes, and returns safe validation responses for malformed input.

AI Studio compatibility is additionally verified structurally by retaining its metadata/config artifacts and standard npm scripts. A rendered AI Studio preview remains the final manual environment check because GitHub CI cannot execute inside the AI Studio product environment.

## Non-Goals

- No Next.js or Firebase Functions migration.
- No new microservices.
- No provider abstraction layer around Gemini/Firebase/OpenCV.
- No generic repository/service wrappers that merely forward calls.
- No package-manager abstraction.
- No visual redesign.
- No compatibility fallback paths.
