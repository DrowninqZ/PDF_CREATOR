import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bitable } from '@lark-base-open/js-sdk';
import { BaseGateway, type StringRecord, type TableMetaInfo } from './bitable/client';
import { MappingPanel } from './components/MappingPanel';
import { OutputPanel } from './components/OutputPanel';
import { PreviewPane } from './components/PreviewPane';
import { RecordPanel } from './components/RecordPanel';
import { TemplatePanel } from './components/TemplatePanel';
import { downloadBlob, zipBlobs } from './pdf/export';
import { renderMergedPdfBlob, renderPdfBlob, safeFileName } from './pdf/render';
import { DEFAULT_TEMPLATE } from './template/defaultTemplate';
import {
  buildDocument,
  extractPlaceholders,
  isBuiltinPlaceholder,
} from './template/engine';
import type {
  FieldInfo,
  GeneratedItem,
  Mapping,
  PersistedConfig,
  RecordCell,
  RecordInfo,
} from './types';

const STORAGE_KEY = 'lark-base-form-pdf:config:v1';

/** 「记录名称字段」选中多个字段时，各列值之间的连接符（用于文件名与列表标题） */
const TITLE_SEPARATOR = ' / ';

type Status = 'loading' | 'ready' | 'error';

/** 合并生成的单个 PDF 结果 */
interface MergedResult {
  url: string;
  fileName: string;
  count: number;
}

function loadConfig(): PersistedConfig {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as PersistedConfig;
  } catch {
    return {};
  }
}

function saveConfig(config: PersistedConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* 忽略写入失败（如隐私模式） */
  }
}

function todayString(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function stampString(): string {
  return todayString().replace(/-/g, '') + '_' + String(Date.now()).slice(-6);
}

/**
 * SDK 在与多维表格宿主通信时，若页面不在插件环境中，部分调用会一直挂起（既不 resolve 也不 reject）。
 * 这里加超时兜底，让页面能给出明确提示而不是无限 loading。
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const CONNECT_TIMEOUT_MS = 8000;

/** 用一条记录的数据填充模板占位符 */
function buildValues(
  row: StringRecord | undefined,
  index: number,
  keys: string[],
  mapping: Mapping,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of keys) {
    if (key === '_index') {
      values[key] = String(index + 1);
      continue;
    }
    if (key === '_now') {
      values[key] = todayString();
      continue;
    }
    if (!row) {
      // 没有记录数据时，用占位符名字占位，便于校对模板版式
      values[key] = `【${key}】`;
      continue;
    }
    const fieldId = mapping[key];
    values[key] = fieldId ? row.fields[fieldId] ?? '' : '';
  }
  return values;
}

/**
 * 根据「记录名称字段」选中的列，从一条记录里取出各列的名称与值。
 * title 为各列值拼接结果（供文件名与列表标题使用），无值时回退到记录 ID。
 */
function buildTitleCells(
  row: StringRecord | undefined,
  fieldIds: string[],
  nameById: Map<string, string>,
): { title: string; cells: RecordCell[] } {
  const cells: RecordCell[] = fieldIds.map((fieldId) => ({
    fieldId,
    name: nameById.get(fieldId) ?? fieldId,
    value: row?.fields[fieldId] ?? '',
  }));
  const title = cells
    .map((cell) => cell.value)
    .filter((value) => value !== '')
    .join(TITLE_SEPARATOR);
  return { title, cells };
}

export default function App() {
  const gatewayRef = useRef<BaseGateway | null>(null);
  const resultsRef = useRef<GeneratedItem[]>([]);
  const mergedRef = useRef<MergedResult | null>(null);

  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [tables, setTables] = useState<TableMetaInfo[]>([]);
  const [tableListError, setTableListError] = useState('');
  const [activeTableId, setActiveTableId] = useState('');
  const [switching, setSwitching] = useState(false);
  const [records, setRecords] = useState<RecordInfo[]>([]);
  const [recordData, setRecordData] = useState<Map<string, StringRecord>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recordsLoading, setRecordsLoading] = useState(false);

  const [filterFieldId, setFilterFieldId] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');

  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [mapping, setMapping] = useState<Mapping>({});
  const [titleFieldIds, setTitleFieldIds] = useState<string[]>([]);
  const [attachmentFieldId, setAttachmentFieldId] = useState('');

  const [writeBack, setWriteBack] = useState(false);
  const [downloadZip, setDownloadZip] = useState(true);

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<GeneratedItem[]>([]);
  const [merged, setMerged] = useState<MergedResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const placeholders = useMemo(() => extractPlaceholders(template), [template]);

  // 第 3 步的筛选结果：筛选（或未筛选时的全部记录）界定了可生成的范围
  const visibleRecords = useMemo(() => {
    const key = filterKeyword.trim().toLowerCase();
    if (!key) return records;
    return records.filter((record) => {
      // 未选择列时按记录名称匹配，否则取该记录在所选列下的文本值
      const text = filterFieldId
        ? (recordData.get(record.id)?.fields[filterFieldId] ?? '')
        : record.title;
      return text.toLowerCase().includes(key);
    });
  }, [records, recordData, filterFieldId, filterKeyword]);

  // 实际参与生成的记录：已勾选 且 通过筛选
  const selectedRecords = useMemo(
    () => visibleRecords.filter((record) => selected.has(record.id)),
    [visibleRecords, selected],
  );

  const previewRecord = selectedRecords[0] ?? visibleRecords[0];

  // 「记录名称字段」选中的列（顺序与每条记录的 cells 一致），作为明细表表头
  const titleFields = useMemo(
    () =>
      titleFieldIds
        .map((fieldId) => fields.find((field) => field.id === fieldId))
        .filter((field): field is FieldInfo => Boolean(field)),
    [titleFieldIds, fields],
  );

  const loadRecords = useCallback(
    async (gateway: BaseGateway, titleIds: string[], fieldList: FieldInfo[]) => {
      setRecordsLoading(true);
      try {
        const viewId = await gateway.resolveViewId();
        const rows = await gateway.listStringRecords(viewId);
        setRecordData(new Map(rows.map((row) => [row.recordId, row])));
        const nameById = new Map(fieldList.map((field) => [field.id, field.name]));
        const infos: RecordInfo[] = rows.map((row) => {
          const { title, cells } = buildTitleCells(row, titleIds, nameById);
          return { id: row.recordId, title: title || row.recordId, cells };
        });
        setRecords(infos);
        setSelected(new Set(infos.map((info) => info.id)));
      } finally {
        setRecordsLoading(false);
      }
    },
    [],
  );

  // 初始化：连接多维表格，恢复上次配置，加载记录
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const gateway = await withTimeout(
          BaseGateway.open(),
          CONNECT_TIMEOUT_MS,
          '连接多维表格超时',
        );
        const selection = await withTimeout(
          gateway.getSelection(),
          CONNECT_TIMEOUT_MS,
          '读取多维表格上下文超时',
        );
        if (!selection.tableId) {
          throw new Error('当前页面不在多维表格插件环境中');
        }
        const fieldList = await gateway.listFields();
        let tableList: TableMetaInfo[] = [];
        try {
          tableList = await BaseGateway.listTables();
        } catch (error) {
          setTableListError(error instanceof Error ? error.message : String(error));
        }
        if (cancelled) return;

        const config = loadConfig();
        const initialTemplate =
          config.template && config.template.trim() ? config.template : DEFAULT_TEMPLATE;
        const idByName = new Map(fieldList.map((field) => [field.name, field.id]));

        const initialMapping: Mapping = {};
        if (config.mappingByName) {
          for (const [key, name] of Object.entries(config.mappingByName)) {
            initialMapping[key] = idByName.get(name) ?? '';
          }
        }

        // 「记录名称字段」：优先用上次保存的多列配置，否则退回索引列
        const savedTitleNames =
          config.titleFieldNames && config.titleFieldNames.length > 0
            ? config.titleFieldNames
            : config.titleFieldName
              ? [config.titleFieldName]
              : [];
        const savedTitleIds = savedTitleNames
          .map((name) => idByName.get(name))
          .filter((id): id is string => Boolean(id));
        const primaryTitleId = fieldList.find((field) => field.isPrimary)?.id;
        const resolvedTitleIds =
          savedTitleIds.length > 0 ? savedTitleIds : primaryTitleId ? [primaryTitleId] : [];
        const resolvedAttachment = idByName.get(config.attachmentFieldName ?? '') ?? '';

        // 按名称自动匹配尚未映射的占位符
        const keys = extractPlaceholders(initialTemplate);
        for (const key of keys) {
          if (isBuiltinPlaceholder(key) || initialMapping[key]) continue;
          const matched = fieldList.find((field) => field.name === key);
          if (matched) initialMapping[key] = matched.id;
        }

        gatewayRef.current = gateway;
        setFields(fieldList);
        setTables(tableList);
        setActiveTableId(selection.tableId);
        setTemplate(initialTemplate);
        setTitleFieldIds(resolvedTitleIds);
        setAttachmentFieldId(resolvedAttachment);
        setMapping(initialMapping);
        setWriteBack(Boolean(resolvedAttachment));
        setStatus('ready');

        await loadRecords(gateway, resolvedTitleIds, fieldList);
      } catch (error) {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadRecords]);

  // 持久化配置（按字段名保存，跨表格复用）
  useEffect(() => {
    if (status !== 'ready') return;
    const nameById = new Map(fields.map((field) => [field.id, field.name]));
    const mappingByName: Record<string, string> = {};
    for (const [key, fieldId] of Object.entries(mapping)) {
      const name = nameById.get(fieldId);
      if (name) mappingByName[key] = name;
    }
    saveConfig({
      template,
      mappingByName,
      titleFieldNames: titleFieldIds
        .map((fieldId) => nameById.get(fieldId))
        .filter((name): name is string => Boolean(name)),
      attachmentFieldName: nameById.get(attachmentFieldId),
    });
  }, [status, fields, mapping, template, titleFieldIds, attachmentFieldId]);

  // 同步结果引用，并在插件卸载时释放 object URL
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    mergedRef.current = merged;
  }, [merged]);

  useEffect(
    () => () => {
      resultsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
      if (mergedRef.current) URL.revokeObjectURL(mergedRef.current.url);
    },
    [],
  );

  // 预览：使用当前选中的第一条记录（无选中则用第一条记录）
  const previewHtml = useMemo(() => {
    if (status !== 'ready') return '';
    const row = previewRecord ? recordData.get(previewRecord.id) : undefined;
    return buildDocument(template, buildValues(row, 0, placeholders, mapping));
  }, [status, previewRecord, recordData, template, placeholders, mapping]);

  const handleMappingChange = useCallback((key: string, fieldId: string) => {
    setMapping((prev) => ({ ...prev, [key]: fieldId }));
  }, []);

  const handleAutoMap = useCallback(() => {
    setMapping((prev) => {
      const next: Mapping = {};
      for (const key of placeholders) {
        if (isBuiltinPlaceholder(key)) continue;
        const matched = fields.find((field) => field.name === key);
        next[key] = matched?.id ?? prev[key] ?? '';
      }
      return next;
    });
  }, [placeholders, fields]);

  // 插入占位符时按名称自动完成映射（已手动映射过的不覆盖）
  const handleInserted = useCallback(
    (key: string) => {
      if (isBuiltinPlaceholder(key)) return;
      const matched = fields.find((field) => field.name === key);
      if (!matched) return;
      setMapping((prev) => (prev[key] ? prev : { ...prev, [key]: matched.id }));
    },
    [fields],
  );

  const handleTitleFieldsChange = useCallback(
    (fieldIds: string[]) => {
      setTitleFieldIds(fieldIds);
      // 筛选列已不在展示列中时，重置筛选列，避免下拉显示为空
      setFilterFieldId((prev) => (prev && !fieldIds.includes(prev) ? '' : prev));
      const nameById = new Map(fields.map((field) => [field.id, field.name]));
      setRecords((prev) =>
        prev.map((record) => {
          const { title, cells } = buildTitleCells(recordData.get(record.id), fieldIds, nameById);
          return { ...record, title: title || record.id, cells };
        }),
      );
    },
    [fields, recordData],
  );

  const handleToggle = useCallback((recordId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((recordIds: string[]) => {
    setSelected(new Set(recordIds));
  }, []);

  const handleClear = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handlePickInteractively = useCallback(async () => {
    const gateway = gatewayRef.current;
    if (!gateway || !activeTableId) return;
    try {
      const viewId = await gateway.resolveViewId();
      if (!viewId) return;
      const picked = await bitable.ui.selectRecordIdList(activeTableId, viewId);
      if (picked && picked.length > 0) setSelected(new Set(picked));
    } catch (error) {
      setLogs((prev) => [
        ...prev,
        `交互选择失败：${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
  }, [activeTableId]);

  const handleReloadRecords = useCallback(() => {
    const gateway = gatewayRef.current;
    if (gateway) void loadRecords(gateway, titleFieldIds, fields);
  }, [loadRecords, titleFieldIds, fields]);

  /** 切换到另一个数据表：保留模板，按新表字段重新映射并重新加载记录 */
  const handleSwitchTable = useCallback(
    async (tableId: string) => {
      const gateway = gatewayRef.current;
      if (!gateway || !tableId || tableId === activeTableId) return;
      setSwitching(true);
      try {
        const nextGateway = await BaseGateway.openTable(tableId);
        const fieldList = await nextGateway.listFields();

        // 保留模板文本，按字段名对新表重建映射
        const nextMapping: Mapping = {};
        for (const key of extractPlaceholders(template)) {
          if (isBuiltinPlaceholder(key)) continue;
          const matched = fieldList.find((field) => field.name === key);
          nextMapping[key] = matched?.id ?? '';
        }
        const primaryId = fieldList.find((field) => field.isPrimary)?.id;
        const nextTitleIds = primaryId ? [primaryId] : [];

        gatewayRef.current = nextGateway;
        setActiveTableId(tableId);
        setFields(fieldList);
        setMapping(nextMapping);
        setTitleFieldIds(nextTitleIds);
        setAttachmentFieldId('');
        setWriteBack(false);
        setFilterFieldId('');
        setFilterKeyword('');
        resultsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
        setResults([]);

        await loadRecords(nextGateway, nextTitleIds, fieldList);
        const name = tables.find((table) => table.id === tableId)?.name ?? tableId;
        setLogs((prev) => [...prev, `已切换到数据表「${name}」`]);
      } catch (error) {
        setLogs((prev) => [
          ...prev,
          `切换数据表失败：${error instanceof Error ? error.message : String(error)}`,
        ]);
      } finally {
        setSwitching(false);
      }
    },
    [activeTableId, template, tables, loadRecords],
  );

  const handleGenerate = useCallback(async () => {
    const gateway = gatewayRef.current;
    if (!gateway || selectedRecords.length === 0) return;

    setGenerating(true);
    // 释放上一批结果占用的 object URL，避免重复生成时内存持续增长
    resultsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    setResults([]);
    setLogs([]);
    setProgress({ done: 0, total: selectedRecords.length });

    const produced: GeneratedItem[] = [];
    const collected: string[] = [];
    const usedNames = new Set<string>();

    try {
      for (let index = 0; index < selectedRecords.length; index += 1) {
        const record = selectedRecords[index];
        const row = recordData.get(record.id);
        const html = buildDocument(template, buildValues(row, index, placeholders, mapping));
        const blob = await renderPdfBlob(html);

        const baseName = safeFileName(record.title, `record_${index + 1}`);
        let fileName = `${baseName}.pdf`;
        let suffix = 1;
        while (usedNames.has(fileName)) {
          fileName = `${baseName}_${suffix}.pdf`;
          suffix += 1;
        }
        usedNames.add(fileName);

        produced.push({
          recordId: record.id,
          recordTitle: record.title,
          fileName,
          blob,
          url: URL.createObjectURL(blob),
        });

        if (writeBack && attachmentFieldId) {
          try {
            await gateway.writeAttachment(
              attachmentFieldId,
              record.id,
              new File([blob], fileName, { type: 'application/pdf' }),
            );
          } catch (error) {
            collected.push(
              `写回附件失败 · ${record.title}：${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }

        setResults([...produced]);
        setProgress({ done: index + 1, total: selectedRecords.length });
      }

      if (downloadZip && produced.length > 0) {
        const zip = await zipBlobs(
          produced.map((item) => ({ name: item.fileName, blob: item.blob })),
        );
        downloadBlob(zip, `表单PDF_${stampString()}.zip`);
      }
    } catch (error) {
      collected.push(`生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLogs(collected);
      setGenerating(false);
    }
  }, [
    selectedRecords,
    recordData,
    template,
    placeholders,
    mapping,
    writeBack,
    attachmentFieldId,
    downloadZip,
  ]);

  /** 把所选记录的表单合并成同一个 PDF（每条记录从新的一页开始） */
  const handleGenerateMerged = useCallback(async () => {
    if (selectedRecords.length === 0) return;

    setGenerating(true);
    setLogs([]);
    setProgress({ done: 0, total: selectedRecords.length });

    try {
      const htmlList: string[] = [];
      for (let index = 0; index < selectedRecords.length; index += 1) {
        const record = selectedRecords[index];
        const row = recordData.get(record.id);
        htmlList.push(buildDocument(template, buildValues(row, index, placeholders, mapping)));
        setProgress({ done: index + 1, total: selectedRecords.length });
      }

      const blob = await renderMergedPdfBlob(htmlList);
      const fileName = `表单PDF_合并_${selectedRecords.length}条_${stampString()}.pdf`;

      if (mergedRef.current) URL.revokeObjectURL(mergedRef.current.url);
      const url = URL.createObjectURL(blob);
      setMerged({ url, fileName, count: selectedRecords.length });
      downloadBlob(blob, fileName);
      setLogs([`已把 ${selectedRecords.length} 条记录的表单合并到同一个 PDF`]);
    } catch (error) {
      setLogs([`合并生成失败：${error instanceof Error ? error.message : String(error)}`]);
    } finally {
      setGenerating(false);
    }
  }, [selectedRecords, recordData, template, placeholders, mapping]);

  if (status === 'loading') {
    return (
      <div className="app-state">
        <div className="spinner" />
        <p>正在连接多维表格…</p>
      </div>
    );
  }

  const ready = status === 'ready';

  return (
    <div className="app">
      <header className="app-head">
        <div>
          <h1>表单 PDF 生成器</h1>
          <p className="muted">
            按 A4 模板批量生成人员信息表单 PDF，支持单独下载、打包下载与回写附件字段
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={handleGenerate}
          disabled={generating || !ready}
        >
          {generating ? `生成中 ${progress.done}/${progress.total}` : '一键生成 PDF'}
        </button>
      </header>

      {ready && (
        <div className="table-bar">
          <span className="muted">数据表</span>
          {tables.length > 0 ? (
            <select
              value={activeTableId}
              onChange={(event) => void handleSwitchTable(event.target.value)}
              disabled={switching}
            >
              {tables.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="muted">未能读取数据表列表</span>
          )}
          <span className="muted">
            {tables.length > 1
              ? `当前多维表格共 ${tables.length} 个数据表，可切换${switching ? '（切换中…）' : ''}`
              : tables.length === 1
                ? '当前多维表格只有 1 个数据表，无需切换'
                : tableListError
                  ? `读取数据表列表失败：${tableListError}`
                  : '数据表列表为空'}
          </span>
        </div>
      )}

      {!ready && (
        <div className="app-banner">
          <strong>未连接多维表格：</strong>
          {errorMsg}
          你仍可导入并编辑模板，字段与记录会在多维表格插件环境中自动加载。请确认本页面是作为多维表格插件打开的。
        </div>
      )}

      <div className="app-body">
        <div className="config-column">
          <TemplatePanel
            template={template}
            placeholders={placeholders}
            fields={fields}
            onChange={setTemplate}
            onInserted={handleInserted}
            onReset={() => setTemplate(DEFAULT_TEMPLATE)}
          />
          <MappingPanel
            placeholders={placeholders}
            fields={fields}
            mapping={mapping}
            titleFieldIds={titleFieldIds}
            onMappingChange={handleMappingChange}
            onTitleFieldsChange={handleTitleFieldsChange}
            onAutoMap={handleAutoMap}
          />
          <RecordPanel
            records={visibleRecords}
            titleFields={titleFields}
            totalCount={records.length}
            selectedCount={selectedRecords.length}
            selected={selected}
            loading={recordsLoading}
            filterFieldId={filterFieldId}
            filterKeyword={filterKeyword}
            onFilterFieldChange={setFilterFieldId}
            onFilterKeywordChange={setFilterKeyword}
            onReload={handleReloadRecords}
            onToggle={handleToggle}
            onSelectAll={handleSelectAll}
            onClear={handleClear}
            onPickInteractively={handlePickInteractively}
          />
          <OutputPanel
            fields={fields}
            attachmentFieldId={attachmentFieldId}
            writeBack={writeBack}
            downloadZip={downloadZip}
            generating={generating}
            progress={progress}
            results={results}
            merged={merged}
            selectedCount={selectedRecords.length}
            logs={logs}
            onAttachmentFieldChange={setAttachmentFieldId}
            onWriteBackChange={setWriteBack}
            onDownloadZipChange={setDownloadZip}
            onGenerate={handleGenerate}
            onGenerateMerged={handleGenerateMerged}
          />
        </div>

        <PreviewPane
          html={previewHtml}
          label={previewRecord ? previewRecord.title : '暂无记录'}
        />
      </div>
    </div>
  );
}