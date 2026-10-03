import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXTERNAL_CONNECTIONS } from "./connections.ts";

describe("external connections", () => {
  it("names Sage, Xero, Payday and Hotelkit as not connected", () => {
    assert.deepEqual(EXTERNAL_CONNECTIONS.map(c => c.code), ["sage", "xero", "payday", "hotelkit"]);
    for (const connection of EXTERNAL_CONNECTIONS) {
      assert.equal(connection.status, "not_connected");
      assert.match(connection.detail, /signed-in .+ account is still needed before anything can sync/i);
      assert.equal("apiKey" in connection, false);
      assert.equal("secret" in connection, false);
      assert.equal("balance" in connection, false);
    }
    const payday = EXTERNAL_CONNECTIONS.find(c => c.code === "payday")!;
    assert.equal(payday.product, "UK payroll");
    assert.match(payday.detail, /UK payroll/);
    assert.equal(payday.site, null);
    const hotelkit = EXTERNAL_CONNECTIONS.find(c => c.code === "hotelkit")!;
    assert.equal(hotelkit.site, "https://hotelkit.net/");
    assert.match(hotelkit.product, /hotelkit\.net/);
  });
});
