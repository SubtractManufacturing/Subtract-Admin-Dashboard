# CI/CD Docker Build Setup

This repository is configured to automatically build and push Docker images to GitHub Container Registry (GHCR) when you push to the main/master branch.

## How It Works

1. **Trigger**: Builds run on:
   - Push to `main` or `master` branch
   - Pull requests to `main` or `master`
   - Manual workflow dispatch

2. **Registry**: Images are stored in GitHub Container Registry (ghcr.io)
   - **Free** for public and private repos
   - **Private** by default (follows repo visibility)
   - No additional setup required

3. **Multi-platform**: Builds for both AMD64 and ARM64 architectures

## Image Location

Your images will be available at:
```
ghcr.io/[your-github-username]/[your-repo-name]:[tag]
```

## Tags Generated

- `latest` - Always points to the latest main/master build
- `main` or `master` - Branch name
- `pr-123` - For pull requests
- `main-abc123-1234567890` - Branch + commit SHA + timestamp
- Semantic versions if you use git tags (e.g., `v1.0.0`)

## Using the Images

### Pull the image (after authentication):
```bash
docker pull ghcr.io/[your-github-username]/subtract-cloud-frontend:latest
```

### Authenticate with GHCR:
```bash
# Using personal access token
echo $GITHUB_TOKEN | docker login ghcr.io -u [your-github-username] --password-stdin

# Or using GitHub CLI
gh auth token | docker login ghcr.io -u [your-github-username] --password-stdin
```

## Setting Image Visibility

By default, packages inherit your repository's visibility. To make the package explicitly private or public:

1. Go to your GitHub profile → Packages
2. Click on the package name
3. Click "Package settings"
4. Under "Danger Zone", you can change visibility

## Required Permissions

The workflow uses `GITHUB_TOKEN` which is automatically provided. No additional secrets needed!

The token has:
- `contents: read` - To checkout code
- `packages: write` - To push images

## Monitoring Builds

1. Go to Actions tab in your GitHub repo
2. Click on "Build and Push Docker Image" workflow
3. View build logs and summaries

## Cost

- **FREE** for private repositories
- Storage included with your GitHub account
- No transfer limits within GitHub Actions

## Local Testing

Test the build locally before pushing:
```bash
docker build -t test-build .
```