import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { Card, State } from '../src/core/model';

const executable = path.resolve(process.env.MOJING_WINDOWS_EXE || 'release/墨径-Windows-x64/墨径.exe');
const acceptanceFile = path.resolve(process.env.MOJING_ACCEPTANCE_FILE || 'reports/acceptance.mjstudy');
const reports = path.resolve('reports');
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

async function nativeState(dataDirectory: string): Promise<State> {
  const candidates = await Promise.all(['snapshot-a.json', 'snapshot-b.json'].map(async name => {
    try {
      const envelope = JSON.parse(await readFile(path.join(dataDirectory, 'workspace', name), 'utf8'));
      if (envelope.format !== 'mojing.snapshot' || digest(JSON.stringify(envelope.state)) !== envelope.sha256 || envelope.state.revision !== envelope.revision) return null;
      return envelope.state as State;
    } catch { return null; }
  }));
  const valid = candidates.filter((value): value is State => !!value).sort((a, b) => b.revision - a.revision);
  if (!valid.length) throw new Error('尚未找到有效的原生文件快照');
  return valid[0];
}
async function saved(page: Page) { await expect(page.locator('.save-state')).toContainText('已保存到本机'); await expect(page.locator('.save-error')).toHaveCount(0); }
async function readerReady(page: Page, expectedPage?: number) {
  await expect(page.locator('.pdf-page canvas')).toBeVisible();
  const targetPage = expectedPage === undefined ? await page.getByLabel('跳转页码', { exact: true }).inputValue() : String(expectedPage);
  await expect(page.locator('.pdf-page canvas')).toHaveAttribute('data-rendered-page', targetPage, { timeout: 60000 });
  await expect(page.locator('.pdf-page canvas')).toHaveAttribute('data-render-state', 'ready');
  await expect(page.locator('.render-badge')).toHaveCount(0);
  await expect(page.locator('.error-box')).toHaveCount(0);
  await expect.poll(() => page.locator('.pdf-page canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(100);
}
function maximumDepth(state: State) {
  const depth = (id: string, visited = new Set<string>()): number => {
    if (visited.has(id)) throw new Error('脑图循环');
    visited.add(id);
    const node = state.nodes.find(item => item.id === id)!;
    return node.parentId ? depth(node.parentId, visited) + 1 : 1;
  };
  return Math.max(0, ...state.nodes.map(node => depth(node.id)));
}
function semantics(state: State) {
  const documentHash = (id: string) => state.documents.find(doc => doc.id === id)!.assetId;
  const cardTitle = (id: string) => state.cards.find(card => card.id === id)!.title;
  const sorted = <T>(items: T[]) => items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    documents: sorted(state.documents.map(doc => ({ name: doc.name, assetId: doc.assetId, pageCount: doc.pageCount }))),
    cards: sorted(state.cards.map(card => ({ title: card.title, body: card.body, color: card.color, tags: card.tags, imageAssetId: card.imageAssetId || null, source: card.source ? { ...card.source, documentId: documentHash(card.source.documentId) } : null }))),
    nodes: sorted(state.nodes.map(node => ({ card: cardTitle(node.cardId), parent: node.parentId ? cardTitle(state.nodes.find(item => item.id === node.parentId)!.cardId) : null, order: node.order, collapsed: node.collapsed }))),
    annotations: sorted(state.annotations.map(({ id: _id, setId: _setId, documentId, ...annotation }) => ({ ...annotation, documentId: documentHash(documentId) }))),
    reviews: sorted(state.reviews.map(({ id: _id, setId: _setId, cardId, ...review }) => ({ ...review, card: cardTitle(cardId) }))),
    logs: sorted(state.reviewLogs.map(({ id: _id, setId: _setId, reviewId: _reviewId, cardId, ...log }) => ({ ...log, card: cardTitle(cardId) }))),
  };
}
async function resize(application: ElectronApplication, page: Page, width: number, height: number) {
  await application.evaluate(({ BrowserWindow }, size) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(size.width, size.height); window.focus(); }, { width, height });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThan(width - 45);
  if (await page.evaluate(() => innerWidth <= 1000) && !await page.locator('.sidebar').evaluate(element => element.classList.contains('open'))) {
    await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  }
  return { requested: { width, height }, actual: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })) };
}
async function chooseExportPath(application: ElectronApplication, target: string) {
  // Only the OS location picker is substituted; renderer export, IPC, filesystem
  // write, flush, rename and the resulting ZIP bytes remain production code.
  await application.evaluate(({ dialog }, filePath) => { Object.defineProperty(dialog, 'showSaveDialog', { configurable: true, value: async () => ({ canceled: false, filePath }) }); }, target);
}
async function cardSource(page: Page, card: Card, state: State) {
  await page.getByRole('tab', { name: /^卡片/ }).click();
  const article = page.locator('.knowledge-card').filter({ has: page.getByRole('button', { name: card.title, exact: true }) });
  await article.getByTitle('返回原文定位', { exact: true }).click();
  await expect(page.locator('.reader-title strong')).toHaveText(state.documents.find(doc => doc.id === card.source!.documentId)!.name);
  await expect(page.getByLabel('跳转页码', { exact: true })).toHaveValue(String(card.source!.page));
  await readerReady(page, card.source!.page);
  await expect(page.locator('.source-focus')).toHaveCount(card.source!.rects.length);
}

test('打包Windows程序：原生文件、来源定位、复习、IPC导出、窗口调整与关闭重开', async ({}, testInfo) => {
  test.setTimeout(300000);
  test.skip(!existsSync(executable), `Windows打包程序不存在：${executable}；尚未运行目标平台验收。`);
  test.skip(!existsSync(acceptanceFile), `真实UI的20卡验收学习集不存在：${acceptanceFile}；等待reader验收产物。`);
  await mkdir(reports, { recursive: true });
  const dataDirectory = path.resolve('.test-data', `Windows原生验收-中文目录-${Date.now()}`);
  await mkdir(dataDirectory, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.MOJING_DEV_URL;
  env.MOJING_DATA_DIR = dataDirectory;
  const originalArchive = unzipSync(new Uint8Array(await readFile(acceptanceFile)));
  const sourceState: State = JSON.parse(new TextDecoder().decode(originalArchive['study.json']));
  expect(sourceState.documents).toHaveLength(2); expect(sourceState.cards).toHaveLength(20); expect(sourceState.nodes).toHaveLength(20); expect(maximumDepth(sourceState)).toBeGreaterThanOrEqual(3); expect(sourceState.reviewLogs.length).toBeGreaterThanOrEqual(1);
  const errors: string[] = [];
  const consoleWarnings: string[] = [];
  const passed: string[] = [];
  const record = (description: string) => { passed.push(description); console.log(`[Windows native] ${description}`); };
  const windows: unknown[] = [];
  let application: ElectronApplication | undefined;
  let completed = false;
  let nativeInfo: unknown;
  let finalState: State | undefined;
  let primaryExportSha256 = '';
  let rendererUrl = '';
  let rendererEntry: { url: string; sha256: string } | undefined;
  let scanRender: { elapsedMilliseconds: number; width: number; height: number; darkPixels: number; textSpans: number } | undefined;
  try {
    application = await _electron.launch({ executablePath: executable, args: [], env, timeout: 60000 });
    let page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['warning', 'error'].includes(message.type()) || /^Warning:/.test(message.text())) consoleWarnings.push(message.text().slice(0, 600)); });
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: '把读过的，变成自己的', exact: true })).toBeVisible();
    rendererUrl = page.url();
    expect(rendererUrl).toMatch(/^file:\/\//);
    expect(rendererUrl).toContain('resources/app/dist/index.html');
    expect(await page.evaluate(() => window.mojing?.platform)).toBe('windows');
    const entry = await page.locator('script[type="module"]').getAttribute('src');
    expect(entry).toBeTruthy();
    const entryUrl = new URL(entry!, rendererUrl);
    const entryPath = decodeURIComponent(entryUrl.pathname).replace(/^\/([A-Za-z]:\/)/, '$1');
    rendererEntry = { url: entryUrl.href, sha256: digest(await readFile(entryPath)) };
    nativeInfo = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), executable: app.getPath('exe'), userData: app.getPath('userData'), versions: process.versions }));
    expect((nativeInfo as { packaged: boolean }).packaged).toBe(true);
    windows.push(await resize(application, page, 1440, 1000));
    record('从release目录启动已打包exe，file://资源、Windows preload和隔离中文数据目录均实际启用');

    await page.getByTestId('backup-input').setInputFiles(acceptanceFile);
    await expect(page.locator('.busy-overlay')).toHaveCount(0);
    await saved(page); await readerReady(page);
    await expect(page.locator('.doc-entry')).toHaveCount(2);
    await expect(page.locator('.knowledge-card')).toHaveCount(20);
    const imported = await nativeState(dataDirectory);
    expect(semantics(imported)).toEqual(semantics(sourceState));
    expect(imported.cards[0].id).not.toBe(sourceState.cards[0].id);
    for (const asset of imported.assets) {
      const bytes = await readFile(path.join(dataDirectory, 'workspace', asset.path));
      expect(bytes.byteLength).toBe(asset.size); expect(digest(bytes)).toBe(asset.sha256);
    }
    record('UI导入20卡/2PDF/三级脑图/批注/复习，原生快照与全部资产真实落盘且哈希正确，逻辑关系与来源区域保持');

    const linkedCard = imported.cards.find(card => card.source?.quote && imported.nodes.some(node => node.cardId === card.id))!;
    expect(linkedCard).toBeTruthy();
    await cardSource(page, linkedCard, imported);
    const marker = await page.locator('.source-focus').first().boundingBox();
    const highlight = await page.locator('.annotation-highlight').first().boundingBox();
    expect(marker).not.toBeNull(); expect(highlight).not.toBeNull();
    expect(Math.abs(marker!.x - highlight!.x)).toBeLessThanOrEqual(2.1); expect(Math.abs(marker!.y - highlight!.y)).toBeLessThanOrEqual(2.1);
    await page.screenshot({ path: path.join(reports, 'windows-card-source.png') });
    const imageCard = imported.cards.find(card => card.imageAssetId && card.source)!;
    expect(imageCard).toBeTruthy();
    const scanStarted = Date.now();
    await cardSource(page, imageCard, imported);
    // This real archival scan page has poor existing OCR. The screenshot workflow
    // deliberately uses the rendered image and does not depend on that text layer.
    const textSpans = await page.locator('.textLayer span').count();
    const scanPixels = await page.locator('.pdf-page canvas').evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let darkPixels = 0; for (let index = 0; index < pixels.length; index += 4) if (pixels[index] + pixels[index + 1] + pixels[index + 2] < 600) darkPixels++;
      return { width: canvas.width, height: canvas.height, darkPixels };
    });
    scanRender = { elapsedMilliseconds: Date.now() - scanStarted, ...scanPixels, textSpans };
    expect(scanPixels.darkPixels).toBeGreaterThan(1000); // Known nonblank archival fixture, not a generic PDF assumption.
    await expect(page.locator('.annotation-layer polyline')).toHaveCount(imported.annotations.filter(annotation => annotation.kind === 'ink' && annotation.documentId === imageCard.source!.documentId && annotation.page === imageCard.source!.page).length);
    await page.screenshot({ path: path.join(reports, 'windows-scan-source.png') });
    await cardSource(page, linkedCard, imported);
    await page.getByRole('tab', { name: '脑图', exact: true }).click();
    await expect(page.locator('.mind-node')).toHaveCount(20);
    await page.getByRole('button', { name: '适应脑图画布', exact: true }).click();
    const linkedNode = imported.nodes.find(node => node.cardId === linkedCard.id)!;
    await page.locator(`[data-mind-node="${linkedNode.id}"]`).click();
    await page.getByRole('button', { name: '返回选中节点原文', exact: true }).click();
    await readerReady(page);
    await expect(page.getByLabel('跳转页码', { exact: true })).toHaveValue(String(linkedCard.source!.page));
    await expect(page.locator('.source-focus')).toHaveCount(linkedCard.source!.rects.length);
    await page.screenshot({ path: path.join(reports, 'windows-three-level-map-source.png') });
    record('文字/真实扫描截图卡片与20节点脑图均返回正确来源文档/页码/区域，定位框与已保存高亮对齐，扫描页墨迹保留');

    // Use actual pointer selection and the renderer copy button; verify the OS clipboard
    // through Electron's native clipboard API and restore the previous text immediately.
    await page.getByRole('button', { name: '选字', exact: true }).click();
    const sentence = page.locator('.textLayer span').filter({ hasText: /^Learning begins with observation\.$/ }).first();
    await sentence.scrollIntoViewIfNeeded();
    const box = (await sentence.boundingBox())!;
    const vertical = box.height > box.width;
    await page.mouse.move(vertical ? box.x + box.width * .5 : box.x + 1, vertical ? box.y + 1 : box.y + box.height * .5);
    await page.mouse.down();
    await page.mouse.move(vertical ? box.x + box.width * .5 : box.x + box.width - 1, vertical ? box.y + box.height - 1 : box.y + box.height * .5, { steps: 20 });
    await page.mouse.up();
    await expect(page.locator('.selection-actions')).toContainText('Learning begins with observation');
    await application.evaluate(async ({ clipboard, ClipboardItem }) => {
      const scope = globalThis as typeof globalThis & { __mojingClipboardBeforeTest?: Awaited<ReturnType<typeof clipboard.read>> };
      scope.__mojingClipboardBeforeTest = await Promise.all((await clipboard.read()).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
    });
    try {
      await page.getByRole('button', { name: '复制', exact: true }).click();
      await expect.poll(() => application!.evaluate(({ clipboard }) => clipboard.readText())).toContain('Learning begins with observation');
    } finally {
      await application.evaluate(async ({ clipboard }) => {
        const scope = globalThis as typeof globalThis & { __mojingClipboardBeforeTest?: Awaited<ReturnType<typeof clipboard.read>> };
        if ((await clipboard.readText()).includes('Learning begins with observation') && scope.__mojingClipboardBeforeTest) {
          if (scope.__mojingClipboardBeforeTest.length) await clipboard.write(scope.__mojingClipboardBeforeTest);
          else clipboard.clear();
        }
        delete scope.__mojingClipboardBeforeTest;
      });
    }
    record('真实鼠标文字选择及复制按钮写入Windows系统剪贴板');

    await page.getByRole('button', { name: '浏览', exact: true }).click();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.keyboard.press('Control+o');
    await (await chooserPromise).setFiles(path.resolve('tests/fixtures/含文字层的学习资料.pdf'));
    await expect(page.locator('.busy-overlay')).toHaveCount(0); await saved(page); await readerReady(page);
    expect((await nativeState(dataDirectory)).documents).toHaveLength(2);
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: '新建卡片', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭卡片编辑器', exact: true }).click();
    const beforeSaveRevision = (await nativeState(dataDirectory)).revision;
    await page.keyboard.press('Control+s'); await saved(page);
    await expect.poll(async () => (await nativeState(dataDirectory)).revision).toBeGreaterThan(beforeSaveRevision);
    record('Ctrl+O真实PDF选择导入并去重，Ctrl+K打开编辑器，Ctrl+S提交原生快照');

    await page.getByRole('tab', { name: '复习', exact: true }).click();
    const practiceAll = page.getByRole('button', { name: '练习全部卡片', exact: true });
    if (await practiceAll.isVisible()) await practiceAll.click();
    await page.getByRole('button', { name: '显示答案', exact: true }).click();
    await expect(page.locator('.review-answer')).toContainText(linkedCard.body);
    await page.getByRole('button', { name: /^已掌握/ }).click(); await saved(page);
    await page.getByRole('navigation', { name: '复习页面' }).getByRole('button', { name: /^记录/ }).click();
    await expect(page.locator('.review-log')).toHaveCount(imported.reviewLogs.length + 1);
    record('Windows完成一次问答复习，掌握反馈和下一次时间写入原生文件');

    windows.push(await resize(application, page, 430, 800));
    await expect(page.getByRole('navigation', { name: '工作区页面' })).toBeVisible();
    await expect(page.locator('.review-log')).toHaveCount(imported.reviewLogs.length + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: path.join(reports, 'windows-phone-window-review.png') });
    windows.push(await resize(application, page, 1000, 900));
    await page.screenshot({ path: path.join(reports, 'windows-tablet-window-review.png') });
    windows.push(await resize(application, page, 1440, 1000));
    record('实际桌面窗口缩放到手机/平板/桌面空间，复习可操作且无页面横向溢出');

    // Save an edit and immediately close the real process. The production close handshake
    // must wait for pending filesystem persistence; no test-side storage writes occur.
    await page.getByRole('tab', { name: /^卡片/ }).click();
    const manualCard = imported.cards.find(card => !card.source)!;
    await page.getByRole('region', { name: '知识卡片', exact: true }).getByRole('button', { name: manualCard.title, exact: true }).click();
    const editedBody = `${manualCard.body}\nWindows 实际关闭保存验收。`;
    const editor = page.getByRole('dialog', { name: '编辑卡片', exact: true });
    await editor.getByLabel('卡片正文', { exact: true }).fill(editedBody);
    await editor.getByRole('button', { name: '保存卡片', exact: true }).click();
    await application.close(); application = undefined;
    const closed = await nativeState(dataDirectory);
    expect(closed.cards.find(card => card.id === manualCard.id)?.body).toBe(editedBody);
    application = await _electron.launch({ executablePath: executable, args: [], env, timeout: 60000 });
    page = await application.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['warning', 'error'].includes(message.type()) || /^Warning:/.test(message.text())) consoleWarnings.push(message.text().slice(0, 600)); });
    await page.waitForLoadState('domcontentloaded'); await saved(page); await readerReady(page);
    await expect(page.locator('.knowledge-card')).toHaveCount(20);
    await expect(page.getByRole('region', { name: '知识卡片', exact: true }).getByText(editedBody, { exact: true })).toBeVisible();
    const reopened = await nativeState(dataDirectory);
    expect(semantics(reopened)).toEqual(semantics(closed));
    expect(reopened.documents.map(doc => doc.progress)).toEqual(closed.documents.map(doc => doc.progress));
    await cardSource(page, linkedCard, reopened);
    await page.getByRole('tab', { name: '脑图', exact: true }).click();
    await expect(page.locator('.mind-node')).toHaveCount(20);
    await page.getByRole('button', { name: '适应脑图画布', exact: true }).click();
    await page.screenshot({ path: path.join(reports, 'windows-reopened-native-state.png') });
    record('编辑后立即关闭实际进程并重新启动，20卡/20节点/批注/阅读状态/复习与新编辑均从原生文件恢复');

    const exportPath = path.join(reports, 'windows-export.mjstudy');
    await chooseExportPath(application, exportPath);
    await page.getByRole('button', { name: '备份当前学习集', exact: true }).click();
    await expect(page.locator('.busy-overlay')).toHaveCount(0);
    await expect.poll(() => existsSync(exportPath)).toBe(true);
    const exportBytes = new Uint8Array(await readFile(exportPath));
    const exported = unzipSync(exportBytes);
    const exportedState: State = JSON.parse(new TextDecoder().decode(exported['study.json']));
    finalState = await nativeState(dataDirectory);
    expect(semantics(exportedState)).toEqual(semantics(finalState));
    primaryExportSha256 = digest(exportBytes);
    record('备份按钮经生产renderer→preload→IPC→fs flush/rename导出真实Windows学习集，供Android目标端导入');

    const markdownPath = path.join(reports, 'windows-markdown.zip');
    await chooseExportPath(application, markdownPath);
    await page.getByRole('button', { name: '导出 Markdown', exact: true }).click();
    await expect(page.locator('.busy-overlay')).toHaveCount(0); await expect.poll(() => existsSync(markdownPath)).toBe(true);
    const markdownFiles = unzipSync(new Uint8Array(await readFile(markdownPath)));
    const markdown = new TextDecoder().decode(markdownFiles['笔记.md']);
    expect(markdown).toContain('来源：'); expect(markdown).toContain('PDF 区域：');
    const links = [...markdown.matchAll(/\]\((assets\/[a-f0-9]{64}\.(?:pdf|png|jpg|webp))(?:#[^)]*)?\)/g)].map(match => match[1]);
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const link of links) expect(markdownFiles[link], `Markdown链接资源 ${link}`).toBeTruthy();
    const shortcutExport = path.join(reports, 'windows-shortcut-export.mjstudy');
    await chooseExportPath(application, shortcutExport);
    await page.keyboard.press('Control+e');
    await expect(page.locator('.busy-overlay')).toHaveCount(0); await expect.poll(() => existsSync(shortcutExport)).toBe(true);
    record('Markdown ZIP包含卡片/图片/来源PDF且所有相对资源存在；Ctrl+E实际导出学习集');
    expect(errors).toEqual([]);
    completed = true;
  } finally {
    if (application) { try { await application.close(); } catch (error) { errors.push(`关闭进程失败：${String(error)}`); completed = false; } }
    await writeFile(path.join(reports, 'windows-evidence.json'), JSON.stringify({
      executedAt: new Date().toISOString(), completed, testTitle: testInfo.title, executable, rendererUrl, rendererEntry, nativeInfo, dataDirectory, scanRender,
      storage: 'Electron production preload/IPC + actual native filesystem, not IndexedDB',
      pickerSubstitution: 'Only dialog.showSaveDialog returns a deterministic path; production UI export/IPC/fs code remains active.',
      inputPackage: acceptanceFile, exportedPackage: completed ? path.join(reports, 'windows-export.mjstudy') : null, primaryExportSha256,
      metrics: finalState ? { documents: finalState.documents.length, cards: finalState.cards.length, nodes: finalState.nodes.length, maximumDepth: maximumDepth(finalState), annotations: finalState.annotations.length, reviews: finalState.reviews.length, reviewLogs: finalState.reviewLogs.length } : null,
      sourceLocations: finalState?.cards.filter(card => card.source).map(card => ({ title: card.title, source: card.source })), windows, passed, errors, consoleWarnings,
      limitations: ['Window-size checks run on Windows, not Android hardware.', 'OS save-location picker is stubbed; actual picker interaction is a separate manual check.', 'Physical stylus pressure/latency/palm rejection is not tested.'],
    }, null, 2));
  }
  expect(completed, 'Windows原生测试须完成全部步骤并正常关闭').toBe(true);
});

test('Windows候选版本专项：直接导入后的快捷键、重复图片、Ctrl滚轮及关闭恢复', async ({}, testInfo) => {
  test.setTimeout(180000);
  test.skip(!existsSync(executable), `Windows打包程序不存在：${executable}`);
  test.skip(!existsSync(acceptanceFile), '缺少真实截图PNG来源的验收包');
  const directory = path.resolve('.test-data', `Windows候选专项-中文-${Date.now()}`);
  await mkdir(directory, { recursive: true });
  const archive = unzipSync(new Uint8Array(await readFile(acceptanceFile)));
  const source: State = JSON.parse(new TextDecoder().decode(archive['study.json']));
  const image = source.assets.find(asset => asset.id === source.cards.find(card => card.imageAssetId)?.imageAssetId)!;
  const imageA = path.join(directory, '相同图片一.png'), imageB = path.join(directory, '相同图片二.png');
  await writeFile(imageA, archive[image.path]); await writeFile(imageB, archive[image.path]);
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.MOJING_DEV_URL; env.MOJING_DATA_DIR = directory;
  const errors: string[] = [], warnings: string[] = [];
  let application: ElectronApplication | undefined;
  let completed = false;
  const detail: Record<string, unknown> = {};
  try {
    application = await _electron.launch({ executablePath: executable, args: [], env, timeout: 60000 });
    let page = await application.firstWindow();
    page.on('pageerror', error => errors.push(`${error.name}: ${error.message}`));
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) warnings.push(message.text()); });
    await page.waitForLoadState('domcontentloaded');
    detail.rendererEntry = await page.locator('script[type="module"]').getAttribute('src');
    detail.nativeInfo = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), executable: app.getPath('exe') }));
    await page.getByTestId('pdf-input').setInputFiles([path.resolve('tests/fixtures/含文字层的学习资料.pdf'), path.resolve('tests/fixtures/archival-scan.pdf')]);
    await expect(page.locator('.doc-entry')).toHaveCount(2); await saved(page); await readerReady(page, 1);
    await page.getByLabel('跳转页码', { exact: true }).fill('4'); await page.getByLabel('跳转页码', { exact: true }).press('Enter');
    await readerReady(page, 4);
    detail.scanPixels = await page.locator('.pdf-page canvas').evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let darkPixels = 0; for (let index = 0; index < pixels.length; index += 4) if (pixels[index] + pixels[index + 1] + pixels[index + 2] < 600) darkPixels++;
      return { width: canvas.width, height: canvas.height, darkPixels };
    });
    expect((detail.scanPixels as { darkPixels: number }).darkPixels).toBeGreaterThan(1000);
    // This starts from direct PDF import, the path affected by the stale busy closure.
    await page.keyboard.press('Control+k');
    const editor = page.getByRole('dialog', { name: '新建卡片', exact: true });
    await expect(editor).toBeVisible();
    await editor.getByLabel('卡片标题', { exact: true }).fill('候选版本 · 相同图片去重');
    await editor.getByLabel('卡片正文', { exact: true }).fill('从直接PDF导入开始，重复上传相同图像，保存后重启核对。');
    const imageInput = editor.locator('.image-upload input[type="file"]');
    await imageInput.setInputFiles(imageA);
    await imageInput.setInputFiles(imageB);
    await imageInput.setInputFiles(imageA);
    await expect(editor.locator('.editor-image img')).toBeVisible();
    await editor.getByRole('button', { name: '保存卡片', exact: true }).click(); await saved(page);
    const afterImages = await nativeState(directory);
    expect(afterImages.assets.filter(asset => asset.mime.startsWith('image/'))).toHaveLength(1);
    expect(new Set(afterImages.assets.map(asset => asset.id)).size).toBe(afterImages.assets.length);
    expect(afterImages.cards[0].imageAssetId).toBe(image.id);
    const chooserPromise = page.waitForEvent('filechooser');
    await page.keyboard.press('Control+o'); await (await chooserPromise).setFiles(path.resolve('tests/fixtures/含文字层的学习资料.pdf'));
    await expect(page.locator('.busy-overlay')).toHaveCount(0); await saved(page); await readerReady(page, 1);
    expect((await nativeState(directory)).documents).toHaveLength(2);
    const revision = (await nativeState(directory)).revision;
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await nativeState(directory)).revision).toBeGreaterThan(revision);
    const frame = (await page.locator('.pdf-scroll').boundingBox())!;
    const factorBefore = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
    const percentBefore = await page.getByTitle('恢复适宽', { exact: true }).textContent();
    await page.mouse.move(frame.x + frame.width * .6, frame.y + frame.height * .6); await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
    await expect(page.getByTitle('恢复适宽', { exact: true })).not.toHaveText(percentBefore || '');
    await readerReady(page, 1);
    const factorAfter = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
    expect(factorAfter).toBe(factorBefore);
    expect(warnings.some(message => /passive event listener/i.test(message))).toBe(false);
    detail.ctrlWheel = { factorBefore, factorAfter, percentBefore, percentAfter: await page.getByTitle('恢复适宽', { exact: true }).textContent() };
    const exportPath = path.join(reports, 'windows-candidate-export.mjstudy');
    await chooseExportPath(application, exportPath);
    await page.keyboard.press('Control+e'); await expect(page.locator('.busy-overlay')).toHaveCount(0); await expect.poll(() => existsSync(exportPath)).toBe(true);
    await expect.poll(async () => {
      try { return JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(await readFile(exportPath)))['study.json'])).sets[0].id; } catch { return ''; }
    }).toBe(afterImages.sets[0].id);
    const exported = unzipSync(new Uint8Array(await readFile(exportPath)));
    const output: State = JSON.parse(new TextDecoder().decode(exported['study.json']));
    expect(output.cards).toHaveLength(1); expect(output.documents).toHaveLength(2); expect(output.assets.filter(asset => asset.mime.startsWith('image/'))).toHaveLength(1);
    const beforeClose = await nativeState(directory);
    await application.close(); application = undefined;
    application = await _electron.launch({ executablePath: executable, args: [], env, timeout: 60000 }); page = await application.firstWindow();
    await page.waitForLoadState('domcontentloaded'); await saved(page); await readerReady(page);
    await expect(page.locator('.knowledge-card')).toHaveCount(1); await expect(page.locator('.knowledge-card-image')).toBeVisible();
    const reopened = await nativeState(directory);
    expect(semantics(reopened)).toEqual(semantics(beforeClose));
    detail.imageAssetId = reopened.cards[0].imageAssetId; detail.assetCount = reopened.assets.length; detail.reopenedRevision = reopened.revision;
    await page.screenshot({ path: path.join(reports, 'windows-candidate-reopened.png') });
    expect(errors).toEqual([]); completed = true;
  } finally {
    if (application) { try { await application.close(); } catch (error) { errors.push(String(error)); completed = false; } }
    await writeFile(path.join(reports, 'windows-candidate-evidence.json'), JSON.stringify({ executedAt: new Date().toISOString(), completed, testTitle: testInfo.title, executable, dataDirectory: directory, ...detail, errors, warnings, primaryCrossPlatformPackageUnchanged: 'reports/windows-export.mjstudy is not written by this focused test' }, null, 2));
  }
  expect(completed).toBe(true);
});
