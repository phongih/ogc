/*
 * OGC Platform E2E (ADR-040): browser → Platform web (dist-platform) → /v1 proxy → Platform API →
 * mock IIOS + PostgreSQL (RLS). Synthetic data only.
 *   1. a fresh database (roles as on the VM: ogc_owner migrates, ogc_app serves), migrate + seed
 *   2. start the mock IIOS and the API (dev login on) from their built bundles
 *   3. build dist-platform, run the bundle guard, serve it with a same-origin /v1 proxy
 *   4. Sam (staff): a clashing reschedule is refused with the clash sentence; a free time saves
 *   5. Tara (teacher): marks the session waiting for attendance; the summary counts it
 *   6. a stale / revoked grant (401) sends the user back to sign in
 * The stack (databases, services, build, guard, proxy) comes from platform-stack.mjs.
 */
import { apiAs, runPlatformJourney } from "./platform-stack.mjs";

/** "YYYY-MM-DDTHH:MM" in center time (UTC+7) for UTC midnight today + d days at a center hour. */
function centerLocal(d, hour) {
  const day0 = Math.floor(Date.now() / 86400000) * 86400000;
  const t = new Date(day0 + d * 86400000 + (hour - 7) * 3600000 + 7 * 3600000);
  return `${t.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00`;
}

/** Tara's next B1 Evening slot (session k2-p1) as "YYYY-MM-DDTHH:MM" center time, read via the API. */
async function nextB1Evening() {
  const o = await (await apiAs("iios-principal-staff-1"))("/v1/schedule");
  const at = o.classes.flatMap((c) => c.sessions).find((x) => x.id === "k2-p1").at;
  return new Date(Date.parse(at) + 7 * 3600000).toISOString().slice(0, 16);
}

runPlatformJourney("platform E2E", async ({ browser, base, check, restartIios }) => {
  const page = await browser.newPage();
  const apiCalls = [];
  page.on("request", (r) => r.url().includes("/v1/") && apiCalls.push(r.url()));

  // 4) Sam — staff schedule
  await page.goto(`${base}/`);
  await page.getByRole("heading", { name: "Sign in (staging)" }).waitFor();
  check(
    "sign-in lists both synthetic orgs",
    (await page.getByText("Lumen", { exact: false }).count()) > 0,
  );
  check(
    "banner says staging / synthetic / mock IIOS",
    (await page.getByText("STAGING · synthetic data · mock IIOS").count()) === 1,
  );
  await page.getByRole("button", { name: "Sam (Org Staff)" }).click();
  await page.getByRole("heading", { name: "Schedule" }).waitFor();
  check("Sam lands on Schedule", page.url().endsWith("/schedule"));
  check(
    "header shows Sam · staff",
    ((await page.getByTestId("who").textContent()) ?? "").includes("Sam"),
  );
  check(
    "Lumen classes are not shown to Nova staff",
    (await page.getByText("Lumen", { exact: false }).count()) === 0,
  );

  const row = page.getByTestId("session-k1-p1");
  await row.getByLabel("New time for k1-p1").fill(await nextB1Evening()); // Tara teaches B1 Evening then
  await row.getByRole("button", { name: "Reschedule" }).click();
  const refusal = row.getByTestId("refusal");
  await refusal.waitFor();
  const rtext = (await refusal.textContent()) ?? "";
  check(
    "clashing reschedule refused with the clash explained",
    rtext.includes("already busy") && /B1 Evening/.test(rtext),
  );

  await row.getByLabel("New time for k1-p1").fill(centerLocal(1, 15));
  await row.getByRole("button", { name: "Reschedule" }).click();
  await page
    .getByTestId("session-k1-p1")
    .getByText("15:00", { exact: false })
    .waitFor({ timeout: 5000 });
  check("free time saves and the schedule re-reads it", true);
  check(
    "every API call went to the same origin /v1",
    apiCalls.every((u) => u.startsWith(`${base}/v1/`)),
  );

  // 5) Tara — attendance
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Tara (Teacher)" }).click();
  await page.getByRole("heading", { name: "Teaching" }).waitFor();
  const toMark = page.getByRole("link", { name: /A2 — / }).first();
  check("Tara has a session to mark", (await toMark.count()) === 1);
  await toMark.click();
  await page.getByRole("button", { name: "Save attendance" }).waitFor();
  check(
    "save disabled until every learner is marked",
    await page.getByRole("button", { name: "Save attendance" }).isDisabled(),
  );
  await page.getByLabel("Linh N. present").check();
  await page.getByLabel("Minh T. late").check();
  await page.getByLabel("An P. absent").check();
  await page.getByRole("button", { name: "Save attendance" }).click();
  await page.getByRole("status").getByText("Saved.").waitFor();
  check("attendance saved", true);
  await page.goto(`${base}/teaching`);
  await page.getByRole("heading", { name: "Teaching" }).waitFor();
  await page.getByText("Nothing to mark.").waitFor();
  check("to-mark list is empty after saving", true);
  await page.getByRole("link", { name: "A2 Morning — Mon/Wed" }).click();
  await page.getByRole("heading", { name: "Attendance summary" }).waitFor();
  const cells = await page
    .getByRole("row", { name: /An P\./ })
    .locator("td")
    .allTextContents();
  // [name, present, late, absent, attended, absent streak]: the new mark is absent → streak ≥ 1
  check(
    "summary counts the new absence (absent ≥ 1, streak ≥ 1)",
    Number(cells[3]) >= 1 && Number(cells[5]) >= 1,
  );

  // 6) Olivia → Access: attach a policy to Sam, create one; restart the mock IIOS; Sam narrowed
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Olivia (Org Admin)" }).click();
  await page
    .getByRole("navigation", { name: "Platform" })
    .getByRole("link", { name: "Access" })
    .click();
  await page.getByRole("heading", { name: "Access policies" }).waitFor();
  check(
    "[olivia] Access page from the API; cannot change own access",
    (await page.getByText(/another Org Admin must change this/).count()) === 1,
  );
  await page
    .getByLabel("Access policy for Sam (Org Staff)")
    .selectOption({ label: "Front desk — District 1 only" });
  await page.getByText("used by 1").waitFor();
  await page.getByRole("button", { name: "+ New policy" }).click();
  await page.getByLabel("Policy name").fill("Evening desk");
  await page.getByLabel("Rule 1: action").selectOption("students:view");
  await page.getByRole("button", { name: "Create policy" }).click();
  await page
    .locator('[data-policy="Evening desk"]')
    .getByText(/v1 · created by Olivia/)
    .waitFor({ state: "attached" }); // inside the collapsed History
  check("[olivia] policy attached and a new one created", true);

  await restartIios();
  await page.reload();
  await page.getByRole("heading", { name: "Access policies" }).waitFor();
  check(
    "[iios restart] attachment and new policy kept in the mock IIOS's database",
    (await page.getByText("used by 1").count()) === 1 &&
      (await page.locator('[data-policy="Evening desk"]').count()) === 1 &&
      (await page.getByLabel("Access policy for Sam (Org Staff)").inputValue()) ===
        "policy-front-desk-d1",
  );

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sam (Org Staff)" }).click();
  await page.getByRole("heading", { name: "Schedule" }).waitFor();
  await page.getByText("A2 Morning — Mon/Wed").waitFor();
  check(
    "[sam] narrowed to District 1: no B1 Evening (Thu Duc)",
    (await page.getByText("B1 Evening — Tue/Thu").count()) === 0 &&
      (await page.getByText("A2 Evening — Tue/Thu").count()) === 1,
  );
  await page.getByLabel("Teacher of A2 Morning — Mon/Wed").selectOption({ label: "Ben" });
  await page.getByText("Your access policy does not allow this here.").waitFor();
  check("[sam] class teacher is read-only under the policy (refused by the API)", true);
  check(
    "[access] no Access link for staff",
    (await page
      .getByRole("navigation", { name: "Platform" })
      .getByRole("link", { name: "Access" })
      .count()) === 0,
  );

  // 7) a grant the API refuses → back to sign in
  await page.evaluate(() => {
    const k = "ogc.platform.session";
    const s = JSON.parse(sessionStorage.getItem(k));
    s.grant = "not-a-grant";
    sessionStorage.setItem(k, JSON.stringify(s));
  });
  await page.goto(`${base}/teaching`);
  await page.getByRole("heading", { name: "Sign in (staging)" }).waitFor({ timeout: 5000 });
  check("a refused grant (401) sends the user back to sign in", true);
});
