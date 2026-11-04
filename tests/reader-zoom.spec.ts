import { test, expect, type Page, type CDPSession, type TestInfo } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { State } from '../src/core/model';

// Real 612×792 PDF fixture. All observations are public DOM, pixels and persisted
// data; the tests do not call Reader internals or dispatch synthetic JS events.
const fixture = path.resolve('tests/fixtures/text.pdf');
const label = process.env.MOJING_ZOOM_LABEL || 'candidate';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid evidence label');
const directory = path.resolve('reports/zoom-0.1.1', label);
test.use({ viewport: { width: 1280, height: 900 }, hasTouch: true, deviceScaleFactor: 2 });
type XY = { x: number; y: number };
type Metrics = { center: XY; pdf: XY; bounds: { x: number; y: number; width: number; height: number }; scroll: XY; zoom: number };
type Probe = { trusted: number; untrusted: number; types: Record<string, number>; canvasDimensions: number; loadingTransitions: number; readyTransitions: number; disconnect: () => void };
declare global { interface Window { __readerZoomProbe?: Probe } }
type Evidence = { test: string; label: string; startedAt: string; observations: Record<string, unknown>; errors: string[]; runtime?: unknown; fixtureSha256?: string };
let evidence: Evidence;

test.beforeEach(async ({ page }, info) => {
  evidence = { test: info.title, label, startedAt: new Date().toISOString(), observations: {}, errors: [] };
  page.on('pageerror', error => evidence.errors.push(error.message));
  await mkdir(directory, { recursive: true });
});
test.afterEach(async ({ page }, info) => {
  const filename = slug(info);
  if (!page.isClosed()) await page.screenshot({ path: path.join(directory, `${filename}.png`) }).catch(() => {});
  await writeFile(path.join(directory, `${filename}.json`), JSON.stringify({ ...evidence, finishedAt: new Date().toISOString(), status: info.status, failures: info.errors.map(error => error.message), scope: 'Installed Chrome with trusted CDP touch injection at a tablet viewport; not Huawei physical-device verification.' }, null, 2));
});
function slug(info: TestInfo) { return info.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff-]+/g, '-').slice(0, 110); }
async function state(page: Page): Promise<State> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('mojing-files', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const slots = await Promise.all(['snapshot-a.json', 'snapshot-b.json'].map(name => new Promise<any>(resolve => { const request = db.transaction('files').objectStore('files').get(name); request.onsuccess = () => { try { resolve(JSON.parse(new TextDecoder().decode(new Uint8Array(request.result)))); } catch { resolve(null); } }; request.onerror = () => resolve(null); })));
    db.close(); return slots.filter(Boolean).sort((a, b) => b.revision - a.revision)[0].state;
  });
}
async function saved(page: Page) { await expect(page.locator('.save-state')).toContainText('已保存到本机'); }
async function ready(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const canvas = page.locator('.pdf-page canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-rendered-page', await page.getByLabel('跳转页码', { exact: true }).inputValue(), { timeout: 60_000 });
  await expect(canvas).toHaveAttribute('data-render-state', 'ready', { timeout: 60_000 });
  await expect(page.locator('.error-box')).toHaveCount(0);
}
async function pixels(page: Page) {
  return page.locator('.pdf-page canvas').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0, opaque = 0;
    for (let i = 0; i < data.length; i += 4) { if (data[i + 3] === 255) opaque++; if (data[i + 3] > 0 && data[i] + data[i + 1] + data[i + 2] < 600) dark++; }
    return { width: canvas.width, height: canvas.height, dark, opaque, total: canvas.width * canvas.height };
  });
}
async function metrics(page: Page, screenPoint?: XY): Promise<Metrics> {
  return page.evaluate(point => {
    const frame = document.querySelector('.pdf-scroll') as HTMLElement;
    const f = frame.getBoundingClientRect(), b = document.querySelector('.pdf-page')!.getBoundingClientRect();
    const center = point || { x: f.x + f.width * .46, y: f.y + f.height * .47 };
    const x = (center.x - b.x) / b.width, y = (center.y - b.y) / b.height;
    // All pinch-center measurements use this fixture's unrotated first page.
    // Rotated overlays are checked separately against the stored PDF points.
    const pdf = { x: x * 612, y: (1 - y) * 792 };
    const button = document.querySelector('.reader-footer button[title="恢复适宽"]');
    return { center, pdf, bounds: { x: b.x, y: b.y, width: b.width, height: b.height }, scroll: { x: frame.scrollLeft, y: frame.scrollTop }, zoom: Number(button?.textContent?.replace('%', '')) / 100 };
  }, screenPoint);
}
function drift(before: Metrics, after: Metrics) {
  // Express the coordinate displacement back in final CSS pixels, not PDF units.
  const scale = after.bounds.width / 612;
  return Math.hypot(before.pdf.x - after.pdf.x, before.pdf.y - after.pdf.y) * scale;
}
async function centerScroll(page: Page) {
  await page.locator('.pdf-scroll').evaluate(element => { element.scrollLeft = (element.scrollWidth - element.clientWidth) * .48; element.scrollTop = (element.scrollHeight - element.clientHeight) * .43; });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
}
async function setup(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-shell')).toBeVisible();
  evidence.runtime = await page.evaluate(() => ({ scripts: [...document.scripts].map(script => script.src), userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, maxTouchPoints: navigator.maxTouchPoints }));
  evidence.fixtureSha256 = createHash('sha256').update(await readFile(fixture)).digest('hex');
  await page.getByTestId('pdf-input').setInputFiles(fixture); await ready(page); await saved(page);
  // A real ink annotation is the invariant checked after every transform.
  await page.getByRole('button', { name: '手写笔', exact: true }).click();
  const box = (await page.locator('.pdf-page').boundingBox())!;
  const frame = (await page.locator('.pdf-scroll').boundingBox())!;
  const y = Math.max(box.y, frame.y) + 65;
  await page.mouse.move(box.x + 70, y); await page.mouse.down(); await page.mouse.move(box.x + 150, y + 35, { steps: 14 }); await page.mouse.up();
  await expect(page.locator('polyline[data-annotation]')).toHaveCount(1); await saved(page);
  const annotations = (await state(page)).annotations;
  await page.getByRole('button', { name: '浏览', exact: true }).click();
  // Start away from fit-width boundaries, so anchored zoom is geometrically possible.
  for (let i = 0; i < 4; i++) { await page.getByRole('button', { name: '放大', exact: true }).click(); await ready(page); }
  await saved(page); await centerScroll(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  return { cdp, annotations };
}
async function startProbe(page: Page) {
  await page.evaluate(() => {
    window.__readerZoomProbe?.disconnect();
    const probe: Probe = { trusted: 0, untrusted: 0, types: {}, canvasDimensions: 0, loadingTransitions: 0, readyTransitions: 0, disconnect: () => {} };
    const listen = (event: Event) => { if (!(event.target as Element)?.closest('.pdf-scroll')) return; event.isTrusted ? probe.trusted++ : probe.untrusted++; probe.types[event.type] = (probe.types[event.type] || 0) + 1; };
    const names = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'];
    for (const name of names) document.addEventListener(name, listen, true);
    const observer = new MutationObserver(records => { for (const record of records) { if (['width', 'height'].includes(record.attributeName || '')) probe.canvasDimensions++; if (record.attributeName === 'data-render-state') { if ((record.target as Element).getAttribute('data-render-state') === 'loading') probe.loadingTransitions++; else probe.readyTransitions++; } } });
    observer.observe(document.querySelector('.pdf-page canvas')!, { attributes: true, attributeFilter: ['width', 'height', 'data-render-state'] });
    probe.disconnect = () => { observer.disconnect(); for (const name of names) document.removeEventListener(name, listen, true); };
    window.__readerZoomProbe = probe;
  });
}
async function probe(page: Page) { return page.evaluate(() => { const { disconnect: _, ...result } = window.__readerZoomProbe!; return result; }); }
const touch = (id: number, x: number, y: number) => ({ id, x, y, radiusX: 3, radiusY: 3, force: .5 });
async function pinch(cdp: CDPSession, page: Page, factor: number, order: 'first-first' | 'second-first', frames = 32, cancel = false) {
  const before = await metrics(page), center = before.center, distance = 90;
  const points = (fraction: number) => { const d = distance * (1 + (factor - 1) * fraction) / 2; return [touch(11, center.x - d, center.y), touch(22, center.x + d, center.y)]; };
  let current = points(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [current[0]] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: current });
  for (let frame = 1; frame <= frames; frame++) { current = points(frame / frames); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: current }); }
  const preview = await metrics(page, center), during = await probe(page);
  if (cancel) await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  else {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [current[order === 'first-first' ? 1 : 0]] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await ready(page); await saved(page);
  const after = await metrics(page, center), final = await probe(page), bitmap = await pixels(page);
  return { frames, order, cancel, factor, before, preview, after, during, final, previewDriftCssPixels: drift(before, preview), finalDriftCssPixels: drift(before, after), bitmap };
}

for (const order of ['second-first', 'first-first'] as const) {
  test(`可信双指缩放中心与100帧渲染开销-${order}`, async ({ page }) => {
    test.setTimeout(180_000);
    const { cdp, annotations } = await setup(page);
    await startProbe(page);
    const outward = await pinch(cdp, page, 1.4, order, 100);
    evidence.observations.outward = outward;
    await startProbe(page);
    const inward = await pinch(cdp, page, 1 / 1.4, order, 45);
    evidence.observations.inward = inward;
    expect.soft(outward.after.zoom).toBeCloseTo(outward.before.zoom * 1.4, 1);
    expect.soft(inward.after.zoom).toBeCloseTo(inward.before.zoom / 1.4, 1);
    expect.soft(outward.finalDriftCssPixels, 'The PDF point under the stationary two-finger midpoint must remain at that midpoint.').toBeLessThan(3);
    expect.soft(inward.finalDriftCssPixels).toBeLessThan(3);
    expect.soft(outward.previewDriftCssPixels).toBeLessThan(3);
    expect.soft(outward.during.canvasDimensions, '100 moves must preview without rebuilding the expensive PDF canvas per move.').toBeLessThanOrEqual(2);
    expect.soft(outward.final.canvasDimensions, 'The gesture should commit at most one canvas size pair.').toBeLessThanOrEqual(4);
    expect.soft(outward.final.trusted).toBeGreaterThan(100); expect.soft(outward.final.untrusted).toBe(0);
    expect.soft(outward.bitmap.dark).toBeGreaterThan(100); expect.soft(outward.bitmap.opaque).toBe(outward.bitmap.total);
    expect((await state(page)).annotations).toEqual(annotations);
    expect(evidence.errors).toEqual([]); await cdp.detach();
  });
}

test('选字模式双指接管与取消后重新缩放及平移', async ({ page }) => {
  test.setTimeout(180_000);
  const { cdp, annotations } = await setup(page);
  await page.getByRole('button', { name: '选字', exact: true }).click();
  await startProbe(page);
  const selectedModePinch = await pinch(cdp, page, 1.25, 'first-first');
  evidence.observations.fromSelection = selectedModePinch;
  expect.soft(selectedModePinch.after.zoom).toBeCloseTo(selectedModePinch.before.zoom * 1.25, 1);
  expect.soft(selectedModePinch.finalDriftCssPixels).toBeLessThan(3);
  await startProbe(page);
  const canceled = await pinch(cdp, page, .9, 'second-first', 15, true);
  evidence.observations.canceled = canceled;
  expect.soft(canceled.final.types.pointercancel).toBeGreaterThanOrEqual(1);
  const activeGesture = await page.locator('[data-zoom-gesture="pinching"]').count();
  expect.soft(activeGesture).toBe(0);
  await startProbe(page);
  const subsequent = await pinch(cdp, page, 1.15, 'second-first');
  evidence.observations.afterCancel = subsequent;
  expect.soft(subsequent.after.zoom).toBeCloseTo(subsequent.before.zoom * 1.15, 1);
  expect.soft(subsequent.finalDriftCssPixels).toBeLessThan(3);
  await page.getByRole('button', { name: '浏览', exact: true }).click();
  await centerScroll(page); const before = await metrics(page), p = before.center;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(33, p.x, p.y)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(33, p.x - 32, p.y - 45)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await metrics(page);
  evidence.observations.pan = { before, after };
  expect(after.scroll.x - before.scroll.x).toBeGreaterThan(20); expect(after.scroll.y - before.scroll.y).toBeGreaterThan(30);
  expect((await state(page)).annotations).toEqual(annotations);
  expect(evidence.errors).toEqual([]); await cdp.detach();
});

test('按钮缩放旋转分栏和4倍高DPI画布预算保留PDF批注坐标', async ({ page }) => {
  test.setTimeout(180_000);
  const { cdp, annotations } = await setup(page);
  // Button zoom anchors at the viewport center. Pinch tests deliberately use
  // an off-center midpoint; that is a separate interaction contract.
  const center = await page.locator('.pdf-scroll').evaluate(element => { const b = element.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  const initial = await metrics(page, center);
  await page.getByRole('button', { name: '放大', exact: true }).click(); await ready(page);
  const larger = await metrics(page, initial.center);
  await page.getByRole('button', { name: '缩小', exact: true }).click(); await ready(page);
  const smaller = await metrics(page, initial.center);
  evidence.observations.buttons = { initial, larger, smaller };
  expect.soft(larger.zoom).toBeCloseTo(initial.zoom * 1.2, 1); expect.soft(smaller.zoom).toBeCloseTo(initial.zoom, 1);
  expect.soft(drift(initial, larger)).toBeLessThan(3); expect.soft(drift(initial, smaller)).toBeLessThan(3);
  await startProbe(page); const maximum = await pinch(cdp, page, 3, 'second-first', 35);
  evidence.observations.maximum = maximum; expect.soft(maximum.after.zoom).toBe(4);
  await page.getByRole('button', { name: '旋转页面', exact: true }).click(); await ready(page); await saved(page);
  const separator = page.getByRole('separator', { name: '调整阅读与知识面板比例' });
  await separator.focus(); for (let i = 0; i < 5; i++) await separator.press('ArrowRight'); await ready(page);
  await expect(page.getByLabel('跳转页码', { exact: true })).toHaveValue('1');
  await page.setViewportSize({ width: 1600, height: 1050 }); await ready(page); await saved(page);
  const bitmap = await pixels(page), finalState = await state(page);
  const persisted = finalState.documents.find(doc => doc.id === finalState.activeDocumentId)!;
  evidence.observations.transformed = { bitmap, rotation: persisted.progress.rotation, zoom: persisted.progress.zoom, viewport: page.viewportSize(), split: await separator.getAttribute('aria-valuenow') };
  expect.soft(bitmap.width).toBeLessThanOrEqual(8192); expect.soft(bitmap.height).toBeLessThanOrEqual(8192);
  expect.soft(bitmap.total, 'High zoom must not allocate an unbounded backing store.').toBeLessThanOrEqual(16 * 1024 * 1024);
  expect.soft(bitmap.dark).toBeGreaterThan(100); expect.soft(bitmap.opaque).toBe(bitmap.total);
  expect(finalState.annotations).toEqual(annotations); expect(persisted.progress.rotation).toBe(90); expect(persisted.progress.zoom).toBe(4);
  // Independently project the stored PDF points for clockwise 90°. Compare the
  // SVG's actual painted viewport points, which must share the rendered page.
  const ink = annotations[0];
  const overlay = await page.locator(`polyline[data-annotation="${ink.id}"]`).evaluate((line: SVGPolylineElement) => ({ points: [...Array(line.points.numberOfItems)].map((_, index) => ({ x: line.points.getItem(index).x, y: line.points.getItem(index).y })), width: Number(line.ownerSVGElement!.getAttribute('width')), height: Number(line.ownerSVGElement!.getAttribute('height')) }));
  ink.points!.forEach((point, index) => { expect(overlay.points[index].x).toBeCloseTo(point.y / 792 * overlay.width, 2); expect(overlay.points[index].y).toBeCloseTo(point.x / 612 * overlay.height, 2); });
  expect(evidence.errors).toEqual([]); await cdp.detach();
});
