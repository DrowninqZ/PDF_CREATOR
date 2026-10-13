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

/** 数据表（底部 sheet 页签）元信息 */
export interface TableMetaInfo {
  id: string;
  name: string;
}

/**
 * 多维表格数据访问封装。
 * 插件运行在多维表格 iframe 内，通过官方 SDK 与宿主通信，读写当前表格数据。
 */
export class BaseGateway {
  private readonly fieldCache = new Map<string, IField>();

  private constructor(
    private readonly table: ITable,
    readonly tableId: string,
  ) {}

  static async open(): Promise<BaseGateway> {
    const table = await bitable.base.getActiveTable();
    return new BaseGateway(table, await BaseGateway.resolveActiveTableId());
  }

  /** 打开指定的数据表（用于在多数据表间切换） */
  static async openTable(tableId: string): Promise<BaseGateway> {
    const table = await bitable.base.getTableById(tableId);
    return new BaseGateway(table, tableId);
  }

  /** 列出当前多维表格下的全部数据表 */
  static async listTables(): Promise<TableMetaInfo[]> {
    const metas = await bitable.base.getTableMetaList();
    return metas.map((meta) => ({ id: meta.id, name: meta.name }));
  }

  private static async resolveActiveTableId(): Promise<string> {
    const { tableId } = await bitable.base.getSelection();
    return tableId ?? '';
  }

  /** 当前激活的文档 / 数据表 / 视图信息 */
  async getSelection(): Promise<{ tableId: string | null; viewId: string | null }> {
    const { tableId, viewId } = await bitable.base.getSelection();
    return { tableId, viewId };
  }

  /**
   * 解析拉取记录所用的视图 id。
   * 宿主当前激活的就是本数据表时，沿用用户正在看的视图；否则退回该表的第一个视图。
   */
  async resolveViewId(): Promise<string | null> {
    const selection = await bitable.base.getSelection();
    if (selection.tableId === this.tableId && selection.viewId) return selection.viewId;
    const views = await this.table.getViewMetaList();
    return views[0]?.id ?? null;
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