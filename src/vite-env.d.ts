/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 使用统计上报地址；不配置则完全不上报 */
  readonly VITE_ANALYTICS_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}