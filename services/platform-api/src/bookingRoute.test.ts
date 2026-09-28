import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openText, sealText } from "./fieldCrypto.ts";
import { openParty, openPartyBundle, sealParty } from "./bookingRoute.ts";
import { validateCapture } from "../../../domains/guest/booking.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("booking route persistence", () => {
  it("seals the party the enquiry stores and opens the same allergens", () => {
    const parsed = validateCapture({
      name: "Ada Lovelace",
      email: "ada@example.invalid",
      people: 1,
      arrival: "2026-10-02",
      departure: "2026-10-04",
      party: [{ given_name: "Ada", family_name: "Lovelace", diet: ["vegan"], allergens: [{ code: "peanuts", severity: "ANAPHYLAXIS" }], other: "EpiPen" }],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const sealed = sealParty(parsed.capture.party);
    assert.ok(sealed?.startsWith("enc1:"));
    assert.equal(openText(sealed)?.includes("peanuts"), true);
    const opened = openParty(sealed) as { allergens: { code: string; severity: string }[] }[];
    assert.equal(opened[0].allergens[0].code, "peanuts");
    assert.equal(opened[0].allergens[0].severity, "ANAPHYLAXIS");
    assert.equal(sealText(sealed!), sealed);
    const withAccess = sealParty(parsed.capture.party, { access: ["step_free", "ground_floor"], access_note: "Example ramp" });
    const bundle = openPartyBundle(withAccess);
    assert.deepEqual(bundle.access, ["step_free", "ground_floor"]);
    assert.equal(bundle.access_note, "Example ramp");
    assert.equal((bundle.party as { allergens: { code: string }[] }[])[0].allergens[0].code, "peanuts");
  });
});

describe("guest booking regressions", () => {
  const guestPortal = readFileSync(join(here, "guestPortal.ts"), "utf8");
  const guests = readFileSync(join(here, "guests.ts"), "utf8");
  const page = readFileSync(join(here, "../../../apps/web-guest/app/page.tsx"), "utf8");

  it("resend-code does not create an account or rewrite the display name", () => {
    const start = guestPortal.indexOf('"/guest/resend-code"');
    const body = guestPortal.slice(start, start + 1800);
    assert.equal(body.includes("upsertGuestWithCode"), false);
    assert.equal(body.includes("insert into guest_account"), false);
    assert.equal(body.includes("display_name"), true);
    assert.match(body, /update guest_account set access_code_hash/);
    assert.equal(/display_name\s*=/.test(body), false);
  });

  it("Guest 360 reads dietary notes from the guest account and does not interpolate the tenant id", () => {
    assert.match(guests, /ga\.dietary_notes/);
    assert.equal(guests.includes("p.dietary_notes"), false);
    assert.equal(guests.includes("tenant_id=${"), false);
    assert.match(guests, /update guest_account set/);
  });

  it("a failed card page does not submit the enquiry twice", () => {
    const start = page.indexOf("await doEnquiry({ finish: false })");
    const end = page.indexOf("Pay deposit & save my place");
    const handler = page.slice(start, end);
    assert.equal((handler.match(/doEnquiry\(/g) ?? []).length, 1);
    const caught = handler.slice(handler.indexOf("catch"));
    assert.equal(caught.includes("doEnquiry("), false);
  });
});
