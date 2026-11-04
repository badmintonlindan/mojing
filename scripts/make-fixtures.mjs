import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const directory = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));
await mkdir(directory, { recursive: true });
// Use a system CJK font when available. PDF text remains standard embedded English.
for (const font of ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf']) {
  try { if (GlobalFonts.registerFromPath(font, 'Fixture CJK')) break; } catch {}
}
function chineseTitle(title, width = 1100, height = 100) {
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#185c50'; ctx.font = 'bold 48px "Fixture CJK", sans-serif'; ctx.fillText(title, 10, 65);
  return canvas.toBuffer('image/png');
}

const text = await PDFDocument.create();
text.setTitle('Mojing text-layer fixture / 文字层阅读测试'); text.setAuthor('Mojing test suite');
text.setSubject('Generated test document, not third-party learning material');
const regular = await text.embedFont(StandardFonts.Helvetica), bold = await text.embedFont(StandardFonts.HelveticaBold);
const chapters = ['Observation', 'Connection', 'Retrieval'];
for (let i = 0; i < 3; i++) {
  const page = text.addPage([612, 792]);
  const title = await text.embedPng(chineseTitle(`墨径学习测试 · 第 ${i + 1} 页`));
  page.drawImage(title, { x: 48, y: 704, width: 516, height: 47 });
  page.drawText(`Chapter ${i + 1}: ${chapters[i]}`, { x: 48, y: 670, font: bold, size: 20, color: rgb(.09,.29,.25) });
  const lines = [
    'Learning begins with observation.',
    'Select this sentence to create a source-linked knowledge card.',
    'A useful note connects an idea with the exact original evidence.',
    'Highlights and handwriting must follow the PDF coordinates.',
    'Move from reading to excerpting, mapping, and active recall.',
    'This document has a real searchable and selectable text layer.',
    'Practice question: How does retrieval strengthen understanding?',
    'Answer: Retrieve, compare with the source, and correct the gap.',
    `Unique search token: chapter${i + 1}evidence.`,
    'Use the scan fixture to test image excerpts without OCR.',
    'Chinese file paths and study-set names are part of this test.',
    'All fixture content was generated for this application.',
  ];
  lines.forEach((line, row) => page.drawText(line, { x: 48, y: 623 - row * 29, font: regular, size: 12, color: rgb(.14,.18,.19) }));
  page.drawRectangle({ x: 48, y: 155, width: 516, height: 90, borderColor: rgb(.73,.79,.76), borderWidth: 1, color: rgb(.95,.97,.95) });
  page.drawText('EXCERPT REGION', { x: 68, y: 215, font: bold, size: 14, color: rgb(.09,.29,.25) });
  page.drawText(`This is page ${i + 1}. Keep its source when exporting a study set.`, { x: 68, y: 183, font: regular, size: 11 });
  page.drawText(`${i + 1} / 3`, { x: 288, y: 35, font: regular, size: 10, color: rgb(.4,.4,.4) });
}
const textBytes = await text.save();
await writeFile(`${directory}/text.pdf`, textBytes);
await writeFile(`${directory}/含文字层的学习资料.pdf`, textBytes);

const scan = await PDFDocument.create();
scan.setTitle('Mojing image-only simulated scan / 扫描模拟'); scan.setAuthor('Mojing test suite');
scan.setSubject('Generated raster-only scan simulation; not a physical scanner capture; no OCR or text layer');
for (let i = 0; i < 2; i++) {
  const canvas = createCanvas(1224, 1584), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f8f6ef'; ctx.fillRect(0, 0, 1224, 1584);
  ctx.save(); ctx.translate(612, 792); ctx.rotate((i ? -.35 : .25) * Math.PI / 180); ctx.translate(-612, -792);
  ctx.fillStyle = '#252a28'; ctx.font = 'bold 48px "Fixture CJK", sans-serif'; ctx.fillText(`扫描模拟文档 · 第 ${i + 1} 页`, 96, 140);
  ctx.font = '25px "Fixture CJK", sans-serif'; ctx.fillText('此文件由位图生成，用于验证无文字层 PDF 的截图摘录。', 96, 208);
  ctx.fillText('它是测试夹具，不是由物理扫描仪采集的真实纸质扫描件。', 96, 254);
  ctx.strokeStyle = '#6e7870'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(96,285); ctx.lineTo(1128,285); ctx.stroke();
  ctx.font = '30px "Fixture CJK", sans-serif';
  const lines = ['从图像进入知识整理流程', '1. 阅读原文，并圈出需要理解的片段。', '2. 拖出一个矩形，将图像保存为知识卡片。', '3. 卡片保存文档、页码及 PDF 坐标。', '4. 从脑图节点回到原文，核对上下文。', '5. 重启并迁移学习集，检查图像和定位保留。'];
  lines.forEach((line, index) => ctx.fillText(line, 96, 360 + index * 65));
  ctx.strokeStyle = '#597267'; ctx.lineWidth = 4; ctx.strokeRect(96, 825, 1032, 300);
  ctx.fillStyle = '#185c50'; ctx.font = 'bold 42px "Fixture CJK", sans-serif'; ctx.fillText('图像摘录区域', 132, 895);
  ctx.fillStyle = '#333d38'; ctx.font = '30px "Fixture CJK", sans-serif'; ctx.fillText(`第 ${i + 1} 页：区域截图应与原文保持一致。`, 132, 960);
  ctx.fillText('No selectable text. Image-only test page.', 132, 1020);
  ctx.font = '24px sans-serif'; ctx.fillText(`SIMULATED SCAN ${i + 1}/2`, 450, 1490); ctx.restore();
  // Deterministic faint scan specks make the fixture visibly raster-only.
  let seed = 7343 + i;
  for (let n = 0; n < 1800; n++) { seed = (seed * 1664525 + 1013904223) >>> 0; const x = seed % 1224; seed = (seed * 1664525 + 1013904223) >>> 0; const y = seed % 1584; ctx.fillStyle = 'rgba(50,45,35,0.08)'; ctx.fillRect(x,y,1,1); }
  const png = canvas.toBuffer('image/png');
  const image = await scan.embedPng(png);
  const page = scan.addPage([612,792]); page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
}
const scanBytes = await scan.save();
await writeFile(`${directory}/scan.pdf`, scanBytes);
await writeFile(`${directory}/纯位图扫描模拟.pdf`, scanBytes);

let external = '未下载';
if (!process.argv.includes('--offline')) {
  try {
    const response = await fetch('https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf', { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!new TextDecoder().decode(bytes.slice(0, 16)).startsWith('%PDF-')) throw new Error('返回内容不是PDF');
    await writeFile(`${directory}/tracemonkey.pdf`, bytes); external = `${bytes.length} 字节，SHA-256 ${createHash('sha256').update(bytes).digest('hex')}`;
  } catch (error) { external = `下载失败：${error.message}`; }
}
let archivalNote = '';
try {
  const bytes = await readFile(`${directory}/archival-scan.pdf`);
  archivalNote = `\n- archival-scan.pdf：真实馆藏手稿扫描，16 页，Smithsonian Libraries and Archives 书目 letter00mace。书目 https://library.si.edu/digital-library/book/letter00mace ，原始数据 https://archive.org/metadata/letter00mace ，PDF https://archive.org/download/letter00mace/letter00mace.pdf 。第 4 页为清晰手写扫描，用于主验收；原文件部分页面已有不准确的 OCR 文字（第 1 页 301 字符、第 4 页 423 字符），不是本应用产生。第 2/3/6/16 页没有文字层。SHA-256 ${createHash('sha256').update(bytes).digest('hex')}；SHA-1 ${createHash('sha1').update(bytes).digest('hex')}。\n`;
} catch { /* This optional external fixture is downloaded separately. */ }
const readme = `# 阅读验收测试资料\n\n- text.pdf / 含文字层的学习资料.pdf：脚本生成，3 页，可搜索与选择的英文文字层，中文标题是嵌入位图。SHA-256 ${createHash('sha256').update(textBytes).digest('hex')}\n- scan.pdf / 纯位图扫描模拟.pdf：脚本生成，2 页纯位图，无文字层。仅为扫描版模拟测试夹具，不宣称来自真实纸质扫描。SHA-256 ${createHash('sha256').update(scanBytes).digest('hex')}\n- tracemonkey.pdf：Mozilla PDF.js 官方在线示例使用的真实外部研究论文，由原作者保留权利。来源 https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf 。本文件只用于本地互操作测试；不作为应用内容宣传。下载结果：${external}\n${archivalNote}\n生成命令：node scripts/make-fixtures.mjs（使用已锁定的 pdf-lib 与 PDF.js 开发依赖中的 @napi-rs/canvas）。主验收使用真实馆藏扫描时，设置 MOJING_SCAN_PDF 为 archival-scan.pdf 的绝对路径。\n`;
await writeFile(`${directory}/README.md`, readme);
console.log(`Fixtures written: ${directory}\ntext.pdf ${textBytes.length} bytes\nscan.pdf ${scanBytes.length} bytes\nExternal: ${external}`);
