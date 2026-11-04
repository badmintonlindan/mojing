/** Actual APK acceptance on a dedicated Android AVD. No renderer storage mocks.
 * node scripts/test-android.mjs --serial emulator-5554 --label phone
 * Requires reports/windows-export.mjstudy produced by the packaged Windows app.
 * Playwright connects to the real WebView; ADB observes and operates the native picker.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.tools/ms-playwright');
const [{ _android: android }, { expect }] = await Promise.all([import('playwright'), import('@playwright/test')]);

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => value.startsWith('--') ? [...pairs, [value.slice(2), all[i + 1]]] : pairs, []));
const serial = args.serial || 'emulator-5554';
assert.match(serial, /^emulator-\d+$/, 'This script only modifies a dedicated AVD, never an attached personal device.');
const label = args.label || 'phone';
assert.match(label, /^[a-z0-9-]+$/);
const mode = args.mode || 'full';
assert.ok(['full', 'export', 'finish-export', 'cancel-export', 'resume-restart', 'clipboard', 'touch'].includes(mode));
const pkg = 'cn.mojing.study';
const adbPath = path.resolve(process.env.MOJING_ADB || '.tools/android-sdk/platform-tools/adb.exe');
const archivePath = path.resolve(args.archive || 'reports/windows-export.mjstudy');
const reportDir = path.resolve('reports/android', label);
await mkdir(reportDir, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const adb = (...command) => execFileSync(adbPath, ['-s', serial, ...command], { maxBuffer: 256 * 1024 * 1024 });
const adbText = (...command) => adb(...command).toString('utf8').trim();
const report = { platform: 'Android APK', serial, label, mode, startedAt: new Date().toISOString(), completed: false, steps: [], errors: [], console: [], layouts: [], artifacts: [] };
let device, page;
let stage = 'connect';
const check = expect.configure({ timeout: 45000 });
function pass(text, detail) { report.steps.push({ text, detail, at: new Date().toISOString() }); console.log(`PASS ${text}`); }
async function screenshot(name, system = false) {
  const target = path.join(reportDir, `${name}.png`);
  // CDP screenshots can omit hardware-composited WebView canvases. Capture the
  // actual Android compositor for both app views and native picker evidence.
  const remote = `/sdcard/mojing-${label}-${name}.png`;
  adb('shell', 'screencap', '-p', remote); adb('pull', remote, target);
  report.artifacts.push(path.relative(process.cwd(), target));
}
function snapshot() {
  const states = ['snapshot-a.json', 'snapshot-b.json'].map(name => {
    try {
      const envelope = JSON.parse(adbText('exec-out', 'run-as', pkg, 'cat', `files/${name}`));
      assert.equal(envelope.format, 'mojing.snapshot');
      assert.equal(sha(JSON.stringify(envelope.state)), envelope.sha256);
      assert.equal(envelope.revision, envelope.state.revision);
      return envelope.state;
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.revision - a.revision);
  assert.ok(states.length, 'No valid native Android files/snapshot-*.json snapshot');
  return states[0];
}
function activeSubset(state) {
  const set = state.sets.find(item => item.id === state.activeSetId);
  assert.ok(set, 'Active study set exists in native snapshot');
  const documents = state.documents.filter(doc => set.documentIds.includes(doc.id));
  const cards = state.cards.filter(card => card.setId === set.id);
  const assets = new Set([...documents.map(doc => doc.assetId), ...cards.map(card => card.imageAssetId).filter(Boolean)]);
  return { ...state, sets: [set], documents, cards, assets: state.assets.filter(asset => assets.has(asset.id)), nodes: state.nodes.filter(node => node.setId === set.id), annotations: state.annotations.filter(a => a.setId === set.id), reviews: state.reviews.filter(r => r.setId === set.id), reviewLogs: state.reviewLogs.filter(r => r.setId === set.id) };
}
function semantics(state) {
  const doc = id => state.documents.find(item => item.id === id).assetId;
  const card = id => state.cards.find(item => item.id === id).title;
  const sorted = items => items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    documents: sorted(state.documents.map(({ name, assetId, pageCount }) => ({ name, assetId, pageCount }))),
    cards: sorted(state.cards.map(c => ({ title: c.title, body: c.body, color: c.color, tags: c.tags, imageAssetId: c.imageAssetId || null, source: c.source ? { ...c.source, documentId: doc(c.source.documentId) } : null }))),
    nodes: sorted(state.nodes.map(n => ({ card: card(n.cardId), parent: n.parentId ? card(state.nodes.find(p => p.id === n.parentId).cardId) : null, order: n.order, collapsed: n.collapsed }))),
    annotations: sorted(state.annotations.map(({ id, setId, documentId, ...a }) => ({ ...a, documentId: doc(documentId) }))),
    reviews: sorted(state.reviews.map(({ id, setId, cardId, ...r }) => ({ ...r, card: card(cardId) }))),
    logs: sorted(state.reviewLogs.map(({ id, setId, reviewId, cardId, ...r }) => ({ ...r, card: card(cardId) }))),
  };
}
function maximumDepth(state) {
  function depth(node, seen = new Set()) { assert.ok(!seen.has(node.id), 'No map cycle'); seen.add(node.id); return node.parentId ? 1 + depth(state.nodes.find(n => n.id === node.parentId), seen) : 1; }
  return Math.max(0, ...state.nodes.map(node => depth(node)));
}
function verifyArchive(bytes) {
  const files = unzipSync(new Uint8Array(bytes));
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'));
  assert.equal(manifest.format, 'mojing.studyset'); assert.equal(manifest.version, 1);
  for (const entry of manifest.files) { assert.equal(files[entry.path].byteLength, entry.size); assert.equal(sha(files[entry.path]), entry.sha256); }
  return JSON.parse(Buffer.from(files['study.json']).toString('utf8'));
}
async function saved() { await check(page.locator('.save-state')).toContainText('已保存到本机'); await check(page.locator('.save-error')).toHaveCount(0); }
async function readerReady() {
  await check(page.locator('.pdf-page canvas')).toBeVisible();
  const expectedPage = await page.getByLabel('跳转页码', { exact: true }).inputValue();
  await check(page.locator('.pdf-page canvas')).toHaveAttribute('data-rendered-page', expectedPage);
  await check(page.locator('.pdf-page canvas')).toHaveAttribute('data-render-state', 'ready');
  await check(page.locator('.render-badge')).toHaveCount(0);
  await check(page.locator('.error-box')).toHaveCount(0);
}
async function scanPixels(phase) {
  const pixels = await page.locator('.pdf-page canvas').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let darkPixels = 0, opaquePixels = 0, transparentPixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] === 255) opaquePixels++;
      if (data[index + 3] === 0) transparentPixels++;
      if (data[index + 3] > 0 && data[index] + data[index + 1] + data[index + 2] < 600) darkPixels++;
    }
    return { width: canvas.width, height: canvas.height, darkPixels, opaquePixels, transparentPixels };
  });
  (report.scanChecks ||= []).push({ phase, ...pixels });
  assert.ok(pixels.darkPixels > 1000, `Known nonblank archival scan rendered original pixels after ${phase}: ${pixels.darkPixels}`);
  assert.ok(pixels.opaquePixels >= pixels.width * pixels.height * .99, 'Rendered PDF page is opaque rather than an empty transparent canvas');
  return pixels;
}
async function attach() {
  let lastError;
  page = undefined;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const activePid = Number(adbText('shell', 'pidof', pkg));
      const webview = await device.webView({ pkg }, { timeout: 5000 });
      assert.equal(webview.pid(), activePid, 'WebView belongs to the currently running app process');
      const candidate = await webview.page();
      assert.equal(candidate.isClosed(), false);
      candidate.setDefaultTimeout(45000);
      await check(candidate.locator('.app-shell')).toBeVisible({ timeout: 6000 });
      await candidate.evaluate(() => document.readyState);
      page = candidate;
      (report.attachments ||= []).push({ attempt: attempt + 1, pid: activePid, at: new Date().toISOString() });
      break;
    } catch (error) {
      page = undefined; lastError = error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  if (!page || page.isClosed()) throw lastError || new Error('No live APK WebView');
  page.setDefaultTimeout(45000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.console.push(message.text().slice(0, 800)); });
  return page;
}
async function restartCurrent() {
  const beforeRestart = activeSubset(snapshot());
  const beforePid = adbText('shell', 'pidof', pkg);
  await device.shell(`am force-stop ${pkg}`);
  await device.shell(`am start -n ${pkg}/.MainActivity`);
  await attach(); await readerReady(); await saved();
  await scanPixels('force-stop-reopened');
  const afterRestart = activeSubset(snapshot());
  assert.deepEqual(semantics(afterRestart), semantics(beforeRestart));
  for (const document of beforeRestart.documents) assert.deepEqual(afterRestart.documents.find(item => item.assetId === document.assetId).progress, document.progress);
  const afterPid = adbText('shell', 'pidof', pkg);
  assert.notEqual(afterPid, beforePid, 'Force-stop restarted the actual app process');
  report.restart = { beforePid, afterPid, beforeRevision: beforeRestart.revision, afterRevision: afterRestart.revision, cards: afterRestart.cards.length, nodes: afterRestart.nodes.length, annotations: afterRestart.annotations.length, reviewLogs: afterRestart.reviewLogs.length };
  await screenshot('force-stop-reopened');
  pass('force-stop后重新打开APK，原生文件、学习关系、批注及复习记录恢复');
}
async function tab(name) {
  if (await page.locator('.sidebar').evaluate(element => element.classList.contains('open'))) {
    const close = page.getByLabel('关闭侧栏', { exact: true });
    if (await close.isVisible()) await close.click();
  }
  const mobile = page.locator('.mobile-nav');
  if (await mobile.isVisible()) await mobile.getByRole('button', { name, exact: true }).click();
  else if (name !== '阅读') await page.getByRole('tab', { name: name === '卡片' ? /^卡片/ : name, exact: name !== '卡片' }).click();
}
async function openSource(card, state) {
  await tab('卡片');
  const article = page.locator('.knowledge-card').filter({ has: page.getByRole('button', { name: card.title, exact: true }) });
  await article.getByTitle('返回原文定位', { exact: true }).click();
  await readerReady();
  await check(page.locator('.reader-title strong')).toHaveText(state.documents.find(d => d.id === card.source.documentId).name);
  await check(page.getByLabel('跳转页码', { exact: true })).toHaveValue(String(card.source.page));
  await check(page.locator('.source-focus')).toHaveCount(card.source.rects.length);
}
async function clipboardCopy(linkedCard, state) {
  await openSource(linkedCard, state);
  let rotation = activeSubset(snapshot()).documents.find(document => document.id === linkedCard.source.documentId).progress.rotation;
  while (rotation !== 0) {
    await page.getByRole('button', { name: '旋转页面', exact: true }).click(); await readerReady();
    rotation = (rotation + 90) % 360;
  }
  await page.getByTitle('恢复适宽', { exact: true }).click(); await readerReady();
  await page.getByRole('button', { name: '选字', exact: true }).click();
  const target = await page.locator('.textLayer span').evaluateAll(spans => {
    const frame = document.querySelector('.pdf-scroll').getBoundingClientRect();
    for (const span of spans) {
      const box = span.getBoundingClientRect();
      if ((span.textContent || '').trim().length >= 10 && box.width > 50 && box.top >= frame.top && box.bottom <= frame.bottom && box.left >= frame.left && box.right <= frame.right) return box.toJSON();
    }
    return null;
  });
  assert.ok(target, 'A visible real PDF text span is available for drag selection');
  await page.mouse.move(target.x + 2, target.y + target.height / 2);
  await page.mouse.down(); await page.mouse.move(target.x + target.width * .8, target.y + target.height / 2, { steps: 12 }); await page.mouse.up();
  await check(page.locator('.selection-actions')).toBeVisible();
  const selected = await page.evaluate(() => window.getSelection().toString().trim());
  assert.ok(selected.length > 3);
  await page.locator('.selection-actions').getByRole('button', { name: '复制', exact: true }).click();
  await check(page.locator('.toast')).toContainText('已复制选中文字');
  await tab('卡片'); await page.getByRole('button', { name: '新建卡片', exact: true }).first().click();
  await page.getByLabel('卡片正文', { exact: true }).click();
  adb('shell', 'input', 'keyevent', 'KEYCODE_PASTE');
  await check(page.getByLabel('卡片正文', { exact: true })).toHaveValue(selected);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  // After a native paste, CDP click can be consumed by the Android IME. Verify
  // the dialog actually closed, then map the observed DOM button into the native
  // WebView's screen bounds. Some WebViews expose no HTML nodes to UiAutomator.
  await check(page.locator('.card-editor')).toHaveCount(0, { timeout: 1500 }).catch(async () => {
    const button = await page.getByRole('button', { name: '取消', exact: true }).boundingBox();
    const native = nativeTree().find(node => node.pkg === pkg && node.clazz === 'android.webkit.WebView');
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(button && native, 'Cancel button and native WebView screen bounds are observed');
    const x = native.bounds.x + (button.x + button.width / 2) * native.bounds.width / viewport.width;
    const y = native.bounds.y + (button.y + button.height / 2) * native.bounds.height / viewport.height;
    adb('shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y)));
  });
  await check(page.locator('.card-editor')).toHaveCount(0);
  pass('实际拖选PDF文字并点击复制，经Android系统KEYCODE_PASTE粘贴到正文验证剪贴板内容');
}
function nativeTree() {
  const remote = `/sdcard/mojing-${label}-ui.xml`;
  adb('shell', 'uiautomator', 'dump', remote);
  const xml = adbText('exec-out', 'cat', remote);
  const decode = text => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) => {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
    const box = attributes.bounds?.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    return { text: attributes.text, desc: attributes['content-desc'], res: attributes['resource-id'], pkg: attributes.package, clazz: attributes.class, enabled: attributes.enabled === 'true', bounds: box ? { x: +box[1], y: +box[2], width: +box[3] - +box[1], height: +box[4] - +box[2] } : { x: 0, y: 0, width: 0, height: 0 } };
  });
}
function matchesNative(node, selector) { return Object.entries(selector).every(([key, value]) => value instanceof RegExp ? value.test(node[key] || '') : node[key] === value); }
async function nativeFind(selector) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const found = nativeTree().find(node => matchesNative(node, selector));
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Native selector not found: ${JSON.stringify(selector)}`);
}
async function nativeTap(selector) {
  const { bounds, enabled } = await nativeFind(selector);
  assert.ok(enabled && bounds.width > 0 && bounds.height > 0, 'Native control is enabled and has screen bounds');
  // ADB injects a real touchscreen tap at the observed native control, avoiding
  // UiObject.click inconsistencies on non-clickable TextView children in Android 15.
  adb('shell', 'input', 'tap', String(Math.round(bounds.x + bounds.width / 2)), String(Math.round(bounds.y + bounds.height / 2)));
}
function resumedActivity() {
  return adbText('shell', 'dumpsys', 'activity', 'activities').split(/\r?\n/).filter(line => line.toLowerCase().includes('resumedactivity')).join('\n');
}
async function downloads() {
  const docs = { pkg: 'com.android.documentsui' };
  const drawerOpen = nativeTree().some(node => node.pkg === docs.pkg && ['Open from', 'Save to'].includes(node.text));
  if (!drawerOpen) await nativeTap({ ...docs, desc: 'Show roots' });
  await nativeTap({ ...docs, res: 'android:id/title', text: 'Downloads' });
}
async function nativeFill(selector, value) {
  await nativeTap(selector);
  adb('shell', 'input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A');
  adb('shell', 'input', 'text', value);
}
async function importFromPicker() {
  adb('push', archivePath, '/sdcard/Download/Windows-export.mjstudy');
  const sidebar = page.getByLabel('打开侧栏', { exact: true });
  if (await sidebar.isVisible() && !await page.locator('.sidebar').evaluate(element => element.classList.contains('open'))) await sidebar.click();
  await page.getByRole('button', { name: '导入学习集', exact: true }).click();
  await check.poll(resumedActivity, { timeout: 180000 }).toContain('com.android.documentsui');
  await downloads();
  await screenshot('native-import-picker', true);
  await nativeTap({ pkg: 'com.android.documentsui', text: 'Windows-export.mjstudy' });
  await check.poll(resumedActivity).toContain(pkg);
  await check(page.locator('.toast')).toContainText('已作为新学习集导入');
  await check(page.locator('.busy-overlay')).toHaveCount(0);
  await saved();
  const closeSidebar = page.getByLabel('关闭侧栏', { exact: true });
  if (await page.locator('.sidebar').evaluate(element => element.classList.contains('open'))) await closeSidebar.click();
  await tab('阅读'); await readerReady();
}
async function physicalTouchNavigation() {
  await tab('阅读'); await readerReady();
  await page.getByRole('button', { name: '浏览', exact: true }).click();
  assert.equal(await page.locator('.mobile-nav').isVisible(), true, 'Phone bottom navigation is visible');
  const native = nativeTree().find(node => node.pkg === pkg && node.clazz === 'android.webkit.WebView');
  assert.ok(native, 'Physical WebView screen bounds are observed');
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const screenPoint = (x, y) => [String(Math.round(native.bounds.x + x * native.bounds.width / viewport.width)), String(Math.round(native.bounds.y + y * native.bounds.height / viewport.height))];
  const frame = await page.locator('.pdf-scroll').boundingBox();
  const start = screenPoint(frame.x + frame.width * .65, frame.y + frame.height * .7);
  const end = screenPoint(frame.x + frame.width * .35, frame.y + frame.height * .35);
  for (let i = 0; i < 2; i++) adb('shell', 'input', 'swipe', ...start, ...end, '350');
  for (const name of ['卡片', '复习', '阅读']) {
    const button = page.locator('.mobile-nav').getByRole('button', { name, exact: true });
    const box = await button.boundingBox();
    adb('shell', 'input', 'tap', ...screenPoint(box.x + box.width / 2, box.y + box.height / 2));
    await check(button).toHaveClass('active');
    await screenshot(`physical-touch-${name === '卡片' ? 'cards' : name === '复习' ? 'review' : 'read'}`);
  }
  report.physicalTouch = { swipes: 2, navigation: ['卡片', '复习', '阅读'], input: 'adb touchscreen swipe/tap', nativeBounds: native.bounds };
  pass('真实Android触摸注入连续平移PDF后，底栏卡片、复习、阅读均响应轻触');
}
async function orientation(rotation, name) {
  await device.shell('settings put system accelerometer_rotation 0');
  const old = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const currentRotation = Number(adbText('shell', 'settings', 'get', 'system', 'user_rotation')) || 0;
  const currentlyPortrait = old.height >= old.width;
  const naturallyPortrait = currentRotation % 2 === 0 ? currentlyPortrait : !currentlyPortrait;
  const wantPortrait = rotation % 2 === 0;
  const targetRotation = naturallyPortrait ? (wantPortrait ? 0 : 1) : (wantPortrait ? 1 : 0);
  await device.shell(`settings put system user_rotation ${targetRotation}`);
  await check.poll(() => page.evaluate(() => innerHeight >= innerWidth)).toBe(wantPortrait);
  await tab('阅读'); await readerReady(); await scanPixels(name);
  const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scrollWidth: document.documentElement.scrollWidth, mobile: getComputedStyle(document.querySelector('.mobile-nav')).display !== 'none', reader: document.querySelector('.reader-pane').getBoundingClientRect().toJSON(), knowledge: document.querySelector('.knowledge-pane').getBoundingClientRect().toJSON() }));
  assert.ok(layout.scrollWidth <= layout.width + 1, 'No horizontal document overflow');
  if (label.startsWith('phone')) assert.equal(layout.mobile, true, 'Phone keeps single-column navigation in both orientations');
  if (label.startsWith('tablet')) {
    assert.equal(layout.mobile, false, 'Tablet keeps reading/knowledge split in both orientations');
    assert.ok(layout.reader.width > 200 && layout.knowledge.width > 200, 'Both tablet panes remain usable');
  }
  report.layouts.push({ name, ...layout });
  await screenshot(name);
}
async function visibleRegion() {
  const svg = await page.locator('.annotation-layer').boundingBox();
  const frame = await page.locator('.pdf-scroll').boundingBox();
  assert.ok(svg && frame);
  const x = Math.max(svg.x, frame.x) + 18, y = Math.max(svg.y, frame.y) + 18;
  const width = Math.min(svg.x + svg.width, frame.x + frame.width) - x - 20;
  const height = Math.min(svg.y + svg.height, frame.y + frame.height) - y - 20;
  assert.ok(width > 60 && height > 60);
  return { x, y, width, height };
}
async function gesture(kind, points) {
  const cdp = await page.context().newCDPSession(page);
  if (kind === 'touch') {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points[0], id: 1, force: .6 }] });
    for (const point of points.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1, force: .6 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points[0], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .7, tiltX: 10 });
    for (const point of points.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'left', buttons: 1, pointerType: 'pen', force: .7, tiltX: 10 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.at(-1), button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  }
  await cdp.detach(); await saved();
}
async function nativeExport(alreadyOpen = false, cancel = false) {
  const started = Date.now();
  const previous = cancel ? semantics(activeSubset(snapshot())) : null;
  if (!alreadyOpen) {
    const open = page.getByLabel('打开侧栏', { exact: true });
    if (await open.isVisible() && !await page.locator('.sidebar').evaluate(element => element.classList.contains('open'))) await open.click();
    await page.getByRole('button', { name: '备份当前学习集', exact: true }).click();
  }
  await check.poll(resumedActivity, { timeout: 180000 }).toContain('com.android.documentsui');
  const preparationMs = alreadyOpen ? null : Date.now() - started;
  if (cancel) {
    await screenshot('native-export-cancel-picker', true);
    for (let attempt = 0; attempt < 3 && resumedActivity().includes('com.android.documentsui'); attempt++) {
      adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await check.poll(resumedActivity).toContain(pkg);
    await check(page.locator('.busy-overlay')).toHaveCount(0);
    assert.equal(adbText('shell', 'run-as', pkg, 'ls', 'cache/mojing-exports').trim(), '');
    assert.deepEqual(semantics(activeSubset(snapshot())), previous);
    report.canceledExport = { preparationMs, cacheCleaned: true, learningDataUnchanged: true };
    pass('实际系统保存器取消后返回应用，清理临时文件且学习数据保持完整');
    return;
  }
  await downloads();
  const name = `Android-${label}-export-${Date.now()}.mjstudy`;
  await nativeFill({ pkg: 'com.android.documentsui', clazz: 'android.widget.EditText' }, name);
  await screenshot('native-export-picker', true);
  await nativeTap({ pkg: 'com.android.documentsui', res: 'android:id/button1' });
  await check.poll(resumedActivity).toContain(pkg);
  await check(page.locator('.busy-overlay')).toHaveCount(0);
  await check(page.locator('.toast')).toContainText('完整学习集已导出');
  const listing = adbText('shell', 'ls', '/sdcard/Download').split(/\r?\n/);
  const savedName = listing.includes(name) ? name : listing.includes(`${name}.zip`) ? `${name}.zip` : null;
  assert.ok(savedName, 'System picker saved the requested exchange file in Downloads');
  const deviceFile = `/sdcard/Download/${savedName}`;
  const target = path.join(reportDir, `Android-${label}-export.mjstudy`);
  adb('pull', deviceFile, target);
  const bytes = await readFile(target);
  const exported = verifyArchive(bytes);
  assert.deepEqual(semantics(exported), semantics(activeSubset(snapshot())));
  const temporaryFiles = adbText('shell', 'run-as', pkg, 'ls', 'cache/mojing-exports').trim();
  assert.equal(temporaryFiles, '', 'Export cache is cleaned after successful save');
  report.export = { path: path.relative(process.cwd(), target), sha256: sha(bytes), bytes: bytes.length, deviceFile, preparationMs, totalMs: Date.now() - started, cacheCleaned: true };
  pass('原生 ACTION_CREATE_DOCUMENT 系统保存器写出完整包，ADB取回逐项校验通过', report.export);
}

try {
  const bytes = await readFile(archivePath);
  const original = verifyArchive(bytes);
  assert.equal(original.cards.length, 20); assert.equal(original.documents.length, 2); assert.equal(original.nodes.length, 20);
  assert.ok(maximumDepth(original) >= 3); assert.ok(original.reviewLogs.length >= 1);
  report.input = { path: archivePath, sha256: sha(bytes), bytes: bytes.length };
  const devices = await android.devices();
  device = devices.find(item => item.serial() === serial);
  assert.ok(device, `ADB AVD ${serial} is connected`);
  device.setDefaultTimeout(45000);
  // Native UI is observed through fresh uiautomator dumps and injected through ADB.
  // Keep the optional experimental UiObject driver from caching stale drawer nodes.
  adb('shell', 'am', 'force-stop', 'com.microsoft.playwright.androiddriver');
  report.device = { model: device.model(), sdk: adbText('shell', 'getprop', 'ro.build.version.sdk'), release: adbText('shell', 'getprop', 'ro.build.version.release'), fingerprint: adbText('shell', 'getprop', 'ro.build.fingerprint'), webview: adbText('shell', 'dumpsys', 'webviewupdate') };
  if (mode !== 'finish-export') await device.shell(`am start -n ${pkg}/.MainActivity`);
  await attach();
  report.runtime = await page.evaluate(() => ({ url: location.href, scripts: [...document.scripts].map(script => script.src), platform: window.Capacitor?.getPlatform(), native: window.Capacitor?.isNativePlatform(), filesystem: window.Capacitor?.isPluginAvailable('Filesystem'), userAgent: navigator.userAgent }));
  assert.equal(report.runtime.platform, 'android'); assert.equal(report.runtime.native, true); assert.equal(report.runtime.filesystem, true);
  pass('已安装APK真实WebView启动并启用原生Filesystem插件', report.runtime);

  await device.shell('cmd connectivity airplane-mode enable');
  await device.shell('svc wifi disable'); await device.shell('svc data disable');
  report.network = { airplaneMode: adbText('shell', 'settings', 'get', 'global', 'airplane_mode_on') };
  assert.equal(report.network.airplaneMode, '1');
  pass('设备飞行模式开启，后续PDF渲染、摘录、复习及交换全程离线');

  if (mode !== 'full') {
    if (mode === 'clipboard') {
      stage = 'clipboard'; const current = activeSubset(snapshot());
      const linked = current.cards.find(card => card.source?.quote && current.nodes.some(node => node.cardId === card.id));
      assert.ok(linked); await clipboardCopy(linked, current);
    } else if (mode === 'touch') { stage = 'physical-touch'; await physicalTouchNavigation();
    } else if (mode === 'resume-restart') {
      const previous = await readFile(path.join(reportDir, 'result.json'));
      const previousReport = JSON.parse(previous);
      assert.equal(previousReport.failure?.stage, 'restart', 'Resume is linked to an explicitly recorded restart-stage failure');
      report.resumes = { report: 'result.json', sha256: sha(previous), failedStage: previousReport.failure.stage, completedEarlierSteps: previousReport.steps.map(step => step.text) };
      stage = 'restart'; await restartCurrent();
      stage = 'native-export'; await nativeExport();
    } else { stage = 'native-export'; await nativeExport(mode === 'finish-export', mode === 'cancel-export'); }
  } else {
  stage = 'native-import'; await importFromPicker();
  const imported = activeSubset(snapshot());
  assert.deepEqual(semantics(imported), semantics(original));
  assert.notEqual(imported.cards[0].id, original.cards[0].id);
  for (const asset of imported.assets) { const data = adb('exec-out', 'run-as', pkg, 'cat', `files/${asset.path}`); assert.equal(data.length, asset.size); assert.equal(sha(data), asset.sha256); }
  await writeFile(path.join(reportDir, 'native-imported-state.json'), JSON.stringify(imported, null, 2));
  const databases = await page.evaluate(async () => typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []);
  assert.ok(!databases.some(db => db.name === 'mojing-files'));
  pass('Windows包经真实系统文件选择器导入：2PDF、20卡、三级20节点、来源区域、批注、复习均保留；原生落盘资产SHA全部正确');

  stage = 'sources';
  const linkedCard = imported.cards.find(card => card.source?.quote && imported.nodes.some(node => node.cardId === card.id));
  assert.ok(linkedCard); await openSource(linkedCard, imported);
  const sourceMarker = await page.locator('.source-focus').first().boundingBox();
  const sourceHighlight = await page.locator('.annotation-highlight').first().boundingBox();
  assert.ok(sourceMarker && sourceHighlight);
  assert.ok(Math.abs(sourceMarker.x - sourceHighlight.x) <= 2.1 && Math.abs(sourceMarker.y - sourceHighlight.y) <= 2.1, 'Source marker and original highlight coincide in the actual Android viewport');
  await screenshot('card-source');
  await tab('脑图');
  await page.getByRole('button', { name: '适应脑图画布', exact: true }).click();
  const node = imported.nodes.find(item => item.cardId === linkedCard.id);
  await page.locator(`[data-mind-node="${node.id}"]`).click();
  await page.getByRole('button', { name: '返回选中节点原文', exact: true }).click();
  await readerReady(); await check(page.locator('.source-focus')).toHaveCount(linkedCard.source.rects.length);
  await check(page.locator('.reader-title strong')).toHaveText(imported.documents.find(document => document.id === linkedCard.source.documentId).name);
  await check(page.getByLabel('跳转页码', { exact: true })).toHaveValue(String(linkedCard.source.page));
  await screenshot('mind-source');
  pass('卡片及脑图均返回相应原文页与定位区域');
  stage = 'clipboard'; await clipboardCopy(linkedCard, imported);

  stage = 'annotations';
  const imageCard = imported.cards.find(card => card.imageAssetId && card.source);
  assert.ok(imageCard); await openSource(imageCard, imported);
  // The archival source is a genuine scanned manuscript. Page 4 also carries
  // low-quality text embedded by its publisher; this app does not perform OCR.
  const embeddedTextSpans = await page.locator('.textLayer span').count();
  report.scan = await page.locator('.pdf-page canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let darkPixels = 0; for (let index = 0; index < pixels.length; index += 4) if (pixels[index] + pixels[index + 1] + pixels[index + 2] < 600) darkPixels++;
    return { width: canvas.width, height: canvas.height, darkPixels };
  });
  report.scan.embeddedTextSpans = embeddedTextSpans;
  assert.ok(report.scan.darkPixels > 1000, 'The known nonblank archival scan actually rendered pixels');
  await page.getByRole('button', { name: '区域摘录', exact: true }).click();
  let box = await visibleRegion();
  await gesture('touch', [{ x: box.x + box.width * .1, y: box.y + box.height * .2 }, { x: box.x + box.width * .75, y: box.y + box.height * .6 }]);
  await check(page.getByRole('dialog', { name: '新建卡片', exact: true })).toBeVisible();
  await page.getByLabel('卡片标题', { exact: true }).fill(`Android${label}区域摘录`);
  await page.getByRole('button', { name: '保存卡片', exact: true }).click(); await saved();
  assert.ok(activeSubset(snapshot()).cards.some(card => card.title === `Android${label}区域摘录` && card.imageAssetId && card.source));
  await tab('阅读'); await page.getByRole('button', { name: '手写笔', exact: true }).click();
  await page.getByLabel('仅触控笔', { exact: true }).uncheck();
  box = await visibleRegion();
  const line = Array.from({ length: 9 }, (_, i) => ({ x: box.x + 20 + i * Math.min(9, box.width / 14), y: box.y + 35 + i * 4 }));
  const before = activeSubset(snapshot()).annotations.length;
  await gesture('touch', line); await check.poll(() => activeSubset(snapshot()).annotations.length).toBe(before + 1);
  await page.getByLabel('仅触控笔', { exact: true }).check();
  await gesture('touch', line); assert.equal(activeSubset(snapshot()).annotations.length, before + 1);
  // Finger pans in pen-only mode; compute new visible positions before injecting pen input.
  box = await visibleRegion();
  const penLine = Array.from({ length: 9 }, (_, i) => ({ x: box.x + 25 + i * Math.min(8, box.width / 15), y: box.y + 70 + i * 3 }));
  await gesture('pen', penLine); await check.poll(() => activeSubset(snapshot()).annotations.length).toBe(before + 2);
  const ink = activeSubset(snapshot()).annotations.at(-1);
  assert.equal(ink.kind, 'ink'); assert.ok(ink.points.length >= 5); assert.ok(ink.points.some(point => point.pressure > .6));
  await page.getByRole('button', { name: '撤销批注', exact: true }).click(); await saved();
  assert.equal(activeSubset(snapshot()).annotations.length, before + 1);
  const fingerInk = activeSubset(snapshot()).annotations.at(-1);
  const fingerPath = page.locator(`[data-annotation="${fingerInk.id}"]`);
  const fingerBox = await fingerPath.boundingBox(); assert.ok(fingerBox);
  await page.getByRole('button', { name: '橡皮', exact: true }).click();
  await page.mouse.click(fingerBox.x + fingerBox.width / 2, fingerBox.y + fingerBox.height / 2); await saved();
  assert.ok(!activeSubset(snapshot()).annotations.some(annotation => annotation.id === fingerInk.id));
  await page.getByRole('button', { name: '撤销批注', exact: true }).click(); await saved();
  assert.ok(activeSubset(snapshot()).annotations.some(annotation => annotation.id === fingerInk.id));
  await page.getByRole('button', { name: '放大', exact: true }).click(); await readerReady();
  await page.getByRole('button', { name: '旋转页面', exact: true }).click(); await readerReady();
  await scanPixels('zoom120-rotation90');
  assert.deepEqual(activeSubset(snapshot()).annotations.find(annotation => annotation.id === fingerInk.id).points, fingerInk.points);
  await check(fingerPath).toBeVisible();
  await screenshot('finger-ink-after-undo');
  pass('扫描PDF触摸区域截图保存成带来源图片卡；手指手写、仅笔模式忽略手指、模拟pen压力输入、橡皮及撤销真实落盘，缩放旋转后坐标保留');

  stage = 'layouts';
  await page.getByRole('button', { name: '浏览', exact: true }).click();
  await orientation(0, 'portrait'); await orientation(1, 'landscape'); await orientation(0, 'portrait-restored');
  pass('实际Android设备横竖屏布局切换，PDF与批注重新渲染，无整页横向溢出', report.layouts);

  stage = 'review'; await tab('复习');
  if (await page.getByRole('button', { name: '练习全部卡片', exact: true }).isVisible()) await page.getByRole('button', { name: '练习全部卡片', exact: true }).click();
  const logsBefore = activeSubset(snapshot()).reviewLogs.length;
  await page.getByRole('button', { name: '显示答案', exact: true }).click();
  await page.getByRole('button', { name: /^已掌握/ }).click(); await saved();
  await check.poll(() => activeSubset(snapshot()).reviewLogs.length).toBe(logsBefore + 1);
  await screenshot('review'); pass('实际Android完成显示答案、掌握反馈、下次安排及原生复习记录保存');

  stage = 'restart';
  await restartCurrent();

  stage = 'native-export'; await nativeExport();
  }
  assert.deepEqual(report.errors, []); report.completed = true;
} catch (error) {
  report.failure = { stage, message: error.message, stack: error.stack };
  console.error(`FAIL ${stage}: ${error.stack}`);
  if (device) await screenshot(`failed-${stage}`, true).catch(() => {});
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  if (device) {
    const rawLog = adbText('logcat', '-d', '-t', '1500');
    const sanitizedLog = rawLog.replace(/[A-Za-z0-9+/]{180,}={0,2}/g, text => `[base64 payload omitted: ${text.length} characters]`);
    await writeFile(path.join(reportDir, 'logcat.txt'), sanitizedLog).catch(() => {});
    await Promise.race([device.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  const reportFile = path.join(reportDir, mode === 'full' ? 'result.json' : `${mode}-result.json`);
  await writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(`Android report: ${reportFile}`);
}
// The experimental Android driver can retain its ADB instrumentation socket after close.
// All reports above are awaited; end this dedicated test CLI without leaving a stale controller.
process.exit(process.exitCode || 0);
