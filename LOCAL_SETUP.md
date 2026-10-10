# Run the backend locally from GitHub source

This guide builds a backend image on your own computer from the source code in GitHub. It does not pull or use the image published under someone else's Docker Hub account. The frontend is separate and is not included in this backend image. By default, the API is available at `http://localhost:3001`.

## Requirements

- Git.
- Docker Desktop (or Docker Engine with the Compose plugin) installed and running.
- Access to the backend repository: <https://github.com/syedahmedzeshaan/fest-backend>.
- The separate frontend app, if you want to use the website.

You do not need a Docker Hub account or `docker login` to build and run this locally. Docker will download the public base images (Bun and PostgreSQL) as needed, then build the backend image on your machine.

## 1. Get the backend source

Clone the backend repository and enter its folder:

```sh
git clone https://github.com/syedahmedzeshaan/fest-backend.git
cd fest-backend
```

If you already have the repository, open its folder and update it with `git pull` only if you do not have local changes you need to keep. Run the remaining commands from the folder containing `compose.yaml`.

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

Keep `.env` private. It is ignored by Git and must not be committed or shared. The Docker image does not contain `.env`; Compose reads it on your computer and passes settings to containers when they start.

## 3. Build your own image and start the backend

Run Compose with the build option. Docker builds a local image from this repository's `Dockerfile`, starts PostgreSQL, applies migrations, and starts the API:

```sh
docker compose up --build -d
```

This uses the Compose image name `fest-registration-backend:local` on your computer. It does not pull `syedahmedzeshaan/fest-backend` from Docker Hub or publish anything to Docker Hub.

Create or update the administrator accounts configured in `.env`:

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

Start them again with `docker compose up -d`. The database is stored in the `postgres_data` volume. Removing that volume deletes its database contents; do not run `docker compose down -v` unless you intend to erase that local data.

## Rebuild after getting newer backend code

After safely updating the local GitHub checkout, rebuild and restart the backend image:

```sh
docker compose up --build -d
```

The local PostgreSQL volume is preserved during this update. To publish an image to your own Docker Hub account, separately tag it with your own username and repository, then sign in and push it; that is not needed to develop the frontend locally.
