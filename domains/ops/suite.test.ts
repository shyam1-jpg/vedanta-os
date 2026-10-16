import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EVENT_IDEAS = `New event ideas for The Vedanta
Digital Detox Night. A gong bath, a quiet night's sleep and sunrise yoga with breakfast. No phones.
Bring Your Own Question. A small-group chat with a Vedanta teacher about what's really on your mind.
Sunrise to Sunset Vow Day. Yoga, silence, simple food and journalling, ending with a fire ceremony.
Local Day Retreats. Yoga, a talk, lunch and a garden walk, just outside Lincoln.
Festival Weekends. Diwali, Janmashtami and Holi with music, colour and a big feast.
Team Wellbeing Days. Mindfulness, a fresh vegetarian lunch and quiet space for your team.
Love & Light (Valentine's). Partner yoga, a candlelit dinner and diya lighting, with a self-love version for friends.
Thank You Amma (Mother's Day). A special lunch, a flower garland and relaxing yoga nidra for mums.
Father's Day Garden Morning. Gardening with Dad, a short talk and a hearty lunch.
New Year Intentions. Meditation and a fire ceremony to start the year, then a feast.
Full Moon Nights. Monthly outdoor meditation, then hot chai.
`;
import {
  audienceAllows,
  buildTextPdf,
  canMoveComplaint,
  mayOperate,
  mayPublish,
  nextOpenDue,
  parseEventIdeas,
  PUBLISH_ROLES,
  richTextToPlain,
  sanitizeRichText,
  assigneeCanMarkDone,
  staffMayComplete,
  taskIsVisible,
} from "./suite.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("content publishing", () => {
  it("is granted only by the content.publish permission", () => {
    assert.equal(mayPublish(["group.read", "task.write"]), false);
    assert.equal(mayPublish(["content.publish"]), true);
    assert.equal(mayOperate(["group.read", "task.write", "maintenance.report"]), false);
    assert.equal(mayOperate(["leave.approve_hod"]), true);
    assert.equal(mayOperate(["content.publish"]), true);
  });

  it("is seeded only for the owner and the general manager", () => {
    const seed = readFileSync(join(here, "../../db/seed/0021_staff_ops_content.sql"), "utf8");
    const grant = seed.split("INSERT INTO role_permission").pop() ?? "";
    for (const role of PUBLISH_ROLES) assert.match(grant, new RegExp(role));
    assert.doesNotMatch(grant, /FRONT_OFFICE_MANAGER|HK_SUPERVISOR|RECEPTIONIST|KITCHEN|HEAD_CHEF/);
  });
});

describe("read rights and staff task completion", () => {
  it("lets the whole house read an article with no audience", () => {
    assert.equal(audienceAllows([], { department: "KITCHEN", role: "KITCHEN" }), true);
    assert.equal(audienceAllows(["KITCHEN"], { department: "KITCHEN", role: "KITCHEN" }), true);
    assert.equal(audienceAllows(["KITCHEN"], { department: "HK", role: "HK_ATTENDANT" }), false);
    assert.equal(audienceAllows(["SYSTEM_OWNER"], { department: null, role: "SYSTEM_OWNER" }), true);
  });

  it("hides a task until its show-later time", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    assert.equal(taskIsVisible("2026-10-16T12:00:00Z", now, false), false);
    assert.equal(taskIsVisible("2026-10-16T12:00:00Z", now, true), true);
    assert.equal(taskIsVisible(null, now, false), true);
  });

  it("lets staff finish only a task assigned to them", () => {
    const task = { assigned_staff_id: "a", assigned_staff_ids: ["b"] };
    assert.equal(staffMayComplete(task, "a"), true);
    assert.equal(staffMayComplete(task, "b"), true);
    assert.equal(staffMayComplete(task, "c"), false);
    assert.equal(assigneeCanMarkDone("assigned"), true);
    assert.equal(assigneeCanMarkDone("completed"), false);
    assert.equal(assigneeCanMarkDone("cancelled"), false);
  });
});

describe("recurrence, complaints and handbook text", () => {
  it("rolls a daily task to the next future due date", () => {
    const next = nextOpenDue("2026-10-01T09:00:00Z", "daily", "2026-10-20", new Date("2026-10-15T12:00:00Z"));
    assert.equal(next, "2026-10-16T09:00:00.000Z");
    assert.equal(nextOpenDue("2026-10-01T09:00:00Z", "daily", "2026-10-10", new Date("2026-10-15T12:00:00Z")), null);
  });

  it("moves a complaint along its states", () => {
    assert.equal(canMoveComplaint("open", "acknowledged"), true);
    assert.equal(canMoveComplaint("open", "resolved"), false);
    assert.equal(canMoveComplaint("resolved", "closed"), true);
  });

  it("strips scripts from handbook html and keeps a printable paragraph", () => {
    const clean = sanitizeRichText(`<p onclick="alert(1)">Boil<strong> water</strong></p><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="https://vedanta.example/sop">SOP</a>`);
    assert.equal(clean.includes("script"), false);
    assert.equal(clean.includes("onclick"), false);
    assert.equal(clean.includes("javascript"), false);
    assert.match(clean, /href="https:\/\/vedanta\.example\/sop"/);
    assert.match(richTextToPlain(clean), /Boil water/);
  });

  it("builds a PDF that names the article", () => {
    const pdf = new TextDecoder().decode(buildTextPdf("Kitchen risk", "Wash hands. Check the oil."));
    assert.match(pdf, /^%PDF-1\.4/);
    assert.match(pdf, /Kitchen risk/);
    assert.match(pdf, /%%EOF/);
  });
});

describe("event idea seed", () => {
  it("turns each line after the title into one idea", () => {
    const ideas = parseEventIdeas(EVENT_IDEAS);
    assert.equal(ideas.length, 11);
    assert.equal(ideas[0].title, "Digital Detox Night");
    assert.match(ideas[0].body, /gong bath/);
    assert.equal(ideas.at(-1)?.title, "Full Moon Nights");
    assert.equal(ideas.some(idea => /New event ideas/.test(idea.title)), false);
  });
});
