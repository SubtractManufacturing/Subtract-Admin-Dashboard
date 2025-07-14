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

## Environment Variables

Create a `.env` file based on the example in the docker directory:
```bash
cp docker/.env.docker.example .env
```

Required variables:
- `DATABASE_URL` - PostgreSQL connection string
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key

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

- Base image: `node:20-alpine`
- Exposed port: `3000`
- Non-root user: `nodejs` (UID 1001)
- Includes health check at `/health`
- Production optimizations applied