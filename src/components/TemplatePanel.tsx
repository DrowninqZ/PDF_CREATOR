import { useRef, useState } from 'react';
import { TemplateEditor } from './TemplateEditor';
import { importTemplateFile } from '../template/templateImport';
import type { FieldInfo } from '../types';

interface TemplatePanelProps {
  template: string;
  placeholders: string[];
  fields: FieldInfo[];
  onChange: (template: string) => void;
  /** 插入占位符后回调，用于自动完成字段映射 */
  onInserted?: (key: string) => void;
  onReset: () => void;
}

/** 模板配置：导入 Word/HTML，再用可视化编辑器直接改表单、点字段插入占位符 */
export function TemplatePanel({
  template,
  placeholders,
  fields,
  onChange,
  onInserted,
  onReset,
}: TemplatePanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError('');
    setImporting(true);
    try {
      const html = await importTemplateFile(file);
      onChange(html);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="pane">
      <header className="pane-head">
        <h2>
          <span className="step">1</span> 表单模板
        </h2>
        <div className="pane-actions">
          <button
            type="button"
            className="btn ghost"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            {importing ? '导入中…' : '导入 Word / HTML'}
          </button>
          <button type="button" className="btn ghost" onClick={onReset}>
            恢复示例模板
          </button>
        </div>
      </header>

      <p className="hint">
        直接编辑下方表单即可，无需写代码。把光标放到要填值的位置，再点字段就会插入
        <code className="code-inline">@字段名</code> 标签，同一字段可重复插入。
      </p>

      {importError && <div className="warn inline-warn">{importError}</div>}

      <TemplateEditor
        template={template}
        placeholders={placeholders}
        fields={fields}
        onChange={onChange}
        onInserted={onInserted}
      />

      <div className="tag-row">
        <span className="muted">识别到 {placeholders.length} 个占位符：</span>
        {placeholders.map((key) => (
          <span className="tag" key={key}>
            {key}
          </span>
        ))}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".docx,.html,.htm,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html"
        hidden
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
    </section>
  );
}