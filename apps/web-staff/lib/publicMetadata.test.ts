import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROPERTY_DESCRIPTION, publicPageMetadata } from "./publicMetadata.ts";

const pages: [string, string][] = [
  ["Book · The Vedanta Way", new URL("../../web-guest/app/layout.tsx", import.meta.url).pathname],
  ["Pocket · The Vedanta Way", new URL("../app/layout.tsx", import.meta.url).pathname],
  ["Sign in · The Vedanta Way", new URL("../../web-admin/app/sign-in/layout.tsx", import.meta.url).pathname],
  ["Guest list · The Vedanta Way", new URL("../../web-admin/app/form/page.tsx", import.meta.url).pathname],
  ["The Vedanta Way", new URL("../../web-admin/app/page.tsx", import.meta.url).pathname],
];

describe("public page metadata", () => {
  it("uses the property description, which is a sentence and not the title", () => {
    assert.equal(PROPERTY_DESCRIPTION, "A Grade II listed Elizabethan estate and luxury retreat centre, set in 75 acres of woodland, meadows and lakes in Lincolnshire.");
    assert.equal(PROPERTY_DESCRIPTION.split("Grade II").length - 1, 1);
    assert.ok(PROPERTY_DESCRIPTION.endsWith("."));
    for (const [title] of pages) {
      const meta = publicPageMetadata(title);
      assert.deepEqual(meta.title, { absolute: title });
      assert.equal(meta.description, PROPERTY_DESCRIPTION);
      assert.notEqual(meta.description, title);
      assert.equal(meta.openGraph && "title" in meta.openGraph ? meta.openGraph.title : null, title);
      assert.equal(meta.openGraph && "description" in meta.openGraph ? meta.openGraph.description : null, PROPERTY_DESCRIPTION);
      assert.equal(meta.twitter && "title" in meta.twitter ? meta.twitter.title : null, title);
      assert.equal(meta.twitter && "description" in meta.twitter ? meta.twitter.description : null, PROPERTY_DESCRIPTION);
      assert.equal(!PROPERTY_DESCRIPTION.includes(title), true);
    }
  });

  it("points every public page at that description", () => {
    for (const [title, file] of pages) {
      const source = readFileSync(file, "utf8");
      assert.match(source, new RegExp(`publicPageMetadata\\("${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\)`));
    }
    const copies = [
      new URL("./publicMetadata.ts", import.meta.url),
      new URL("../../web-guest/lib/publicMetadata.ts", import.meta.url),
      new URL("../../web-admin/lib/publicMetadata.ts", import.meta.url),
    ];
    for (const file of copies) {
      const source = readFileSync(file, "utf8");
      assert.ok(source.includes(PROPERTY_DESCRIPTION));
      assert.equal(source.includes("Retreat Center"), false);
      assert.equal(source.includes("Oway"), false);
    }
  });
});
