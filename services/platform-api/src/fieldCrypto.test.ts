import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FIELD_PREFIX, openText, sealText } from "./fieldCrypto.ts";

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("field encryption", () => {
  it("round-trips allergen and health notes", () => {
    const prev = process.env.FIELD_ENCRYPTION_KEY;
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    process.env.FIELD_ENCRYPTION_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
    try {
      const sealed = sealText("tree-nut allergy, carries a pen in this story");
      assert.ok(sealed?.startsWith(FIELD_PREFIX));
      assert.equal(sealed?.includes("tree-nut"), false);
      assert.equal(openText(sealed), "tree-nut allergy, carries a pen in this story");
      assert.equal(sealText(sealed), sealed);
      assert.equal(openText(null), null);
    } finally {
      restore("FIELD_ENCRYPTION_KEY", prev);
      restore("NODE_ENV", prevEnv);
    }
  });

  it("decrypts with the previous key after rotation", () => {
    const prev = process.env.FIELD_ENCRYPTION_KEY;
    const older = process.env.FIELD_ENCRYPTION_KEY_PREVIOUS;
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    process.env.FIELD_ENCRYPTION_KEY = Buffer.from("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").toString("base64");
    delete process.env.FIELD_ENCRYPTION_KEY_PREVIOUS;
    const sealed = sealText("ground floor access");
    process.env.FIELD_ENCRYPTION_KEY = Buffer.from("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb").toString("base64");
    process.env.FIELD_ENCRYPTION_KEY_PREVIOUS = Buffer.from("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").toString("base64");
    try { assert.equal(openText(sealed), "ground floor access"); }
    finally {
      restore("FIELD_ENCRYPTION_KEY", prev);
      restore("FIELD_ENCRYPTION_KEY_PREVIOUS", older);
      restore("NODE_ENV", prevEnv);
    }
  });

  it("refuses to start in production without a key", async () => {
    const prev = process.env.FIELD_ENCRYPTION_KEY;
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.FIELD_ENCRYPTION_KEY;
    try {
      const { assertFieldEncryptionReady } = await import("./fieldCrypto.ts");
      assert.throws(() => assertFieldEncryptionReady(), /FIELD_ENCRYPTION_KEY/);
    } finally {
      restore("FIELD_ENCRYPTION_KEY", prev);
      restore("NODE_ENV", prevEnv);
    }
  });
});
