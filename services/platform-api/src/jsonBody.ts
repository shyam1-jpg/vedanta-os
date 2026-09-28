/**
 * Fastify rejects an empty application/json body before the route runs.
 * Clock-in, session revoke, SOP delete and several other buttons send no body.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";

export function parseJsonBody(raw: string): unknown {
  if (raw === "") return {};
  return JSON.parse(raw);
}

export function installJsonBody(app: FastifyInstance) {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const raw = typeof body === "string" ? body : body.toString("utf8");
    (req as FastifyRequest & { rawBody?: string }).rawBody = raw;
    try {
      done(null, parseJsonBody(raw));
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });
}
