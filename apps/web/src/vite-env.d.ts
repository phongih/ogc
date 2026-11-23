/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CATALOG_ADAPTER?: string;
  readonly VITE_CATALOG_API_BASE?: string;
  readonly VITE_CATALOG_ORG_SLUG?: string;
  readonly VITE_OGC_API_BASE?: string; // Platform build only (ADR-040); default same origin
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Short release SHA of this build (see vite.config.ts). */
declare const __OGC_BUILD__: string;
