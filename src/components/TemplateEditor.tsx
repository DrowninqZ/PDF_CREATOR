import { useCallback, useEffect, useRef, type MouseEvent } from 'react';
import {
  BUILTIN_PLACEHOLDERS,
  bodyToEditorHtml,
  chipLabel,
  composeTemplate,
  createChipElement,
  editorHtmlToBody,
  parseTemplate,
} from '../template/engine';
import type { FieldInfo } from '../types';

interface TemplateEditorProps {
  /** 完整模板文档（占位符为 {{key}} 文本） */
  template: string;
  placeholders: string[];
  fields: FieldInfo[];
  onChange: (template: string) => void;
  /** 插入占位符后回调，用于自动完成字段映射 */
  onInserted?: (key: string) => void;
}

/** 可视化占位符 chip 的样式，仅存在于编辑器 Shadow DOM 中，不会进入导出 PDF */
const CHIP_CSS = `
.ph {
  display: inline-block;
  margin: 0 2px;
  padding: 1px 8px;
  border: 1px solid #c5d7ff;
  border-radius: 10px;
  background: #eaf1ff;
  color: #2b5cff;
  font-size: 0.92em;
  font-weight: 500;
  line-height: 1.6;
  white-space: nowrap;
  cursor: default;
  user-select: none;
}
.ph::before { content: "@"; opacity: 0.7; }
`;

const EMIT_DELAY_MS = 400;
/** A4 在 96dpi 下的宽度，用于把表单等比缩放到面板宽度 */
const A4_PAGE_WIDTH_PX = 794;

/**
 * 可视化模板编辑器。
 * 用 Shadow DOM 隔离模板样式，contenteditable 直接编辑表单正文，
 * 占位符以可视化 chip 呈现（内部仍是 {{key}} 文本，导出时自动还原）。
 */
export function TemplateEditor({
  template,
  placeholders,
  fields,
  onChange,
  onInserted,
}: TemplateEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const docRef = useRef<HTMLElement | null>(null);
  const cssRef = useRef('');
  const lastEmittedRef = useRef('');
  const savedRangeRef = useRef<Range | null>(null);
  const timerRef = useRef<number | null>(null);
  const changeRef = useRef(onChange);
  const insertedRef = useRef(onInserted);

  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    insertedRef.current = onInserted;
  }, [onInserted]);

  /**
   * Chrome 下 window.getSelection() 看不到 Shadow DOM 内部的选区（会被抬到宿主边界），
   * 必须用 shadowRoot.getSelection() 才能拿到编辑器里的真实光标位置。
   */
  const getActiveSelection = useCallback((): Selection | null => {
    const root = shadowRef.current as
      | (ShadowRoot & { getSelection?: () => Selection | null })
      | null;
    if (root && typeof root.getSelection === 'function') {
      const sel = root.getSelection();
      if (sel) return sel;
    }
    return window.getSelection();
  }, []);

  /** 记录编辑器内的光标位置，插入占位符时就近落点 */
  const captureSelection = useCallback(() => {
    const docEl = docRef.current;
    const sel = getActiveSelection();
    if (!docEl || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (docEl.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  }, [getActiveSelection]);

  const emitNow = useCallback(() => {
    const docEl = docRef.current;
    if (!docEl) return;
    const body = editorHtmlToBody(docEl.innerHTML);
    const next = composeTemplate(cssRef.current, body);
    lastEmittedRef.current = next;
    changeRef.current(next);
  }, []);

  const scheduleEmit = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      emitNow();
    }, EMIT_DELAY_MS);
  }, [emitNow]);

  /** 按面板宽度把 A4 表单等比缩放，避免出现横向滚动 */
  const applyZoom = useCallback(() => {
    const host = hostRef.current;
    const root = shadowRef.current;
    if (!host || !root) return;
    const wrap = root.querySelector<HTMLElement>('.editor-page-wrap');
    if (!wrap) return;
    const available = host.clientWidth - 24;
    if (available <= 0) return;
    const zoom = Math.min(1, Math.max(0.2, available / A4_PAGE_WIDTH_PX));
    wrap.style.zoom = String(zoom);
  }, []);

  const render = useCallback(
    (raw: string) => {
      const host = hostRef.current;
      if (!host) return;
      let root = shadowRef.current;
      if (!root) {
        root = host.attachShadow({ mode: 'open' });
        shadowRef.current = root;
      }

      const { css, body } = parseTemplate(raw);
      cssRef.current = css;

      root.innerHTML =
        `<style>:host{display:block;}.editor-page-wrap{width:210mm;}` +
        `.editor-doc{outline:none;}.editor-doc:focus{outline:none;}` +
        `.editor-doc .page{margin:0 auto;background:#fff;}` +
        `${css}\n${CHIP_CSS}</style>` +
        `<div class="editor-page-wrap"><div class="editor-doc" contenteditable="true" spellcheck="false">${bodyToEditorHtml(
          body,
        )}</div></div>`;

      const docEl = root.querySelector<HTMLElement>('.editor-doc');
      docRef.current = docEl;
      docEl?.addEventListener('input', scheduleEmit);
      docEl?.addEventListener('blur', emitNow);
      // mouseup / keyup 兜底记录光标，避免个别情况下 selectionchange 未覆盖
      docEl?.addEventListener('mouseup', captureSelection);
      docEl?.addEventListener('keyup', captureSelection);
      savedRangeRef.current = null;
      applyZoom();
    },
    [applyZoom, captureSelection, emitNow, scheduleEmit],
  );

  // 外部模板变化（导入 / 恢复示例）时重建编辑器；自身编辑产生的回写不再重建，避免丢光标
  useEffect(() => {
    if (template === lastEmittedRef.current) return;
    render(template);
  }, [template, render]);

  // 记录编辑器内的光标位置，插入占位符时就近落点
  useEffect(() => {
    document.addEventListener('selectionchange', captureSelection);
    return () => document.removeEventListener('selectionchange', captureSelection);
  }, [captureSelection]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => applyZoom());
    observer.observe(host);
    return () => observer.disconnect();
  }, [applyZoom]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const insertPlaceholder = useCallback(
    (key: string) => {
      const docEl = docRef.current;
      if (!docEl) return;

      const chip = createChipElement(document, key);
      const range = savedRangeRef.current;
      if (range && docEl.contains(range.startContainer)) {
        range.deleteContents();
        range.insertNode(chip);
      } else {
        // 没在表单里落过光标时，落到 A4 页面内容末尾，避免掉到页面外面看不见
        const page = docEl.querySelector('.page');
        (page ?? docEl).appendChild(chip);
      }

      const root = shadowRef.current;
      if (root && root.activeElement !== docEl) docEl.focus();

      const sel = getActiveSelection();
      if (sel) {
        const after = document.createRange();
        after.setStartAfter(chip);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
        savedRangeRef.current = after.cloneRange();
      }

      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      emitNow();
      insertedRef.current?.(key);
    },
    [emitNow, getActiveSelection],
  );

  const usedKeys = new Set(placeholders);

  // 用 mousedown 并在回调里 preventDefault：避免按钮抢走编辑器焦点导致光标丢失
  const handleChipMouseDown = (event: MouseEvent, key: string) => {
    event.preventDefault();
    insertPlaceholder(key);
  };

  return (
    <div className="template-editor">
      <div className="insert-area">
        <div className="insert-group">
          <span className="insert-label">数据字段</span>
          <div className="chip-wrap">
            {fields.length === 0 ? (
              <span className="muted">未读取到字段（请在多维表格插件中打开）</span>
            ) : (
              fields.map((field) => (
                <button
                  type="button"
                  key={field.id}
                  className={`chip${usedKeys.has(field.name) ? ' used' : ''}`}
                  onMouseDown={(event) => handleChipMouseDown(event, field.name)}
                  title={`插入 @${field.name}（同一字段可重复插入）`}
                >
                  {field.name}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="insert-group">
          <span className="insert-label">内置</span>
          <div className="chip-wrap">
            {Object.keys(BUILTIN_PLACEHOLDERS).map((key) => (
              <button
                type="button"
                key={key}
                className={`chip builtin${usedKeys.has(key) ? ' used' : ''}`}
                onMouseDown={(event) => handleChipMouseDown(event, key)}
                title={`插入 @${chipLabel(key)}：${BUILTIN_PLACEHOLDERS[key]}`}
              >
                {chipLabel(key)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="editor-scroll" ref={hostRef} />

      <p className="hint editor-hint">
        可直接点击表单里的文字进行修改；把光标放到要填值的空白处，再点上方字段即可插入
        <code className="code-inline">@字段名</code> 标签。同一字段可以在多处重复插入，生成时会各自填入该记录的值。
      </p>
    </div>
  );
}