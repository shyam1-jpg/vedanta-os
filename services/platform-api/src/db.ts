import fs from "node:fs";
import pg from "pg";

const connectionString = process.env.DATABASE_URL ?? "postgres://vedanta:vedanta@localhost:5432/vedanta";

function caCert(): string | undefined {
  if (process.env.DATABASE_CA_CERT?.trim()) return process.env.DATABASE_CA_CERT;
  if (process.env.PGSSLROOTCERT?.trim()) return fs.readFileSync(process.env.PGSSLROOTCERT, "utf8");
  return undefined;
}

/**
 * Hosted Postgres must present a certificate the process trusts.
 * rejectUnauthorized is never false in production. Local Docker does not use TLS.
 * PGSSL_INSECURE=1 is a local-only escape hatch and throws in production.
 */
export function sslFor(url: string): pg.ClientConfig["ssl"] {
  const lower = url.toLowerCase();
  const production = process.env.NODE_ENV === "production";
  const hosted = /render\.com|neon\.tech|amazonaws\.com|supabase\.co|sslmode=require|sslmode=verify-full|sslmode=verify-ca/.test(lower);
  const force = process.env.PGSSL === "1" || process.env.PGSSLMODE === "require" || process.env.PGSSLMODE === "verify-full";
  if (!production && !hosted && !force) return undefined;
  if (process.env.PGSSL_INSECURE === "1") {
    if (production) throw new Error("PGSSL_INSECURE is not allowed when NODE_ENV=production");
    return { rejectUnauthorized: false };
  }
  const ca = caCert();
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

export function clientConfig(url = connectionString): pg.ClientConfig {
  return { connectionString: url, ssl: sslFor(url) };
}

export const pool = new pg.Pool({ ...clientConfig(), max: 10 });
export type Q = pg.PoolClient;
export async function tx<T>(fn: (c: Q) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
