/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 使用统计上报地址；不配置则完全不上报 */
  readonly VITE_ANALYTICS_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** 由 vite.config.ts 的 define 注入，取自 package.json 的 version */
declare const __APP_VERSION__: string;