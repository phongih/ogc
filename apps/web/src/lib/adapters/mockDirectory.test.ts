import { describe, expect, it } from "vitest";
import { mockDirectory } from "./mockDirectory";
import { organizations } from "../../fixtures/directory";

describe("mockDirectory (contract adapter)", () => {
  it("lists synthetic organizations", async () => {
    const orgs = await mockDirectory.listOrganizations();
    expect(orgs.length).toBeGreaterThan(0);
    expect(orgs[0].id).toBe(organizations[0].id);
  });

  it("scopes brands and centers to their organization (tenant root)", async () => {
    const orgId = organizations[0].id;
    const brands = await mockDirectory.listBrands(orgId);
    const centers = await mockDirectory.listCenters(orgId);
    expect(brands.every((b) => b.orgId === orgId)).toBe(true);
    expect(centers.every((c) => c.orgId === orgId)).toBe(true);
    // the other org's centers must not leak in
    const otherCenters = await mockDirectory.listCenters(organizations[1].id);
    expect(otherCenters.some((c) => c.orgId === orgId)).toBe(false);
  });

  it("filters centers by brand when provided", async () => {
    const orgId = organizations[0].id;
    const all = await mockDirectory.listCenters(orgId);
    const brandId = all[0].brandId;
    const filtered = await mockDirectory.listCenters(orgId, brandId);
    expect(filtered.every((c) => c.brandId === brandId)).toBe(true);
    expect(filtered.length).toBeLessThanOrEqual(all.length);
  });

  it("returns a center detail or null", async () => {
    const orgId = organizations[0].id;
    const [center] = await mockDirectory.listCenters(orgId);
    const detail = await mockDirectory.getCenter(center.id);
    expect(detail?.id).toBe(center.id);
    expect(detail?.roomCount).toBeGreaterThanOrEqual(0);
    expect(await mockDirectory.getCenter("missing")).toBeNull();
  });
});
