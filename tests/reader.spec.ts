import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { unzipSync } from 'fflate';
import type { State } from '../src/core/model';

const fixtures = path.resolve('tests/fixtures');
const reportDirectory = path.resolve('reports');
const scanFile = process.env.MOJING_SCAN_PDF || path.join(fixtures, '纯位图扫描模拟.pdf');
const scanName = path.basename(scanFile, '.pdf');
const scanIsGenerated = scanName === '纯位图扫描模拟' || scanName === 'scan';
const scanSourcePage = scanIsGenerated ? 1 : 4;
const scanProgressPage = scanIsGenerated ? 2 : 5;
const renderObservations: { document: string; page: string; readyMilliseconds: number; nonWhiteSamples: number; samples: number }[] = [];
let attemptDiagnostics: { kind: string; message: string; at: string }[] = [];
let attemptStarted = 0;

test.afterEach(async ({}, info) => {
  if (!info.title.startsWith('真实PDF阅读')) return;
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(path.join(reportDirectory, 'reader-last-attempt.json'), JSON.stringify({ title: info.title, status: info.status, executedAt: new Date().toISOString(), durationMilliseconds: Date.now() - attemptStarted, errors: info.errors.map(e => e.message), renderObservations, diagnostics: attemptDiagnostics }, null, 2));
});

async function savedState(page: Page): Promise<State> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('mojing-files', 1); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const read = (name: string) => new Promise<any>(resolve => { const req = db.transaction('files').objectStore('files').get(name); req.onsuccess = () => { try { resolve(req.result ? JSON.parse(new TextDecoder().decode(new Uint8Array(req.result))) : null); } catch { resolve(null); } }; req.onerror = () => resolve(null); });
    const values = await Promise.all([read('snapshot-a.json'), read('snapshot-b.json')]); db.close();
    return values.filter(Boolean).sort((a, b) => b.revision - a.revision)[0]?.state;
  });
}
async function saved(page: Page) { await expect(page.locator('.save-state')).toContainText('已保存到本机'); }
async function ready(page: Page) {
  const started = Date.now();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator('.loading')).toHaveCount(0);
  await expect.poll(async () => page.locator('.pdf-page').evaluate(e => (e as HTMLElement).clientWidth)).toBeGreaterThan(100);
  await expect(page.locator('.pdf-page canvas')).toBeVisible();
  const targetPage = await page.getByLabel('跳转页码', { exact: true }).inputValue();
  await expect(page.locator('.pdf-page canvas')).toHaveAttribute('data-rendered-page', targetPage, { timeout: 90_000 });
  await expect(page.locator('.render-badge')).toHaveCount(0, { timeout: 90_000 });
  await expect(page.locator('.error-box')).toHaveCount(0);
  await expect.poll(async () => page.locator('.pdf-page canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(100);
  const pixels = await page.locator('.pdf-page canvas').evaluate((c: HTMLCanvasElement) => {
    const bytes = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let nonWhiteSamples = 0, samples = 0;
    for (let i = 0; i < bytes.length; i += 16) { samples++; if (bytes[i + 3] > 240 && Math.min(bytes[i], bytes[i + 1], bytes[i + 2]) < 245) nonWhiteSamples++; }
    return { nonWhiteSamples, samples };
  });
  expect(pixels.nonWhiteSamples).toBeGreaterThan(10); // A resolved render promise alone can still hide failed image decoding.
  renderObservations.push({ document: await page.locator('.reader-title strong').innerText(), page: targetPage, readyMilliseconds: Date.now() - started, ...pixels });
}
async function selectSentence(page: Page) {
  await page.getByRole('button', { name: '选字', exact: true }).click();
  const sentence = page.locator('.textLayer span').filter({ hasText: /^Learning begins with observation\.$/ }).first();
  await expect(sentence).toBeVisible(); await sentence.scrollIntoViewIfNeeded();
  const box = (await sentence.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height * .55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height * .55, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('.selection-actions')).toBeVisible();
  await expect(page.locator('.selection-actions')).toContainText('Learning begins with observation');
}
async function saveCard(page: Page, title: string, body?: string) {
  const dialog = page.getByRole('dialog', { name: '新建卡片', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('卡片标题', { exact: true }).fill(title);
  if (body !== undefined) await dialog.getByLabel('卡片正文', { exact: true }).fill(body);
  await dialog.getByRole('button', { name: '保存卡片', exact: true }).click(); await saved(page);
}
async function draw(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.locator('.pdf-page').boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]); await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 18 }); await page.mouse.up();
}

test('真实PDF阅读、选字高亮、截图、手写、来源坐标及重启持久化', async ({ page, browser }) => {
  test.setTimeout(600_000);
  attemptStarted = Date.now();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  attemptDiagnostics = [];
  const diagnostics = attemptDiagnostics;
  renderObservations.length = 0;
  page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') diagnostics.push({ kind: message.type(), message: message.text(), at: new Date().toISOString() }); });
  page.on('response', response => { if (/\.wasm(?:\?|$)/.test(response.url())) diagnostics.push({ kind: 'wasm-response', message: `${response.status()} ${response.url()}`, at: new Date().toISOString() }); });
  page.on('requestfailed', request => diagnostics.push({ kind: 'request-failed', message: `${request.url()} ${request.failure()?.errorText}`, at: new Date().toISOString() }));
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await mkdir(reportDirectory, { recursive: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' }); await expect(page.getByRole('heading', { name: '把读过的，变成自己的' })).toBeVisible();
  await page.locator('.welcome').getByRole('button', { name: '创建学习集', exact: true }).click();
  const setDialog = page.getByRole('dialog', { name: '创建学习集', exact: true });
  await setDialog.getByLabel('名称', { exact: true }).fill('验收·中文学习集'); await setDialog.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.locator('.breadcrumb strong')).toHaveText('验收·中文学习集');
  await page.getByTestId('pdf-input').setInputFiles([path.join(fixtures, '含文字层的学习资料.pdf'), scanFile]);
  await expect(page.locator('.busy-overlay')).toHaveCount(0); await ready(page); await saved(page);
  await expect(page.locator('.doc-entry')).toHaveCount(2);
  if (!scanIsGenerated) { await page.getByLabel('跳转页码', { exact: true }).fill(String(scanSourcePage)); await page.getByLabel('跳转页码', { exact: true }).press('Enter'); await ready(page); }
  if (scanIsGenerated) await expect(page.locator('.textLayer span')).toHaveCount(0);

  await page.locator('.doc-entry').filter({ hasText: '含文字层的学习资料' }).click(); await ready(page);
  await expect(page.locator('.textLayer')).toContainText('Learning begins with observation.');
  await selectSentence(page); await page.getByRole('button', { name: '复制', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Learning begins with observation');
  await page.getByRole('button', { name: '高亮', exact: true }).click();
  await expect(page.locator('.annotation-highlight')).toHaveCount(1); await saved(page);
  await selectSentence(page); await page.getByRole('button', { name: '摘录卡片', exact: true }).click();
  await saveCard(page, '01 观察与证据');
  const textCard = page.locator('.knowledge-card').filter({ hasText: '01 观察与证据' });
  await expect(textCard).toContainText('Learning begins with observation');

  await page.getByLabel('搜索 PDF 文字', { exact: true }).fill('chapter3evidence');
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await expect(page.getByLabel('跳转页码', { exact: true })).toHaveValue('3'); await ready(page);
  await expect(page.locator('.textLayer')).toContainText('chapter3evidence');
  await textCard.getByTitle('返回原文定位', { exact: true }).click();
  await expect(page.getByLabel('跳转页码', { exact: true })).toHaveValue('1'); await ready(page);
  await expect(page.locator('.source-focus')).toHaveCount(1);

  const beforeTransform = await savedState(page), source = beforeTransform.cards[0].source!;
  const originalRect = source.rects[0];
  await page.getByRole('button', { name: '旋转页面', exact: true }).click(); await ready(page);
  await page.getByRole('button', { name: '放大', exact: true }).click(); await ready(page);
  await page.setViewportSize({ width: 1280, height: 920 }); await ready(page);
  await textCard.getByTitle('返回原文定位', { exact: true }).click(); await ready(page);
  await expect(page.locator('.source-focus')).toHaveCount(1);
  // Highlight and returned-source geometry derive independently from persisted PDF coordinates.
  const h = await page.locator('.annotation-highlight').boundingBox(), f = await page.locator('.source-focus').boundingBox();
  expect(h).not.toBeNull(); expect(f).not.toBeNull();
  // The source marker has a 2px outline, unlike the filled highlight.
  expect(Math.abs(h!.x - f!.x)).toBeLessThanOrEqual(1.1); expect(Math.abs(h!.y - f!.y)).toBeLessThanOrEqual(1.1);
  expect(Math.abs(h!.width - f!.width)).toBeLessThanOrEqual(2.1); expect(Math.abs(h!.height - f!.height)).toBeLessThanOrEqual(2.1);
  const actualText = (await page.locator('.textLayer span').filter({ hasText: /^Learning begins with observation\.$/ }).first().boundingBox())!;
  const intersection = Math.max(0, Math.min(h!.x + h!.width, actualText.x + actualText.width) - Math.max(h!.x, actualText.x)) * Math.max(0, Math.min(h!.y + h!.height, actualText.y + actualText.height) - Math.max(h!.y, actualText.y));
  expect(intersection / (actualText.width * actualText.height)).toBeGreaterThan(.8);
  await page.mouse.move(actualText.x + actualText.width / 2, actualText.y + 1); await page.mouse.down();
  await page.mouse.move(actualText.x + actualText.width / 2, actualText.y + actualText.height - 1, { steps: 20 }); await page.mouse.up();
  await expect(page.locator('.selection-actions')).toContainText('Learning begins with observation');
  await page.getByRole('button', { name: '高亮', exact: true }).click(); await expect(page.locator('.annotation-highlight')).toHaveCount(2);
  await page.getByRole('button', { name: '撤销批注', exact: true }).click(); await expect(page.locator('.annotation-highlight')).toHaveCount(1);
  expect((await savedState(page)).cards[0].source?.rects[0]).toEqual(originalRect);
  await page.screenshot({ path: path.join(reportDirectory, 'reader-rotated-source.png'), fullPage: true });

  // Return to a fit-width, unrotated image-only page for pen and crop input.
  await page.locator('.doc-entry').filter({ hasText: scanName }).click(); await ready(page);
  await page.getByRole('button', { name: '手写笔', exact: true }).click();
  await draw(page, [70, 130], [240, 180]); await expect(page.locator('.annotation-layer polyline')).toHaveCount(1);
  await page.getByRole('button', { name: '撤销批注', exact: true }).click(); await expect(page.locator('.annotation-layer polyline')).toHaveCount(0);
  await draw(page, [70, 130], [240, 180]); await expect(page.locator('.annotation-layer polyline')).toHaveCount(1);
  await page.getByRole('button', { name: '橡皮', exact: true }).click();
  const scanBox = (await page.locator('.pdf-page').boundingBox())!;
  await page.mouse.click(scanBox.x + 70, scanBox.y + 130); await expect(page.locator('.annotation-layer polyline')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销批注', exact: true }).click(); await expect(page.locator('.annotation-layer polyline')).toHaveCount(1);
  await page.getByRole('button', { name: '区域摘录', exact: true }).click(); await draw(page, [40, 70], [360, 260]);
  await saveCard(page, '02 扫描图像摘录');
  await expect(page.locator('.knowledge-card').filter({ hasText: '02 扫描图像摘录' }).getByAltText('原文区域摘录')).toBeVisible();
  const state = await savedState(page);
  expect(state.documents).toHaveLength(2); expect(state.cards).toHaveLength(2); expect(state.annotations).toHaveLength(2);
  expect(state.cards[1].imageAssetId).toBeTruthy(); expect(state.cards[1].source?.rects).toHaveLength(1);
  await page.screenshot({ path: path.join(reportDirectory, 'reader-scan-ink-cards.png'), fullPage: true });

  await page.getByLabel('跳转页码', { exact: true }).fill(String(scanProgressPage)); await page.getByLabel('跳转页码', { exact: true }).press('Enter'); await ready(page); await saved(page);
  await page.reload(); await ready(page); await saved(page);
  await expect(page.getByLabel('跳转页码', { exact: true })).toHaveValue(String(scanProgressPage));
  await expect(page.locator('.knowledge-card')).toHaveCount(2);
  await page.locator('.knowledge-card').filter({ hasText: '02 扫描图像摘录' }).getByTitle('返回原文定位', { exact: true }).click(); await ready(page);
  await expect(page.getByLabel('跳转页码', { exact: true })).toHaveValue(String(scanSourcePage)); await expect(page.locator('.annotation-layer polyline')).toHaveCount(1);
  await expect(page.locator('.source-focus')).toHaveCount(1);
  // Build the entire acceptance data set through the user interface.
  for (let n = 3; n <= 20; n++) {
    await page.getByRole('region', { name: '知识卡片', exact: true }).getByRole('button', { name: '新建卡片', exact: true }).click();
    await saveCard(page, `${String(n).padStart(2, '0')} 学习概念`, `第 ${n} 张知识卡片：把观察、联结与主动回忆结合，回到原文核对证据。`);
  }
  await expect(page.locator('.knowledge-card')).toHaveCount(20);
  await page.locator('.knowledge-card').filter({ hasText: '01 观察与证据' }).getByRole('button', { name: '加入脑图', exact: true }).click();
  await page.getByRole('tab', { name: '脑图', exact: true }).click();
  const map = page.getByRole('region', { name: '思维导图', exact: true });
  await map.getByRole('group', { name: '脑图节点 01 观察与证据', exact: true }).click();
  await map.getByRole('button', { name: '子节点', exact: true }).click();
  await page.locator('.mind-picker-list').getByRole('button').filter({ hasText: '02 扫描图像摘录' }).click();
  await map.getByRole('button', { name: '子节点', exact: true }).click();
  await page.locator('.mind-picker-list').getByRole('button').filter({ hasText: '03 学习概念' }).click();
  for (let n = 4; n <= 20; n++) {
    await map.getByRole('button', { name: '同级', exact: true }).click();
    await page.locator('.mind-picker-list').getByRole('button').filter({ hasText: `${String(n).padStart(2, '0')} 学习概念` }).click();
  }
  await expect(map.locator('.mind-node')).toHaveCount(20); await map.getByRole('button', { name: '适应脑图画布', exact: true }).click();
  await saved(page);
  const organized = await savedState(page);
  const node0 = organized.nodes.find(n => n.cardId === organized.cards[0].id)!, node1 = organized.nodes.find(n => n.cardId === organized.cards[1].id)!;
  expect(node0.parentId).toBeNull(); expect(node1.parentId).toBe(node0.id); expect(organized.nodes.filter(n => n.parentId === node1.id)).toHaveLength(18);
  await page.screenshot({ path: path.join(reportDirectory, 'reader-20-card-three-level-map.png'), fullPage: true });
  await map.getByRole('button', { name: '返回原文 01 观察与证据', exact: true }).click(); await ready(page);
  await expect(page.locator('.reader-title strong')).toHaveText('含文字层的学习资料'); await expect(page.getByLabel('跳转页码', { exact: true })).toHaveValue('1');
  await expect(page.locator('.source-focus')).toHaveCount(1);

  await page.getByRole('tab', { name: /^卡片/ }).click();
  await page.locator('.knowledge-card').filter({ hasText: '01 观察与证据' }).getByRole('button', { name: '加入复习', exact: true }).click();
  const questionDialog = page.getByRole('dialog', { name: '设置复习问题', exact: true });
  await questionDialog.getByRole('textbox', { name: '问题', exact: true }).fill('学习从什么开始？请回忆并核对来源。');
  await questionDialog.getByRole('button', { name: '保存问题', exact: true }).click();
  await page.getByRole('tab', { name: '复习', exact: true }).click();
  await page.getByRole('button', { name: '显示答案', exact: true }).click(); await expect(page.locator('.review-answer')).toContainText('Learning begins with observation');
  await page.getByRole('button', { name: /^已掌握/ }).click();
  await expect(page.getByRole('heading', { name: '这一轮已完成', exact: true })).toBeVisible(); await saved(page);
  await page.reload(); await ready(page); await saved(page);
  expect((await savedState(page)).reviewLogs).toHaveLength(1);
  await page.getByRole('tab', { name: '脑图', exact: true }).click(); await expect(page.locator('.mind-node')).toHaveCount(20);
  await page.getByRole('region', { name: '思维导图', exact: true }).getByRole('button', { name: '适应脑图画布', exact: true }).click();
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '备份当前学习集', exact: true }).click();
  const download = await downloadPromise; await download.saveAs(path.join(reportDirectory, 'acceptance.mjstudy'));
  const archive = unzipSync(new Uint8Array(await readFile(path.join(reportDirectory, 'acceptance.mjstudy'))));
  const packageState: State = JSON.parse(new TextDecoder().decode(archive['study.json']));
  expect(packageState.cards).toHaveLength(20); expect(packageState.nodes).toHaveLength(20); expect(packageState.reviewLogs).toHaveLength(1); expect(packageState.documents).toHaveLength(2); expect(packageState.annotations).toHaveLength(2);

  // Import into a fresh independent browser context, then repeat to verify conflict handling.
  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const other = await otherContext.newPage(); await other.goto('/', { waitUntil: 'domcontentloaded' });
  await other.getByTestId('backup-input').setInputFiles(path.join(reportDirectory, 'acceptance.mjstudy'));
  await expect(other.locator('.busy-overlay')).toHaveCount(0); await ready(other); await saved(other);
  await expect(other.locator('.knowledge-card')).toHaveCount(20);
  const imported = await savedState(other);
  expect(imported.cards[0].id).not.toBe(packageState.cards[0].id); expect(imported.cards[0].source?.rects).toEqual(packageState.cards[0].source?.rects);
  expect(imported.nodes).toHaveLength(20); expect(imported.annotations).toHaveLength(2); expect(imported.reviewLogs).toHaveLength(1);
  expect(imported.documents.map(d => ({ name: d.name, progress: d.progress }))).toEqual(packageState.documents.map(d => ({ name: d.name, progress: d.progress })));
  const importedRoot = imported.nodes.find(n => n.cardId === imported.cards[0].id)!, importedChild = imported.nodes.find(n => n.cardId === imported.cards[1].id)!;
  expect(importedChild.parentId).toBe(importedRoot.id); expect(imported.nodes.filter(n => n.parentId === importedChild.id)).toHaveLength(18);
  await other.locator('.knowledge-card').filter({ hasText: '02 扫描图像摘录' }).getByTitle('返回原文定位', { exact: true }).click(); await ready(other);
  await expect(other.getByLabel('跳转页码', { exact: true })).toHaveValue(String(scanSourcePage));
  await expect(other.locator('.source-focus')).toHaveCount(1); await expect(other.locator('.annotation-layer polyline')).toHaveCount(1);
  await other.getByTestId('backup-input').setInputFiles(path.join(reportDirectory, 'acceptance.mjstudy'));
  await expect(other.locator('.busy-overlay')).toHaveCount(0); await saved(other);
  expect((await savedState(other)).sets).toHaveLength(2); expect((await savedState(other)).cards).toHaveLength(40);
  await otherContext.close();
  expect(errors).toEqual([]);
  await writeFile(path.join(reportDirectory, 'reader-evidence.json'), JSON.stringify({
    executedAt: new Date().toISOString(), environment: 'Chrome headless, Windows host, local Vite app + IndexedDB adapter',
    fixtures: ['含文字层的学习资料.pdf: 3 pages, generated selectable text', `${path.basename(scanFile)}: ${scanIsGenerated ? '2 pages, generated raster-only scan simulation' : 'actual external archival scan'}`],
    passed: ['中文命名学习集创建及两PDF导入', '真实鼠标拖选文字、高亮及文字卡片', 'PDF跨页文字搜索', '卡片返回来源页及区域', '旋转90度+缩放+窗口变化后高亮/来源像素对齐', '手写、撤销、橡皮及撤销恢复', '扫描PDF区域截图生成带图片/来源卡片', '重新加载应用恢复阅读页/卡片/批注/来源', 'UI创建20张卡片及20节点三级脑图', '脑图来源返回原文', '问答复习反馈、计划及记录重启恢复', '真实UI完整包导出及全新独立浏览器存储导入', '重复导入创建副本并保持原数据'],
    metrics: { documents: packageState.documents.length, cards: packageState.cards.length, annotations: packageState.annotations.length, nodes: packageState.nodes.length, reviewLogs: packageState.reviewLogs.length, sourceRectUnchanged: originalRect },
    limitations: ['This test uses browser storage, not the native Android or Electron storage adapter.', ...(scanIsGenerated ? ['Raster scan fixture is generated.'] : []), 'Physical stylus hardware is not tested.'], renderObservations, diagnostics, errors,
  }, null, 2));
});

test('纯位图扫描模拟文件无文字层仍可截图建卡并返回区域', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('pdf-input').setInputFiles(path.join(fixtures, 'scan.pdf')); await expect(page.locator('.busy-overlay')).toHaveCount(0); await ready(page);
  await expect(page.locator('.textLayer span')).toHaveCount(0);
  await page.getByRole('button', { name: '区域摘录', exact: true }).click(); await draw(page, [40, 70], [360, 260]); await saveCard(page, '无文字层图像卡片');
  await expect(page.locator('.knowledge-card').getByAltText('原文区域摘录')).toBeVisible();
  await page.getByRole('button', { name: '下一页', exact: true }).click(); await ready(page);
  await page.locator('.knowledge-card').getByTitle('返回原文定位', { exact: true }).click(); await ready(page);
  await expect(page.getByLabel('跳转页码', { exact: true })).toHaveValue('1'); await expect(page.locator('.source-focus')).toHaveCount(1);
  await mkdir(reportDirectory, { recursive: true }); await page.screenshot({ path: path.join(reportDirectory, 'reader-no-text-layer-crop.png'), fullPage: true });
});

test('官方外部PDF真实文件渲染、搜索与进度恢复', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('pdf-input').setInputFiles(path.join(fixtures, 'tracemonkey.pdf'));
  await expect(page.locator('.busy-overlay')).toHaveCount(0); await ready(page);
  await expect(page.locator('.page-total')).toHaveText('14 页');
  await expect(page.locator('.textLayer')).toContainText('Trace-based Just-in-Time');
  await page.getByLabel('搜索 PDF 文字', { exact: true }).fill('JavaScript'); await page.getByRole('button', { name: '查找', exact: true }).click();
  await expect(page.getByLabel('搜索结果', { exact: true })).toBeVisible();
  await page.getByLabel('跳转页码', { exact: true }).fill('4'); await page.getByLabel('跳转页码', { exact: true }).press('Enter'); await ready(page); await saved(page);
  await page.reload(); await ready(page); await expect(page.getByLabel('跳转页码', { exact: true })).toHaveValue('4');
  await mkdir(reportDirectory, { recursive: true }); await page.screenshot({ path: path.join(reportDirectory, 'reader-external-pdf.png'), fullPage: true });
});

test('真实档案扫描第4页渲染压力与可见像素', async ({ page }) => {
  test.skip(!existsSync(path.join(fixtures, 'archival-scan.pdf')), '需单独下载并校验 Smithsonian 真实馆藏扫描');
  test.setTimeout(180_000);
  const diagnostics: string[] = [], errors: string[] = [];
  let completed = false, page4Milliseconds: number | null = null, started = 0;
  page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') diagnostics.push(`${message.type()}: ${message.text()}`); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (/\.wasm(?:\?|$)/.test(response.url())) diagnostics.push(`WASM ${response.status()} ${response.url()}`); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('pdf-input').setInputFiles(path.join(fixtures, 'archival-scan.pdf'));
    await expect(page.locator('.busy-overlay')).toHaveCount(0, { timeout: 60_000 }); await ready(page);
    await expect(page.locator('.page-total')).toHaveText('16 页');
    started = Date.now(); await page.getByLabel('跳转页码', { exact: true }).fill('4'); await page.getByLabel('跳转页码', { exact: true }).press('Enter'); await ready(page);
    page4Milliseconds = Date.now() - started;
    await mkdir(reportDirectory, { recursive: true }); await page.screenshot({ path: path.join(reportDirectory, 'reader-archival-stress-page4.png'), fullPage: true });
    expect(errors).toEqual([]); completed = true;
  } finally {
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(path.join(reportDirectory, 'reader-archival-stress.json'), JSON.stringify({ executedAt: new Date().toISOString(), completed, page4Milliseconds: page4Milliseconds ?? (started ? Date.now() - started : null), source: 'Smithsonian letter00mace / archival-scan.pdf, SHA256 c5eb1115c7fec4927f798051d157e6c58146b883b817aa22f4b1a875a0c39c66', page4Dictionary: { widthPt: 2201.04, heightPt: 1440, imageCount: 2, imageWidth: 9171, imageHeight: 6000, filter: 'JPXDecode', note: 'PDF.js reports decoded image dimensions can differ from image dictionary.' }, renderObservations, diagnostics, errors }, null, 2));
  }
});
