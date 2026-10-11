# Fest Registration Backend

Bun, Express, Prisma, and PostgreSQL API for college fest registrations. The frontend is maintained and deployed separately.

## Run with Docker Compose

Copy `.env.example` to `.env`, then replace the database password, JWT secret, administrator credentials, and `CORS_ORIGIN` with values for your deployment. Google Sheets sync settings are optional.

```sh
cp .env.example .env
docker compose up --build -d
docker compose exec backend bun run seed
```

The API is available at `http://localhost:3001` by default. Set `API_HOST_PORT` to change the host port, `BACKEND_PORT` for the container port, and `POSTGRES_HOST_PORT` for the local database port. The database is stored in the `postgres_data` volume. Migrations run before the API starts.

For a public deployment, expose the API through HTTPS and set `CORS_ORIGIN` to the exact origin of the separate frontend. Keep `.env` private. Back up the database volume regularly.

## Run locally

Install Bun, PostgreSQL, and dependencies. Create `.env` using `.env.example`, then set `DATABASE_URL` to your PostgreSQL connection string and configure the required app settings.

```sh
bun install
bunx prisma migrate dev
bun run seed
bun run dev
```

The local API listens on port 3000 by default. `HOST` and `PORT` can be changed in `.env`.

## Registration flow (MVSR Sangamam 2026)

Registrations move through these statuses. Payment review and organizer approval are separate steps; a submitted UTR alone never verifies a payment.

```
PENDING_PAYMENT → PAYMENT_REVIEW → PAYMENT_VERIFIED → APPROVED → TICKET_ISSUED
                         ↓
                  PAYMENT_REJECTED (participant can resubmit)      REJECTED (organizer, with a reason)
```

- `POST /events/:eventId/registrations` (signed in): `{ teamName, college, phone, participants: [{ name, email, rollNumber? }] }`. Roll numbers are required for MVSR students (`2451-2X-XXX-XXX`). The fee is computed on the server (`feeMode: PER_HEAD` multiplies `feePaise` by the team size). Each student email can join an event once.
- `POST /registrations/:id/payment-proofs` (signed in, multipart): `utr`, `paymentMethod` (`UPI`), `screenshot` (PNG/JPEG ≤ 5 MB). Moves the registration to `PAYMENT_REVIEW`.
- `PATCH /admin/payment-proofs/:proofId/verify` and `/reject` (`{ reason }`).
- `PATCH /admin/registrations/:id/approve`: requires `PAYMENT_VERIFIED`; repeated calls return `alreadyApproved: true` without side effects.
- `PATCH /admin/registrations/:id/reject` (`{ reason }`), `GET /admin/registrations/:id/audit`, `GET /admin/registrations?status=PAYMENT_REVIEW`.
- Check-in (`POST /admin/check-in`) requires an approved registration.

Create the events that accept online registration (slugs must match the website). Safe to re-run:

```sh
bun run seed:events          # or: docker compose exec backend bun run seed:events
```

To show the real UPI QR instead of the website's demo QR, an administrator uploads it with `POST /admin/payment-qrs` (multipart `label`, `image`) and activates it with `PATCH /admin/payment-qrs/:qrId/active` (`{ "isActive": true }`).

### Connecting the website

- Build the website with `VITE_API_URL` set to this API's public HTTPS origin (see the website's `.env.example`).
- Add the website's origin to `CORS_ORIGIN`, e.g. `CORS_ORIGIN=https://suryaprakashrachamalla.github.io` (the origin has no path).
- Participants register at the event pages and track their registrations at `/fest/dashboard`; organizers sign in at `/fest/admin` with an administrator account from `bun run seed`.

### Google Sheets

1. Create a Google Cloud project, enable the Google Sheets API, and create a service account with a JSON key.
2. Create a spreadsheet named **MVSR Sangamam 2026 Registrations** and share it with the service account email as an Editor. Share it with organizers only.
3. Set `GOOGLE_SPREADSHEET_ID` (from the spreadsheet URL), `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` in `.env`.

The worker creates the Registrations, Participants, PaymentProofs, Events and Users tabs. The Registrations tab has one row per registration keyed by its `SG26-…` code, with participants, emails, phone, college, event, team, fee, payment method, UTR, payment and approval status, timestamps and placeholders for Luma guest ID, ticket and email status. Rows are updated in place; failed writes stay in PostgreSQL and are retried with backoff. If you created the spreadsheet before this change, delete its old tabs so the new headers can be written.

### Tests

```sh
RUN_DB_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… bun test
```

### Luma (ticket emails)

Approved registrations are added as guests to the matching Luma event, and Luma emails each team member their ticket. Nothing is sent when a UTR is submitted or a payment is verified; only organizer approval triggers it. Each registration moves to `TICKET_ISSUED` once Luma accepts it, with an audit entry and the Sheets row's email status set to `SENT_BY_LUMA`.

1. Luma Plus is required for the API. In the Luma calendar, open Settings → Developer and create an API key.
2. Create a Luma event for each website event and copy its ID (`evt-…`).
3. In `.env` set `LUMA_API_KEY` and `LUMA_EVENT_IDS`, e.g. `hackathon=evt-abc,build-lab=evt-def` (slugs as in `seedEvents.ts`).
4. Preview, then send:
   - `bun run luma:sync` lists what would be sent and sends nothing.
   - `bun run luma:sync -- --send` adds the guests to Luma.
5. To automate it, set `LUMA_AUTO_SYNC=true`: the server sends each new approval right away and re-checks every `LUMA_SYNC_INTERVAL_MS` (default 60 s). Organizers can also press **Send to Luma now** on the admin dashboard (`POST /admin/luma-sync`).

Failures (for example a wrong event ID) are stored on the registration, shown on the admin dashboard and retried after 5 minutes.
