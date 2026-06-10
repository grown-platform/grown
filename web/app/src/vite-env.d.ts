/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GIPHY_KEY?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
