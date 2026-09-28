/** Check a gitignored staff file before it is loaded on the Organisation screen.
 *  Reads db/import/staff-org.local.json, or staff-teams.local.json from the rota branch.
 *  Does not write to the database. Real names stay in the local file.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseOrgImport, placeholderContact } from "../../domains/staff/hierarchy.ts";

const roots = [process.cwd(), resolve(process.cwd(), "../..")];
const names = ["db/import/staff-org.local.json", "db/import/staff-teams.local.json"];
let raw: unknown = null;
let found = "";
for (const root of roots) {
  for (const name of names) {
    const path = resolve(root, name);
    if (existsSync(path)) {
      raw = JSON.parse(readFileSync(path, "utf8"));
      found = path;
      break;
    }
  }
  if (raw) break;
}
if (!raw) {
  console.log("No local file. Copy db/import/staff-org.example.json to db/import/staff-org.local.json and replace the placeholder people there.");
  process.exit(0);
}
const parsed = parseOrgImport(raw);
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}
const placeholders = parsed.people.filter(person => placeholderContact(person.email)).length;
console.log(`Checked ${parsed.people.length} people in ${found}. ${placeholders} still use an example address.`);
console.log("Open Organisation and choose Import local file. Nothing was written.");
