import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { audienceFromState, audienceFromSurface, sessionErrorLocation, sessionHandoffLocation, stateForAudience } from "./session-handoff.ts";

const TOKEN = "staffsessiontokenvalue1";
const WEB = "https://app.parslia.net";

describe("audienceFromSurface", () => {
  it("issues a STAFF session only for the staff surface", () => {
    assert.equal(audienceFromSurface("staff"), "STAFF");
    assert.equal(audienceFromSurface(" Staff "), "STAFF");
    assert.equal(audienceFromSurface(["staff"]), "STAFF");
  });

  it("keeps the admin door as the default", () => {
    assert.equal(audienceFromSurface(undefined), "ADMIN");
    assert.equal(audienceFromSurface("admin"), "ADMIN");
    assert.equal(audienceFromSurface("staff/../admin"), "ADMIN");
    assert.equal(audienceFromSurface(""), "ADMIN");
  });
});

describe("state audience hint", () => {
  it("round-trips the door without putting a session token in the state", () => {
    const staff = stateForAudience("STAFF", "noncevalue");
    const admin = stateForAudience("ADMIN", "noncevalue");
    assert.equal(audienceFromState(staff), "STAFF");
    assert.equal(audienceFromState(admin), "ADMIN");
    assert.equal(staff.includes("token"), false);
    assert.equal(audienceFromState("tampered"), null);
  });
});

describe("sessionHandoffLocation", () => {
  it("lands staff in Pocket with the token in the fragment", () => {
    const location = sessionHandoffLocation("STAFF", TOKEN, WEB);
    const url = new URL(location);
    assert.equal(url.origin, WEB);
    assert.equal(url.pathname, "/pocket/");
    assert.equal(url.search, "");
    assert.equal(url.hash, `#token=${TOKEN}`);
    assert.equal(url.searchParams.has("token"), false);
  });

  it("lands the house app on /sign-in/ the same way", () => {
    const url = new URL(sessionHandoffLocation("ADMIN", TOKEN, WEB + "/"));
    assert.equal(url.pathname, "/sign-in/");
    assert.equal(url.search, "");
    assert.equal(url.hash, `#token=${TOKEN}`);
  });

  it("does not double the pocket path when STAFF_WEB_URL already includes it", () => {
    const url = new URL(sessionHandoffLocation("STAFF", TOKEN, WEB, "https://app.parslia.net/pocket"));
    assert.equal(url.pathname, "/pocket/");
    assert.equal(url.hash, `#token=${TOKEN}`);
    assert.equal(url.search, "");
  });

  it("refuses to put an unsafe token on a redirect and does not echo it", () => {
    assert.throws(
      () => sessionHandoffLocation("STAFF", "bad token", WEB),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message.includes("bad token"), false);
        return true;
      },
    );
  });
});

describe("sessionErrorLocation", () => {
  it("sends staff failures back to Pocket without a session token", () => {
    const url = new URL(sessionErrorLocation("STAFF", "Sign-in expired, please try again", WEB));
    assert.equal(url.pathname, "/pocket/");
    assert.equal(url.hash, "");
    assert.equal(url.searchParams.get("error"), "Sign-in expired, please try again");
    assert.equal(url.searchParams.has("token"), false);
  });

  it("sends house failures back to the admin sign-in page", () => {
    const url = new URL(sessionErrorLocation("ADMIN", "Microsoft did not accept the sign-in", WEB));
    assert.equal(url.pathname, "/sign-in/");
    assert.equal(url.searchParams.get("error"), "Microsoft did not accept the sign-in");
  });

  it("drops an error that contains a token", () => {
    const url = new URL(sessionErrorLocation("STAFF", `failed token=${TOKEN}`, WEB));
    assert.equal(url.searchParams.get("error"), "Sign-in did not complete. Try again.");
    assert.equal(url.toString().includes(TOKEN), false);
  });
});

describe("Microsoft callback wiring", () => {
  const src = readFileSync(new URL("./microsoft.ts", import.meta.url), "utf8");

  it("uses the handoff helper and does not hard-code an admin audience", () => {
    assert.match(src, /sessionHandoffLocation\(audience/);
    assert.match(src, /audienceFromSurface\(req\.query\.surface\)/);
    assert.doesNotMatch(src, /'ADMIN'/);
    assert.match(src, /\$4/);
    assert.doesNotMatch(src, /console\.(log|info|debug|warn|error)/);
  });
});
