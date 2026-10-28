// Mock implementation of the OgcDirectoryPort contract. NON-PRODUCTION, synthetic data only.
// The app depends on the contract, not on this file directly (see lib/api/directory.ts).
import type { OgcDirectoryPort, Organization, Brand, Center, CenterDetail } from "@ogc/contracts";
import { organizations, brands, centers, centerDetails } from "../../fixtures/directory";

const latency = <T>(value: T, ms = 120): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export const mockDirectory: OgcDirectoryPort = {
  listOrganizations: () => latency(organizations.slice()),
  getOrganization: (orgId: string) =>
    latency(organizations.find((o: Organization) => o.id === orgId) ?? null),
  listBrands: (orgId: string) => latency(brands.filter((b: Brand) => b.orgId === orgId)),
  listCenters: (orgId: string, brandId?: string) =>
    latency(
      centers.filter((c: Center) => c.orgId === orgId && (brandId ? c.brandId === brandId : true)),
    ),
  getCenter: (centerId: string): Promise<CenterDetail | null> =>
    latency(centerDetails[centerId] ?? null),
};
