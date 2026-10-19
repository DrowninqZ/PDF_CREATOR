import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/** A4 尺寸（mm） */
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

/** A4 在 96dpi 下的像素尺寸，用于 iframe 渲染宽度 */
export const A4_WIDTH_PX = Math.round((PAGE_WIDTH_MM / 25.4) * 96); // 794
export const A4_HEIGHT_PX = Math.round((PAGE_HEIGHT_MM / 25.4) * 96); // 1123

const FRAME_TIMEOUT_MS = 15000;

function loadFrame(frame: HTMLIFrameElement, html: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('模板渲染超时，请检查模板中是否引用了外部资源'));
    }, FRAME_TIMEOUT_MS);
    frame.addEventListener(
      'load',
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    frame.srcdoc = html;
  });
}

/** 等待 iframe 内的字体与图片加载完成，避免导出缺字或空白图 */
async function waitForAssets(doc: Document): Promise<void> {
  const fonts = doc.fonts;
  if (fonts?.ready) {
    try {
      await fonts.ready;
    } catch {
      /* 字体加载失败不阻断导出 */
    }
  }

  const images = Array.from(doc.images);
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        }),
    ),
  );

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function withHiddenFrame<T>(
  html: string,
  task: (doc: Document) => Promise<T>,
): Promise<T> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.left = '-10000px';
  frame.style.top = '0';
  frame.style.width = `${A4_WIDTH_PX}px`;
  frame.style.height = `${A4_HEIGHT_PX}px`;
  frame.style.border = '0';
  frame.style.background = '#ffffff';
  document.body.appendChild(frame);

  try {
    await loadFrame(frame, html);
    const doc = frame.contentDocument;
    if (!doc) throw new Error('无法创建渲染容器');
    // 多页文档会被固定高度裁掉，按内容实际高度把离屏容器撑高
    const contentHeight = doc.documentElement.scrollHeight;
    if (contentHeight > A4_HEIGHT_PX) frame.style.height = `${contentHeight}px`;
    return await task(doc);
  } finally {
    frame.remove();
  }
}

/**
 * 计算分页切点（canvas 像素）。
 * 切点若落在某一行表格内部，则上移到该行顶部，让整行完整地出现在下一页，
 * 避免出现「同一行被分页切断」的情况。
 */
function computePageBreaks(doc: Document, scale: number): number[] {
  const root = doc.documentElement;
  const rootRect = root.getBoundingClientRect();
  const totalHeight = root.scrollHeight;
  // 与 PDF 页面高宽比保持一致，换算成文档内的像素高度
  const pageHeight = (PAGE_HEIGHT_MM / PAGE_WIDTH_MM) * root.scrollWidth;
  // 小于该高度的残差视为舍入误差，不再单独分页（换算自 canvas 的 2px）
  const residue = 2 / scale;

  const rows = Array.from(doc.querySelectorAll('tr'))
    .map((tr) => {
      const rect = tr.getBoundingClientRect();
      return { top: rect.top - rootRect.top, bottom: rect.bottom - rootRect.top };
    })
    .filter((row) => row.bottom - row.top > 0);

  const breaks: number[] = [];
  let cursor = 0;
  while (cursor + pageHeight < totalHeight - residue) {
    let cut = cursor + pageHeight;

    // 在跨越切点的行里，选起点最靠前、且能整行放进一页的那一行，把切点上移到它的顶部
    let moved: number | null = null;
    for (const row of rows) {
      if (row.top <= cursor || row.top >= cut || row.bottom <= cut) continue;
      if (row.bottom - row.top > pageHeight) continue;
      if (moved === null || row.top < moved) moved = row.top;
    }
    if (moved !== null) cut = moved;

    breaks.push(cut * scale);
    cursor = cut;
  }

  return breaks;
}

/** 把一份 HTML 渲染为 canvas（含分页切点），内容超出 A4 高度时按切点分页 */
async function htmlToPageCanvases(html: string, scale: number): Promise<HTMLCanvasElement[]> {
  return withHiddenFrame(html, async (doc) => {
    await waitForAssets(doc);

    const pageEls = Array.from(doc.querySelectorAll<HTMLElement>('.page'));
    // 逐页模式：文档带分页信号（多个 .page，或带 .docx-page 标记）时按元素逐页截图
    const pageMode = pageEls.length > 1 || !!doc.querySelector('.docx-page');

    if (!pageMode) {
      // 回退：整篇渲染后按 A4 高度启发式切片（HTML 模板等无分页信号的文档）
      const target = doc.documentElement;
      const breaks = computePageBreaks(doc, scale);
      const canvas = await html2canvas(target, {
        scale,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        width: target.scrollWidth,
        height: target.scrollHeight,
      });
      return sliceCanvas(canvas, breaks);
    }

    // 串行截图：扫描件整页大图时逐页并发会显著抬高内存峰值
    const pages: HTMLCanvasElement[] = [];
    for (const element of pageEls) {
      pages.push(
        await html2canvas(element, {
          scale,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
          width: element.scrollWidth,
          height: element.scrollHeight,
          windowWidth: element.scrollWidth,
          windowHeight: element.scrollHeight,
        }),
      );
    }
    return pages;
  });
}

/**
 * 按分页切点把一张长图切成多页 canvas。
 * breaks 为每页起始位置的 canvas 像素坐标；每页高度可能小于 A4（切点上移留下的空白）。
 */
function sliceCanvas(canvas: HTMLCanvasElement, breaks: number[]): HTMLCanvasElement[] {
  // 小于该高度的残差视为舍入误差，不再单独分页
  const RESIDUE_TOLERANCE_PX = 2;
  if (canvas.height <= RESIDUE_TOLERANCE_PX) return [];

  const bounds = [0];
  for (const value of breaks) {
    const cut = Math.round(value);
    const last = bounds[bounds.length - 1];
    if (cut - last > RESIDUE_TOLERANCE_PX && canvas.height - cut > RESIDUE_TOLERANCE_PX) {
      bounds.push(cut);
    }
  }
  bounds.push(canvas.height);

  const pages: HTMLCanvasElement[] = [];
  for (let index = 0; index < bounds.length - 1; index += 1) {
    const start = bounds[index];
    const sliceHeight = bounds[index + 1] - start;

    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = sliceHeight;
    const ctx = slice.getContext('2d');
    if (!ctx) throw new Error('无法创建 canvas 上下文');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(
      canvas,
      0,
      start,
      canvas.width,
      sliceHeight,
      0,
      0,
      canvas.width,
      sliceHeight,
    );

    pages.push(slice);
  }

  return pages;
}

/**
 * 把一页 canvas 追加到 PDF 的当前页。
 * 一页内容因字体差异比 A4 略高时，等比缩小塞进一张 A4（保页数、不丢内容）。
 */
function addFitted(pdf: jsPDF, canvas: HTMLCanvasElement): void {
  const pxPerMm = canvas.width / PAGE_WIDTH_MM;
  const naturalHeight = canvas.height / pxPerMm;

  let width = PAGE_WIDTH_MM;
  let height = naturalHeight;
  let x = 0;

  if (naturalHeight > PAGE_HEIGHT_MM + 0.5) {
    const factor = PAGE_HEIGHT_MM / naturalHeight;
    width = PAGE_WIDTH_MM * factor;
    height = PAGE_HEIGHT_MM;
    x = (PAGE_WIDTH_MM - width) / 2;
  }

  // 表单以文字为主，PNG 无损，可避免 JPEG 压缩带来的文字发虚
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, 0, width, height);
}

function createPdf(): jsPDF {
  return new jsPDF({
    unit: 'mm',
    format: 'a4',
    orientation: 'portrait',
  });
}

/** 把一份完整 HTML 文档渲染成 A4 PDF Blob（纯前端，无需服务端） */
export async function renderPdfBlob(html: string, scale = 2): Promise<Blob> {
  const pdf = createPdf();
  const pages = await htmlToPageCanvases(html, scale);
  if (pages.length === 0) {
    throw new Error('模板内容为空，无法生成 PDF');
  }

  pages.forEach((canvas, index) => {
    if (index > 0) pdf.addPage();
    addFitted(pdf, canvas);
  });

  return pdf.output('blob');
}

/**
 * 把多份 HTML 文档渲染并合并成同一个 PDF。
 * 每条记录的表单从新的一页开始，单条内容超出一页时仍自动分页。
 */
export async function renderMergedPdfBlob(htmlList: string[], scale = 2): Promise<Blob> {
  const pdf = createPdf();
  let totalPages = 0;

  for (const html of htmlList) {
    const pages = await htmlToPageCanvases(html, scale);
    for (const canvas of pages) {
      if (totalPages > 0) pdf.addPage();
      addFitted(pdf, canvas);
      totalPages += 1;
    }
  }

  if (totalPages === 0) {
    throw new Error('模板内容为空，无法生成 PDF');
  }

  return pdf.output('blob');
}

/** 生成安全的文件名（去掉路径与非法字符） */
export function safeFileName(input: string, fallback: string): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}