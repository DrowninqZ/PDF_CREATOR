import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bitable } from '@lark-base-open/js-sdk';
import { BaseGateway, type StringRecord } from './bitable/client';
import { MappingPanel } from './components/MappingPanel';
import { OutputPanel } from './components/OutputPanel';
import { PreviewPane } from './components/PreviewPane';
import { RecordPanel } from './components/RecordPanel';
import { TemplatePanel } from './components/TemplatePanel';
import { downloadBlob, zipBlobs } from './pdf/export';
import { renderPdfBlob, safeFileName } from './pdf/render';
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
  RecordInfo,
} from './types';

const STORAGE_KEY = 'lark-base-form-pdf:config:v1';

type Status = 'loading' | 'ready' | 'error';

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

export default function App() {
  const gatewayRef = useRef<BaseGateway | null>(null);
  const resultsRef = useRef<GeneratedItem[]>([]);

  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [records, setRecords] = useState<RecordInfo[]>([]);
  const [recordData, setRecordData] = useState<Map<string, StringRecord>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recordsLoading, setRecordsLoading] = useState(false);

  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [mapping, setMapping] = useState<Mapping>({});
  const [titleFieldId, setTitleFieldId] = useState('');
  const [attachmentFieldId, setAttachmentFieldId] = useState('');

  const [writeBack, setWriteBack] = useState(false);
  const [downloadZip, setDownloadZip] = useState(true);

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<GeneratedItem[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const placeholders = useMemo(() => extractPlaceholders(template), [template]);

  const selectedRecords = useMemo(
    () => records.filter((record) => selected.has(record.id)),
    [records, selected],
  );

  const previewRecord = selectedRecords[0] ?? records[0];

  const loadRecords = useCallback(
    async (gateway: BaseGateway, titleId: string) => {
      setRecordsLoading(true);
      try {
        const { viewId } = await gateway.getSelection();
        const rows = await gateway.listStringRecords(viewId);
        setRecordData(new Map(rows.map((row) => [row.recordId, row])));
        const infos: RecordInfo[] = rows.map((row) => ({
          id: row.recordId,
          title: (titleId ? row.fields[titleId] : '') || row.recordId,
        }));
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

        const resolvedTitle =
          idByName.get(config.titleFieldName ?? '') ??
          fieldList.find((field) => field.isPrimary)?.id ??
          '';
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
        setTemplate(initialTemplate);
        setTitleFieldId(resolvedTitle);
        setAttachmentFieldId(resolvedAttachment);
        setMapping(initialMapping);
        setWriteBack(Boolean(resolvedAttachment));
        setStatus('ready');

        await loadRecords(gateway, resolvedTitle);
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
      titleFieldName: nameById.get(titleFieldId),
      attachmentFieldName: nameById.get(attachmentFieldId),
    });
  }, [status, fields, mapping, template, titleFieldId, attachmentFieldId]);

  // 同步结果引用，并在插件卸载时释放 object URL
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(
    () => () => {
      resultsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
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

  const handleTitleFieldChange = useCallback(
    (fieldId: string) => {
      setTitleFieldId(fieldId);
      setRecords((prev) =>
        prev.map((record) => ({
          ...record,
          title: (fieldId ? recordData.get(record.id)?.fields[fieldId] : '') || record.id,
        })),
      );
    },
    [recordData],
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
    if (!gateway) return;
    try {
      const { tableId, viewId } = await gateway.getSelection();
      if (!tableId || !viewId) return;
      const picked = await bitable.ui.selectRecordIdList(tableId, viewId);
      if (picked && picked.length > 0) setSelected(new Set(picked));
    } catch (error) {
      setLogs((prev) => [
        ...prev,
        `交互选择失败：${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
  }, []);

  const handleReloadRecords = useCallback(() => {
    const gateway = gatewayRef.current;
    if (gateway) void loadRecords(gateway, titleFieldId);
  }, [loadRecords, titleFieldId]);

  const ensureResultsZip = useCallback(async () => {
    const zip = await zipBlobs(
      results.map((item) => ({ name: item.fileName, blob: item.blob })),
    );
    downloadBlob(zip, `表单PDF_${stampString()}.zip`);
  }, [results]);

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
            titleFieldId={titleFieldId}
            onMappingChange={handleMappingChange}
            onTitleFieldChange={handleTitleFieldChange}
            onAutoMap={handleAutoMap}
          />
          <RecordPanel
            records={records}
            selected={selected}
            loading={recordsLoading}
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
            selectedCount={selectedRecords.length}
            logs={logs}
            onAttachmentFieldChange={setAttachmentFieldId}
            onWriteBackChange={setWriteBack}
            onDownloadZipChange={setDownloadZip}
            onGenerate={handleGenerate}
            onDownloadZipAll={ensureResultsZip}
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