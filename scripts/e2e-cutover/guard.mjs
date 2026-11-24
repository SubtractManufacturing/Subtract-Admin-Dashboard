/**
 * Loaded into the app server with `node --import` by the cutover browser run.
 * Refuses every network connection that is not to this machine, so a stray
 * setting can never reach a real database, mail or payment service.
 */
import { existsSync } from "node:fs";
import net from "node:net";

const LOCAL = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

if (existsSync(".env")) {
  throw new Error("[e2e guard] a .env file is present in the working folder; refusing to start");
}
for (const [key, value] of Object.entries(process.env)) {
  if (/_FILE$/i.test(key) && /^(DATABASE|SUPABASE|S3|INTAKE|STRIPE|POSTMARK)/i.test(key) && value) {
    throw new Error(`[e2e guard] ${key} is set; refusing to start`);
  }
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  let host = "localhost";
  if (first && typeof first === "object") host = first.path ? "localhost" : (first.host ?? "localhost");
  else if (typeof first === "number" && typeof args[1] === "string") host = args[1];
  if (!LOCAL.has(String(host).toLowerCase())) {
    const error = new Error(`[e2e guard] blocked a connection to the non-local host "${host}"`);
    console.error(error.message);
    throw error;
  }
  return connect.apply(this, args);
};
