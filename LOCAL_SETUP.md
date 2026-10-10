# Run the backend locally from the published Docker image

This guide runs the backend and PostgreSQL on your computer. The frontend is a separate app and is not included in the image. The API is available to the frontend at `http://localhost:3001` by default.

## Requirements

- Docker Desktop (or Docker Engine with the Compose plugin) installed and running.
- Access to the Docker Hub image `syedahmedzeshaan/fest-backend:latest`.
- The separate frontend app, if you want to use the website.

If the Docker Hub repository is private, sign in first with `docker login`.

## 1. Get the backend files

Clone the backend repository, or open the existing `backend` folder in your checkout. Run all commands below from that folder, where `compose.yaml` is located.

## 2. Create local settings

Create `.env` from the example if you do not already have a `.env` file:

```sh
cp .env.example .env
```

If `.env` already exists, keep it and add any missing settings from `.env.example`; do not overwrite working credentials. At minimum, Compose needs:

```dotenv
POSTGRES_DB=fest_registration
POSTGRES_USER=fest_app
POSTGRES_PASSWORD=replace-with-a-long-url-safe-password
```

Also replace the `JWT_SECRET` and the three administrator passwords with unique values. Set `CORS_ORIGIN` to the frontend's exact origin, including scheme and port (for local Vite development this is usually `http://localhost:5173`). Google Sheets settings are optional; leave them blank to disable Sheets sync.

Keep `.env` private. It is ignored by Git and must not be committed or shared. The Docker image intentionally does not contain `.env`; Compose reads it on your computer and passes settings to the containers when they start.

## 3. Download and run the image

Pull the published image and give it the local name expected by `compose.yaml`:

```sh
docker pull syedahmedzeshaan/fest-backend:latest
docker tag syedahmedzeshaan/fest-backend:latest fest-registration-backend:local
```

Start PostgreSQL, apply migrations, and start the backend:

```sh
docker compose up --no-build -d
```

Migrations run automatically before the backend starts. Create or update the administrator accounts configured in `.env`:

```sh
docker compose exec backend bun run seed
```

The API is now available at `http://localhost:3001`. Configure the separate frontend to use that API URL (for example, `VITE_API_URL=http://localhost:3001` for local development).

## 4. Check status and logs

```sh
docker compose ps
docker compose logs -f backend
```

To verify that important settings reached the running backend without printing secret values:

```sh
docker compose exec backend bun -e 'for (const k of ["DATABASE_URL","JWT_SECRET","CORS_ORIGIN"]) console.log(`${k}: ${process.env[k] ? "set" : "missing"}`)'
```

If Compose reports that `POSTGRES_DB`, `POSTGRES_USER`, or `POSTGRES_PASSWORD` is missing, check that `.env` exists beside `compose.yaml` and contains those entries. Do not print or paste the full `.env` into chat or support messages.

## 5. Stop the services

Stop containers while preserving the PostgreSQL data:

```sh
docker compose down
```

Start them again with `docker compose up --no-build -d`. The database is stored in the `postgres_data` volume. Removing that volume deletes its database contents; do not run `docker compose down -v` unless you intend to erase that local data.

## Update to a newer published image

Pull the latest image, update the local Compose tag, and recreate the backend:

```sh
docker pull syedahmedzeshaan/fest-backend:latest
docker tag syedahmedzeshaan/fest-backend:latest fest-registration-backend:local
docker compose up --no-build -d
```

## Use local backend source instead

For backend development, build the current source instead of using the published image:

```sh
docker compose up --build -d
```

This builds the image from the local `Dockerfile`. It does not build or serve the separate frontend.
