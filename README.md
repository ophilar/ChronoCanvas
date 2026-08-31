# ChronoCanvas

ChronoCanvas tracks painting milestones, aligns progress images, and exports timelapse videos.

## Stack

- React 19 + Vite 8
- Firebase Authentication, Firestore, and Storage
- Express 5 for authenticated server-side Gemini and OpenCV processing
- OpenCV.js 5 for canvas detection, perspective correction, and milestone alignment

## Google AI Studio

ChronoCanvas is structured as an AI Studio full-stack React/Node project. `metadata.json` declares server-side Gemini capability, and Gemini access stays on the Node server.

AI Studio provides `GEMINI_API_KEY` to the server-side environment. Configure `GEMINI_MODEL` alongside it to enable Gemini canvas detection. OpenCV canvas detection does not require Gemini.

## Local development

Prerequisites: Node.js 24 LTS and npm.

1. Install exactly the committed dependencies:
   `npm ci`
2. Copy `.env.example` to `.env.local`.
3. Set `PORT` explicitly. `3000` is suitable for local development.
4. To use Gemini detection locally, set `GEMINI_API_KEY` and `GEMINI_MODEL` in `.env.local`.
5. Run:
   `npm run dev`

## Verification

Run the complete local verification pipeline with:

`npm run check`

This performs TypeScript validation, Firebase rules linting, regression tests, and the production build.

## Production

Build and start the Node server with:

`npm run build`

`npm start`

The production environment must provide `PORT`. Firebase Admin uses Application Default Credentials in deployed Google environments. User images are persisted in Firebase Storage rather than the server filesystem.

Deploy Firestore and Storage rules from `firebase.json` so they are applied to the configured named Firestore database and Storage bucket.
