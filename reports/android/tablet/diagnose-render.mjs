import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.tools/ms-playwright');
const { _android: android } = await import('playwright');
const serial = 'emulator-5556', pkg = 'cn.mojing.study';
const dir = path.resolve('reports/android/tablet/render-diagnostics');
await mkdir(dir, { recursive: true });
const adb = (...args) => execFileSync(path.resolve('.tools/android-sdk/platform-tools/adb.exe'), ['-s', serial, ...args], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8').trim();
const device = (await android.devices()).find(item => item.serial() === serial);
if (!device) throw new Error('Tablet AVD is unavailable');
const page = await (await device.webView({ pkg })).page();
page.setDefaultTimeout(45000);
const report = { serial, startedAt: new Date().toISOString(), samples: [], console: [], errors: [] };
page.on('console', message => { if (['warning', 'error'].includes(message.type())) report.console.push({ type: message.type(), text: message.text(), at: new Date().toISOString() }); });
page.on('pageerror', error => report.errors.push(error.message));
async function ready() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => {
    const c = document.querySelector('.pdf-page canvas'), input = document.querySelector('[aria-label="跳转页码"]');
    return c && input && c.dataset.renderState === 'ready' && c.dataset.renderedPage === input.value;
  }, null, { timeout: 90000 });
}
async function sample(label) {
  await ready();
  const result = await page.evaluate(() => {
    const c = document.querySelector('.pdf-page canvas'), context = c.getContext('2d'), frame = document.querySelector('.pdf-scroll');
    window.__tabletCanvasEvents ??= [];
    if (!c.__diagnosticHook) {
      c.__diagnosticHook = true;
      for (const type of ['contextlost', 'contextrestored', 'webglcontextlost', 'webglcontextrestored']) c.addEventListener(type, () => window.__tabletCanvasEvents.push({ type, at: Date.now() }));
    }
    const bytes = context.getImageData(0, 0, c.width, c.height).data;
    let dark = 0, nonWhite = 0, opaque = 0, transparent = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      if (bytes[i + 3] > 240) { opaque++; if (bytes[i] + bytes[i + 1] + bytes[i + 2] < 600) dark++; if (Math.min(bytes[i], bytes[i + 1], bytes[i + 2]) < 245) nonWhite++; }
      if (bytes[i + 3] === 0) transparent++;
    }
    return {
      document: document.querySelector('.reader-title strong')?.textContent,
      page: document.querySelector('[aria-label="跳转页码"]')?.value,
      rotation: document.querySelector('.textLayer')?.dataset.mainRotation,
      zoom: document.querySelector('[title="恢复适宽"]')?.textContent,
      width: c.width, height: c.height, styleWidth: c.style.width, styleHeight: c.style.height,
      cssBox: c.getBoundingClientRect().toJSON(), pageBox: document.querySelector('.pdf-page').getBoundingClientRect().toJSON(),
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      scroll: { top: frame.scrollTop, left: frame.scrollLeft, width: frame.clientWidth, height: frame.clientHeight, scrollWidth: frame.scrollWidth, scrollHeight: frame.scrollHeight },
      ready: { ...c.dataset }, contextLost: context.isContextLost?.(), contextAttributes: context.getContextAttributes?.(),
      pixelCount: c.width * c.height, dark, nonWhite, opaque, transparent,
      contextEvents: window.__tabletCanvasEvents, visibility: document.visibilityState, png: c.toDataURL('image/png'),
    };
  });
  const png = Buffer.from(result.png.split(',')[1], 'base64'); delete result.png;
  await writeFile(path.join(dir, `${label}.png`), png);
  Object.assign(result, { label, at: new Date().toISOString(), pngBytes: png.length }); report.samples.push(result);
  await writeFile(path.join(dir, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ label, rotation: result.rotation, zoom: result.zoom, dark: result.dark, nonWhite: result.nonWhite, transparent: result.transparent, contextLost: result.contextLost, contextAttributes: result.contextAttributes, width: result.width, height: result.height, pngBytes: png.length }));
}
async function rotateTo(target, prefix) {
  for (let i = 0; i < 4; i++) {
    const current = Number(await page.locator('.textLayer').getAttribute('data-main-rotation'));
    if (current === target) return;
    await page.getByRole('button', { name: '旋转页面', exact: true }).click();
    await sample(`${prefix}-rotation${(current + 90) % 360}`);
  }
}
try {
  await sample('initial');
  await rotateTo(0, 'baseline');
  await page.getByTitle('恢复适宽', { exact: true }).click(); await sample('baseline-rotation0-zoom100');
  await page.getByRole('button', { name: '放大', exact: true }).click(); await sample('baseline-rotation0-zoom120');
  await rotateTo(90, 'baseline');
  await page.getByTitle('恢复适宽', { exact: true }).click(); await sample('baseline-rotation90-zoom100');
  const open = page.getByLabel('打开侧栏', { exact: true });
  if (await open.isVisible()) await open.click();
  await page.locator('.doc-entry').filter({ hasText: '含文字层的学习资料' }).click(); await sample('different-text-document');
  if (await open.isVisible()) await open.click();
  await page.locator('.doc-entry').filter({ hasText: 'archival-scan' }).click(); await sample('reopened-scan-rotation90');
  await page.context().addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, options) {
      return original.call(this, type, type === '2d' ? { ...options, alpha: false, willReadFrequently: true } : options);
    };
  });
  await page.reload({ waitUntil: 'domcontentloaded' }); await sample('software-context-rotation90');
  await rotateTo(0, 'software-context');
  await rotateTo(90, 'software-context');
  report.completed = true;
} catch (error) { report.failure = { message: error.message, stack: error.stack }; console.error(error.stack); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(path.join(dir, 'result.json'), JSON.stringify(report, null, 2)); await device.close().catch(() => {}); process.exit(process.exitCode || 0); }
