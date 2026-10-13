import { FieldType } from '@lark-base-open/js-sdk';
import type { FieldInfo, GeneratedItem } from '../types';

interface OutputPanelProps {
  fields: FieldInfo[];
  attachmentFieldId: string;
  writeBack: boolean;
  downloadZip: boolean;
  generating: boolean;
  progress: { done: number; total: number };
  results: GeneratedItem[];
  selectedCount: number;
  logs: string[];
  onAttachmentFieldChange: (fieldId: string) => void;
  onWriteBackChange: (value: boolean) => void;
  onDownloadZipChange: (value: boolean) => void;
  onGenerate: () => void;
  onDownloadZipAll: () => void;
}

/** 生成与输出：写回附件字段 / 打包 ZIP / 单独下载链接 */
export function OutputPanel({
  fields,
  attachmentFieldId,
  writeBack,
  downloadZip,
  generating,
  progress,
  results,
  selectedCount,
  logs,
  onAttachmentFieldChange,
  onWriteBackChange,
  onDownloadZipChange,
  onGenerate,
  onDownloadZipAll,
}: OutputPanelProps) {
  const attachmentFields = fields.filter((field) => field.type === FieldType.Attachment);
  const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  return (
    <section className="pane">
      <header className="pane-head">
        <h2>
          <span className="step">4</span> 生成 PDF
        </h2>
      </header>

      <div className="options">
        <label className="option">
          <input
            type="checkbox"
            checked={writeBack}
            onChange={(event) => onWriteBackChange(event.target.checked)}
          />
          <span>把 PDF 回写到多维表格附件字段</span>
        </label>
        {writeBack && (
          <select
            className="option-select"
            value={attachmentFieldId}
            onChange={(event) => onAttachmentFieldChange(event.target.value)}
          >
            <option value="">— 请选择附件字段 —</option>
            {attachmentFields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
          </select>
        )}
        {writeBack && attachmentFields.length === 0 && (
          <div className="warn">当前数据表没有附件字段，请先在多维表格中新增一个「附件」列。</div>
        )}

        <label className="option">
          <input
            type="checkbox"
            checked={downloadZip}
            onChange={(event) => onDownloadZipChange(event.target.checked)}
          />
          <span>生成后自动打包成 ZIP 下载</span>
        </label>
      </div>

      <div className="generate-bar">
        <button
          type="button"
          className="btn primary"
          disabled={generating || selectedCount === 0}
          onClick={onGenerate}
        >
          {generating ? `生成中 ${progress.done}/${progress.total}` : `生成 PDF（${selectedCount} 条）`}
        </button>
        {results.length > 0 && (
          <button type="button" className="btn ghost" onClick={onDownloadZipAll}>
            下载全部（ZIP · {results.length} 个）
          </button>
        )}
      </div>

      {generating && (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${percent}%` }} />
        </div>
      )}

      {results.length > 0 && (
        <>
          <div className="result-head">
            <span className="muted">生成结果（点击文件名即可单独下载）</span>
          </div>
          <ul className="result-list">
            {results.map((item) => (
              <li key={item.recordId}>
                <a href={item.url} download={item.fileName}>
                  {item.fileName}
                </a>
                <span className="muted">{item.recordTitle}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {logs.length > 0 && (
        <details className="logs">
          <summary>运行日志（{logs.length}）</summary>
          <ul>
            {logs.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}