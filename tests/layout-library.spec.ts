import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('reports/layout-final');
const textPdf = path.resolve('tests/fixtures/含文字层的学习资料.pdf');
const scanPdf = path.resolve('tests/fixtures/纯位图扫描模拟.pdf');

async function ready(page: Page, targetPage = 1) {
  await expect(page.locator('.pdf-page canvas')).toHaveAttribute('data-rendered-page', String(targetPage));
  await expect(page.locator('.pdf-page canvas')).toHaveAttribute('data-render-state', 'ready');
  await expect(page.locator('.error-box')).toHaveCount(0);
  await expect.poll(() => page.locator('.pdf-page canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(100);
}
async function saved(page: Page) { await expect(page.locator('.save-state')).toContainText('已保存到本机'); await expect(page.locator('.save-error')).toHaveCount(0); }
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
async function dismissToast(page: Page) { const close = page.getByRole('button', { name: '关闭提示', exact: true }); if (await close.isVisible()) await close.click(); }
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
  for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 8, y: from.y + (to.y - from.y) * step / 8, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
}

for (const layout of [
  { name: 'phone-landscape', width: 915, height: 412, singleColumn: true },
  { name: 'tablet-portrait', width: 900, height: 1200, singleColumn: false },
  { name: 'tablet-landscape', width: 1200, height: 800, singleColumn: false },
]) {
  test.describe(`最终触摸布局 ${layout.name}`, () => {
    test.use({ viewport: { width: layout.width, height: layout.height }, hasTouch: true, isMobile: true });
    test('真实PDF与单栏切换或双栏触摸分隔条', async ({ page }) => {
      await mkdir(output, { recursive: true });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      expect(await page.evaluate(() => matchMedia('(pointer:coarse)').matches)).toBe(true);
      await page.getByTestId('pdf-input').setInputFiles(textPdf);
      await expect(page.locator('.doc-entry')).toHaveCount(1); await saved(page); await ready(page);
      await dismissToast(page);
      await expect(page.locator('.reader-title strong')).toHaveText('含文字层的学习资料');
      const metadata: Record<string, unknown> = { executedAt: new Date().toISOString(), layout, browser: page.context().browser()?.version(), rendererEntry: await page.locator('script[type="module"]').getAttribute('src'), pointer: 'coarse', touchInput: true };
      if (layout.singleColumn) {
        const navigation = page.getByRole('navigation', { name: '工作区页面' });
        await expect(navigation).toBeVisible();
        await expect(page.locator('.reader-pane')).toBeVisible();
        await expect(page.locator('.knowledge-pane')).toBeHidden();
        await expect(page.getByRole('separator', { name: '调整阅读与知识面板比例' })).toBeHidden();
        await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeInViewport();
        const sentence = page.locator('.textLayer span').filter({ hasText: /^Learning begins with observation\.$/ }).first();
        await sentence.scrollIntoViewIfNeeded();
        await expect(sentence).toBeInViewport();
        metadata.readingScrollTop = await page.locator('.pdf-scroll').evaluate(element => element.scrollTop);
        await noOverflow(page);
        await page.screenshot({ path: path.join(output, `${layout.name}-reading.png`) });
        await navigation.getByRole('button', { name: '卡片', exact: true }).tap();
        await expect(page.locator('.reader-pane')).toBeHidden();
        await expect(page.getByRole('region', { name: '知识卡片', exact: true })).toBeVisible();
        await expect(page.getByRole('region', { name: '知识卡片', exact: true }).getByRole('button', { name: '新建卡片', exact: true })).toBeInViewport();
        await noOverflow(page);
        await page.screenshot({ path: path.join(output, `${layout.name}-cards.png`) });
        await navigation.getByRole('button', { name: '阅读', exact: true }).tap();
        await expect(page.locator('.knowledge-pane')).toBeHidden(); await ready(page);
        metadata.observed = ['横屏仍为单栏', '滚动后原文句子可见', '底栏触摸切换阅读/卡片', '翻页和新建卡片按钮在视口内', '无页面横向溢出'];
      } else {
        await expect(page.getByRole('navigation', { name: '工作区页面' })).toBeHidden();
        await expect(page.locator('.reader-pane')).toBeVisible(); await expect(page.locator('.knowledge-pane')).toBeVisible();
        const divider = page.getByRole('separator', { name: '调整阅读与知识面板比例' });
        await expect(divider).toBeVisible();
        const ratioBefore = Number(await divider.getAttribute('aria-valuenow'));
        const canvasBefore = (await page.locator('.pdf-page canvas').boundingBox())!.width;
        const box = (await divider.boundingBox())!;
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        await touchDrag(page, { x, y }, { x: x - 80, y });
        await expect.poll(async () => Number(await divider.getAttribute('aria-valuenow'))).toBeLessThan(ratioBefore - 3);
        await expect.poll(async () => (await page.locator('.pdf-page canvas').boundingBox())!.width).toBeLessThan(canvasBefore - 20);
        await ready(page); await noOverflow(page);
        const reader = (await page.locator('.reader-pane').boundingBox())!, knowledge = (await page.locator('.knowledge-pane').boundingBox())!;
        expect(knowledge.x).toBeGreaterThan(reader.x + reader.width - 1);
        expect(knowledge.x + knowledge.width).toBeLessThanOrEqual(layout.width + 1);
        await page.screenshot({ path: path.join(output, `${layout.name}-split-dragged.png`) });
        metadata.split = { ratioBefore, ratioAfter: Number(await divider.getAttribute('aria-valuenow')), reader, knowledge, input: 'CDP trusted touch pointer events on production splitter' };
        metadata.observed = ['阅读/知识双栏', '实际触摸拖动分隔条改变比例', 'PDF按新宽度重新渲染完成', '无页面横向溢出'];
      }
      expect(errors).toEqual([]);
      await writeFile(path.join(output, `${layout.name}.json`), JSON.stringify({ ...metadata, completed: true, errors }, null, 2));
    });
  });
}

test.describe('资料库真实操作', () => {
  test.use({ viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false });
  test('独立学习集的PDF重命名、资料库搜索、删除与重载恢复', async ({ page }) => {
    await mkdir(output, { recursive: true });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('.welcome').getByRole('button', { name: '创建学习集', exact: true }).click();
    const newSet = page.getByRole('dialog', { name: '创建学习集', exact: true });
    await newSet.getByLabel('名称', { exact: true }).fill('资料库回归 · 中文');
    await newSet.getByRole('button', { name: '确定', exact: true }).click();
    await page.getByTestId('pdf-input').setInputFiles([textPdf, scanPdf]);
    await expect(page.locator('.doc-entry')).toHaveCount(2); await saved(page); await ready(page);
    await dismissToast(page);
    await page.getByRole('button', { name: /^资料库\s*\d+$/ }).click();
    const library = page.getByRole('dialog', { name: '资料库', exact: true });
    await expect(library.locator('.library-item')).toHaveCount(2);
    await library.getByRole('button', { name: '重命名 含文字层的学习资料', exact: true }).click();
    const rename = page.getByRole('dialog', { name: '重命名文档', exact: true });
    const newName = '已重命名 · 中文资料';
    await rename.getByLabel('名称', { exact: true }).fill(newName); await rename.getByRole('button', { name: '确定', exact: true }).click(); await saved(page);
    await expect(library.locator('.library-item strong').filter({ hasText: newName })).toHaveCount(1);
    await library.getByRole('textbox', { name: '搜索资料库', exact: true }).fill('已重命名');
    await expect(library.locator('.library-item')).toHaveCount(1);
    await expect(library.locator('.library-item strong')).toHaveText(newName);
    await page.screenshot({ path: path.join(output, 'library-renamed-search.png') });
    await library.getByRole('textbox', { name: '搜索资料库', exact: true }).fill('不存在的资料');
    await expect(library.locator('.library-item')).toHaveCount(0);
    await library.getByRole('textbox', { name: '搜索资料库', exact: true }).fill('');
    await expect(library.locator('.library-item')).toHaveCount(2);
    page.once('dialog', dialog => dialog.accept());
    await library.getByRole('button', { name: '删除 纯位图扫描模拟', exact: true }).click();
    await expect(library.locator('.library-item')).toHaveCount(1); await saved(page);
    await library.getByRole('button', { name: '完成', exact: true }).click();
    await expect(page.locator('.doc-entry')).toHaveCount(1); await ready(page);
    await expect(page.locator('.reader-title strong')).toHaveText(newName);
    await expect(page.locator('.textLayer')).toContainText('Learning begins with observation.');
    await page.reload({ waitUntil: 'domcontentloaded' }); await saved(page); await ready(page);
    await expect(page.locator('.breadcrumb strong')).toHaveText('资料库回归 · 中文');
    await expect(page.locator('.doc-entry')).toHaveCount(1); await expect(page.locator('.reader-title strong')).toHaveText(newName);
    await expect(page.locator('.knowledge-card')).toHaveCount(0);
    await page.getByRole('button', { name: /^资料库\s*\d+$/ }).click();
    await expect(library.locator('.library-item')).toHaveCount(1);
    await expect(library.locator('.library-item strong')).toHaveText(newName);
    await expect(library.getByRole('checkbox', { name: `关联 ${newName}`, exact: true })).toBeChecked();
    await noOverflow(page); await page.screenshot({ path: path.join(output, 'library-deleted-reloaded.png') });
    expect(errors).toEqual([]);
    await writeFile(path.join(output, 'library-evidence.json'), JSON.stringify({ executedAt: new Date().toISOString(), completed: true, browser: page.context().browser()?.version(), rendererEntry: await page.locator('script[type="module"]').getAttribute('src'), studySet: '资料库回归 · 中文', imported: 2, remaining: 1, renamedTo: newName, cards: 0, observed: ['UI创建独立中文学习集', '真实PDF导入两份', 'PDF重命名', '资料库搜索命中与未命中', '删除无来源卡片/批注的PDF', '重载后名称/关联/删除状态/原文可读均恢复'], errors }, null, 2));
  });
});
