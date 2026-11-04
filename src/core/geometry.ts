import type { Point, Rect } from './model';

/** PDF.js PageViewport.transform. Coordinates are PDF user units, never screen pixels. */
export type Transform = readonly number[];

function checkTransform(m: Transform) {
  if (m.length !== 6 || m.some(n => !Number.isFinite(n)) || Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-12) {
    throw new Error('页面变换矩阵无效');
  }
}

export function pdfToViewport(point: Point, m: Transform): Point {
  checkTransform(m);
  return { x: m[0] * point.x + m[2] * point.y + m[4], y: m[1] * point.x + m[3] * point.y + m[5] };
}

export function viewportToPdf(point: Point, m: Transform): Point {
  checkTransform(m);
  const det = m[0] * m[3] - m[1] * m[2];
  const x = point.x - m[4], y = point.y - m[5];
  return { x: (m[3] * x - m[2] * y) / det, y: (-m[1] * x + m[0] * y) / det };
}

export function normalizeRect(rect: Rect): Rect {
  return [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
}

function transformRect(rect: Rect, transform: (point: Point) => Point): Rect {
  const corners = [transform({ x: rect[0], y: rect[1] }), transform({ x: rect[2], y: rect[1] }), transform({ x: rect[0], y: rect[3] }), transform({ x: rect[2], y: rect[3] })];
  return [Math.min(...corners.map(p => p.x)), Math.min(...corners.map(p => p.y)), Math.max(...corners.map(p => p.x)), Math.max(...corners.map(p => p.y))];
}

export function pdfRectToViewport(rect: Rect, m: Transform): Rect {
  return transformRect(rect, p => pdfToViewport(p, m));
}

export function viewportRectToPdf(rect: Rect, m: Transform): Rect {
  return transformRect(rect, p => viewportToPdf(p, m));
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
