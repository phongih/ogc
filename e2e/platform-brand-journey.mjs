/*
 * OGC Platform E2E — brand & provider profile (owner 24/11) on the real API: a visitor opens Nova's
 * public profile (tagline, centers, verified badges only, Tara's opted-in profile; Ben is not
 * public); a course page shows the provider block and its teachers. Sam adds an organization badge
 * but cannot verify it himself; Olivia verifies it (fake Credly says valid), verifies the
 * certificate only after ticking "seen", and the revoked Credly badge is refused. Ben opts in →
 * he appears on the A2 course (not on B1); Tara opts out → she is gone at once. SYNTHETIC data;
 * the Credly register is a mock. Stack: platform-stack.mjs. Needs OGC_TEST_PG_ADMIN_URL and
 * Playwright.
 */
import { runPlatformJourney } from "./platform-stack.mjs";

runPlatformJourney("platform brand E2E", async ({ browser, base, check }) => {
  const page = await browser.newPage();
  const text = async () => (await page.locator("main").textContent()) ?? "";
  const signIn = async (who, heading) => {
    await page.goto(`${base}/login`);
    await page.getByRole("button", { name: who }).click();
    if (heading) await page.getByRole("heading", { name: heading }).waitFor();
  };
  const signOut = async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name: "Sam (Org Staff)" }).waitFor();
  };
  const teachersOf = async (ref) => {
    await page.goto(`${base}/showcase/nova-learning/${ref}`);
    const r = page.getByRole("region", { name: "Teachers" });
    await r.waitFor();
    return r
      .locator("[data-testid^=instructor-]")
      .evaluateAll((els) =>
        els.map((e) => e.getAttribute("data-testid").replace("instructor-", "")),
      );
  };

  // 1) A visitor: the public profile from the courses page
  await page.goto(`${base}/showcase/nova-learning`);
  await page.getByRole("link", { name: /About Nova Learning/ }).click();
  await page.getByRole("list", { name: "Organization badges" }).waitFor();
  const about = await text();
  check(
    "[public] profile: tagline, three centers",
    about.includes("English that works — for school, work and travel") &&
      (await page.getByRole("list", { name: "Centers" }).locator("li").count()) === 3,
  );
  check(
    "[public] only the verified badge shows (the certificate is still waiting)",
    (await page.getByTestId("badge-MOCK-NOVA-QR26").count()) === 1 &&
      (await page.getByTestId("badge-CERT-LSF-0042").count()) === 0,
  );
  check(
    "[public] Tara (opted in) with her verified badge only; Ben not public; no names of verifiers",
    (await page.getByTestId("instructor-Tara").count()) === 1 &&
      (await page.getByTestId("badge-MOCK-TARA-SAC1").count()) === 1 &&
      (await page.getByTestId("badge-MOCK-TARA-YLM2-R").count()) === 0 &&
      (await page.getByTestId("instructor-Ben").count()) === 0 &&
      !about.includes("Olivia") &&
      !about.includes("Sam"),
  );
  check(
    "[public] A2 course: provider block, teachers Tara",
    (await teachersOf("CS-A2-EVERYDAY")).join() === "Tara",
  );
  check(
    "[public] A2 course: provider tagline and badge",
    (await page.getByRole("region", { name: "Provider" }).textContent())?.includes(
      "English that works",
    ) &&
      (await page
        .getByRole("region", { name: "Provider" })
        .getByTestId("badge-MOCK-NOVA-QR26")
        .count()) === 1,
  );

  // 2) Sam adds an organization badge; he cannot verify his own
  await signIn("Sam (Org Staff)", "Schedule");
  await page
    .getByRole("navigation", { name: "Platform" })
    .getByRole("link", { name: "Brand" })
    .click();
  const add = page.getByRole("region", { name: "Add a badge" });
  await add.waitFor();
  await add.getByLabel("Title").fill("Blended Learning Design");
  await add.getByLabel("Issuer").fill("TESOL Practice Guild (synthetic)");
  await add.getByLabel("Badge code").fill("MOCK-NOVA-E2E1");
  await add.getByLabel("Issued on").fill("2026-05-01");
  await add.getByRole("button", { name: "Add badge" }).click();
  await add.getByRole("status").waitFor();
  check(
    "[sam] badge added: CR-6 waiting",
    ((await add.getByRole("status").textContent()) ?? "").includes("CR-6"),
  );
  const cr6 = page.getByTestId("cred-CR-6");
  await cr6.waitFor();
  check(
    "[sam] no Verify on his own badge — someone else verifies it",
    (await cr6.getByRole("button", { name: "Check & verify" }).count()) === 0 &&
      ((await cr6.textContent()) ?? "").includes("You added it"),
  );
  await signOut();

  // 3) Olivia verifies
  await signIn("Olivia (Org Admin)", "Schedule");
  await page.goto(`${base}/brand`);
  await page.getByTestId("cred-CR-6").getByRole("button", { name: "Check & verify" }).click();
  await page.getByTestId("cred-CR-6").getByText("Credly (mock): valid on").waitFor();
  check("[olivia] CR-6 verified: Credly (mock) valid", true);
  const cr2 = page.getByTestId("cred-CR-2");
  await cr2.getByRole("button", { name: "Verify" }).click();
  await cr2.getByRole("alert").waitFor();
  check(
    "[olivia] the certificate needs 'seen' first",
    ((await cr2.getByRole("alert").textContent()) ?? "").includes("seen the certificate"),
  );
  await cr2.getByLabel("I have seen the certificate").check();
  await cr2.getByRole("button", { name: "Verify" }).click();
  await cr2.getByText("Certificate seen by Olivia").waitFor();
  check("[olivia] certificate verified", true);
  const cr4 = page.getByTestId("cred-CR-4");
  await cr4.getByRole("button", { name: "Check & verify" }).click();
  await cr4.getByRole("alert").waitFor();
  check(
    "[olivia] Tara's revoked Credly badge is refused",
    ((await cr4.getByRole("alert").textContent()) ?? "").includes("Credly (mock) says: revoked"),
  );
  await signOut();
  await page.goto(`${base}/showcase/nova-learning/about`);
  await page.getByRole("list", { name: "Organization badges" }).waitFor();
  check(
    "[public] three verified organization badges now",
    (await page.getByRole("list", { name: "Organization badges" }).locator("li").count()) === 3,
  );

  // 4) Ben opts in; Tara opts out
  await signIn("Ben (Teacher)", "Teaching");
  await page
    .getByRole("navigation", { name: "Platform" })
    .getByRole("link", { name: "Public profile" })
    .click();
  const prof = page.getByRole("region", { name: "Profile" });
  await prof.waitFor();
  await prof.getByLabel("Short bio (up to 400 characters)").fill("Exam skills. Call 0903123456");
  await prof.getByLabel("Show my profile on the public pages").check();
  await prof.getByRole("button", { name: "Save my profile" }).click();
  await prof.getByRole("alert").waitFor();
  check(
    "[ben] contact details refused",
    ((await prof.getByRole("alert").textContent()) ?? "").includes("no phone numbers"),
  );
  await prof
    .getByLabel("Short bio (up to 400 characters)")
    .fill("Exam skills and steady practice.");
  await prof.getByRole("button", { name: "Save my profile" }).click();
  await prof.getByRole("status").waitFor();
  await signOut();
  check("[public] A2: Ben and Tara", (await teachersOf("CS-A2-EVERYDAY")).join() === "Ben,Tara");
  check(
    "[public] B1: Tara only (Ben has no B1 class)",
    (await teachersOf("CS-B1-SPEAK")).join() === "Tara",
  );

  await signIn("Tara (Teacher)", "Teaching");
  await page.goto(`${base}/public-profile`);
  await prof.waitFor();
  await prof.getByLabel("Show my profile on the public pages").uncheck();
  await prof.getByRole("button", { name: "Save my profile" }).click();
  await prof.getByRole("status").waitFor();
  await signOut();
  check(
    "[public] Tara off: gone from A2 at once",
    (await teachersOf("CS-A2-EVERYDAY")).join() === "Ben",
  );
  check("[public] B1: no public teacher", (await teachersOf("CS-B1-SPEAK")).length === 0);
});
