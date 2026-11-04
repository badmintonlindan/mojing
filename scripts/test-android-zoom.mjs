/** Dedicated AVD only: real update install, touch zoom, sidebar and native-data retention. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const { _android: android, expect } = await import('@playwright/test');
const serial = process.env.MOJING_TEST_SERIAL || 'emulator-5556';
assert.match(serial, /^emulator-\d+$/, 'Only a dedicated test AVD may be modified');
const pkg = 'cn.mojing.study', output = 'reports/0.1.1/android-tablet';
const adbPath = path.resolve('.tools/android-sdk/platform-tools/adb.exe');
const apk = path.resolve(process.env.MOJING_TEST_APK || 'android/app/build/outputs/apk/debug/app-debug.apk');
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], { maxBuffer: 32 * 1024 * 1024 });
const adbText = (...args) => adb(...args).toString('utf8').trim();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const check = expect.configure({ timeout: 45000 });
const report = { completed: false, version: '0.1.1', startedAt: new Date().toISOString(), serial, checks: [], errors: [] };
await mkdir(output, { recursive: true });
let device, page;
function snapshot() {
  const slots = ['a', 'b'].map(slot => {
    try { const envelope = JSON.parse(adbText('exec-out', 'run-as', pkg, 'cat', `files/snapshot-${slot}.json`)); assert.equal(hash(JSON.stringify(envelope.state)), envelope.sha256); return envelope.state; } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.revision - a.revision);
  assert.ok(slots.length, 'Existing native data must be available before an update'); return slots[0];
}
async function attach() {
  let error;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const view = await device.webView({ pkg }, { timeout: 4000 });
      assert.equal(view.pid(), Number(adbText('shell', 'pidof', pkg)));
      page = await view.page(); assert.equal(page.isClosed(), false);
      await check(page.locator('.app-shell')).toBeVisible({ timeout: 5000 });
      page.on('pageerror', e => report.errors.push(e.message)); return;
    } catch (e) { error = e; await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  throw error;
}
async function ready() {
  await check(page.locator('.pdf-page canvas')).toHaveAttribute('data-render-state', 'ready');
  await check(page.locator('.error-box')).toHaveCount(0);
  await check(page.locator('.save-state')).toContainText('已保存到本机');
}
async function screenshot(name) { await writeFile(`${output}/${name}.png`, adb('exec-out', 'screencap', '-p')); }
async function geometry() { return page.locator('.pdf-scroll').evaluate(el => { const b = el.getBoundingClientRect(), p = el.querySelector('.pdf-page').getBoundingClientRect(), c = el.querySelector('canvas'); return { clientX: b.left + el.clientWidth / 2, clientY: b.top + el.clientHeight / 2, left: p.left, top: p.top, width: p.width, height: p.height, canvasWidth: c.width, canvasHeight: c.height, scrollTop: el.scrollTop }; }); }
try {
  const before = snapshot();
  report.previousVersion = adbText('shell', 'dumpsys', 'package', pkg).match(/versionName=([^\s]+)/)?.[1];
  report.before = { revision: before.revision, cards: before.cards.length, nodes: before.nodes.length, annotations: before.annotations.length, reviewLogs: before.reviewLogs.length };
  report.apkSha256 = hash(await readFile(apk));
  assert.match(adbText('install', '-r', apk), /Success/);
  const installedPath = adbText('shell', 'pm', 'path', pkg).replace(/^package:/, '');
  report.installedSha256 = adbText('shell', 'sha256sum', installedPath).split(/\s+/)[0];
  assert.equal(report.installedSha256, report.apkSha256);
  assert.match(adbText('shell', 'dumpsys', 'package', pkg), /versionName=0\.1\.1/);
  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
  adb('shell', 'settings', 'put', 'system', 'user_rotation', '0');
  adb('shell', 'am', 'force-stop', pkg); adb('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
  device = (await android.devices()).find(item => item.serial() === serial); assert.ok(device);
  await attach(); await ready();
  report.entry = await page.locator('script[type=module]').getAttribute('src');
  for (const key of ['sets', 'documents', 'assets', 'cards', 'annotations', 'nodes', 'reviews', 'reviewLogs']) assert.deepEqual(snapshot()[key], before[key], `Update preserves existing ${key}`);
  report.checks.push('覆盖安装成功，原生双槽资料、来源、批注、脑图与复习数据逐字段保留');
  const readerBefore = (await page.locator('.reader-pane').boundingBox()).width;
  await page.getByLabel('收起侧栏', { exact: true }).click(); await ready();
  assert.ok((await page.locator('.reader-pane').boundingBox()).width > readerBefore + 100);
  await screenshot('sidebar-collapsed');
  await page.getByRole('button', { name: '打开侧栏', exact: true }).click(); await ready();
  report.checks.push('真实Android平板宽屏资料栏收起释放阅读宽度，按钮可重新展开');
  await page.getByLabel('浏览', { exact: true }).click();
  const start = await geometry(), x = start.clientX, y = start.clientY;
  const oldZoom = parseFloat(await page.getByLabel('缩放比例，点击恢复适宽', { exact: true }).innerText()) / 100;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const points = span => [{ x: x - span, y, id: 1 }, { x: x + span, y, id: 2 }];
  await touch('touchStart', [points(35)[0]]); await touch('touchStart', points(35));
  await check(page.locator('.pdf-scroll')).toHaveAttribute('data-zoom-gesture', 'pinching');
  for (let i = 1; i <= 24; i++) await touch('touchMove', points(35 + 35 * i / 24));
  const preview = await geometry(); assert.equal(preview.canvasWidth, start.canvasWidth); assert.equal(preview.canvasHeight, start.canvasHeight);
  await touch('touchEnd', [points(70)[1]]); await touch('touchEnd', []);
  await ready(); await check(page.locator('.pdf-scroll')).toHaveAttribute('data-zoom-gesture', 'idle');
  const finish = await geometry(), targetZoom = Math.min(4, oldZoom * 2);
  assert.ok(Math.abs(parseFloat(await page.getByLabel('缩放比例，点击恢复适宽').innerText()) - targetZoom * 100) <= 1);
  const expectedX = (x - start.left) / start.width * finish.width + finish.left, expectedY = (y - start.top) / start.height * finish.height + finish.top;
  assert.ok(Math.abs(expectedX - x) < 4 && Math.abs(expectedY - y) < 4, `Pinch focal anchor drift: ${expectedX - x}, ${expectedY - y}`);
  assert.ok(finish.canvasWidth * finish.canvasHeight <= 16 * 1024 * 1024 && finish.canvasWidth <= 8192 && finish.canvasHeight <= 8192);
  await screenshot('pinch-zoom');
  await touch('touchStart', [{ x, y, id: 3 }]); await touch('touchMove', [{ x, y: y - 60, id: 3 }]); await touch('touchEnd', []);
  assert.ok((await geometry()).scrollTop > finish.scrollTop + 30);
  await cdp.detach();
  report.zoom = { before: oldZoom, after: targetZoom, anchorDrift: { x: expectedX - x, y: expectedY - y }, canvas: { width: finish.canvasWidth, height: finish.canvasHeight }, previewBitmapUnchanged: true };
  report.checks.push('真实WebView可信多点触摸预览时未重建位图，松指一次清晰重绘、焦点守恒、后续单指平移正常');
  await page.getByLabel('缩放比例，点击恢复适宽').click(); await ready();
  await page.getByLabel('放大', { exact: true }).click(); await ready();
  await check(page.getByLabel('缩放比例，点击恢复适宽')).toHaveText('120%');
  await page.getByLabel('缩小', { exact: true }).click(); await ready();
  await check(page.getByLabel('缩放比例，点击恢复适宽')).toHaveText('100%');
  const afterZoom = snapshot(); assert.deepEqual(afterZoom.annotations, before.annotations);
  report.checks.push('适宽/加减缩放可用，全部既有批注PDF坐标和卡片来源保持');
  const pid = adbText('shell', 'pidof', pkg);
  adb('shell', 'am', 'force-stop', pkg); adb('shell', 'am', 'start', '-n', `${pkg}/.MainActivity`);
  await attach(); await ready(); assert.notEqual(adbText('shell', 'pidof', pkg), pid);
  for (const key of ['documents', 'cards', 'annotations', 'nodes', 'reviews', 'reviewLogs']) assert.deepEqual(snapshot()[key], afterZoom[key]);
  await screenshot('reopened'); report.checks.push('再次force-stop及新进程恢复缩放、原文、关系与批注');
  assert.deepEqual(report.errors, []); report.completed = true;
} catch (e) { report.failure = e.stack || String(e); process.exitCode = 1; try { await screenshot('failure'); } catch {} }
finally { report.finishedAt = new Date().toISOString(); await writeFile(`${output}/result.json`, JSON.stringify(report, null, 2) + '\n'); if (device) await device.close(); }
console.log(JSON.stringify(report, null, 2));
