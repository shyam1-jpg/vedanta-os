import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deliverSms } from "./sms.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "feedback.ts"), "utf8");
const auto = readFileSync(join(here, "autocomms.ts"), "utf8");

describe("feedback wiring", () => {
  it("seals free text, emails through the helper, and will not send the invite twice", () => {
    assert.match(src, /sealText/);
    assert.match(src, /sendEmail/);
    assert.match(src, /on conflict \(group_id\) do update/);
    assert.match(src, /sent_at is null/);
    assert.match(src, /rate_limited/);
    assert.match(src, /maintenance_ticket/);
    assert.match(src, /deliverSms/);
    assert.equal(src.includes("body.author"), false);
  });

  it("stops the old reply-to-email feedback note", () => {
    const schedule = auto.slice(auto.indexOf("const schedule"), auto.indexOf("Cancel any unsent"));
    assert.equal(schedule.includes('"feedback"'), false);
    assert.match(auto, /feedback_form/);
  });
});

describe("sms adapter", () => {
  it("stays off until Twilio is configured, and can post when it is", async () => {
    assert.equal(await deliverSms({}, { to: "+447000000000", body: "Hello" }), "disabled");
    let called = "";
    const status = await deliverSms(
      { TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "token", TWILIO_FROM: "+15005550006" },
      { to: "+447000000000", body: "Thank you for staying with us." },
      async (url) => { called = String(url); return new Response("", { status: 201 }); },
    );
    assert.equal(status, "sent");
    assert.equal(called.includes("api.twilio.com"), true);
  });
});
