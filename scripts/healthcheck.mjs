/**
 * Container healthcheck, used by the Dockerfile HEALTHCHECK.
 *
 * Checks the endpoint(s) that exist for this container's role:
 *   CONTAINER_ROLE=web     -> web server    (PORT, default 3000)
 *   CONTAINER_ROLE=worker  -> worker health (WORKER_HEALTH_PORT, default 3001)
 *   anything else (hybrid) -> both
 *
 * Exits 0 only if every applicable endpoint returns HTTP 200.
 * Plain Node with no dependencies, so it runs in the slim production image.
 */

const TIMEOUT_MS = 2000;

const role = process.env.CONTAINER_ROLE;
const webPort = process.env.PORT || 3000;
const workerPort = process.env.WORKER_HEALTH_PORT || 3001;

const targets = [];
if (role !== "worker") {
  targets.push({ name: "web", url: `http://localhost:${webPort}/health` });
}
if (role !== "web") {
  targets.push({ name: "worker", url: `http://127.0.0.1:${workerPort}/health` });
}

async function check({ name, url }) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status !== 200) {
      console.error(`[healthcheck] ${name} returned ${res.status} (${url})`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[healthcheck] ${name} unreachable (${url}):`, error.message);
    return false;
  }
}

const results = await Promise.all(targets.map(check));
process.exit(results.every(Boolean) ? 0 : 1);
