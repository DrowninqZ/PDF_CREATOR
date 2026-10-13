/** 数据表字段信息（来自 table.getFieldMetaList） */
export interface FieldInfo {
  id: string;
  name: string;
  /** FieldType 枚举值 */
  type: number;
  /** 是否为索引列（首列） */
  isPrimary: boolean;
}

export interface RecordInfo {
  id: string;
  /** 索引列文本，用于展示与生成文件名 */
  title: string;
}

/** 模板占位符 key -> 字段 id（空字符串表示未映射） */
export type Mapping = Record<string, string>;

/** 单条记录生成结果 */
export interface GeneratedItem {
  recordId: string;
  recordTitle: string;
  fileName: string;
  blob: Blob;
  /** 浏览器内可用的下载链接（object URL） */
  url: string;
}

/** 输出配置 */
export interface OutputConfig {
  /** 是否把生成的 PDF 回写到附件字段 */
  writeBack: boolean;
  /** 目标附件字段 id */
  attachmentFieldId: string;
  /** 是否打包 ZIP */
  downloadZip: boolean;
}

/** 需要持久化到 localStorage 的配置（按字段名保存，避免跨表格 id 变化） */
export interface PersistedConfig {
  template?: string;
  mappingByName?: Record<string, string>;
  titleFieldName?: string;
  attachmentFieldName?: string;
}