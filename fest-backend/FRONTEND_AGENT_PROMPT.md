# Prompt for the frontend coding agent

Copy the prompt below into the agent working on the separate frontend repository.

---

You are working on the separate frontend for the College Fest Registration website. The backend is already implemented and is available from GitHub at `https://github.com/syedahmedzeshaan/fest-backend`. Its Docker image is published as `syedahmedzeshaan/fest-backend:latest`.

Your task is to connect the frontend pages already being built to the backend and add the routes, API client, authentication handling, and supporting files needed for a complete frontend flow. Preserve the existing visual design and working pages. Inspect the frontend repository before editing; reuse its framework, patterns, and components rather than replacing the app with a new scaffold.

## First inspect

1. Identify the frontend framework, build tool, existing routes/pages, styling system, and current API calls.
2. Read the backend API source and README. If the backend code is not already available locally, clone `https://github.com/syedahmedzeshaan/fest-backend` into a temporary location for read-only API inspection. Do not copy backend files into the frontend repository.
3. Confirm the exact request/response shapes, authentication requirements, and error formats from the backend implementation. Use those real contracts; do not invent endpoints or field names.
4. Summarize the route map and any backend contract gaps before making broad changes.

## Backend connection

- For local frontend development, the backend API base URL is `http://localhost:3001` when run using the backend's Docker Compose setup.
- Configure the base URL through the frontend's normal environment mechanism (for example, `VITE_API_URL=http://localhost:3001` for Vite). Add a safe `.env.example` with a local default if appropriate. Never commit `.env`, credentials, tokens, or payment data.
- Keep the API base URL in one shared API client module. Centralize JSON handling, bearer-token attachment, and API error parsing there.
- Store and clear the login token using the existing frontend conventions. Protect authenticated pages and redirect unauthenticated users to the appropriate sign-in page.
- If the backend's allowed origin is configured through `CORS_ORIGIN`, document that the local frontend origin (commonly `http://localhost:5173`) must match it.
- Do not place backend secrets, Google service-account credentials, database URLs, JWT signing secrets, or administrator passwords in frontend code or environment variables.

## Routes and user flows

Design the final route list based on the existing pages and actual backend endpoints. At minimum, check that the app has sensible routes for:

- Public landing page and event browsing/details, if those pages exist.
- Participant registration, login, and logout.
- Participant dashboard / registrations and the payment-proof submission flow, if supported by the backend.
- Administrator login and protected admin pages for event management, registration/payment review, admission/check-in, and sync status where supported.
- A useful not-found route and loading/error states.

Reuse existing page components. Do not create duplicate landing pages, duplicate admin pages, or dead-end routes. Keep participant and administrator navigation distinct where the current UI supports those roles. Ensure refresh/deep links work with the frontend's hosting setup, and document any required SPA fallback configuration.

## Working rules

- Do not change the backend repository, database, Docker image, production deployment, or spreadsheet contents.
- Do not create or submit real registrations, payment proofs, or administrator accounts while implementing the frontend.
- Do not hard-code demo records or claim a request succeeded when the API returned an error.
- Keep changes scoped to the frontend repository. Avoid unrelated redesigns and dependency upgrades.
- Follow existing linting, type-checking, and build scripts. Run the checks that are available and report their results.
- If the backend lacks an endpoint needed by the current UI, do not quietly change the backend contract. Identify the gap and report the exact expected data/action and route that needs support.

## Finish by reporting

1. The routes added or connected.
2. Which existing pages were reused or updated.
3. The frontend environment variable and local run instructions.
4. Any backend API gaps or assumptions.
5. The checks run and whether they passed.

---
