import type { Section } from "@ogc/mock-authz";

export const sectionRoute: Record<Section, string> = {
  directory: "/app/orgs",
  operations: "/app/operations",
  access: "/app/access",
  learning: "/app/learning",
  teaching: "/app/teaching",
  catalog: "/app/catalog",
  tutor: "/app/tutor",
  guardian: "/app/guardian",
  referrals: "/app/referrals",
  tuition: "/app/tuition",
};

export const sectionLabel: Record<Section, string> = {
  directory: "Directory",
  operations: "Center operations",
  access: "Access",
  learning: "My Learning",
  teaching: "Teaching",
  catalog: "Catalog",
  tutor: "AI Tutor",
  guardian: "Guardian",
  referrals: "Refer a friend",
  tuition: "Tuition",
};
