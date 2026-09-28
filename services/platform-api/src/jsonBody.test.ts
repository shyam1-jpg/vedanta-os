import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { installJsonBody, parseJsonBody } from "./jsonBody.ts";

describe("empty JSON bodies", () => {
  it("treats a blank body as an empty object", () => {
    assert.deepEqual(parseJsonBody(""), {});
    assert.deepEqual(parseJsonBody('{"ok":true}'), { ok: true });
  });

  it("lets a POST with content-type and no body reach the route", async () => {
    const app = Fastify();
    installJsonBody(app);
    app.post("/tick", async (req) => ({ body: req.body }));
    const res = await app.inject({ method: "POST", url: "/tick", headers: { "content-type": "application/json" }, payload: "" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { body: {} });
    await app.close();
  });
});
