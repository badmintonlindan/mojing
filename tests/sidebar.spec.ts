import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('reports/sidebar');
const pdf = path.resolve('tests/fixtures/含文字层的学习资料.pdf');

async function ready(page: Page) {
  const canvas = page.locator('.pdf-page canvas');
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await expect(canvas).toHaveAttribute('data-render-state', 'ready');
  await expect(page.locator('.textLayer')).toContainText('Learning begins with observation.');
  await expect(page.locator('.error-box,.save-error')).toHaveCount(0);
}

async function drawerClosed(page: Page) {
  await expect(page.locator('.sidebar')).not.toHaveClass(/\bopen\b/);
  await expect.poll(async () => {
    const box = await page.locator('.sidebar').boundingBox();
    return box ? box.x + box.width : 0;
  }).toBeLessThanOrEqual(1);
  await expect(page.locator('.sidebar-shade')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开侧栏', exact: true })).toHaveAttribute('aria-expanded', 'false');
}

async function drawerOpened(page: Page) {
  await expect(page.locator('.sidebar')).toHaveClass(/\bopen\b/);
  await expect.poll(async () => (await page.locator('.sidebar').boundingBox())!.x).toBeCloseTo(0, 0);
  await expect(page.locator('.sidebar-shade')).toBeVisible();
}

for (const layout of [
  { name: 'windows-wide', width: 1440, height: 1000, touch: false, wide: true },
  { name: 'tablet-wide', width: 1280, height: 800, touch: true, wide: true },
  { name: 'phone-drawer', width: 412, height: 915, touch: true, wide: false },
  { name: 'tablet-drawer', width: 900, height: 1200, touch: true, wide: false },
]) {
  test.describe(`资料侧栏 ${layout.name}`, () => {
    test.use({ viewport: { width: layout.width, height: layout.height }, hasTouch: layout.touch, isMobile: layout.touch });

    test('真实PDF下收起、重新打开及抽屉关闭', async ({ page }) => {
      await mkdir(output, { recursive: true });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.app-header')).toBeVisible();
      const activate = async (label: string) => {
        const button = page.getByRole('button', { name: label, exact: true });
        if (layout.touch) await button.tap(); else await button.click();
      };
      if (layout.wide) {
        await expect(page.getByRole('button', { name: '收起侧栏', exact: true })).toHaveAttribute('aria-expanded', 'true');
        await expect(page.getByRole('complementary', { name: '资料侧栏' })).toBeVisible();
      } else {
        await drawerClosed(page);
        await expect(page.locator('.sidebar-toggle')).toBeHidden();
      }

      await page.getByTestId('pdf-input').setInputFiles(pdf);
      await expect(page.locator('.doc-entry')).toHaveCount(1);
      await expect(page.locator('.save-state')).toContainText('已保存到本机');
      await ready(page);
      const toastClose = page.getByRole('button', { name: '关闭提示', exact: true });
      if (await toastClose.isVisible()) await toastClose.click();
      const before = {
        main: (await page.locator('.main-area').boundingBox())!.width,
        reader: (await page.locator('.reader-pane').boundingBox())!.width,
        canvas: (await page.locator('.pdf-page canvas').boundingBox())!.width,
      };
      const observed: string[] = [];
      let after: typeof before | undefined;

      if (layout.wide) {
        // Selecting a document closes only the narrow-screen drawer, not the wide sidebar.
        if (layout.touch) await page.locator('.doc-entry').tap(); else await page.locator('.doc-entry').click();
        await expect(page.getByRole('button', { name: '收起侧栏', exact: true })).toHaveAttribute('aria-expanded', 'true');
        await page.screenshot({ path: path.join(output, `${layout.name}-expanded.png`) });
        await activate('收起侧栏');
        await expect(page.getByRole('complementary', { name: '资料侧栏' })).toBeHidden();
        const reopen = page.getByRole('button', { name: '打开侧栏', exact: true });
        await expect(reopen).toBeInViewport();
        await expect(reopen).toHaveAttribute('aria-expanded', 'false');
        await expect.poll(async () => (await page.locator('.reader-pane').boundingBox())!.width).toBeGreaterThan(before.reader + 100);
        await expect.poll(async () => (await page.locator('.pdf-page canvas').boundingBox())!.width).toBeGreaterThan(before.canvas + 90);
        await ready(page);
        after = {
          main: (await page.locator('.main-area').boundingBox())!.width,
          reader: (await page.locator('.reader-pane').boundingBox())!.width,
          canvas: (await page.locator('.pdf-page canvas').boundingBox())!.width,
        };
        expect(after.main).toBeGreaterThan(before.main + 200);
        await expect(page.locator('.sidebar-shade')).toHaveCount(0);
        await page.screenshot({ path: path.join(output, `${layout.name}-collapsed.png`) });
        if (layout.touch) await reopen.tap(); else { await reopen.focus(); await page.keyboard.press('Enter'); }
        await expect(page.getByRole('complementary', { name: '资料侧栏' })).toBeVisible();
        await expect(page.getByRole('button', { name: '收起侧栏', exact: true })).toHaveAttribute('aria-expanded', 'true');
        await expect.poll(async () => (await page.locator('.reader-pane').boundingBox())!.width).toBeCloseTo(before.reader, 0);
        await ready(page);
        observed.push('宽屏默认展开', '点击文档保持宽屏展开', '收起释放侧栏占位并使原文重新渲染变宽', '标题栏入口可触摸或键盘重新打开');
      } else {
        await activate('打开侧栏');
        await drawerOpened(page);
        await expect(page.locator('.menu-toggle')).toHaveAttribute('aria-expanded', 'true');
        await page.screenshot({ path: path.join(output, `${layout.name}-open.png`) });
        await activate('关闭侧栏');
        await drawerClosed(page);
        await activate('打开侧栏');
        await drawerOpened(page);
        await page.locator('.sidebar-shade').tap({ position: { x: layout.width - 15, y: layout.height / 2 } });
        await drawerClosed(page);
        await activate('打开侧栏');
        await drawerOpened(page);
        await page.locator('.doc-entry').tap();
        await drawerClosed(page);
        await ready(page);
        expect((await page.locator('.main-area').boundingBox())!.width).toBeCloseTo(before.main, 0);
        await page.screenshot({ path: path.join(output, `${layout.name}-closed.png`) });
        observed.push('窄屏默认关闭', '菜单可打开抽屉', '关闭按钮/遮罩/选择文档均可收起', '抽屉不占据原文布局宽度');
      }

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(errors).toEqual([]);
      await writeFile(path.join(output, `${layout.name}.json`), JSON.stringify({
        executedAt: new Date().toISOString(), completed: true, layout,
        browser: page.context().browser()?.version(),
        rendererEntry: await page.locator('script[type="module"]').getAttribute('src'),
        before, after, observed, errors,
        scope: 'Chrome desktop/touch layout regression with real PDF import; not physical Huawei tablet verification',
      }, null, 2));
    });
  });
}
