/** 数据表字段信息（来自 table.getFieldMetaList） */
export interface FieldInfo {
  id: string;
  name: string;
  /** FieldType 枚举值 */
  type: number;
  /** 是否为索引列（首列） */
  isPrimary: boolean;
}

/** 记录名称所包含的一列信息（列名 + 该记录在此列的值） */
export interface RecordCell {
  fieldId: string;
  /** 字段名，列表里作为列名展示 */
  name: string;
  /** 该记录在此字段下的文本值 */
  value: string;
}

export interface RecordInfo {
  id: string;
  /** 由「记录名称字段」各列值拼接而成，用于展示与生成文件名 */
  title: string;
  /** 记录名称包含的各列信息，用于列表展示 */
  cells: RecordCell[];
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
  /** 「记录名称字段」对应的字段名列表（支持多选） */
  titleFieldNames?: string[];
  /** 旧版本仅支持单个字段名，读取时兼容 */
  titleFieldName?: string;
  attachmentFieldName?: string;
}