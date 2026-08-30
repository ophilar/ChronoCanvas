# ChronoCanvas

ChronoCanvas tracks painting milestones, aligns progress images, and exports timelapse videos.

## Stack

- React 19 + Vite 8
- Firebase Authentication, Firestore, and Storage
- Express 5 backend for authenticated OpenCV/Gemini image processing
- OpenCV.js 5 for canvas detection, perspective correction, and milestone alignment

## Local development

Prerequisites: Node.js 26+ and Bun 1.4+.

1. Install dependencies:
   `bun install --frozen-lockfile`
2. Copy `.env.example` to `.env.local`.
3. Set `PORT` explicitly. `3000` is suitable for local development.
4. To enable Gemini-based canvas detection, set both `GEMINI_API_KEY` and `GEMINI_MODEL`. The example uses the current GA `gemini-3.7-flash` model.
5. Run:
   `bun run dev`

OpenCV detection remains available without Gemini configuration.

## Verification

Run the complete local verification pipeline with:

`bun run check`

This performs TypeScript validation, Firebase rules linting, regression tests, and the production build.

## Deployment

The server requires `PORT`; managed Cloud Run deployments provide it automatically. Firebase Admin uses Application Default Credentials in the deployed environment. Images are persisted in Firebase Storage rather than the container filesystem.

Deploy Firestore and Storage rules from `firebase.json` so they are applied to the configured named Firestore database and Storage bucket.
