/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CATALOG_ADAPTER?: string;
  readonly VITE_CATALOG_API_BASE?: string;
  readonly VITE_CATALOG_ORG_SLUG?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
