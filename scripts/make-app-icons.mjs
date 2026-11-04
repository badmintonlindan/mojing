import { createCanvas } from '@napi-rs/canvas';
import { mkdir, writeFile } from 'node:fs/promises';
const green = '#185c50', cream = '#f2e3b7';
function icon(size, foreground = false) {
  const canvas = createCanvas(size, size), c = canvas.getContext('2d');
  if (!foreground) { c.fillStyle = green; c.beginPath(); c.roundRect(size * .035, size * .035, size * .93, size * .93, size * .2); c.fill(); }
  const unit = foreground ? size * .62 : size * .9, offset = (size - unit) / 2;
  c.save(); c.translate(offset, offset); c.scale(unit, unit); c.strokeStyle = cream; c.lineWidth = .043; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(.5, .34); c.bezierCurveTo(.39, .24, .26, .27, .22, .30); c.lineTo(.22, .68); c.bezierCurveTo(.31, .64, .40, .65, .5, .73); c.bezierCurveTo(.60, .65, .69, .64, .78, .68); c.lineTo(.78, .30); c.bezierCurveTo(.69, .26, .59, .27, .5, .34); c.lineTo(.5, .73); c.stroke(); c.restore();
  return canvas.toBuffer('image/png');
}
await mkdir('public', { recursive: true });
const png = icon(256);
await writeFile('public/mojing.png', png);
const ico = Buffer.alloc(22); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
await writeFile('public/mojing.ico', Buffer.concat([ico, png]));
for (const [dpi, factor] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
  const folder = `android/app/src/main/res/mipmap-${dpi}`; await mkdir(folder, { recursive: true });
  for (const name of ['ic_launcher', 'ic_launcher_round']) await writeFile(`${folder}/${name}.png`, icon(48 * factor));
  await writeFile(`${folder}/ic_launcher_foreground.png`, icon(108 * factor, true));
}
console.log('已生成墨径自有书本图标（纯绘制、无网络字体或图片依赖）。');
