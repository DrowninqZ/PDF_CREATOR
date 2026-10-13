import {
  bitable,
  type IAttachmentField,
  type IField,
  type ITable,
} from '@lark-base-open/js-sdk';
import type { FieldInfo } from '../types';

/** 分页拉取时每页条数（SDK 上限 200） */
const PAGE_SIZE = 200;
/** 分页保护上限，避免异常情况下死循环 */
const MAX_PAGES = 500;

/** 一条记录的字段文本值：fieldId -> 展示文本 */
export interface StringRecord {
  recordId: string;
  fields: Record<string, string>;
}

/**
 * 多维表格数据访问封装。
 * 插件运行在多维表格 iframe 内，通过官方 SDK 与宿主通信，读写当前表格数据。
 */
export class BaseGateway {
  private readonly fieldCache = new Map<string, IField>();

  private constructor(private readonly table: ITable) {}

  static async open(): Promise<BaseGateway> {
    const table = await bitable.base.getActiveTable();
    return new BaseGateway(table);
  }

  /** 当前激活的文档 / 数据表 / 视图信息 */
  async getSelection(): Promise<{ tableId: string | null; viewId: string | null }> {
    const { tableId, viewId } = await bitable.base.getSelection();
    return { tableId, viewId };
  }

  /** 读取全部字段（索引列排在最前） */
  async listFields(): Promise<FieldInfo[]> {
    const metas = await this.table.getFieldMetaList();
    const list: FieldInfo[] = metas.map((meta) => ({
      id: meta.id,
      name: meta.name,
      type: meta.type,
      isPrimary: Boolean(meta.isPrimary),
    }));
    list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    return list;
  }

  /**
   * 分页拉取记录，并把所有单元格值转成展示文本。
   * 使用 stringValue: true，SDK 会按字段类型统一转换（人员→姓名、日期→格式化、多选→顿号连接等），
   * 一次请求可取回 200 条记录的全部字段，避免逐条逐字段调用。
   */
  async listStringRecords(viewId?: string | null): Promise<StringRecord[]> {
    const result: StringRecord[] = [];
    let pageToken: number | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await this.table.getRecordsByPage({
        pageSize: PAGE_SIZE,
        pageToken,
        viewId: viewId ?? undefined,
        stringValue: true,
      });

      for (const record of res.records) {
        const raw = record.fields as Record<string, unknown>;
        const fields: Record<string, string> = {};
        for (const key of Object.keys(raw)) {
          const value = raw[key];
          fields[key] =
            typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
        }
        result.push({ recordId: record.recordId, fields });
      }

      if (!res.hasMore || res.pageToken === undefined) break;
      pageToken = res.pageToken;
    }

    return result;
  }

  private async field(fieldId: string): Promise<IField> {
    const cached = this.fieldCache.get(fieldId);
    if (cached) return cached;
    const field = await this.table.getField(fieldId);
    this.fieldCache.set(fieldId, field);
    return field;
  }

  /** 把生成的 PDF 写入某个记录的附件字段（会覆盖该单元格原有附件） */
  async writeAttachment(fieldId: string, recordId: string, file: File): Promise<void> {
    const field = (await this.field(fieldId)) as unknown as IAttachmentField;
    await field.setValue(recordId, file);
  }
}