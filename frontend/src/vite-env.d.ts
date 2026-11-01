/// <reference types="vite/client" />

// Build-time values (section 9: only values that are not secret).
interface ImportMetaEnv {
  /** must equal the backend's TERMS_VERSION and PRIVACY_VERSION (Decisions log, U8-02) */
  readonly VITE_TERMS_VERSION?: string;
  readonly VITE_PRIVACY_VERSION?: string;
  /** exact payment-provider page hosts, comma-separated (checkProviderRedirect; U8-05) */
  readonly VITE_PAYMENT_HOSTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
