import type { Section } from "@ogc/mock-authz";

export const sectionRoute: Record<Section, string> = {
  directory: "/app/orgs",
  learning: "/app/learning",
  teaching: "/app/teaching",
  catalog: "/app/catalog",
  tutor: "/app/tutor",
  guardian: "/app/guardian",
};

export const sectionLabel: Record<Section, string> = {
  directory: "Directory",
  learning: "My Learning",
  teaching: "Teaching",
  catalog: "Catalog",
  tutor: "AI Tutor",
  guardian: "Guardian",
};
