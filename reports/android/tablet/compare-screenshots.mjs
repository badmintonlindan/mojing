import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.tools/ms-playwright');
const { _android: android } = await import('playwright');
const serial = 'emulator-5556', pkg = 'cn.mojing.study', dir = path.resolve('reports/android/tablet/screenshot-comparison');
await mkdir(dir, { recursive: true });
const adb = (...args) => execFileSync(path.resolve('.tools/android-sdk/platform-tools/adb.exe'), ['-s', serial, ...args], { maxBuffer: 64 * 1024 * 1024 });
const text = (...args) => adb(...args).toString('utf8').trim();
const beforePid = text('shell', 'pidof', pkg);
adb('shell', 'am', 'force-stop', pkg); adb('shell', 'am', 'start', '-W', '-n', `${pkg}/.MainActivity`);
const device = (await android.devices()).find(item => item.serial() === serial);
const page = await (await device.webView({ pkg })).page(); page.setDefaultTimeout(90000);
const report = { serial, beforePid, freshPid: text('shell', 'pidof', pkg), freshProcess: true, initScriptsInstalled: false, startedAt: new Date().toISOString(), samples: [], console: [], errors: [] };
page.on('console', message => { if (['warning', 'error'].includes(message.type())) report.console.push({ type: message.type(), text: message.text() }); });
page.on('pageerror', error => report.errors.push(error.message));
async function ready() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => { const c = document.querySelector('.pdf-page canvas'), i = document.querySelector('[aria-label="跳转页码"]'); return c && i && c.dataset.renderState === 'ready' && c.dataset.renderedPage === i.value; });
}
async function osShot(name) { const target = `/sdcard/mojing-compare-${name}.png`; adb('shell', 'screencap', '-p', target); await writeFile(path.join(dir, `${name}.png`), adb('exec-out', 'cat', target)); }
async function capture(name) {
  await ready();
  await osShot(`${name}-os-before-readback`);
  await page.screenshot({ path: path.join(dir, `${name}-cdp-before-readback.png`) });
  const sample = await page.evaluate(() => {
    const canvas = document.querySelector('.pdf-page canvas'), context = canvas.getContext('2d'), frame = document.querySelector('.pdf-scroll');
    const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0, nonWhite = 0, opaque = 0, transparent = 0;
    for (let i = 0; i < bytes.length; i += 4) { if (bytes[i + 3] > 240) { opaque++; if (bytes[i] + bytes[i + 1] + bytes[i + 2] < 600) dark++; if (Math.min(bytes[i], bytes[i + 1], bytes[i + 2]) < 245) nonWhite++; } if (bytes[i + 3] === 0) transparent++; }
    return { page: document.querySelector('[aria-label="跳转页码"]').value, document: document.querySelector('.reader-title strong').textContent, rotation: document.querySelector('.textLayer').dataset.mainRotation, zoom: document.querySelector('[title="恢复适宽"]').textContent, width: canvas.width, height: canvas.height, css: canvas.getBoundingClientRect().toJSON(), viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, scroll: { left: frame.scrollLeft, top: frame.scrollTop, scrollWidth: frame.scrollWidth, scrollHeight: frame.scrollHeight }, ready: { ...canvas.dataset }, contextAttributes: context.getContextAttributes?.(), contextLost: context.isContextLost?.(), dark, nonWhite, opaque, transparent, png: canvas.toDataURL('image/png') };
  });
  const png = Buffer.from(sample.png.split(',')[1], 'base64'); delete sample.png;
  await writeFile(path.join(dir, `${name}-canvas.png`), png); sample.pngBytes = png.length;
  await osShot(`${name}-os-after-readback`);
  await page.screenshot({ path: path.join(dir, `${name}-cdp-after-readback.png`) });
  report.samples.push({ name, ...sample }); await writeFile(path.join(dir, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ name, rotation: sample.rotation, zoom: sample.zoom, dark: sample.dark, nonWhite: sample.nonWhite, contextAttributes: sample.contextAttributes, contextLost: sample.contextLost, pngBytes: png.length }));
}
try {
  await ready();
  await page.getByTitle('恢复适宽', { exact: true }).click(); await ready();
  await page.getByRole('button', { name: '放大', exact: true }).click(); await ready();
  for (let i = 0; i < 4 && Number(await page.locator('.textLayer').getAttribute('data-main-rotation')) !== 90; i++) { await page.getByRole('button', { name: '旋转页面', exact: true }).click(); await ready(); }
  await capture('fresh-rotation90-zoom120');
  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'); adb('shell', 'settings', 'put', 'system', 'user_rotation', '1');
  await page.waitForFunction(() => innerHeight > innerWidth); await capture('portrait-rotation90-zoom120');
  adb('shell', 'settings', 'put', 'system', 'user_rotation', '0');
  await page.waitForFunction(() => innerWidth > innerHeight); await capture('landscape-rotation90-zoom120');
  report.completed = true;
} catch (error) { report.failure = { message: error.message, stack: error.stack }; console.error(error.stack); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(path.join(dir, 'result.json'), JSON.stringify(report, null, 2)); await device.close().catch(() => {}); process.exit(process.exitCode || 0); }
