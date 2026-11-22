// Decision Engine — rules (staff), detect → cooldown → act (log / notify / support queue).
import { as } from "../../test/grants";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDecisionEngine as E, runEngine } from "./mockDecisionEngine";
import { __resetAttendanceForTests } from "./mockAttendance";
import { mockSupport } from "./mockProfile";
import { mockMakeup } from "./mockMakeup";
import { restoreDemoState, saveDemoState } from "./persist";
import { organizations } from "../../fixtures/directory";

const S = "demo-staff";
const T = "demo-teacher";
const ORG = organizations[0].id;
const ruleId = async (kind: string) => (await E.listRules(as(S)))!.find((r) => r.kind === kind)!.id;
const queueNames = async () =>
  (await mockSupport.listNeedsSupport(as(T))).map((i) => i.learnerName).sort();

beforeEach(() => {
  __resetAttendanceForTests(); // also resets the engine + rules
  window.localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("Decision Engine — access", () => {
  it("rules, events, log and job are for the org's staff only", async () => {
    expect((await E.listRules(as(S)))!.length).toBe(13); // + studio_inactive (22/11, off by default)
    for (const other of [T, "demo-teacher-2", "demo-learner", "demo-guardian"]) {
      expect(await E.listRules(as(other))).toBeNull();
      expect(await E.listEvents(as(other))).toEqual([]);
      expect(await E.updateRule(as(other), "R-1", { enabled: false })).toMatchObject({
        ok: false,
        reason: "not_staff",
      });
    }
    expect(await E.listNotifications(as("demo-learner"))).toEqual([]);
  });
});

describe("Decision Engine — detect, decide, act", () => {
  it("first run: evidence in plain words; teacher and staff notified; cooldown stops repeats", async () => {
    const job = runEngine(ORG);
    expect(job.lastNewEvents).toBeGreaterThan(0);
    const events = await E.listEvents(as(S));
    const text = events.map((e) => `${e.ruleName}: ${e.subject.label} — ${e.evidence}`);
    expect(text).toContainEqual(
      expect.stringMatching(
        /^Skill below threshold: Minh T\. · A2 Morning — Mon\/Wed — Use of English is 52, below 60 \(placement test only\)$/,
      ),
    );
    expect(text).toContainEqual(
      expect.stringMatching(
        /^Absent several sessions in a row: Huy D\. · B1 Evening — Tue\/Thu — Absent from the last 2 marked sessions$/,
      ),
    );
    expect(text).toContainEqual(
      expect.stringMatching(
        /^Attendance not taken: A2 — Unit 6 · A2 Morning — Mon\/Wed — Started /,
      ),
    );
    // Act: skill_low only queues (no notification); absence + unmarked notify Tara; unmarked notifies staff.
    const tara = (await E.listNotifications(as(T))).map((n) => n.text);
    expect(tara.some((t) => t.startsWith("Absent several sessions in a row: Huy D."))).toBe(true);
    expect(tara.some((t) => t.startsWith("Attendance not taken: A2 — Unit 6"))).toBe(true);
    expect(tara.some((t) => t.startsWith("Skill below threshold"))).toBe(false);
    expect(
      (await E.listNotifications(as(S))).some((n) => n.text.startsWith("Attendance not taken")),
    ).toBe(true);
    expect(
      (await E.listActions(as(S))).some(
        (a) => a.action === "support_queue" && a.target === "Learners needing support",
      ),
    ).toBe(true);
    // Decide: an immediate second run is all cooldown.
    const again = runEngine(ORG);
    expect(again).toMatchObject({
      lastNewEvents: 0,
      lastSkippedCooldown: again.lastDetected,
      runs: 2,
    });
  });

  it("an overdue make-up notifies staff and the class teacher (fake clock +15 days)", async () => {
    const an = (await mockMakeup.getBoard(as(S)))!.items.find((i) => i.learnerName === "An P.")!;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(an.dueAt) + 86_400_000);
    runEngine(ORG);
    const ev = (await E.listEvents(as(S))).find(
      (e) => e.ruleName === "Make-up overdue" && e.subject.label === "An P. · A2 — Unit 5",
    )!;
    expect(ev.evidence).toMatch(/^Not made up; deadline .* has passed$/);
    expect((await E.listNotifications(as(S))).some((n) => n.eventId === ev.id)).toBe(true);
    expect((await E.listNotifications(as(T))).some((n) => n.eventId === ev.id)).toBe(true);
  });

  it("markRead", async () => {
    runEngine(ORG);
    const [first] = await E.listNotifications(as(T));
    await E.markRead(as(T), first.id);
    expect((await E.listNotifications(as(T))).find((n) => n.id === first.id)!.read).toBe(true);
    await E.markRead(as(T), "all");
    expect((await E.listNotifications(as(T))).every((n) => n.read)).toBe(true);
  });
});

describe("Decision Engine — the rules drive the support queue", () => {
  it("default rules = the queue as before", async () => {
    expect(await queueNames()).toEqual(["An P.", "Huy D.", "Linh N.", "Minh T."]);
  });

  it("threshold 53: only Minh (52) is below; pausing absences removes Huy; no queue action, no placement flags", async () => {
    expect(
      (await E.updateRule(as(S), await ruleId("skill_low"), { params: { threshold: 53 } })).ok,
    ).toBe(true);
    expect(await queueNames()).toEqual(["Huy D.", "Minh T."]);
    const minh = (await mockSupport.listNeedsSupport(as(T))).find((i) => i.learnerName === "Minh T.")!;
    expect(minh.signals[0]).toMatchObject({ kind: "low_skill", threshold: 53 });
    await E.updateRule(as(S), await ruleId("absence_streak"), { enabled: false });
    expect(await queueNames()).toEqual(["Minh T."]);
    await E.updateRule(as(S), await ruleId("skill_low"), { actions: ["log_only"] });
    expect(await queueNames()).toEqual([]);
    // Paused rules are not detected by the engine either.
    runEngine(ORG);
    expect((await E.listEvents(as(S))).some((e) => e.kind === "absence_streak")).toBe(false);
  });

  it("refuses invalid settings in plain words", async () => {
    expect(
      await E.updateRule(as(S), await ruleId("skill_low"), { params: { threshold: 0 } }),
    ).toMatchObject({
      ok: false,
      reason: "invalid",
      detail: "skill below must be 1–100",
    });
    expect(
      await E.updateRule(as(S), await ruleId("makeup_overdue"), { actions: ["support_queue"] }),
    ).toMatchObject({
      detail: "only learner rules can use the support queue",
    });
    expect(await E.updateRule(as(S), await ruleId("teacher_overload"), { actions: [] })).toMatchObject({
      detail: "choose at least one action",
    });
    expect(await E.updateRule(as(S), "R-99", { enabled: false })).toMatchObject({
      reason: "not_found",
    });
  });

  it("rule changes, events and notifications survive a reload", async () => {
    await E.updateRule(as(S), await ruleId("skill_low"), { params: { threshold: 53 } });
    runEngine(ORG);
    const events = (await E.listEvents(as(S))).length;
    saveDemoState();
    __resetAttendanceForTests();
    expect((await E.listRules(as(S)))!.find((r) => r.kind === "skill_low")!.params.threshold).toBe(60);
    restoreDemoState();
    expect((await E.listRules(as(S)))!.find((r) => r.kind === "skill_low")!.params.threshold).toBe(53);
    expect((await E.listEvents(as(S))).length).toBe(events);
  });
});
