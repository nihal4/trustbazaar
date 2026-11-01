/// <reference types="vite/client" />

// Build-time values (section 9: only values that are not secret).
interface ImportMetaEnv {
  /** must equal the backend's TERMS_VERSION and PRIVACY_VERSION (Decisions log, U8-02) */
  readonly VITE_TERMS_VERSION?: string;
  readonly VITE_PRIVACY_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
