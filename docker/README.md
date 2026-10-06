# Docker Deployment Instructions

## Prerequisites
- Docker installed on your system
- Environment variables configured (see `.env.docker.example`)

## Building the Production Image

Build the Docker image:
```bash
docker build -t subtract-frontend:latest .
```

Build with a specific tag:
```bash
docker build -t subtract-frontend:v1.0.0 .
```

Build for a registry:
```bash
docker build -t myregistry.com/subtract-frontend:latest .
```

## Running the Container

### Basic Run
```bash
docker run -p 3000:3000 --env-file .env subtract-frontend:latest
```

### Run in Background
```bash
docker run -d \
  --name subtract-frontend \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  subtract-frontend:latest
```

### Run with Custom Port
```bash
docker run -d \
  --name subtract-frontend \
  -p 8080:3000 \
  --env-file .env \
  subtract-frontend:latest
```

## Running the Worker

Run the same image with `CONTAINER_ROLE=worker`:
```bash
docker run -d \
  --name subtract-worker \
  --env-file .env \
  -e CONTAINER_ROLE=worker \
  --restart unless-stopped \
  subtract-frontend:latest
```

View worker logs:
```bash
docker logs -f subtract-worker
```

### Worker health check

The worker exposes `GET /health` on `WORKER_HEALTH_PORT` (default `3001`):
```bash
curl http://localhost:3001/health
```

It returns `200` once the worker has registered all queues and can reach the database. It returns `503` while starting, while shutting down, or when the database is unreachable.

The image `HEALTHCHECK` (`scripts/healthcheck.mjs`) picks the endpoint from `CONTAINER_ROLE`:

| `CONTAINER_ROLE` | Probes |
| --- | --- |
| `web` | web server on `PORT` (default `3000`) |
| `worker` | worker on `WORKER_HEALTH_PORT` (default `3001`) |
| unset (hybrid) | both |

Always set `CONTAINER_ROLE=worker` for worker containers. Overriding the command with `node build/worker.js` skips that role, and the healthcheck would then probe the web port. If your platform (Coolify, ECS, Kubernetes, ...) defines its own healthcheck, point worker services at `http://<container>:3001/health`.

Notes:
- Worker only requires `DATABASE_URL`
- Multiple worker containers can run concurrently (PG Boss uses row locking for safe distribution)

## Environment Variables

Create a `.env` file based on the example in the docker directory:
```bash
cp docker/.env.docker.example .env
```

Required variables:
- `DATABASE_URL` - PostgreSQL connection string
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key

### File-based secrets (`*_FILE`) for Docker Swarm / Compose

App-owned config is resolved via `getEnv` / `requireEnv` (`app/lib/env.server.ts`).
For any variable `FOO`, you may set `FOO_FILE` to a path whose contents become the value:

```bash
# Swarm / Compose secrets (file wins over plain env when FOO_FILE is set)
DATABASE_URL_FILE=/run/secrets/database_url
DATABASE_DIRECT_URL_FILE=/run/secrets/database_direct_url
SUPABASE_SERVICE_ROLE_KEY_FILE=/run/secrets/supabase_service_role_key
S3_SECRET_ACCESS_KEY_FILE=/run/secrets/s3_secret_access_key
STRIPE_SECRET_KEY_FILE=/run/secrets/stripe_secret_key
```

Rules:
- If `FOO_FILE` is a non-empty path, the file **wins** — there is no fallback to `FOO` if the file is missing, unreadable, or empty.
- An empty/`""` `FOO_FILE` is an error; unset `FOO_FILE` to use plain `FOO` instead.
- Local/dev can keep using plain env vars (or `.env`); `*_FILE` is optional.

**Infra follow-up:** production compose lives in `SubtractManufacturing/infra-legacy`. Mount Docker secrets and pass `*_FILE=/run/secrets/...` there when adopting Swarm secrets; no compose change is required in this repo for the app helper to work.

## Container Management

### View Logs
```bash
docker logs -f subtract-frontend
```

### Stop Container
```bash
docker stop subtract-frontend
```

### Start Stopped Container
```bash
docker start subtract-frontend
```

### Remove Container
```bash
docker rm -f subtract-frontend
```

### Access Container Shell
```bash
docker exec -it subtract-frontend sh
```

## Health Check

The container includes a health check endpoint at `/health`:
```bash
curl http://localhost:3000/health
```

## Pushing to Registry

Tag for registry:
```bash
docker tag subtract-frontend:latest myregistry.com/subtract-frontend:latest
```

Push to registry:
```bash
docker push myregistry.com/subtract-frontend:latest
```

## Production Deployment

1. Build the image on your CI/CD system or locally
2. Push to your container registry
3. Deploy to your container orchestration platform (Kubernetes, ECS, etc.)
4. Ensure environment variables are properly configured in your deployment
5. Set up your reverse proxy/load balancer to route traffic to the container on port 3000

## Image Details

- Base image: `node:22-slim`
- Exposed ports: `3000` (web), `3001` (worker health)
- Non-root user: `nodejs` (UID 1001)
- Includes role-aware health check at `/health` (web and worker)
- Production optimizations applied