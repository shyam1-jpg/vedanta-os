import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

for (const workspace of ["apps/web-admin", "apps/web-guest", "apps/web-staff"]) {
  const result = spawnSync("npm", ["run", "build", "--workspace", workspace], {
    cwd: root,
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const destination = resolve(root, "dist-web");
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(resolve(root, "apps/web-admin/out"), destination, { recursive: true });
await cp(resolve(root, "apps/web-guest/out"), resolve(destination, "book"), { recursive: true });
await cp(resolve(root, "apps/web-staff/out"), resolve(destination, "pocket"), { recursive: true });

await writeFile(
  resolve(destination, "index.html"),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=/book/"><title>The Vedanta Way</title><link rel="canonical" href="/book/"></head><body><p><a href="/book/">Open the guest website</a></p><script>location.replace("/book/")</script></body></html>',
);

console.log("Built guest, house and pocket portals in dist-web/");
