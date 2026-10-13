import { useEffect, useRef, useState } from 'react';
import type { FieldInfo, Mapping } from '../types';
import { isBuiltinPlaceholder } from '../template/engine';

interface MappingPanelProps {
  placeholders: string[];
  fields: FieldInfo[];
  mapping: Mapping;
  /** 「记录名称字段」选中的字段 id 列表（可多选） */
  titleFieldIds: string[];
  onMappingChange: (key: string, fieldId: string) => void;
  onTitleFieldsChange: (fieldIds: string[]) => void;
  onAutoMap: () => void;
}

/**
 * 字段多选下拉：点击展开勾选多个字段，已选字段以标签形式显示在按钮上。
 * 选项面板采用文档流内展开（而非绝对定位浮层），避免被外层滚动容器裁切。
 */
function FieldMultiSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: FieldInfo[];
  value: string[];
  onChange: (fieldIds: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const selected = options.filter((option) => value.includes(option.id));

  const toggle = (fieldId: string) => {
    onChange(
      value.includes(fieldId) ? value.filter((id) => id !== fieldId) : [...value, fieldId],
    );
  };

  return (
    <div className="multiselect" ref={boxRef}>
      <button type="button" className="multiselect-trigger" onClick={() => setOpen((prev) => !prev)}>
        {selected.length === 0 ? (
          <span className="multiselect-placeholder">{placeholder}</span>
        ) : (
          <span className="multiselect-values">
            {selected.map((option) => (
              <span className="tag" key={option.id}>
                {option.name}
              </span>
            ))}
          </span>
        )}
        <span className="multiselect-arrow">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="multiselect-panel">
          {options.length > 0 && (
            <div className="multiselect-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => onChange(options.map((option) => option.id))}
                disabled={value.length === options.length}
              >
                全选
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => onChange([])}
                disabled={value.length === 0}
              >
                清空
              </button>
            </div>
          )}
          {options.length === 0 ? (
            <div className="empty">没有可选字段</div>
          ) : (
            options.map((option) => (
              <label className="multiselect-option" key={option.id}>
                <input
                  type="checkbox"
                  checked={value.includes(option.id)}
                  onChange={() => toggle(option.id)}
                />
                <span>{option.name}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** 字段映射：列出未映射的占位符，并配置「记录名称字段」 */
export function MappingPanel({
  placeholders,
  fields,
  mapping,
  titleFieldIds,
  onMappingChange,
  onTitleFieldsChange,
  onAutoMap,
}: MappingPanelProps) {
  const dataKeys = placeholders.filter((key) => !isBuiltinPlaceholder(key));
  const pending = dataKeys.filter((key) => !mapping[key]);
  const mappedCount = dataKeys.length - pending.length;

  return (
    <section className="pane">
      <header className="pane-head">
        <h2>
          <span className="step">2</span> 字段映射
        </h2>
        <div className="pane-actions">
          <span className="muted">
            {pending.length === 0
              ? `${mappedCount} 项已映射`
              : `剩余 ${pending.length} 项待映射`}
          </span>
          <button
            type="button"
            className="btn ghost"
            onClick={onAutoMap}
            disabled={pending.length === 0}
          >
            按名称自动匹配
          </button>
        </div>
      </header>

      <p className="hint">
        在第 1 步点击字段插入占位符时会自动按名称完成映射，这里只列出仍未匹配上的占位符。
        每条记录生成 PDF 时，占位符会替换为该记录对应字段的值。
      </p>

      {dataKeys.length === 0 ? (
        <div className="empty">模板里还没有数据占位符，请在上方第 1 步点击字段插入。</div>
      ) : pending.length === 0 ? (
        <div className="ok-box">全部 {mappedCount} 个占位符已映射完成，可以直接生成 PDF 了。</div>
      ) : (
        <table className="mapping-table">
          <thead>
            <tr>
              <th>模板占位符</th>
              <th>多维表格字段</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((key) => (
              <tr key={key}>
                <td>
                  <code className="code-inline">{`{{${key}}}`}</code>
                </td>
                <td>
                  <select
                    value=""
                    onChange={(event) => onMappingChange(key, event.target.value)}
                  >
                    <option value="">— 请选择字段 —</option>
                    {fields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="field-block">
        <label>记录名称字段（用于文件名与列表展示，可多选）</label>
        <FieldMultiSelect
          options={fields}
          value={titleFieldIds}
          onChange={onTitleFieldsChange}
          placeholder="— 使用记录 ID —"
        />
        <p className="hint field-hint">
          选中的列会作为记录名称：在「3 选择记录」中展示各列的列名与值，多条记录时按顺序拼接作为 PDF 文件名。
        </p>
      </div>
    </section>
  );
}