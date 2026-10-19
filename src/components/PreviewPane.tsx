import { useCallback, useEffect, useRef, useState } from 'react';
import { A4_HEIGHT_PX, A4_WIDTH_PX } from '../pdf/render';

interface PreviewPaneProps {
  /** 完整 HTML 文档 */
  html: string;
  /** 预览对象说明，如「张三」 */
  label: string;
}

/**
 * A4 预览：用 iframe 做样式隔离，按容器宽度等比缩放。
 * 多页模板在 iframe 内纵向堆叠，容器高度按内容实际高度撑开，整卷可滚动。
 */
export function PreviewPane({ html, label }: PreviewPaneProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const contentObserverRef = useRef<ResizeObserver | null>(null);
  const [scale, setScale] = useState(0.5);
  const [contentH, setContentH] = useState(A4_HEIGHT_PX);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const update = () => {
      const available = el.clientWidth - 32;
      if (available > 0) {
        setScale(Math.min(1, Math.max(0.2, available / A4_WIDTH_PX)));
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** 按 iframe 内文档的实际高度测量，多页时不会被裁掉 */
  const measureContent = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const height = doc?.documentElement?.scrollHeight ?? 0;
    if (height > 0) setContentH(height);
  }, []);

  const handleLoad = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;

    measureContent();
    // 字体与图片就位后换行会变，需重新测量
    doc.fonts?.ready.then(measureContent).catch(() => undefined);
    for (const img of Array.from(doc.images)) {
      if (!img.complete) img.addEventListener('load', measureContent, { once: true });
    }

    contentObserverRef.current?.disconnect();
    if (doc.body) {
      const observer = new ResizeObserver(measureContent);
      observer.observe(doc.body);
      contentObserverRef.current = observer;
    }
  }, [measureContent]);

  // 换 html 或卸载时断开观察，避免泄漏
  useEffect(() => {
    setContentH(A4_HEIGHT_PX);
    return () => {
      contentObserverRef.current?.disconnect();
      contentObserverRef.current = null;
    };
  }, [html]);

  return (
    <section className="pane preview-pane">
      <header className="pane-head">
        <h2>预览</h2>
        <span className="muted">{label}</span>
      </header>
      <div className="preview-scroll" ref={wrapRef}>
        <div
          className="preview-stage"
          style={{ width: A4_WIDTH_PX * scale, height: contentH * scale }}
        >
          <iframe
            ref={frameRef}
            title="A4 表单预览"
            className="preview-frame"
            srcDoc={html}
            onLoad={handleLoad}
            style={{
              width: `${A4_WIDTH_PX}px`,
              height: `${contentH}px`,
              transform: `scale(${scale})`,
            }}
          />
        </div>
      </div>
    </section>
  );
}
