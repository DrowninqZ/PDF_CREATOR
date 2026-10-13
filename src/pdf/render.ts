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
    return await task(doc);
  } finally {
    frame.remove();
  }
}

/** 把 canvas 按 A4 高度切片写入 PDF，内容超出时自动分页 */
function canvasToPdfBlob(canvas: HTMLCanvasElement): Blob {
  const pdf = new jsPDF({
    unit: 'mm',
    format: 'a4',
    orientation: 'portrait',
  });

  const pxPerMm = canvas.width / PAGE_WIDTH_MM;
  // 用 round 而非 floor：单页 A4 的高度换算后常带小数（如 2245.9px），
  // 用 floor 会留下 1px 残差，导致每份 PDF 末尾多出一张近乎空白的页。
  const sliceHeightPx = Math.round(PAGE_HEIGHT_MM * pxPerMm);
  // 小于该高度的残差视为舍入误差，不再单独分页
  const RESIDUE_TOLERANCE_PX = 2;

  let offsetY = 0;
  let pageIndex = 0;
  while (canvas.height - offsetY > RESIDUE_TOLERANCE_PX) {
    if (offsetY > 0) pdf.addPage();

    const sliceHeight = Math.min(sliceHeightPx, canvas.height - offsetY);
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
      offsetY,
      canvas.width,
      sliceHeight,
      0,
      0,
      canvas.width,
      sliceHeight,
    );

    // 表单以文字为主，PNG 无损，可避免 JPEG 压缩带来的文字发虚
    pdf.addImage(
      slice.toDataURL('image/png'),
      'PNG',
      0,
      0,
      PAGE_WIDTH_MM,
      sliceHeight / pxPerMm,
    );

    offsetY += sliceHeight;
    pageIndex += 1;
  }

  if (pageIndex === 0) {
    throw new Error('模板内容为空，无法生成 PDF');
  }

  return pdf.output('blob');
}

/** 把一份完整 HTML 文档渲染成 A4 PDF Blob（纯前端，无需服务端） */
export async function renderPdfBlob(html: string, scale = 2): Promise<Blob> {
  return withHiddenFrame(html, async (doc) => {
    await waitForAssets(doc);
    const target = doc.documentElement;
    const canvas = await html2canvas(target, {
      scale,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      width: target.scrollWidth,
      height: target.scrollHeight,
    });
    return canvasToPdfBlob(canvas);
  });
}

/** 生成安全的文件名（去掉路径与非法字符） */
export function safeFileName(input: string, fallback: string): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}