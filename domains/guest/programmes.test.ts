import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanName, guestCopy, guestFacingProgrammeName, isPublicProgrammeName, nightsBetween, programmeKind, programmePublishState, publicProgrammeName } from "./programmes.ts";

describe("public programmes", () => {
  it("hides private booking holds and HOLDs", () => {
    assert.equal(isPublicProgrammeName("Alex booking"), false);
    assert.equal(isPublicProgrammeName("Jordan Sample booking"), false);
    assert.equal(isPublicProgrammeName("HOLD — kitchen"), false);
    assert.equal(isPublicProgrammeName("OPTION for Sample Yoga"), false);
    assert.equal(isPublicProgrammeName("Sample Circle - Graduate Programme"), true);
    assert.equal(isPublicProgrammeName("Sample Yoga - DAY RETREAT"), true);
  });

  it("hides individual person names (GDPR)", () => {
    assert.equal(isPublicProgrammeName("Alex G"), false, "single surname initial");
    assert.equal(isPublicProgrammeName("Alex Example"), false, "firstname surname");
    assert.equal(isPublicProgrammeName("Sam Sample"), false, "firstname surname");
    assert.equal(isPublicProgrammeName("Jordan Placeholder"), false, "firstname surname");
    assert.equal(isPublicProgrammeName("Riley House"), false, "firstname surname");
    assert.equal(isPublicProgrammeName("Casey Guest"), false, "firstname surname");
    assert.equal(isPublicProgrammeName("Morgan Bee"), false, "firstname surname");
    assert.equal(isPublicProgrammeName("Taylor Person"), false, "firstname surname");
  });

  it("shows named public retreats and organisations", () => {
    assert.equal(isPublicProgrammeName("NORTHSTAR"), true, "single org word");
    assert.equal(isPublicProgrammeName("Kirtan Immersion with Sample Host"), true, "has event word");
    assert.equal(isPublicProgrammeName("Open Gita Circle"), true, "has Gita");
    assert.equal(isPublicProgrammeName("Sample Initiative Hackathon"), true, "has event word");
    assert.equal(isPublicProgrammeName("Placeholder Inc"), true, "has Inc");
    assert.equal(isPublicProgrammeName("Sample Yoga - DAY RETREAT"), true, "yoga + retreat");
    assert.equal(isPublicProgrammeName("Quiet Practice Conference 2027 (Alex)"), true, "has conference");
    assert.equal(isPublicProgrammeName("House Mentorship"), true, "has mentorship");
    assert.equal(isPublicProgrammeName("Sample Circle - Graduate Programme"), true, "has programme");
  });

  it("strips personal attribution from display name", () => {
    assert.equal(publicProgrammeName("Quiet Practice Conference 2027 (Alex)", "Residential retreat"), "Quiet Practice Conference 2027");
    assert.equal(publicProgrammeName("SampleYoga (Jordan)", "Residential retreat"), "SampleYoga");
  });

  it("uses a public title when the house booking name is a person", () => {
    assert.equal(guestFacingProgrammeName("Alex Example", "Spring Retreat", "Residential retreat"), "Spring Retreat");
    assert.equal(guestFacingProgrammeName("Alex Example", null, "Residential retreat"), null);
    const state = programmePublishState({
      name: "Alex Example",
      publicTitle: "Spring Retreat",
      status: "CONFIRMED",
      retreatType: "residential",
      openForGuests: true,
    });
    assert.equal(state.live, true);
    assert.equal(state.publicName, "Spring Retreat");
  });

  it("cleans sheet copy for guests", () => {
    assert.equal(cleanName("Alex Example\nSam Sample"), "Alex Example Sam Sample");
    assert.equal(guestCopy("NORTHSTAR\nCheck-in: Fri 18th at 4pm\nPAID\norganisers at 3pm"), "NORTHSTAR\nCheck-in: Fri 18th at 4pm");
  });

  it("labels kinds and nights", () => {
    assert.equal(programmeKind("day_retreat"), "Day retreat");
    assert.equal(programmeKind("residential"), "Residential retreat");
    assert.equal(nightsBetween("2026-10-23", "2026-10-25"), 2);
  });
});
