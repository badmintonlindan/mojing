import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const baseUrl = process.env.MOJING_URL || 'http://127.0.0.1:5173';
const textPdf = process.env.MOJING_TEXT_PDF || path.resolve('tests/fixtures/text.pdf');

async function switchPanel(page: Page, name: '卡片' | '脑图' | '复习') {
  const mobileNavigation = page.getByRole('navigation', { name: '工作区页面' });
  if (await mobileNavigation.isVisible()) await mobileNavigation.getByRole('button', { name, exact: true }).click();
  else await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
}

async function importDocument(page: Page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('pdf-input').setInputFiles(textPdf);
  await expect(page.locator('.busy-overlay')).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator('.save-state')).toHaveText('已保存到本机', { timeout: 30000 });
}

async function addCard(page: Page, title: string, body: string) {
  await switchPanel(page, '卡片');
  const panel = page.getByRole('region', { name: '知识卡片', exact: true });
  await panel.getByRole('button', { name: '新建卡片', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新建卡片', exact: true });
  await editor.getByLabel('卡片标题', { exact: true }).fill(title);
  await editor.getByLabel('卡片正文', { exact: true }).fill(body);
  await editor.getByLabel('卡片标签', { exact: true }).fill('学习, 核心概念');
  await editor.getByRole('button', { name: '保存卡片', exact: true }).click();
  await expect(panel.getByRole('button', { name: title, exact: true })).toBeVisible();
}

async function addReviewFor(page: Page, title: string, question: string) {
  await switchPanel(page, '卡片');
  const card = page.locator('.knowledge-card').filter({ has: page.getByRole('button', { name: title, exact: true }) });
  await card.getByRole('button', { name: '加入复习', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置复习问题' });
  await dialog.getByRole('textbox', { name: '问题', exact: true }).fill(question);
  await dialog.getByRole('button', { name: '保存问题', exact: true }).click();
}

test.describe('知识联结与持久化', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test('三级脑图共享卡片、折叠、删除提升、复习与重启恢复', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    page.on('dialog', dialog => dialog.accept());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await importDocument(page);
    await addCard(page, '概念一：阅读', '阅读先建立问题，再寻找证据。');
    await addCard(page, '概念二：联结', '把证据与已有概念联系起来。');
    await addCard(page, '概念三：复习', '通过主动回忆检验自己的理解。');
    const rootCard = page.locator('.knowledge-card').filter({ has: page.getByRole('button', { name: '概念一：阅读', exact: true }) });
    await rootCard.getByRole('button', { name: '加入脑图', exact: true }).click();
    await switchPanel(page, '脑图');
    const map = page.getByRole('region', { name: '思维导图' });
    const rootNode = map.getByRole('group', { name: '脑图节点 概念一：阅读', exact: true });
    await rootNode.click();
    await map.getByRole('button', { name: '子节点', exact: true }).click();
    await page.locator('.mind-picker-list').getByRole('button').filter({ hasText: '概念二：联结' }).click();
    const childNode = map.getByRole('group', { name: '脑图节点 概念二：联结', exact: true });
    await map.getByRole('button', { name: '适应脑图画布', exact: true }).click();
    await childNode.click();
    await map.getByRole('button', { name: '子节点', exact: true }).click();
    await page.locator('.mind-picker-list').getByRole('button').filter({ hasText: '概念三：复习' }).click();
    const grandchildNode = map.getByRole('group', { name: '脑图节点 概念三：复习', exact: true });
    await expect(map.locator('.mind-node')).toHaveCount(3);
    const lefts = await map.locator('.mind-node').evaluateAll(elements => elements.map(element => Number.parseFloat((element as HTMLElement).style.left)).sort((a, b) => a - b));
    expect(lefts[1]).toBeGreaterThan(lefts[0]);
    expect(lefts[2]).toBeGreaterThan(lefts[1]);
    await map.getByRole('button', { name: '适应脑图画布', exact: true }).click();
    await map.getByRole('button', { name: '折叠节点 概念一：阅读', exact: true }).click();
    await expect(map.locator('.mind-node')).toHaveCount(1);
    await map.getByRole('button', { name: '展开节点 概念一：阅读', exact: true }).click();
    await expect(map.locator('.mind-node')).toHaveCount(3);
    await rootNode.click();
    await map.getByRole('button', { name: '移动', exact: true }).click();
    // A root cannot be moved beneath either of its descendants.
    await expect(page.getByRole('dialog', { name: '移动脑图节点' }).locator('select option')).toHaveCount(1);
    await page.getByRole('dialog', { name: '移动脑图节点' }).getByRole('button', { name: '取消', exact: true }).click();
    await rootNode.getByRole('button', { name: '编辑脑图卡片 概念一：阅读', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑卡片', exact: true });
    await editor.getByLabel('卡片标题', { exact: true }).fill('概念一：提问式阅读');
    await editor.getByLabel('卡片正文', { exact: true }).fill('带着问题阅读，回到原文核对证据。');
    await editor.getByRole('button', { name: '保存卡片', exact: true }).click();
    await expect(map.getByRole('group', { name: '脑图节点 概念一：提问式阅读', exact: true })).toBeVisible();
    await childNode.click();
    await map.getByRole('button', { name: '移除脑图节点', exact: true }).click();
    await expect(map.locator('.mind-node')).toHaveCount(2);
    await expect(map.getByRole('button', { name: '子节点', exact: true })).toBeDisabled();
    const promotedLeft = await grandchildNode.evaluate(element => Number.parseFloat((element as HTMLElement).style.left));
    expect(promotedLeft).toBe(lefts[1]);
    await page.screenshot({ path: testInfo.outputPath('desktop-mind-map.png') });
    await switchPanel(page, '卡片');
    await expect(page.locator('.knowledge-card')).toHaveCount(3);
    await expect(page.getByRole('region', { name: '知识卡片' }).getByText('带着问题阅读，回到原文核对证据。', { exact: true })).toBeVisible();
    await addReviewFor(page, '概念一：提问式阅读', '怎样用提问提高阅读效果？');
    await switchPanel(page, '复习');
    await expect(page.getByRole('heading', { name: '怎样用提问提高阅读效果？', exact: true })).toBeVisible();
    await expect(page.locator('.review-answer')).toHaveCount(0);
    await page.getByRole('button', { name: '显示答案', exact: true }).click();
    await expect(page.locator('.review-answer')).toContainText('带着问题阅读，回到原文核对证据。');
    await page.getByRole('button', { name: /^已掌握/ }).click();
    await expect(page.getByRole('heading', { name: '这一轮已完成', exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: '复习页面' }).getByRole('button', { name: /^记录/ }).click();
    await expect(page.locator('.review-log')).toHaveCount(1);
    await expect(page.locator('.review-log')).toContainText('已掌握');
    await expect(page.locator('.save-state')).toHaveText('已保存到本机');
    await page.reload();
    await expect(page.locator('.save-state')).toHaveText('已保存到本机');
    await switchPanel(page, '脑图');
    await expect(page.locator('.mind-node')).toHaveCount(2);
    await expect(page.getByRole('group', { name: '脑图节点 概念一：提问式阅读', exact: true })).toBeVisible();
    await switchPanel(page, '复习');
    await page.getByRole('navigation', { name: '复习页面' }).getByRole('button', { name: /^记录/ }).click();
    await expect(page.locator('.review-log')).toHaveCount(1);
    await expect(page.locator('.review-log')).toContainText('概念一：提问式阅读');
    expect(errors).toEqual([]);
  });
});

for (const layout of [
  { name: 'phone', width: 412, height: 915 },
  { name: 'tablet-portrait', width: 900, height: 1200 },
]) {
  test.describe(`复习布局 ${layout.name}`, () => {
    test.use({ viewport: { width: layout.width, height: layout.height }, isMobile: layout.name === 'phone', hasTouch: true });
    test('在当前屏幕完成问答反馈并恢复历史', async ({ page }, testInfo) => {
      test.setTimeout(90000);
      await importDocument(page);
      await addCard(page, '主动回忆', '合上资料，用自己的话复述所学，再回到原文核对。');
      await addReviewFor(page, '主动回忆', '什么是主动回忆？');
      await switchPanel(page, '复习');
      const reveal = page.getByRole('button', { name: '显示答案', exact: true });
      await expect(reveal).toBeVisible();
      const box = await reveal.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(42);
      await reveal.click();
      await expect(page.locator('.review-answer')).toContainText('合上资料，用自己的话复述所学');
      const rating = page.getByRole('button', { name: /^很轻松/ });
      await expect(rating).toBeInViewport();
      await rating.click();
      await page.getByRole('navigation', { name: '复习页面' }).getByRole('button', { name: /^记录/ }).click();
      await expect(page.locator('.review-log')).toHaveCount(1);
      await expect(page.locator('.save-state')).toHaveText('已保存到本机');
      await page.screenshot({ path: testInfo.outputPath(`${layout.name}-review-record.png`) });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow).toBe(false);
      await page.reload();
      await expect(page.locator('.save-state')).toHaveText('已保存到本机');
      await switchPanel(page, '复习');
      await page.getByRole('navigation', { name: '复习页面' }).getByRole('button', { name: /^记录/ }).click();
      await expect(page.locator('.review-log')).toHaveCount(1);
      await expect(page.locator('.review-log')).toContainText('很轻松');
    });
  });
}
