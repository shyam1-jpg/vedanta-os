import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { consumeSessionFragment, FRAGMENT_STRIP_SCRIPT, pocketSignInOffer, queryCarriesToken, safeNotice } from "./handoff.ts";

const TOKEN = "staffsessiontokenvalue1";

describe("consumeSessionFragment", () => {
  it("reads a fragment token and returns a URL with the fragment removed", () => {
    const result = consumeSessionFragment({ hash: `#token=${TOKEN}`, search: "", pathname: "/pocket/" });
    assert.equal(result.action, "store");
    if (result.action !== "store") return;
    assert.equal(result.token, TOKEN);
    assert.equal(result.url, "/pocket/");
    assert.equal(result.url.includes(TOKEN), false);
    assert.equal(result.url.includes("#"), false);
    assert.equal(result.url.includes("?"), false);
  });

  it("keeps an unrelated query while stripping the fragment", () => {
    const result = consumeSessionFragment({
      hash: `#token=${TOKEN}`,
      search: "?from=desk",
      pathname: "/pocket/",
    });
    assert.equal(result.action, "store");
    if (result.action !== "store") return;
    assert.equal(result.url, "/pocket/?from=desk");
    assert.equal(result.url.includes(TOKEN), false);
  });

  it("refuses a query-string token and does not return or keep it", () => {
    const leaked = "querystringtokenvalue1";
    const result = consumeSessionFragment({
      hash: `#token=${TOKEN}`,
      search: `?token=${leaked}`,
      pathname: "/pocket/",
    });
    assert.equal(result.action, "reject");
    assert.equal(JSON.stringify(result).includes(leaked), false);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
    if (result.action === "reject") assert.equal(result.url, "/pocket/");
  });

  it("refuses a short or malformed fragment token", () => {
    const result = consumeSessionFragment({ hash: "#token=short", search: "", pathname: "/pocket/" });
    assert.equal(result.action, "reject");
    assert.equal(JSON.stringify(result).includes("short"), false);
  });

  it("ignores a hash that is not a session handoff", () => {
    const result = consumeSessionFragment({ hash: "#clock", search: "", pathname: "/pocket/" });
    assert.deepEqual(result, { action: "none", url: "/pocket/", error: null });
  });

  it("shows a callback error without treating it as a token", () => {
    const result = consumeSessionFragment({
      hash: "",
      search: "?error=Sign-in%20expired%2C%20please%20try%20again",
      pathname: "/pocket/",
    });
    assert.equal(result.action, "none");
    if (result.action !== "none") return;
    assert.equal(result.error, "Sign-in expired, please try again");
    assert.match(result.url, /error=/);
  });

  it("strips an error query that is itself a token", () => {
    const result = consumeSessionFragment({
      hash: "",
      search: `?error=${TOKEN}`,
      pathname: "/pocket/",
    });
    assert.equal(result.action, "none");
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
    if (result.action === "none") assert.equal(result.error, "Sign-in did not complete. Try again.");
  });
});

describe("fragment strip script", () => {
  function run(loc: { pathname: string; search: string; hash: string }) {
    const store = new Map<string, string>();
    let replaced = "";
    const context = {
      location: { ...loc, origin: "https://app.parslia.net" },
      sessionStorage: {
        setItem: (key: string, value: string) => store.set(key, value),
        getItem: (key: string) => store.get(key) ?? null,
      },
      history: { replaceState: (_state: null, _title: string, url: string) => { replaced = url; } },
      URLSearchParams,
    };
    vm.runInNewContext(FRAGMENT_STRIP_SCRIPT, context);
    return { store, replaced };
  }

  it("stores a fragment token and strips it before paint", () => {
    const result = run({ pathname: "/pocket/", search: "", hash: `#token=${TOKEN}` });
    assert.equal(result.store.get("vedanta.staff.token"), TOKEN);
    assert.equal(result.store.get("vedanta.staff.handoff-from-link"), "1");
    assert.equal(result.replaced, "https://app.parslia.net/pocket/");
    assert.equal(result.replaced.includes(TOKEN), false);
    assert.equal(result.replaced.includes("#"), false);
  });

  it("refuses a query token without storing or echoing it", () => {
    const leaked = "querystringtokenvalue1";
    const result = run({ pathname: "/pocket/", search: `?token=${leaked}`, hash: "" });
    assert.equal(result.store.has("vedanta.staff.token"), false);
    assert.equal(result.replaced, "https://app.parslia.net/pocket/");
    assert.equal(JSON.stringify([...result.store.values()]).includes(leaked), false);
  });
});

describe("queryCarriesToken", () => {
  it("detects token in the query and ignores the fragment", () => {
    assert.equal(queryCarriesToken(`?token=${TOKEN}`), true);
    assert.equal(queryCarriesToken(""), false);
    assert.equal(queryCarriesToken("?error=hello"), false);
  });
});

describe("safeNotice", () => {
  it("hides notices that look like session tokens", () => {
    assert.equal(safeNotice(TOKEN), "Sign-in did not complete. Try again.");
    assert.equal(safeNotice("Use Microsoft 365."), "Use Microsoft 365.");
  });
});

describe("pocketSignInOffer", () => {
  it("shows the email form only when email sign-in is enabled", () => {
    assert.equal(pocketSignInOffer(null), "pending");
    assert.equal(pocketSignInOffer({ email: true, microsoft: true }), "email");
    assert.equal(pocketSignInOffer({ email: true, microsoft: false }), "email");
  });

  it("offers Microsoft when email sign-in is off and Microsoft is configured", () => {
    assert.equal(pocketSignInOffer({ email: false, microsoft: true }), "microsoft");
  });

  it("asks for a manager link when no staff sign-in method is configured", () => {
    assert.equal(pocketSignInOffer({ email: false, microsoft: false }), "manager");
  });
});

describe("Pocket page wiring", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

  it("stores the handoff on the staff key and does not read the admin key", () => {
    assert.match(page, /vedanta\.staff\.token/);
    assert.equal(page.includes("vedanta.token"), false);
    assert.match(page, /consumeSessionFragment/);
    assert.match(page, /history\.replaceState/);
    assert.match(page, /surface !== "STAFF"/);
    assert.match(page, /\/auth\/microsoft\?surface=staff/);
    assert.match(page, /Sign in with Microsoft 365/);
    assert.match(page, /Ask your manager for a sign-in link/);
    assert.equal(page.includes("console."), false);
  });

  it("does not read a session token from the query string", () => {
    assert.equal(page.includes('get("token")'), false);
    assert.equal(page.includes("searchParams.get(\"token\")"), false);
    assert.match(page, /queryCarriesToken|consumeSessionFragment/);
  });
});
