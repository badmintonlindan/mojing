import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { unzipSync } from 'fflate';
import type { Card, State } from '../src/core/model';

const executable = path.resolve(process.env.MOJING_WINDOWS_EXE || 'release/墨径-Windows-x64/墨径.exe');
const evidenceRoot = path.resolve('reports/roundtrip');
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const archiveState = (bytes: Uint8Array): State => JSON.parse(new TextDecoder().decode(unzipSync(bytes)['study.json']));

async function saved(page: Page) { await expect(page.locator('.save-state')).toContainText('已保存到本机'); await expect(page.locator('.save-error')).toHaveCount(0); }
async function nativeState(directory: string): Promise<State> {
  const entries = await Promise.all(['snapshot-a.json', 'snapshot-b.json'].map(async name => {
    try {
      const entry = JSON.parse(await readFile(path.join(directory, 'workspace', name), 'utf8'));
      if (entry.format !== 'mojing.snapshot' || entry.revision !== entry.state.revision || entry.sha256 !== hash(JSON.stringify(entry.state))) return null;
      return entry.state as State;
    } catch { return null; }
  }));
  const state = entries.filter((entry): entry is State => !!entry).sort((a, b) => b.revision - a.revision)[0];
  if (!state) throw new Error('没有找到有效原生快照');
  return state;
}
async function rendered(page: Page, number: number) {
  await expect(page.getByLabel('跳转页码', { exact: true })).toHaveValue(String(number));
  await expect(page.locator('.pdf-page canvas')).toHaveAttribute('data-rendered-page', String(number));
  await expect(page.locator('.pdf-page canvas')).toHaveAttribute('data-render-state', 'ready');
  await expect(page.locator('.error-box')).toHaveCount(0);
}

/** Normalize only intentionally remapped IDs/name/revision; retain every other field. */
function semanticState(state: State) {
  const doc = (id: string) => state.documents.findIndex(document => document.id === id);
  const card = (id: string) => state.cards.findIndex(value => value.id === id);
  const node = (id: string) => state.nodes.findIndex(value => value.id === id);
  const review = (id: string) => state.reviews.findIndex(value => value.id === id);
  return {
    schemaVersion: state.schemaVersion,
    sets: state.sets.map(({ id: _id, name: _name, documentIds, ...rest }) => ({ ...rest, documentIndices: documentIds.map(doc) })),
    documents: state.documents.map(({ id: _id, ...rest }) => rest),
    cards: state.cards.map(({ id: _id, setId: _setId, source, ...rest }) => ({ ...rest, source: source ? { ...source, documentId: doc(source.documentId) } : null })),
    nodes: state.nodes.map(({ id: _id, setId: _setId, cardId, parentId, ...rest }) => ({ ...rest, card: card(cardId), parent: parentId ? node(parentId) : null })),
    annotations: state.annotations.map(({ id: _id, setId: _setId, documentId, ...rest }) => ({ ...rest, document: doc(documentId) })),
    reviews: state.reviews.map(({ id: _id, setId: _setId, cardId, ...rest }) => ({ ...rest, card: card(cardId) })),
    reviewLogs: state.reviewLogs.map(({ id: _id, setId: _setId, cardId, reviewId, ...rest }) => ({ ...rest, card: card(cardId), review: review(reviewId) })),
    assets: state.assets.map(asset => ({ ...asset })).sort((a, b) => a.path.localeCompare(b.path)),
  };
}
async function openSource(page: Page, state: State, card: Card, screenshot: string) {
  await page.getByRole('tab', { name: /^卡片/ }).click();
  const article = page.locator('.knowledge-card').filter({ has: page.getByRole('button', { name: card.title, exact: true }) });
  await article.getByTitle('返回原文定位', { exact: true }).click();
  await expect(page.locator('.reader-title strong')).toHaveText(state.documents.find(doc => doc.id === card.source!.documentId)!.name);
  await rendered(page, card.source!.page);
  await expect(page.locator('.source-focus')).toHaveCount(card.source!.rects.length);
  const pixels = await page.locator('.pdf-page canvas').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let darkPixels = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0 && data[i] + data[i + 1] + data[i + 2] < 600) darkPixels++;
    return { width: canvas.width, height: canvas.height, darkPixels };
  });
  expect(pixels.darkPixels).toBeGreaterThan(1000); // Both known source pages contain substantial content.
  await page.screenshot({ path: screenshot });
  return { title: card.title, page: card.source!.page, rects: card.source!.rects, pixels };
}

for (const platform of ['phone', 'tablet'] as const) {
  test(`Android ${platform} 系统保存器导出→打包Windows真实回导与重启`, async ({}, testInfo) => {
    test.setTimeout(150000);
    const input = path.resolve(process.env[`MOJING_ANDROID_${platform.toUpperCase()}_EXPORT`] || `reports/android/${platform}/Android-${platform}-export.mjstudy`);
    // Missing real-device artifacts are failures, never a skipped/passed verification.
    expect(existsSync(executable), `先构建Windows目标程序：${executable}`).toBe(true);
    expect(existsSync(input), `等待Android真实系统保存器导出完成后运行：${input}`).toBe(true);
    await mkdir(evidenceRoot, { recursive: true });
    const sourceBytes = new Uint8Array(await readFile(input));
    const expected = archiveState(sourceBytes);
    const baseline = archiveState(new Uint8Array(await readFile(path.resolve('reports/windows-export.mjstudy'))));
    expect(expected.sets).toHaveLength(1);
    expect(expected.documents).toHaveLength(2);
    expect(expected.cards.length).toBeGreaterThan(baseline.cards.length);
    expect(expected.nodes.length).toBeGreaterThanOrEqual(20);
    expect(expected.reviewLogs.length).toBeGreaterThan(baseline.reviewLogs.length);
    expect(expected.annotations.some(annotation => !baseline.annotations.some(old => old.createdAt === annotation.createdAt))).toBe(true);
    const directory = path.resolve('.test-data', `Android-${platform}-回导Windows-中文-${Date.now()}`);
    await mkdir(directory, { recursive: true });
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete env.ELECTRON_RUN_AS_NODE; delete env.MOJING_DEV_URL; env.MOJING_DATA_DIR = directory;
    const errors: string[] = [];
    const checks: string[] = [];
    const detail: Record<string, unknown> = {};
    let completed = false;
    let application: ElectronApplication | undefined;
    try {
      application = await _electron.launch({ executablePath: executable, args: [], env, timeout: 60000 });
      let page = await application.firstWindow(); page.on('pageerror', error => errors.push(`${error.name}: ${error.message}`));
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByRole('heading', { name: '把读过的，变成自己的', exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.mojing?.platform)).toBe('windows');
      detail.rendererEntry = await page.locator('script[type="module"]').getAttribute('src');
      detail.native = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, executable: app.getPath('exe'), version: app.getVersion(), userData: app.getPath('userData') }));
      expect((detail.native as { packaged: boolean }).packaged).toBe(true);
      await page.getByTestId('backup-input').setInputFiles(input);
      await expect(page.locator('.knowledge-card')).toHaveCount(expected.cards.length); await saved(page);
      await rendered(page, expected.documents[0].progress.page);
      const imported = await nativeState(directory);
      expect(semanticState(imported)).toEqual(semanticState(expected));
      expect(imported.sets[0].name).toBe(`${expected.sets[0].name}（导入）`);
      expect(imported.cards[0].id).not.toBe(expected.cards[0].id);
      for (const asset of imported.assets) {
        const bytes = await readFile(path.join(directory, 'workspace', asset.path));
        expect(bytes.byteLength).toBe(asset.size); expect(hash(bytes)).toBe(asset.sha256);
      }
      checks.push('真实打包EXE以Windows原生文件适配器UI导入Android包');
      checks.push('所有资产字节/SHA-256逐项一致，卡片/文档/来源/脑图/批注/复习全部字段与关系经ID映射后保留');
      const textCard = imported.cards.find(card => card.source?.quote)!;
      const imageCard = imported.cards.find(card => card.imageAssetId && card.source)!;
      expect(textCard).toBeTruthy(); expect(imageCard).toBeTruthy();
      detail.sources = [
        await openSource(page, imported, textCard, path.join(evidenceRoot, `${platform}-text-source.png`)),
        await openSource(page, imported, imageCard, path.join(evidenceRoot, `${platform}-image-source.png`)),
      ];
      await expect(page.locator('.knowledge-card').filter({ has: page.getByRole('button', { name: imageCard.title, exact: true }) }).getByAltText('原文区域摘录')).toBeVisible();
      checks.push('文字和图片摘录实际返回对应文档/页码/区域，原文像素与卡片图片均非空');
      await saved(page);
      const beforeClose = await nativeState(directory);
      await application.close(); application = undefined;
      application = await _electron.launch({ executablePath: executable, args: [], env, timeout: 60000 }); page = await application.firstWindow();
      page.on('pageerror', error => errors.push(`${error.name}: ${error.message}`));
      await page.waitForLoadState('domcontentloaded'); await saved(page);
      await expect(page.locator('.knowledge-card')).toHaveCount(expected.cards.length);
      const reopened = await nativeState(directory);
      await rendered(page, reopened.documents.find(doc => doc.id === reopened.activeDocumentId)?.progress.page || reopened.documents[0].progress.page);
      expect(semanticState(reopened)).toEqual(semanticState(beforeClose));
      await page.screenshot({ path: path.join(evidenceRoot, `${platform}-reopened.png`) });
      checks.push('关闭真实进程并重开后全部内容、关系、批注和新增复习仍由原生文件恢复');
      detail.metrics = { documents: imported.documents.length, cards: imported.cards.length, nodes: imported.nodes.length, annotations: imported.annotations.length, reviews: imported.reviews.length, reviewLogs: imported.reviewLogs.length, assets: imported.assets.length };
      expect(errors).toEqual([]); completed = true;
    } finally {
      if (application) { try { await application.close(); } catch (error) { errors.push(String(error)); completed = false; } }
      await writeFile(path.join(evidenceRoot, `windows-from-android-${platform}.json`), JSON.stringify({ executedAt: new Date().toISOString(), completed, testTitle: testInfo.title, input, inputSha256: hash(sourceBytes), dataDirectory: directory, ...detail, checks, errors, scope: 'Android production system-picker export is imported by packaged Windows production UI/native fs; no state injection and no OS clipboard test' }, null, 2));
    }
    expect(completed).toBe(true);
  });
}
