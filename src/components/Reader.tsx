import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type PDFDocumentLoadingTask, type PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, MousePointer2, Hand, PenLine, Eraser, Undo2, Scan, Search, Copy, Highlighter, FilePlus2 } from 'lucide-react';
import type { Annotation, Document as StudyDocument, Point, Rect, Source } from '../core/model';
import { now, uid } from '../core/model';
import { pdfToViewport, viewportToPdf, pdfRectToViewport, viewportRectToPdf, distanceToSegment } from '../core/geometry';
GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  document: StudyDocument; setId: string; annotations: Annotation[];
  readAsset: (id: string) => Promise<Uint8Array>;
  onProgress: (page: number, zoom: number, rotation: number) => void;
  onAnnotation: (annotation: Annotation) => void; onRemoveAnnotation: (id: string) => void;
  onExcerpt: (source: Source, text: string, image?: Uint8Array) => void;
  focus?: { source: Source; stamp: number }; notify: (message: string) => void;
}
type Mode = 'select' | 'pan' | 'pen' | 'eraser' | 'crop';
type Selection = { text: string; rects: Rect[] };
type ZoomAnchor = { point: Point; clientX: number; clientY: number };
type Pinch = { ids: number[]; distance: number; startZoom: number; zoom: number; anchor: ZoomAnchor; localX: number; localY: number; left: number; top: number };
const clampZoom = (value: number) => Math.max(.4, Math.min(4, value));
export default function Reader(props: Props) {
  const { document: doc } = props;
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(doc.progress.page);
  const [jump, setJump] = useState(String(doc.progress.page));
  const [zoom, setZoom] = useState(doc.progress.zoom);
  const [previewZoom, setPreviewZoom] = useState<number>();
  const [rotation, setRotation] = useState(doc.progress.rotation);
  const [mode, setMode] = useState<Mode>('pan');
  const [penOnly, setPenOnly] = useState(false);
  const [inkColor, setInkColor] = useState('#235db0');
  const [viewport, setViewport] = useState<PageViewport>();
  const [width, setWidth] = useState(600);
  const [selection, setSelection] = useState<Selection>();
  const [pendingPoints, setPendingPoints] = useState<Point[]>([]);
  const [crop, setCrop] = useState<Rect>();
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(false);
  const [renderedKey, setRenderedKey] = useState('');
  const renderKey = `${doc.id}:${page}:${width}:${zoom}:${rotation}`;
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ page: number; text: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [focusVisible, setFocusVisible] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textContainer = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const gesture = useRef<{ pointer: number; points: Point[]; start: [number, number] } | null>(null);
  const pan = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const pointers = useRef(new Map<number, [number, number]>());
  const pinch = useRef<Pinch | null>(null);
  const suppressTouch = useRef(false);
  const zoomAnchor = useRef<ZoomAnchor | null>(null);
  const zoomAction = useRef<(value: number, at?: { clientX: number; clientY: number }) => void>(() => {});
  const currentZoom = useRef(zoom); currentZoom.current = zoom;
  const history = useRef<{ added?: string; removed?: Annotation }[]>([]);
  const touchHistoryStart = useRef<number | null>(null);
  const searchGeneration = useRef(0);
  const latest = useRef(props); latest.current = props;

  useLayoutEffect(() => { if (!frame.current) return; const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width)); observer.observe(frame.current); return () => observer.disconnect(); }, []);
  useEffect(() => {
    const element = frame.current; if (!element) return;
    const wheel = (event: WheelEvent) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); zoomAction.current(currentZoom.current * (event.deltaY < 0 ? 1.1 : .9), event); } };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => {
    let canceled = false; let task: PDFDocumentLoadingTask | undefined;
    setPdf(undefined); setError(''); setPage(doc.progress.page); setZoom(doc.progress.zoom); setRotation(doc.progress.rotation); setSelection(undefined); setResults([]); history.current = [];
    props.readAsset(doc.assetId).then(bytes => {
      if (canceled) return;
      const base = new URL('./pdf/', window.location.href).href;
      task = getDocument({ data: bytes.slice(), cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`, iccUrl: `${base}iccs/`, useSystemFonts: true, canvasMaxAreaInBytes: 64 * 1024 * 1024 });
      return task.promise;
    }).then(result => { if (result && !canceled) setPdf(result); }).catch(e => { if (!canceled) setError(`PDF 打开失败：${String(e.message || e)}`); });
    return () => { canceled = true; searchGeneration.current++; if (task) void task.destroy(); };
  }, [doc.id, doc.assetId]);

  useEffect(() => { setJump(String(page)); latest.current.onProgress(page, zoom, rotation); setSelection(undefined); }, [page, zoom, rotation, doc.id]);
  useEffect(() => {
    if (!pdf || !canvas.current || !textContainer.current) return;
    let canceled = false; let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined; let textLayer: TextLayer | undefined;
    setRendering(true); setRenderedKey(''); setError('');
    void (async () => {
      const p = await pdf.getPage(Math.max(1, Math.min(page, pdf.numPages)));
      if (canceled || !canvas.current || !textContainer.current) return;
      const base = p.getViewport({ scale: 1, rotation: (p.rotate + rotation) % 360 });
      const scale = Math.max(.15, (width - 40) / base.width) * zoom;
      const vp = p.getViewport({ scale, rotation: (p.rotate + rotation) % 360 });
      setViewport(vp); const c = canvas.current;
      // Keep the page's CSS size and PDF coordinates exact while bounding the
      // backing bitmap on high-DPI tablets at high zoom (64 MiB RGBA, 8192/side).
      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16 * 1024 * 1024 / (vp.width * vp.height)), 8192 / vp.width, 8192 / vp.height);
      c.width = Math.max(1, Math.floor(vp.width * dpr)); c.height = Math.max(1, Math.floor(vp.height * dpr)); c.style.width = `${vp.width}px`; c.style.height = `${vp.height}px`;
      renderTask = p.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] });
      // A resize or document switch can cancel painting while text is loading.
      // Observe rejection immediately; the original promise is still awaited below.
      void renderTask.promise.catch(() => undefined);
      const tc = textContainer.current; tc.replaceChildren(); tc.style.setProperty('--scale-factor', String(scale)); tc.style.setProperty('--total-scale-factor', String(scale * (vp.userUnit || 1)));
      const text = await p.getTextContent(); if (canceled) return;
      textLayer = new TextLayer({ textContentSource: text, container: tc, viewport: vp });
      // PDF.js uses CSS round() in its standard viewer. Explicit unrotated dimensions
      // also support Android WebViews predating that CSS function.
      const rawDimensions = vp.rawDims as { pageWidth: number; pageHeight: number };
      tc.style.width = `${rawDimensions.pageWidth * scale * vp.userUnit}px`;
      tc.style.height = `${rawDimensions.pageHeight * scale * vp.userUnit}px`;
      await Promise.all([renderTask.promise, textLayer.render()]);
      if (canceled) return;
      if (search.trim()) for (const span of textLayer.textDivs) if (span.textContent?.toLocaleLowerCase().includes(search.toLocaleLowerCase())) span.classList.add('pdf-search-hit');
      setRenderedKey(renderKey); setRendering(false);
    })().catch(e => { if (!canceled && e.name !== 'RenderingCancelledException') { setError(`页面渲染失败：${e.message}`); setRendering(false); } });
    return () => { canceled = true; renderTask?.cancel(); textLayer?.cancel(); };
  }, [pdf, page, width, zoom, rotation]);

  useEffect(() => { const f = props.focus; if (!f || f.source.documentId !== doc.id) return; setPage(f.source.page); setFocusVisible(true); }, [props.focus?.stamp, doc.id]);
  useEffect(() => {
    if (!pdf || !viewport || rendering || !focusVisible || props.focus?.source.page !== page) return;
    const timer = setTimeout(() => setFocusVisible(false), 6000);
    return () => clearTimeout(timer);
  }, [pdf, viewport, rendering, page, props.focus?.stamp, focusVisible]);
  useEffect(() => { if (!focusVisible || !viewport || rendering || !props.focus?.source.rects.length || !frame.current) return; const r = pdfRectToViewport(props.focus.source.rects[0], viewport.transform); const el = surface.current; const scroller = frame.current; if (el) { scroller.scrollTo({ top: Math.max(0, el.offsetTop + Math.min(r[1], r[3]) - scroller.clientHeight / 3), left: Math.max(0, el.offsetLeft + Math.min(r[0], r[2]) - scroller.clientWidth / 3), behavior: 'smooth' }); } }, [viewport, rendering, focusVisible, props.focus?.stamp]);
  const placeAnchor = (vp: PageViewport, anchor: ZoomAnchor) => {
    const scroller = frame.current, element = surface.current; if (!scroller || !element) return;
    const point = pdfToViewport(anchor.point, vp.transform), bounds = scroller.getBoundingClientRect();
    scroller.scrollLeft = element.offsetLeft + point.x - (anchor.clientX - bounds.left - scroller.clientLeft);
    scroller.scrollTop = element.offsetTop + point.y - (anchor.clientY - bounds.top - scroller.clientTop);
  };
  useLayoutEffect(() => { if (viewport && zoomAnchor.current) { placeAnchor(viewport, zoomAnchor.current); zoomAnchor.current = null; } }, [viewport]);
  const clearPreview = () => { if (surface.current) { surface.current.style.transform = ''; surface.current.style.transformOrigin = ''; surface.current.style.willChange = ''; } setPreviewZoom(undefined); };
  const cancelTouch = () => { pointers.current.clear(); pan.current = null; pinch.current = null; suppressTouch.current = false; touchHistoryStart.current = null; gesture.current = null; setPendingPoints([]); setCrop(undefined); clearPreview(); };
  // Window/rotation/page changes invalidate the screen geometry of an active gesture.
  useEffect(() => { cancelTouch(); }, [width, page, rotation, mode]);
  const changeZoom = (value: number, at?: { clientX: number; clientY: number }) => {
    if (pinch.current) return;
    const next = clampZoom(value); if (next === zoom) return;
    setFocusVisible(false);
    if (viewport && frame.current && surface.current) {
      const box = frame.current.getBoundingClientRect(), pageBox = surface.current.getBoundingClientRect();
      const clientX = at?.clientX ?? box.left + frame.current.clientWidth / 2, clientY = at?.clientY ?? box.top + frame.current.clientHeight / 2;
      zoomAnchor.current = { point: viewportToPdf({ x: clientX - pageBox.left, y: clientY - pageBox.top }, viewport.transform), clientX, clientY };
    }
    setZoom(next);
  };
  zoomAction.current = changeZoom;
  const startTouch = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
      if (pointers.current.size === 1) touchHistoryStart.current = history.current.length;
      if (pointers.current.size >= 2) {
        // The first eraser touch may have removed a stroke before the second
        // finger arrived. Restore those removals when the gesture becomes zoom.
        if (touchHistoryStart.current !== null) {
          for (const item of history.current.splice(touchHistoryStart.current).reverse()) if (item.removed) props.onAnnotation(item.removed);
          touchHistoryStart.current = null;
        }
        gesture.current = null; setPendingPoints([]); setCrop(undefined); setSelection(undefined); window.getSelection()?.removeAllRanges();
        event.preventDefault(); event.stopPropagation();
        if (!pinch.current && viewport && surface.current && !rendering && renderedKey === renderKey) {
          setFocusVisible(false);
          const ids = [...pointers.current.keys()].slice(0, 2), a = pointers.current.get(ids[0])!, b = pointers.current.get(ids[1])!;
          const clientX = (a[0] + b[0]) / 2, clientY = (a[1] + b[1]) / 2, bounds = surface.current.getBoundingClientRect();
          const localX = clientX - bounds.left, localY = clientY - bounds.top;
          pinch.current = { ids, distance: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), startZoom: zoom, zoom, localX, localY, left: bounds.left, top: bounds.top, anchor: { point: viewportToPdf({ x: localX, y: localY }, viewport.transform), clientX, clientY } };
          surface.current.style.transformOrigin = '0 0'; surface.current.style.willChange = 'transform'; setPreviewZoom(zoom);
          for (const id of ids) event.currentTarget.setPointerCapture(id);
        }
        pan.current = null; return;
      }
    }
    const shouldPan = mode === 'pan' || (mode === 'pen' && penOnly && event.pointerType === 'touch');
    if (shouldPan && !suppressTouch.current) { pan.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }
  };
  const moveTouch = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
    const p = pinch.current;
    if (p) {
      event.preventDefault(); event.stopPropagation();
      const a = pointers.current.get(p.ids[0]), b = pointers.current.get(p.ids[1]); if (!a || !b || !surface.current) return;
      p.zoom = clampZoom(p.startZoom * Math.hypot(a[0] - b[0], a[1] - b[1]) / p.distance);
      p.anchor.clientX = (a[0] + b[0]) / 2; p.anchor.clientY = (a[1] + b[1]) / 2;
      const scale = p.zoom / p.startZoom;
      surface.current.style.transform = `translate(${p.anchor.clientX - p.left - p.localX * scale}px, ${p.anchor.clientY - p.top - p.localY * scale}px) scale(${scale})`;
      setPreviewZoom(p.zoom); return;
    }
    if (suppressTouch.current && event.pointerType === 'touch') { event.preventDefault(); event.stopPropagation(); return; }
    if (pan.current?.pointer === event.pointerId && frame.current) {
      frame.current.scrollLeft -= event.clientX - pan.current.x; frame.current.scrollTop -= event.clientY - pan.current.y;
      pan.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
    }
  };
  const endTouch = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const p = pinch.current;
    if (p && p.ids.includes(event.pointerId)) {
      event.preventDefault(); event.stopPropagation(); pinch.current = null; clearPreview();
      if (Math.abs(p.zoom - zoom) > .0001) { zoomAnchor.current = p.anchor; setZoom(p.zoom); }
      else if (viewport) placeAnchor(viewport, p.anchor);
      suppressTouch.current = pointers.current.size > 0;
    } else if (suppressTouch.current && event.pointerType === 'touch') { event.stopPropagation(); }
    if (pan.current?.pointer === event.pointerId) pan.current = null;
    if (!pointers.current.size) { suppressTouch.current = false; touchHistoryStart.current = null; }
  };
  const readSelection = () => {
    if (mode !== 'select' || !surface.current || !viewport || rendering || renderedKey !== renderKey || pinch.current || suppressTouch.current) return;
    const s = window.getSelection(); if (!s?.rangeCount || !s.toString().trim() || !textContainer.current?.contains(s.anchorNode) || !textContainer.current?.contains(s.focusNode)) return;
    const b = surface.current.getBoundingClientRect();
    const rects = Array.from(s.getRangeAt(0).getClientRects()).filter(r => r.width > 1 && r.height > 1).map(r => viewportRectToPdf([r.left - b.left, r.top - b.top, r.right - b.left, r.bottom - b.top], viewport.transform));
    if (rects.length) setSelection({ text: s.toString().trim(), rects });
  };
  const source = (rects: Rect[], quote?: string): Source => ({ documentId: doc.id, page, rects, quote });
  const addAnnotation = (a: Annotation) => { history.current.push({ added: a.id }); props.onAnnotation(a); };
  const undo = () => { const item = history.current.pop(); if (!item) return props.notify('本次阅读没有可撤销的批注'); if (item.added) props.onRemoveAnnotation(item.added); if (item.removed) props.onAnnotation(item.removed); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !frame.current?.offsetParent || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true],[role=separator]')) return;
      const control = event.ctrlKey || event.metaKey;
      if (control && event.key.toLowerCase() === 'f') { event.preventDefault(); searchInput.current?.focus(); searchInput.current?.select(); }
      else if (control && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
      else if (control && ['+', '='].includes(event.key)) { event.preventDefault(); changeZoom(zoom * 1.2); }
      else if (control && event.key === '-') { event.preventDefault(); changeZoom(zoom / 1.2); }
      else if (control && event.key === '0') { event.preventDefault(); changeZoom(1); }
      else if (!control && ['PageDown', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setPage(Math.min(doc.pageCount, page + 1)); }
      else if (!control && ['PageUp', 'ArrowLeft'].includes(event.key)) { event.preventDefault(); setPage(Math.max(1, page - 1)); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [page, zoom, doc.id, props.annotations]);
  const localPoint = (e: React.PointerEvent): [number, number] => { const b = surface.current!.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  const eraseAt = (point: [number, number]) => {
    if (!viewport) return;
    const distance = (p: Point) => { const q = pdfToViewport(p, viewport.transform); return Math.hypot(q.x - point[0], q.y - point[1]); };
    const target = [...props.annotations].reverse().find(a => a.page === page && ((a.points?.some((p, i) => distance(p) < 18 || (i > 0 && distanceToSegment({ x: point[0], y: point[1] }, pdfToViewport(a.points![i - 1], viewport.transform), pdfToViewport(p, viewport.transform)) < 18))) || a.rects?.some(rect => { const r = pdfRectToViewport(rect, viewport.transform); return point[0] >= r[0] - 8 && point[0] <= r[2] + 8 && point[1] >= r[1] - 8 && point[1] <= r[3] + 8; })));
    if (target) { history.current.push({ removed: target }); props.onRemoveAnnotation(target.id); }
  };
  const pointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!viewport || rendering || renderedKey !== renderKey || mode === 'select') return;
    const point = localPoint(e);
    if (mode === 'eraser') { eraseAt(point); e.currentTarget.setPointerCapture(e.pointerId); return; }
    if (mode === 'pan' || (mode === 'pen' && penOnly && e.pointerType !== 'pen')) return;
    if (e.pointerType === 'touch' && !e.isPrimary) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    const p = viewportToPdf({ x: point[0], y: point[1] }, viewport.transform); p.pressure = e.pressure || .5;
    gesture.current = { pointer: e.pointerId, points: [p], start: point }; if (mode === 'pen') setPendingPoints([p]); else setCrop([...point, ...point]);
  };
  const pointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!viewport) return;
    if (mode === 'eraser' && e.buttons) { eraseAt(localPoint(e)); return; }
    const g = gesture.current; if (!g || g.pointer !== e.pointerId) return;
    const point = localPoint(e); const p = viewportToPdf({ x: point[0], y: point[1] }, viewport.transform); p.pressure = e.pressure || .5;
    if (mode === 'pen') { g.points.push(p); setPendingPoints([...g.points]); } else if (mode === 'crop') setCrop([g.start[0], g.start[1], point[0], point[1]]);
  };
  const pointerUp = async (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current; if (!g || g.pointer !== e.pointerId || !viewport) return;
    gesture.current = null; setPendingPoints([]); setCrop(undefined);
    if (mode === 'pen' && g.points.length > 1) addAnnotation({ id: uid(), setId: props.setId, documentId: doc.id, page, kind: 'ink', color: inkColor, points: g.points, width: 2.2 / viewport.scale, createdAt: now() });
    if (mode === 'crop' && canvas.current) {
      const end = localPoint(e); const x = Math.max(0, Math.min(g.start[0], end[0])); const y = Math.max(0, Math.min(g.start[1], end[1])); const w = Math.min(viewport.width, Math.max(g.start[0], end[0])) - x; const h = Math.min(viewport.height, Math.max(g.start[1], end[1])) - y;
      if (w < 8 || h < 8) return props.notify('拖出一个区域即可截图摘录');
      const out = window.document.createElement('canvas'); const ratio = canvas.current.width / viewport.width; out.width = Math.ceil(w * ratio); out.height = Math.ceil(h * ratio); out.getContext('2d')!.drawImage(canvas.current, x * ratio, y * ratio, w * ratio, h * ratio, 0, 0, out.width, out.height);
      const blob = await new Promise<Blob | null>(resolve => out.toBlob(resolve, 'image/png'));
      if (blob) props.onExcerpt(source([viewportRectToPdf([x, y, x + w, y + h], viewport.transform)]), '', new Uint8Array(await blob.arrayBuffer()));
      setMode('pan');
    }
  };
  const runSearch = async () => {
    if (!pdf || !search.trim()) return; const generation = ++searchGeneration.current; setSearching(true); setResults([]); const found: { page: number; text: string }[] = [];
    try { for (let i = 1; i <= pdf.numPages; i++) { const text = (await (await pdf.getPage(i)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '); if (generation !== searchGeneration.current) return; const at = text.toLocaleLowerCase().indexOf(search.trim().toLocaleLowerCase()); if (at >= 0) found.push({ page: i, text: text.slice(Math.max(0, at - 25), at + search.length + 60) }); } setResults(found); if (found[0]) { setPage(found[0].page); props.notify(`在 ${found.length} 页中找到文字`); } else props.notify('未找到文字；扫描版可使用区域摘录'); }
    catch (e) { props.notify(`搜索失败：${String(e)}`); } finally { if (generation === searchGeneration.current) setSearching(false); }
  };
  const svgRect = (rect: Rect, className: string, key: string, color?: string) => { if (!viewport) return null; const r = pdfRectToViewport(rect, viewport.transform); return <rect key={key} className={className} x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} fill={color} />; };
  const path = (points: Point[]) => viewport ? points.map(p => { const q = pdfToViewport(p, viewport.transform); return `${q.x},${q.y}`; }).join(' ') : '';
  return <section className="reader" aria-label="PDF 阅读器">
    <div className="reader-title"><div><span className="eyebrow">正在阅读</span><strong title={doc.name}>{doc.name}</strong></div><span className="page-total">{doc.pageCount} 页</span></div>
    <div className="reader-toolbar" role="toolbar" aria-label="阅读与批注工具">
      {([{ mode: 'pan', label: '浏览', icon: Hand }, { mode: 'select', label: '选字', icon: MousePointer2 }, { mode: 'crop', label: '区域摘录', icon: Scan }, { mode: 'pen', label: '手写笔', icon: PenLine }, { mode: 'eraser', label: '橡皮', icon: Eraser }] as const).map(item => <button key={item.mode} title={item.label} aria-label={item.label} aria-pressed={mode === item.mode} className={mode === item.mode ? 'active' : ''} onClick={() => { setMode(item.mode); setSelection(undefined); }}><item.icon size={17}/><span>{item.label}</span></button>)}
      <button aria-label="撤销批注" title="撤销批注" onClick={undo}><Undo2 size={18}/></button>
      {mode === 'pen' && <><input aria-label="笔颜色" type="color" value={inkColor} onChange={e => setInkColor(e.target.value)} /><label className="pen-only"><input type="checkbox" checked={penOnly} onChange={e => setPenOnly(e.target.checked)}/>仅触控笔</label></>}
    </div>
    <form className="pdf-search" onSubmit={e => { e.preventDefault(); void runSearch(); }}><Search size={16}/><input ref={searchInput} aria-label="搜索 PDF 文字" placeholder="搜索原文…" value={search} onChange={e => setSearch(e.target.value)}/><button type="submit" disabled={searching || !pdf}>{searching ? '搜索中…' : '查找'}</button>{results.length > 0 && <select aria-label="搜索结果" onChange={e => setPage(Number(e.target.value))} value={results.some(r => r.page === page) ? page : ''}><option value="" disabled>选择结果</option>{results.map(r => <option key={r.page} value={r.page}>第 {r.page} 页 · {r.text.slice(0, 35)}</option>)}</select>}</form>
    <div className={`pdf-scroll mode-${mode}`} ref={frame} style={{ touchAction: 'none' }} data-zoom-gesture={previewZoom === undefined ? 'idle' : 'pinching'} onPointerUp={() => setTimeout(readSelection, 30)} onTouchEnd={() => setTimeout(readSelection, 150)}
      onPointerDownCapture={startTouch} onPointerMoveCapture={moveTouch} onPointerUpCapture={endTouch}
      onPointerCancelCapture={cancelTouch} onLostPointerCapture={e => { if (e.target === e.currentTarget && pointers.current.has(e.pointerId) && !e.currentTarget.hasPointerCapture(e.pointerId)) cancelTouch(); }}>
      {error && <div className="error-box">{error}</div>}
      {!pdf && !error && <div className="loading">正在打开本地 PDF…</div>}
      <div ref={surface} className="pdf-page" data-testid="pdf-page" style={{ width: viewport?.width || 1, height: viewport?.height || 1 }}>
        <canvas ref={canvas} aria-label={`PDF 第 ${page} 页`} data-rendered-page={renderedKey === renderKey ? page : undefined} data-render-state={renderedKey === renderKey ? 'ready' : 'loading'} />
        <div className="textLayer" ref={textContainer} style={{ pointerEvents: mode === 'select' ? 'auto' : 'none' }} />
        <svg className="annotation-layer" width={viewport?.width} height={viewport?.height} style={{ pointerEvents: mode === 'select' ? 'none' : 'auto', touchAction: mode === 'pen' && penOnly ? 'none' : undefined }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={e => void pointerUp(e)} onPointerCancel={() => { gesture.current = null; setPendingPoints([]); setCrop(undefined); }}>
          {props.annotations.filter(a => a.page === page).map(a => a.kind === 'highlight' ? a.rects?.map((r, i) => svgRect(r, 'annotation-highlight', `${a.id}-${i}`, a.color)) : <polyline key={a.id} data-annotation={a.id} points={path(a.points || [])} fill="none" stroke={a.color} strokeWidth={(a.width || 1.5) * (viewport?.scale || 1)} strokeLinecap="round" strokeLinejoin="round"/>)}
          {pendingPoints.length > 0 && <polyline points={path(pendingPoints)} fill="none" stroke={inkColor} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"/>}
          {crop && <rect className="crop-preview" x={Math.min(crop[0], crop[2])} y={Math.min(crop[1], crop[3])} width={Math.abs(crop[2] - crop[0])} height={Math.abs(crop[3] - crop[1])}/>}
          {focusVisible && props.focus?.source.page === page && props.focus.source.rects.map((r, i) => svgRect(r, 'source-focus', `focus-${i}`))}
        </svg>
      </div>
      {(rendering || pdf && renderedKey !== renderKey) && <div className="render-badge">正在渲染…</div>}
    </div>
    {selection && <div className="selection-actions" onPointerDown={e => e.preventDefault()}><span>{selection.text.slice(0, 36)}{selection.text.length > 36 ? '…' : ''}</span><button onClick={() => void navigator.clipboard.writeText(selection.text).then(() => props.notify('已复制选中文字')).catch(() => props.notify('复制受限，请使用系统复制菜单'))}><Copy size={16}/>复制</button><button onClick={() => { addAnnotation({ id: uid(), setId: props.setId, documentId: doc.id, page, kind: 'highlight', color: '#f4ca58', rects: selection.rects, createdAt: now() }); setSelection(undefined); window.getSelection()?.removeAllRanges(); }}><Highlighter size={16}/>高亮</button><button className="primary" onClick={() => { props.onExcerpt(source(selection.rects, selection.text), selection.text); setSelection(undefined); window.getSelection()?.removeAllRanges(); }}><FilePlus2 size={16}/>摘录卡片</button></div>}
    <div className="reader-footer"><button aria-label="上一页" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={18}/></button><form onSubmit={e => { e.preventDefault(); const n = Number(jump); if (Number.isInteger(n) && n >= 1 && n <= doc.pageCount) setPage(n); else { setJump(String(page)); props.notify('请输入有效页码'); } }}><input aria-label="跳转页码" inputMode="numeric" value={jump} onChange={e => setJump(e.target.value)}/><span>/ {doc.pageCount}</span></form><button aria-label="下一页" disabled={page >= doc.pageCount} onClick={() => setPage(page + 1)}><ChevronRight size={18}/></button><div className="toolbar-spacer"/><button aria-label="缩小" onClick={() => changeZoom(zoom / 1.2)}><ZoomOut size={17}/></button><button aria-label="缩放比例，点击恢复适宽" title="恢复适宽" onClick={() => changeZoom(1)}>{Math.round((previewZoom ?? zoom) * 100)}%</button><button aria-label="放大" onClick={() => changeZoom(zoom * 1.2)}><ZoomIn size={17}/></button><button aria-label="旋转页面" title="旋转页面" onClick={() => setRotation((rotation + 90) % 360)}><RotateCw size={17}/></button></div>
  </section>;
}
