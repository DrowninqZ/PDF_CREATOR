import JSZip from 'jszip';
import { escapeHtml } from './engine';
import { A4_DOCX_BASE_CSS } from './a4Styles';

/**
 * Word（.docx）→ A4 模板 HTML。
 *
 * 这里直接解析 OOXML，而不是走「语义化」转换库，原因是要**保留版式**：
 * 表格列宽（w:tblGrid / w:tcW）、边框（w:tblBorders / w:tcBorders）、底纹（w:shd）、
 * 行高（w:trHeight）、合并（w:gridSpan / w:vMerge）、段落对齐与间距（w:jc / w:spacing / w:ind）、
 * 字号字体（w:rPr）、图片原始尺寸（wp:extent）等，全部映射成内联样式。
 *
 * 已知不做的事：页眉页脚、页面边框、浮动图片的精确定位、分栏。
 */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** EMU → px：914400 EMU/inch，96 px/inch */
const EMU_PER_PX = 9525;
/** twip(dxa) → pt */
const TWIPS_PER_PT = 20;
/** twip → mm */
const TWIPS_PER_MM = 1440 / 25.4;
/** Word 表格默认单元格左右内边距（twip） */
const DEFAULT_CELL_MARGIN_PT = 5.4;

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

type El = Element;

const round = (value: number): number => Math.round(value * 100) / 100;
const toPt = (twips: number): number => twips / TWIPS_PER_PT;
const toMm = (twips: number): number => twips / TWIPS_PER_MM;

/* ------------------------------------------------------------------ XML 工具 */

const childEls = (el: El): El[] =>
  Array.from(el.childNodes).filter((node): node is El => node.nodeType === 1);

/** 只取**直接子元素**，避免嵌套表格/嵌套段落的属性串味 */
function kids(el: El | null | undefined, name: string): El[] {
  if (!el) return [];
  return childEls(el).filter((child) => child.localName === name);
}

function kid(el: El | null | undefined, name: string): El | null {
  if (!el) return null;
  return childEls(el).find((child) => child.localName === name) ?? null;
}

function wAttr(el: El | null, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(W_NS, name) ?? el.getAttribute(`w:${name}`);
}

function rAttr(el: El | null, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(R_NS, name) ?? el.getAttribute(`r:${name}`);
}

/** 读取 w:* 元素的 w:val 属性 */
const wVal = (el: El | null): string | null => wAttr(el, 'val');

/** 读取开关型属性（w:b / w:i / w:vMerge 等）：无 val 视为 true */
function onOff(el: El | null): boolean {
  if (!el) return false;
  const value = wVal(el);
  return value === null || value === '1' || value === 'true' || value === 'on';
}

/** 在优先级由低到高的属性元素列表中，取最后一个定义了该子元素的值 */
function pick(list: (El | null)[], name: string): El | null {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const found = kid(list[index], name);
    if (found) return found;
  }
  return null;
}

function num(value: string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ------------------------------------------------------------------ 样式表 */

interface StyleDef {
  basedOn: string | null;
  pPr: El | null;
  rPr: El | null;
  tblPr: El | null;
}

interface StyleSheet {
  styles: Map<string, StyleDef>;
  defaultPPr: El | null;
  defaultRPr: El | null;
}

function readStyles(xml: string | null): StyleSheet {
  const sheet: StyleSheet = { styles: new Map(), defaultPPr: null, defaultRPr: null };
  if (!xml) return sheet;

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (!root) return sheet;

  const defaults = kid(root, 'docDefaults');
  sheet.defaultPPr = kid(kid(defaults, 'pPrDefault'), 'pPr');
  sheet.defaultRPr = kid(kid(defaults, 'rPrDefault'), 'rPr');

  for (const style of kids(root, 'style')) {
    const styleId = wAttr(style, 'styleId');
    if (!styleId) continue;
    sheet.styles.set(styleId, {
      basedOn: wVal(kid(style, 'basedOn')),
      pPr: kid(style, 'pPr'),
      rPr: kid(style, 'rPr'),
      tblPr: kid(style, 'tblPr'),
    });
  }
  return sheet;
}

/** 展开样式继承链，父样式在前（优先级低）、子样式在后 */
function styleChain(sheet: StyleSheet, styleId: string | null): StyleDef[] {
  const chain: StyleDef[] = [];
  const seen = new Set<string>();
  let id: string | null = styleId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const def = sheet.styles.get(id);
    if (!def) break;
    chain.unshift(def);
    id = def.basedOn;
  }
  return chain;
}

/* ------------------------------------------------------------------ 颜色与边框 */

const COLOR_WORDS: Record<string, string> = {
  red: '#ff0000',
  blue: '#0000ff',
  green: '#008000',
  black: '#000000',
  white: '#ffffff',
  yellow: '#ffff00',
  gray: '#808080',
  grey: '#808080',
};

/** 把 OOXML 的颜色写法（RRGGBB / 具名色 / auto）转成 CSS 颜色 */
function hexColor(raw: string | null): string | null {
  if (!raw || raw === 'auto') return null;
  const value = raw.trim();
  const word = COLOR_WORDS[value.toLowerCase()];
  if (word) return word;
  const hex = value.replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : null;
}

/** 读取 w:color 元素的颜色（属性名是 w:val） */
const colorOf = (el: El | null): string | null => hexColor(wVal(el));

interface Border {
  width: number;
  color: string;
}

/** 边框的三种状态：未定义（继承）、明确无边框（null）、有边框 */
function readBorder(el: El | null): Border | null | undefined {
  if (!el) return undefined;
  const style = wAttr(el, 'val');
  if (style === 'nil' || style === 'none' || style === '') return null;
  const sz = num(wAttr(el, 'sz'));
  return {
    width: Math.max(sz / 8, 0.5),
    color: hexColor(wAttr(el, 'color')) ?? '#000000',
  };
}

function borderCss(border: Border | null | undefined): string | null {
  if (border === undefined) return null;
  if (border === null) return 'none';
  return `${round(border.width)}pt solid ${border.color}`;
}

/* ------------------------------------------------------------------ 字体 */

interface Font {
  size: number;
  family: string;
  color: string | null;
}

/** CSS font-family：含空格的字体名加单引号（避免与外层双引号属性冲突） */
function cssFontFamily(family: string): string {
  return family
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => (/[\s]/.test(name) ? `'${name}'` : name))
    .join(', ');
}

function readFont(rPrs: (El | null)[], fallback: Font): Font {
  const sizeRaw = wAttr(pick(rPrs, 'sz'), 'val');
  const size = sizeRaw ? num(sizeRaw) / 2 : fallback.size;

  const rFonts = pick(rPrs, 'rFonts');
  const eastAsia = wAttr(rFonts, 'eastAsia');
  const ascii = wAttr(rFonts, 'ascii');
  const names: string[] = [];
  for (const name of [eastAsia, ascii]) {
    if (name && name !== 'auto' && !names.includes(name)) names.push(name);
  }

  return {
    size: size > 0 ? size : fallback.size,
    family: names.length > 0 ? names.join(', ') : fallback.family,
    color: colorOf(pick(rPrs, 'color')) ?? fallback.color,
  };
}

function fontCss(font: Font): string {
  const parts = [`font-size:${round(font.size)}pt`, `font-family:${cssFontFamily(font.family)}`];
  if (font.color) parts.push(`color:${font.color}`);
  return parts.join(';');
}

const sameFont = (a: Font, b: Font): boolean =>
  a.size === b.size && a.family === b.family && a.color === b.color;

/* ------------------------------------------------------------------ 段落属性 */

const ALIGN: Record<string, string> = {
  left: 'left',
  start: 'left',
  center: 'center',
  right: 'right',
  end: 'right',
  both: 'justify',
  distribute: 'justify',
};

function paragraphCss(pPrs: (El | null)[]): string {
  const parts: string[] = [];

  const jc = wVal(pick(pPrs, 'jc'));
  if (jc && ALIGN[jc]) parts.push(`text-align:${ALIGN[jc]}`);

  const spacing = pick(pPrs, 'spacing');
  if (spacing) {
    const before = wAttr(spacing, 'before');
    const after = wAttr(spacing, 'after');
    if (before && before !== 'auto') parts.push(`margin-top:${round(toPt(num(before)))}pt`);
    if (after && after !== 'auto') parts.push(`margin-bottom:${round(toPt(num(after)))}pt`);

    const line = wAttr(spacing, 'line');
    const rule = wAttr(spacing, 'lineRule') ?? 'auto';
    if (line) {
      if (rule === 'auto') {
        // 240 = 单倍行距，交给 CSS 的 normal，避免中文行距过紧
        const multiple = num(line) / 240;
        if (multiple > 1.01) parts.push(`line-height:${round(multiple)}`);
      } else {
        parts.push(`line-height:${round(toPt(num(line)))}pt`);
      }
    }
  }

  const ind = pick(pPrs, 'ind');
  if (ind) {
    const left = wAttr(ind, 'left') ?? wAttr(ind, 'start');
    const right = wAttr(ind, 'right') ?? wAttr(ind, 'end');
    const firstLine = wAttr(ind, 'firstLine');
    const hanging = wAttr(ind, 'hanging');
    if (left) parts.push(`margin-left:${round(toPt(num(left)))}pt`);
    if (right) parts.push(`margin-right:${round(toPt(num(right)))}pt`);
    if (firstLine) parts.push(`text-indent:${round(toPt(num(firstLine)))}pt`);
    else if (hanging) parts.push(`text-indent:${round(-toPt(num(hanging)))}pt`);
  }

  return parts.join(';');
}

/* ------------------------------------------------------------------ 渲染上下文 */

interface Ctx {
  sheet: StyleSheet;
  /** rId -> data URI */
  images: Map<string, string>;
  /** 文档默认字体，作为所有文字的兜底 */
  pageFont: Font;
}

/* ------------------------------------------------------------------ 分页流模型 */

/**
 * 渲染结果是一个有序流：块内容与分页点按文档顺序排列。
 *
 * 分页信号可能出现在任意深度（run 内、段落属性、表格单元格内），
 * 在内层被「向上提升」成分页点，只在最顶层消费，从而保证
 * 导出 PDF 的页数、每页内容边界与源文档一致。
 */
type FlowItem = { kind: 'block'; html: string } | { kind: 'break' };
type Flow = FlowItem[];

const BREAK: FlowItem = { kind: 'break' };

/** `<w:br w:type="page"/>`：硬分页（区别于普通换行 `<w:br/>`） */
const isPageBreakBr = (el: El): boolean => el.localName === 'br' && wAttr(el, 'type') === 'page';

/** 段落属性是否要求「本段从新页开始」 */
const breaksBeforeParagraph = (pPr: El | null): boolean => onOff(kid(pPr, 'pageBreakBefore'));

/** 段落级 sectPr：本段之后分节，除 continuous 外都会另起一页 */
function breaksAfterParagraph(pPr: El | null): boolean {
  const sectPr = kid(pPr, 'sectPr');
  if (!sectPr) return false;
  const type = wVal(kid(sectPr, 'type'));
  return type === null || type === 'nextPage' || type === 'evenPage' || type === 'oddPage';
}

const flowHasBreak = (flow: Flow): boolean => flow.some((item) => item.kind === 'break');
const dropBreaks = (flow: Flow): Flow => flow.filter((item) => item.kind !== 'break');

/** 把 src 的分页点并入 dst：src 的首段接在 dst 末段之后，其余各自成为新段 */
function mergeSegments(dst: string[], src: string[]): void {
  if (src.length === 0) return;
  dst[dst.length - 1] += src[0];
  for (let index = 1; index < src.length; index += 1) dst.push(src[index]);
}

/* ---- 行内内容（返回「以分页点分隔」的片段序列） ---- */

/** 单个 run 内部：文字、换行、制表符、图片。分页标记处切断片段 */
function renderRunContentSegments(run: El, ctx: Ctx): string[] {
  const segments: string[] = [];
  let buffer = '';
  const flush = () => {
    segments.push(buffer);
    buffer = '';
  };

  for (const child of childEls(run)) {
    switch (child.localName) {
      case 'lastRenderedPageBreak':
        flush();
        break;
      case 'br':
        if (isPageBreakBr(child)) flush();
        else buffer += '<br>';
        break;
      case 't':
        buffer += escapeHtml(child.textContent ?? '');
        break;
      case 'tab':
        buffer += '<span style="display:inline-block;width:21pt"></span>';
        break;
      case 'noBreakHyphen':
        buffer += '&#8209;';
        break;
      case 'softHyphen':
        buffer += '&shy;';
        break;
      case 'drawing':
        buffer += renderDrawing(child, ctx);
        break;
      case 'pict':
        buffer += renderPict(child, ctx);
        break;
      default:
        break;
    }
  }

  flush();
  return segments;
}

function renderRunSegments(run: El, ctx: Ctx, baseRPrs: (El | null)[], baseFont: Font): string[] {
  const rPr = kid(run, 'rPr');
  const styles = [baseRPrs, ...styleChain(ctx.sheet, wVal(kid(rPr, 'rStyle'))).map((d) => d.rPr), rPr];
  const rPrs = styles.flat();
  const font = readFont(rPrs, baseFont);

  const parts: string[] = [];
  if (!sameFont(font, baseFont)) parts.push(fontCss(font));
  if (onOff(pick(rPrs, 'b'))) parts.push('font-weight:700');
  if (onOff(pick(rPrs, 'i'))) parts.push('font-style:italic');

  const decorations: string[] = [];
  const underline = pick(rPrs, 'u');
  if (underline && wVal(underline) !== 'none') decorations.push('underline');
  if (onOff(pick(rPrs, 'strike'))) decorations.push('line-through');
  if (decorations.length > 0) parts.push(`text-decoration:${decorations.join(' ')}`);

  const vertAlign = wVal(pick(rPrs, 'vertAlign'));
  if (vertAlign === 'superscript' || vertAlign === 'subscript') {
    parts.push(`vertical-align:${vertAlign === 'superscript' ? 'super' : 'sub'}`);
    parts.push('font-size:0.72em');
  }

  const open = parts.length > 0 ? `<span style="${parts.join(';')}">` : '';
  const close = parts.length > 0 ? '</span>' : '';

  return renderRunContentSegments(run, ctx).map((segment) =>
    segment ? `${open}${segment}${close}` : '',
  );
}

/** 行内容器（段落 / 超链接 / 修订插入 / 内容控件）里的内容 */
function renderInlineSegments(
  parent: El,
  ctx: Ctx,
  baseRPrs: (El | null)[],
  baseFont: Font,
): string[] {
  const segments: string[] = [''];

  for (const child of childEls(parent)) {
    switch (child.localName) {
      case 'r':
        mergeSegments(segments, renderRunSegments(child, ctx, baseRPrs, baseFont));
        break;
      case 'hyperlink':
      case 'ins':
        mergeSegments(segments, renderInlineSegments(child, ctx, baseRPrs, baseFont));
        break;
      case 'sdt':
      case 'smartTag': {
        const box = kid(child, 'sdtContent') ?? child;
        mergeSegments(segments, renderInlineSegments(box, ctx, baseRPrs, baseFont));
        break;
      }
      case 'drawing':
        mergeSegments(segments, [renderDrawing(child, ctx)]);
        break;
      case 'pict':
        mergeSegments(segments, [renderPict(child, ctx)]);
        break;
      default:
        break;
    }
  }

  return segments;
}

/* ------------------------------------------------------------------ 图片 */

function imageTag(src: string, widthPt: number | null, heightPt: number | null): string {
  const size: string[] = [];
  if (widthPt && heightPt) {
    size.push(`width:${round(widthPt)}pt`, `height:${round(heightPt)}pt`);
  }
  const style = size.length > 0 ? ` style="${size.join(';')}"` : '';
  return `<img src="${src}" alt=""${style}>`;
}

function renderDrawing(drawing: El, ctx: Ctx): string {
  const blip = drawing.getElementsByTagNameNS('*', 'blip')[0];
  const rId = rAttr(blip ?? null, 'embed');
  const src = rId ? ctx.images.get(rId) : undefined;
  if (!src) return '';

  const extent = drawing.getElementsByTagNameNS('*', 'extent')[0];
  const cx = num(extent?.getAttribute('cx'));
  const cy = num(extent?.getAttribute('cy'));
  if (cx <= 0 || cy <= 0) return `<img src="${src}" alt="">`;

  // EMU -> px -> pt（1px = 0.75pt）
  return imageTag(src, (cx / EMU_PER_PX) * 0.75, (cy / EMU_PER_PX) * 0.75);
}

/** 旧版 VML 图片（w:pict / v:imagedata），尺寸写在 style 的 width/height 上 */
function renderPict(pict: El, ctx: Ctx): string {
  const imageData = pict.getElementsByTagNameNS('*', 'imagedata')[0];
  const rId = rAttr(imageData ?? null, 'id');
  const src = rId ? ctx.images.get(rId) : undefined;
  if (!src) return '';

  const shape = pict.getElementsByTagNameNS('*', 'shape')[0];
  const style = shape?.getAttribute('style') ?? '';
  const width = /width:([\d.]+)pt/.exec(style);
  const height = /height:([\d.]+)pt/.exec(style);
  if (width && height) return imageTag(src, num(width[1]), num(height[1]));
  return `<img src="${src}" alt="">`;
}

/* ------------------------------------------------------------------ 表格 */

interface OutCell {
  colSpan: number;
  /** 起始网格列下标，用于判断首/末列 */
  gridIndex: number;
  /** 纵向合并的高度（行数），只在同一张表内有效 */
  rowSpan: number;
  /** 与位置无关的样式：宽度、底纹、垂直对齐、内边距 */
  baseCss: string;
  /** 单元格自身声明的边框；undefined 表示继承表格边框 */
  borders: { top: Border | null | undefined; bottom: Border | null | undefined; left: Border | null | undefined; right: Border | null | undefined };
  flow: Flow;
}

interface OutRow {
  height: number;
  cells: OutCell[];
}

type TableEdges = Record<
  'top' | 'bottom' | 'left' | 'right' | 'insideH' | 'insideV',
  Border | null | undefined
>;

interface TableMeta {
  css: string;
  colgroup: string;
  edges: TableEdges;
  pad: { top: number; right: number; bottom: number; left: number };
  totalCols: number;
}

function countGridSpan(tr: El): number {
  return kids(tr, 'tc').reduce(
    (sum, tc) => sum + Math.max(num(wVal(kid(kid(tc, 'tcPr'), 'gridSpan'))) || 1, 1),
    0,
  );
}

function readTableWidth(tblW: El | null, gridCols: number[]): string | null {
  const type = wAttr(tblW, 'type');
  const value = num(wAttr(tblW, 'w'));
  if (value > 0) {
    if (type === 'dxa') return `${round(toPt(value))}pt`;
    if (type === 'pct') return `${round(value / 50)}%`;
  }
  if (gridCols.length > 0) {
    return `${round(toPt(gridCols.reduce((sum, w) => sum + w, 0)))}pt`;
  }
  return null;
}

function buildTableMeta(
  tblPrs: (El | null)[],
  gridCols: number[],
  totalCols: number,
): TableMeta {
  const tblBorders = pick(tblPrs, 'tblBorders');
  const edges: TableEdges = {
    top: readBorder(kid(tblBorders, 'top')),
    bottom: readBorder(kid(tblBorders, 'bottom')),
    left: readBorder(kid(tblBorders, 'left')),
    right: readBorder(kid(tblBorders, 'right')),
    insideH: readBorder(kid(tblBorders, 'insideH')),
    insideV: readBorder(kid(tblBorders, 'insideV')),
  };

  const cellMar = pick(tblPrs, 'tblCellMar');
  const marginPt = (name: string, fallback: number): number => {
    const value = wAttr(kid(cellMar, name), 'w');
    return value ? toPt(num(value)) : fallback;
  };
  const pad = {
    top: marginPt('top', 0),
    right: marginPt('right', DEFAULT_CELL_MARGIN_PT),
    bottom: marginPt('bottom', 0),
    left: marginPt('left', DEFAULT_CELL_MARGIN_PT),
  };

  const css: string[] = ['border-collapse:collapse'];
  const tableWidth = readTableWidth(pick(tblPrs, 'tblW'), gridCols);
  if (tableWidth) css.push(`width:${tableWidth}`);
  if (gridCols.length > 0) css.push('table-layout:fixed');

  const jc = wVal(pick(tblPrs, 'jc'));
  if (jc === 'center') {
    css.push('margin-left:auto', 'margin-right:auto');
  } else {
    const indent = num(wAttr(pick(tblPrs, 'tblInd'), 'w'));
    if (indent > 0) css.push(`margin-left:${round(toPt(indent))}pt`);
  }

  const colgroup =
    gridCols.length > 0
      ? `<colgroup>${gridCols.map((w) => `<col style="width:${round(toPt(w))}pt">`).join('')}</colgroup>`
      : '';

  return { css: css.join(';'), colgroup, edges, pad, totalCols };
}

function buildCell(
  tc: El,
  tcPr: El | null,
  ctx: Ctx,
  options: { pad: TableMeta['pad']; colSpan: number; gridIndex: number },
): OutCell {
  const css: string[] = [];

  const tcW = kid(tcPr, 'tcW');
  if (wAttr(tcW, 'type') === 'dxa') {
    const width = num(wAttr(tcW, 'w'));
    if (width > 0) css.push(`width:${round(toPt(width))}pt`);
  }

  const shading = kid(tcPr, 'shd');
  if (shading && wVal(shading) !== 'nil') {
    const fill = hexColor(wAttr(shading, 'fill'));
    if (fill) css.push(`background-color:${fill}`);
  }

  const vAlign = wVal(kid(tcPr, 'vAlign'));
  css.push(`vertical-align:${vAlign === 'center' ? 'middle' : vAlign === 'bottom' ? 'bottom' : 'top'}`);

  const tcMar = kid(tcPr, 'tcMar');
  const padOf = (name: string, fallback: number): number => {
    const value = wAttr(kid(tcMar, name), 'w');
    return value ? toPt(num(value)) : fallback;
  };
  css.push(
    `padding:${round(padOf('top', options.pad.top))}pt ${round(padOf('right', options.pad.right))}pt ` +
      `${round(padOf('bottom', options.pad.bottom))}pt ${round(padOf('left', options.pad.left))}pt`,
  );

  const tcBorders = kid(tcPr, 'tcBorders');
  const own = (name: string): Border | null | undefined => readBorder(kid(tcBorders, name));

  return {
    colSpan: options.colSpan,
    gridIndex: options.gridIndex,
    rowSpan: 1,
    baseCss: css.join(';'),
    borders: { top: own('top'), bottom: own('bottom'), left: own('left'), right: own('right') },
    flow: renderBlockFlow(tc, ctx),
  };
}

/**
 * 渲染一张表格。若某一行内出现分页点，则在行边界处把表格拆成上下两张，
 * 分页点落在两者之间；含分页点的那一行整体下移（不丢内容，可能多留空白）。
 */
function renderTableFlow(table: El, ctx: Ctx): Flow {
  const tblPr = kid(table, 'tblPr');
  const tblPrs = [
    ...styleChain(ctx.sheet, wVal(kid(tblPr, 'tblStyle'))).map((d) => d.tblPr),
    tblPr,
  ];

  // 列宽来自 w:tblGrid，是还原版式的核心
  const gridCols = kids(kid(table, 'tblGrid'), 'gridCol').map((col) => num(wAttr(col, 'w')));
  const rows = kids(table, 'tr');
  const totalCols = gridCols.length > 0 ? gridCols.length : Math.max(...rows.map(countGridSpan), 1);
  const meta = buildTableMeta(tblPrs, gridCols, totalCols);

  const outRows: OutRow[] = [];
  /** 网格列下标 -> 正在纵向合并的单元格 */
  const openMerge = new Map<number, OutCell>();

  rows.forEach((tr) => {
    const trHeight = kid(kid(tr, 'trPr'), 'trHeight');
    const height = num(wAttr(trHeight, 'val'));
    const row: OutRow = { height: height > 0 ? toPt(height) : 0, cells: [] };

    let gridIndex = 0;
    for (const tc of kids(tr, 'tc')) {
      const tcPr = kid(tc, 'tcPr');
      const colSpan = Math.max(num(wVal(kid(tcPr, 'gridSpan'))) || 1, 1);

      const vMerge = kid(tcPr, 'vMerge');
      // 纵向合并的续格：把它并进上方的单元格，自身不输出
      if (vMerge && wVal(vMerge) !== 'restart') {
        const host = openMerge.get(gridIndex);
        if (host) host.rowSpan += 1;
        gridIndex += colSpan;
        continue;
      }

      const cell = buildCell(tc, tcPr, ctx, { pad: meta.pad, colSpan, gridIndex });
      row.cells.push(cell);

      for (let index = gridIndex; index < gridIndex + colSpan; index += 1) {
        if (vMerge) openMerge.set(index, cell);
        else openMerge.delete(index);
      }
      gridIndex += colSpan;
    }

    outRows.push(row);
  });

  const splitAt = outRows
    .map((row, index) => (row.cells.some((cell) => flowHasBreak(cell.flow)) ? index : -1))
    .filter((index) => index >= 0);

  if (splitAt.length === 0) {
    return [{ kind: 'block', html: serializeTable(meta, outRows, 0, outRows.length) }];
  }

  const flow: Flow = [];
  let start = 0;

  for (const boundary of splitAt) {
    // 该行整体下移到下一页，其内部的分页点由这次拆分消费掉
    for (const cell of outRows[boundary].cells) cell.flow = dropBreaks(cell.flow);

    if (boundary > start) {
      flow.push({ kind: 'block', html: serializeTable(meta, outRows, start, boundary) });
    }
    flow.push(BREAK);
    start = boundary;
  }

  flow.push({ kind: 'block', html: serializeTable(meta, outRows, start, outRows.length) });
  return flow;
}

/**
 * 跨拆分缝隙的纵向合并：把上半张表里还没结束的合并单元格，
 * 在下半张表的首行补出续格，避免下半张表出现网格空洞。
 */
function collectCarriedMerges(rows: OutRow[], from: number, to: number): OutCell[] {
  const carried = new Map<number, OutCell>();

  for (let index = 0; index < from; index += 1) {
    for (const cell of rows[index].cells) {
      const end = index + cell.rowSpan;
      if (end <= from) continue;

      const continuation: OutCell = {
        colSpan: cell.colSpan,
        gridIndex: cell.gridIndex,
        rowSpan: Math.min(end, to) - from,
        baseCss: cell.baseCss,
        borders: cell.borders,
        flow: [],
      };
      for (let col = cell.gridIndex; col < cell.gridIndex + cell.colSpan; col += 1) {
        carried.set(col, continuation);
      }
    }
  }

  return Array.from(new Set(carried.values())).sort((a, b) => a.gridIndex - b.gridIndex);
}

/** 序列化 [from, to) 区间的行；边框按**本张表内**的首/末行、首/末列重算 */
function serializeTable(meta: TableMeta, rows: OutRow[], from: number, to: number): string {
  const carried = from > 0 ? collectCarriedMerges(rows, from, to) : [];

  const body = rows
    .slice(from, to)
    .map((row, offset) => {
      const isFirstRow = offset === 0;
      const isLastRow = offset === to - from - 1;
      const cells =
        isFirstRow && carried.length > 0
          ? [...carried, ...row.cells].sort((a, b) => a.gridIndex - b.gridIndex)
          : row.cells;

      const attr = row.height > 0 ? ` style="height:${round(row.height)}pt"` : '';
      const html = cells
        .map((cell) => serializeCell(meta, cell, from + offset, isFirstRow, isLastRow, to))
        .join('');
      return `<tr${attr}>${html}</tr>`;
    })
    .join('');

  return `<table style="${meta.css}">${meta.colgroup}<tbody>${body}</tbody></table>`;
}

function serializeCell(
  meta: TableMeta,
  cell: OutCell,
  rowIndex: number,
  isFirstRow: boolean,
  isLastRow: boolean,
  endRow: number,
): string {
  const rowSpan = Math.min(rowIndex + cell.rowSpan, endRow) - rowIndex;
  const isFirstCol = cell.gridIndex === 0;
  const isLastCol = cell.gridIndex + cell.colSpan >= meta.totalCols;

  // 边框：单元格自身 > 本表外框（首行/首列/末行/末列）> 表格内部线
  const resolve = (name: 'top' | 'bottom' | 'left' | 'right'): Border | null | undefined => {
    const own = cell.borders[name];
    if (own !== undefined) return own;
    if (name === 'top') return isFirstRow ? meta.edges.top : meta.edges.insideH;
    if (name === 'bottom') return isLastRow ? meta.edges.bottom : meta.edges.insideH;
    if (name === 'left') return isFirstCol ? meta.edges.left : meta.edges.insideV;
    return isLastCol ? meta.edges.right : meta.edges.insideV;
  };

  const css: string[] = [];
  for (const name of ['top', 'bottom', 'left', 'right'] as const) {
    const value = borderCss(resolve(name));
    if (value) css.push(`border-${name}:${value}`);
  }
  if (cell.baseCss) css.push(cell.baseCss);

  const attrs: string[] = [];
  if (cell.colSpan > 1) attrs.push(`colspan="${cell.colSpan}"`);
  if (rowSpan > 1) attrs.push(`rowspan="${rowSpan}"`);

  const content =
    cell.flow.map((item) => (item.kind === 'block' ? item.html : '')).join('') || '&nbsp;';
  return `<td${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''} style="${css.join(';')}">${content}</td>`;
}

/* ------------------------------------------------------------------ 块级内容 */

function renderParagraphFlow(p: El, ctx: Ctx): Flow {
  const pPr = kid(p, 'pPr');
  const chain = styleChain(ctx.sheet, wVal(kid(pPr, 'pStyle')));

  const pPrs: (El | null)[] = [ctx.sheet.defaultPPr, ...chain.map((d) => d.pPr), pPr];
  const baseRPrs: (El | null)[] = [ctx.sheet.defaultRPr, ...chain.map((d) => d.rPr), kid(pPr, 'rPr')];

  const baseFont = readFont(baseRPrs, ctx.pageFont);
  const css = [paragraphCss(pPrs), fontCss(baseFont)].filter(Boolean).join(';');
  const segments = renderInlineSegments(p, ctx, baseRPrs, baseFont);

  const flow: Flow = [];
  if (breaksBeforeParagraph(pPr)) flow.push(BREAK);

  if (segments.length <= 1) {
    // 段内没有分页点：保持原有行为（空段落输出 &nbsp; 占位）
    flow.push({ kind: 'block', html: `<p style="${css}">${segments[0] || '&nbsp;'}</p>` });
  } else {
    // 段内出现分页点：空片段不产出 <p>，消解「只承载分页符的空段落」
    segments.forEach((segment, index) => {
      if (index > 0) flow.push(BREAK);
      if (segment) flow.push({ kind: 'block', html: `<p style="${css}">${segment}</p>` });
    });
  }

  if (breaksAfterParagraph(pPr)) flow.push(BREAK);
  return flow;
}

function renderBlockFlow(parent: El, ctx: Ctx): Flow {
  const flow: Flow = [];
  for (const child of childEls(parent)) {
    switch (child.localName) {
      case 'p':
        flow.push(...renderParagraphFlow(child, ctx));
        break;
      case 'tbl':
        flow.push(...renderTableFlow(child, ctx));
        break;
      case 'sdt': {
        const box = kid(child, 'sdtContent');
        if (box) flow.push(...renderBlockFlow(box, ctx));
        break;
      }
      default:
        break;
    }
  }
  return flow;
}

/** 按分页点把流切成页；当前页为空时忽略分页点，末尾空页丢弃 */
function flowToPages(flow: Flow): string[][] {
  const pages: string[][] = [];
  let current: string[] = [];

  for (const item of flow) {
    if (item.kind === 'break') {
      if (current.length > 0) {
        pages.push(current);
        current = [];
      }
      continue;
    }
    current.push(item.html);
  }

  if (current.length > 0) pages.push(current);
  return pages;
}

/* ------------------------------------------------------------------ 页面设置 */

function pageCss(sectPr: El | null, font: Font): string {
  const rules: string[] = [];

  const pgMar = kid(sectPr, 'pgMar');
  // 页边距写在 w:pgMar 的属性上（w:top / w:right / w:bottom / w:left），单位 twip
  const side = (name: string): number => toMm(num(wAttr(pgMar, name)));
  const gutter = toMm(num(wAttr(pgMar, 'gutter')));
  const top = side('top');
  const right = side('right');
  const bottom = side('bottom');
  // Word 的装订线（gutter）叠加在左边距上
  const left = side('left') + gutter;
  if (top || right || bottom || left) {
    rules.push(
      `.page { padding: ${round(top)}mm ${round(right)}mm ${round(bottom)}mm ${round(left)}mm; }`,
    );
  }

  rules.push(
    `.page { font-size: ${round(font.size)}pt; font-family: ${cssFontFamily(font.family)}; }`,
  );
  return rules.join('\n');
}

/* ------------------------------------------------------------------ 入口 */

async function readPart(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  return file ? file.async('string') : null;
}

/** 只加载文档中真正引用到的图片，避免把未使用的媒体一起塞进模板 */
async function loadImages(zip: JSZip, document: El, relsXml: string | null): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!relsXml) return result;

  const used = new Set<string>();
  for (const name of ['blip', 'imagedata']) {
    for (const el of Array.from(document.getElementsByTagNameNS('*', name))) {
      const id = rAttr(el, 'embed') ?? rAttr(el, 'id') ?? rAttr(el, 'link');
      if (id) used.add(id);
    }
  }
  if (used.size === 0) return result;

  const rels = new DOMParser().parseFromString(relsXml, 'application/xml');
  for (const rel of Array.from(rels.getElementsByTagNameNS('*', 'Relationship'))) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (!id || !target || !used.has(id) || rel.getAttribute('TargetMode') === 'External') continue;

    const path = target.startsWith('/') ? target.slice(1) : `word/${target}`;
    const file = zip.file(path) ?? zip.file(decodeURIComponent(path));
    if (!file) continue;

    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const mime = MIME[ext];
    if (!mime) continue;

    const base64 = await file.async('base64');
    result.set(id, `data:${mime};base64,${base64}`);
  }
  return result;
}

/** 把 .docx 转成与编辑器、导出管线兼容的 A4 模板 HTML */
export async function docxToTemplate(data: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);

  const documentXml = await readPart(zip, 'word/document.xml');
  if (!documentXml) throw new Error('这个文件不是有效的 .docx（缺少 word/document.xml）');

  const xml = new DOMParser().parseFromString(documentXml, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Word 文档解析失败，文件可能已损坏');
  }

  const body = kid(xml.documentElement, 'body');
  if (!body) throw new Error('Word 文档结构异常：缺少 w:body');

  const sheet = readStyles(await readPart(zip, 'word/styles.xml'));
  const images = await loadImages(zip, body, await readPart(zip, 'word/_rels/document.xml.rels'));

  const pageFont: Font = {
    size: 10.5,
    family: '宋体',
    color: null,
  };
  const defaultFont = readFont([sheet.defaultRPr], pageFont);

  const ctx: Ctx = { sheet, images, pageFont: defaultFont };
  const flow = renderBlockFlow(body, ctx);
  const pages = flowToPages(flow);
  if (pages.length === 0) throw new Error('这个 Word 文档没有可转换的内容');

  const css = `${A4_DOCX_BASE_CSS}\n${pageCss(kid(body, 'sectPr'), defaultFont)}`;
  // 有明确分页信号时按源文档分页输出（.docx-page 标记供导出侧逐页渲染）；
  // 没有分页信号时退回单页，导出侧仍走「按 A4 高度切片」的启发式分页
  const pageHtml = flowHasBreak(flow)
    ? pages.map((blocks) => `<div class="page docx-page">\n${blocks.join('\n')}\n</div>`).join('\n')
    : `<div class="page">\n${pages[0].join('\n')}\n</div>`;

  return `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8" />\n<style>\n${css}\n</style>\n</head>\n<body>\n${pageHtml}\n</body>\n</html>`;
}
