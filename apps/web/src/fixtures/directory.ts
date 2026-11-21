// Synthetic-only fixtures for Slice-1. No real organizations, brands, centers or people.
import type { Organization, Brand, Center, CenterDetail } from "@ogc/contracts";

export const organizations: Organization[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Nova Learning Group",
    slug: "nova-learning",
    createdAt: "2026-01-04T00:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Lumen Education Holdings",
    slug: "lumen-edu",
    createdAt: "2026-02-18T00:00:00.000Z",
  },
];

export const brands: Brand[] = [
  {
    id: "00000000-0000-4000-8000-0000000000a1",
    orgId: organizations[0].id,
    name: "Nova English",
    slug: "nova-english",
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    orgId: organizations[0].id,
    name: "Nova Juniors",
    slug: "nova-juniors",
  },
  {
    id: "00000000-0000-4000-8000-0000000000b1",
    orgId: organizations[1].id,
    name: "Lumen Academy",
    slug: "lumen-academy",
  },
];

export const centers: Center[] = [
  {
    id: "00000000-0000-4000-8000-000000000c01",
    orgId: organizations[0].id,
    brandId: brands[0].id,
    name: "Nova English — District 1",
    city: "Ho Chi Minh City",
  },
  {
    id: "00000000-0000-4000-8000-000000000c02",
    orgId: organizations[0].id,
    brandId: brands[0].id,
    name: "Nova English — Thu Duc",
    city: "Ho Chi Minh City",
  },
  {
    id: "00000000-0000-4000-8000-000000000c03",
    orgId: organizations[0].id,
    brandId: brands[1].id,
    name: "Nova Juniors — Cau Giay",
    city: "Hanoi",
  },
  {
    id: "00000000-0000-4000-8000-000000000c04",
    orgId: organizations[1].id,
    brandId: brands[2].id,
    name: "Lumen Academy — Hai Chau",
    city: "Da Nang",
  },
];

export const centerDetails: Record<string, CenterDetail> = Object.fromEntries(
  centers.map((c, i) => [
    c.id,
    {
      ...c,
      addressLine: `${10 + i} Synthetic Street`,
      roomCount: 4 + i,
      activeCourses: 3 + i,
    },
  ]),
);
