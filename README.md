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
