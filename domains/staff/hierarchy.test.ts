import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLadder,
  canEditOrg,
  dropOnDepartment,
  inferLevel,
  parseOrgImport,
  placeholderContact,
  reassign,
  seesPersonalContact,
  structureCycle,
  trainingStatus,
  undoChange,
  visibleContact,
  snapshot,
  type OrgSeat,
  type OrgViewer,
} from "./hierarchy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function seat(partial: Partial<OrgSeat> & Pick<OrgSeat, "id" | "title" | "department" | "level">): OrgSeat {
  return {
    departmentName: partial.department,
    holderId: partial.holderId ?? null,
    holderName: partial.holderName ?? null,
    managerId: partial.managerId ?? null,
    dottedIds: partial.dottedIds ?? [],
    training: partial.training ?? "none",
    email: partial.email ?? null,
    personalPhone: partial.personalPhone ?? null,
    workPhone: partial.workPhone ?? null,
    ...partial,
  };
}

const house: OrgSeat[] = [
  seat({ id: "gm", title: "General manager", department: "MGMT", level: "gm", holderId: "u-gm", holderName: "Morgan Example", email: "morgan.example@example.invalid", personalPhone: "01632 960000", workPhone: "01632 960100" }),
  seat({ id: "hk-head", title: "Housekeeping head", department: "HK", level: "head", holderId: "u-hk", holderName: "Harper Example", managerId: "gm", email: "harper.example@example.invalid", personalPhone: "01632 960001" }),
  seat({ id: "hk-lead", title: "Housekeeping lead", department: "HK", level: "lead", holderId: "u-lead", holderName: "Hayden Example", managerId: "hk-head" }),
  seat({ id: "hk-staff", title: "Housekeeping assistant", department: "HK", level: "staff", holderId: "u-staff", holderName: "Harley Example", managerId: "hk-lead", email: "harley.example@example.invalid", personalPhone: "01632 960002", workPhone: "01632 960102", training: "cleared" }),
  seat({ id: "kit-head", title: "Kitchen head", department: "KITCHEN", level: "head", holderId: "u-kit", holderName: "Kerry Example", managerId: "gm" }),
  seat({ id: "dev-staff", title: "Development assistant", department: "DEVELOPMENT", level: "staff", holderName: null, managerId: "gm", training: "none" }),
];

const staffViewer: OrgViewer = { userId: "u-staff", role: "HK_ATTENDANT", positionIds: ["hk-staff"] };
const leadViewer: OrgViewer = { userId: "u-lead", role: "HK_SUPERVISOR", positionIds: ["hk-lead"] };
const headViewer: OrgViewer = { userId: "u-hk", role: "HK_SUPERVISOR", positionIds: ["hk-head"] };
const gmViewer: OrgViewer = { userId: "u-gm", role: "GENERAL_MANAGER", positionIds: ["gm"] };

describe("reporting lines", () => {
  it("rejects a reporting line that goes in a circle", () => {
    const moved = reassign(house, { positionId: "gm", managerId: "hk-staff", effectiveOn: "2026-09-28" }, { allowMultipleGm: true });
    assert.equal(moved.ok, false);
    if (!moved.ok) assert.match(moved.error, /circle/);
    assert.equal(structureCycle([
      { id: "a", managerId: "b", dottedIds: [] },
      { id: "b", managerId: "a", dottedIds: [] },
    ]), true);
    const dotted = reassign(house, { positionId: "hk-head", dottedIds: ["hk-staff"], effectiveOn: "2026-09-28" }, { allowMultipleGm: false });
    assert.equal(dotted.ok, false);
  });

  it("moves a person onto a new manager and can undo it", () => {
    const before = snapshot(house.find(item => item.id === "hk-staff")!);
    const moved = reassign(house, { positionId: "hk-staff", managerId: "kit-head", department: "KITCHEN", effectiveOn: "2026-10-01" }, { allowMultipleGm: false });
    assert.equal(moved.ok, true);
    if (!moved.ok) return;
    const staff = moved.seats.find(item => item.id === "hk-staff")!;
    assert.equal(staff.managerId, "kit-head");
    assert.equal(staff.department, "KITCHEN");
    const back = undoChange(moved.seats, before, "hk-staff");
    assert.equal(back.ok, true);
    if (!back.ok) return;
    const restored = back.seats.find(item => item.id === "hk-staff")!;
    assert.equal(restored.managerId, "hk-lead");
    assert.equal(restored.department, "HK");
  });

  it("keeps a single general manager at the top unless the house allows more", () => {
    const second = reassign(house, { positionId: "hk-head", level: "gm", managerId: null, effectiveOn: "2026-09-28" }, { allowMultipleGm: false });
    assert.equal(second.ok, false);
    if (!second.ok) assert.match(second.error, /one general manager/);
    const allowed = reassign(house, { positionId: "hk-head", level: "gm", managerId: null, effectiveOn: "2026-09-28" }, { allowMultipleGm: true });
    assert.equal(allowed.ok, true);
    const demoted = reassign(house, { positionId: "gm", managerId: "hk-head", effectiveOn: "2026-09-28" }, { allowMultipleGm: false });
    assert.equal(demoted.ok, false);
  });

  it("drops a person into a department under that department's head", () => {
    const moved = dropOnDepartment(house, "hk-staff", "KITCHEN", "2026-09-28", false);
    assert.equal(moved.ok, true);
    if (!moved.ok) return;
    const staff = moved.seats.find(item => item.id === "hk-staff")!;
    assert.equal(staff.department, "KITCHEN");
    assert.equal(staff.managerId, "kit-head");
  });
});

describe("who can see a phone number", () => {
  it("shows phone and email to the general manager and to that person's managers", () => {
    const person = house.find(item => item.id === "hk-staff")!;
    assert.equal(seesPersonalContact(gmViewer, person, house), true);
    assert.equal(seesPersonalContact(headViewer, person, house), true);
    assert.equal(seesPersonalContact(leadViewer, person, house), true);
    const full = visibleContact(person, gmViewer, house, "none");
    assert.equal(full.email, "harley.example@example.invalid");
    assert.equal(full.phone, "01632 960002");
    const kitchen = house.find(item => item.id === "kit-head")!;
    assert.equal(seesPersonalContact(headViewer, kitchen, house), false);
  });

  it("shows staff the work contact only, or nothing, from the setting", () => {
    const person = house.find(item => item.id === "hk-staff")!;
    const work = visibleContact(person, staffViewer, house, "work");
    assert.equal(work.email, "harley.example@example.invalid");
    assert.equal(work.phone, null);
    assert.equal(work.workPhone, "01632 960102");
    const hidden = visibleContact(person, staffViewer, house, "none");
    assert.deepEqual(hidden, { email: null, phone: null, workPhone: null });
  });
});

describe("the ladder", () => {
  it("ranks the house under the general manager and keeps a vacant seat", () => {
    const tree = buildLadder(house);
    assert.equal(tree[0].name, "Morgan Example");
    assert.equal(tree[0].reports, 3);
    const vacant = tree[0].children.find(child => child.id === "dev-staff");
    assert.equal(vacant?.vacant, true);
    assert.equal(vacant?.name, "Vacant");
    const hk = buildLadder(house, "HK");
    assert.equal(hk.length, 1);
    assert.equal(hk[0].name, "Harper Example");
    assert.equal(hk[0].children[0].children[0].trainingLabel, "Cleared for unsupervised work");
    assert.equal(trainingStatus(0, false), "none");
    assert.equal(trainingStatus(2, false), "not_cleared");
  });

  it("lets the system owner, the general manager, and an admin with the permission edit the tree", () => {
    assert.equal(canEditOrg("SYSTEM_OWNER"), true);
    assert.equal(canEditOrg("GENERAL_MANAGER"), true);
    assert.equal(canEditOrg("RECEPTIONIST"), false);
    assert.equal(canEditOrg("RECEPTIONIST", ["org.manage"]), true);
  });
});

describe("import", () => {
  it("reads a team file and refuses a row without an email", () => {
    const file = JSON.parse(readFileSync(join(root, "db/import/staff-org.example.json"), "utf8"));
    const parsed = parseOrgImport(file);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.ok(parsed.people.every(person => placeholderContact(person.email)));
    assert.ok(parsed.people.every(person => person.name.includes("Example")));
    assert.equal(inferLevel("HEAD_CHEF"), "head");
    assert.equal(inferLevel("KITCHEN_PORTER"), "staff");
    const broken = parseOrgImport({ people: [{ name: "Example Person", email: "not-an-email", department: "KITCHEN" }] });
    assert.equal(broken.ok, false);
  });

  it("keeps real names out of the example seed", () => {
    const seed = readFileSync(join(root, "db/seed/0030_org_examples.sql"), "utf8");
    assert.match(seed, /example\.invalid/);
    assert.equal(seed.includes("@vedanta"), false);
    assert.match(seed, /Example/);
    assert.match(seed, /department_section/);
  });
});
