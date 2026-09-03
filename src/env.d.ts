/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Basis-URL der DCAT.Atlas-REST-API, z. B. `/dcat/rest`. */
  readonly VITE_DCAT_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
