import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, "roomAssign.ts"), "utf8");
const occupancy = readFileSync(join(dir, "occupancy.ts"), "utf8");
const server = readFileSync(join(dir, "server.ts"), "utf8");
const domain = readFileSync(join(dir, "../../../domains/groups/roomAssign.ts"), "utf8");

describe("organiser room assignment wiring", () => {
  it("scopes every organiser read and write to the session's groups", () => {
    assert.match(src, /id = any\(\$2::uuid\[\]\)/);
    assert.match(src, /session\.groupIds\.includes\(groupId\)/);
    assert.match(src, /That retreat is not on your list/);
    assert.match(src, /form_token=\$1/);
    assert.match(src, /where s\.token=\$1/);
    assert.match(src, /email_verified/);
    assert.equal(src.includes("startsWith(token"), false);
  });

  it("reuses the guest access-code rules, writes people onto room occupancy, and mails through the shared helper", () => {
    assert.match(src, /accessOutcome/);
    assert.match(src, /organiserCodeCheck/);
    assert.match(src, /nextFailedAttempts/);
    assert.match(src, /publicLoginDetail/);
    assert.match(domain, /accessOutcome/);
    assert.match(src, /room_occupancy/);
    assert.match(src, /person_id/);
    assert.match(src, /sendEmail/);
    assert.match(src, /kind: "organiser_rooms"/);
    assert.match(src, /actor_type/);
    assert.match(src, /hashOrganiserCode/);
    assert.match(src, /payload: \{ rotated: true/);
    assert.equal(src.includes("ALLOW_UNVERIFIED"), false);
    assert.equal(src.includes("decideBookingGate"), false);
  });

  it("treats a held room as taken for any other group, and registers the routes", () => {
    assert.match(occupancy, /group_room_hold/);
    assert.match(occupancy, /room_held/);
    assert.match(server, /roomAssignRoutes/);
    assert.match(server, /remindRoomLists/);
  });

  it("keeps allergen details off the organiser board and reminds through the shared mail helper", () => {
    const board = src.slice(src.indexOf("async function organiserBoard"), src.indexOf("function allowAssign"));
    assert.equal(board.includes("allergens"), false);
    assert.equal(board.includes("diet_notes"), false);
    assert.match(board, /organiserClientView/);
    const attendees = src.slice(src.indexOf('"/public/organiser/attendees"'), src.indexOf('"/public/organiser/attendees/remove"'));
    assert.equal(attendees.includes("diet_profile"), false);
    assert.match(src, /export async function remindRoomLists/);
    assert.match(src, /organiser_room_reminder/);
    assert.match(src, /on conflict do nothing/);
    assert.match(domain, /function autoAssign/);
    assert.equal(src.includes("ALLOW_UNVERIFIED"), false);
    assert.equal(src.includes("decideBookingGate"), false);
  });
});
