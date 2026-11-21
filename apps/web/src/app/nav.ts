import type { Section } from "@ogc/mock-authz";

export const sectionRoute: Record<Section, string> = {
  directory: "/app/orgs",
  operations: "/app/operations",
  learning: "/app/learning",
  teaching: "/app/teaching",
  catalog: "/app/catalog",
  tutor: "/app/tutor",
  guardian: "/app/guardian",
};

export const sectionLabel: Record<Section, string> = {
  directory: "Directory",
  operations: "Center operations",
  learning: "My Learning",
  teaching: "Teaching",
  catalog: "Catalog",
  tutor: "AI Tutor",
  guardian: "Guardian",
};
