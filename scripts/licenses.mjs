/** Copy unmodified license/notice texts from the exact installed, locked packages. */
import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'public/licenses');
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const exists = async name => { try { await access(name); return true; } catch { return false; } };
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
const isNotice = name => /^(?:licen[cs]e|notice|copyright|copying|authors)/i.test(name);
const htmlEscape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const copied = [];
const inventory = [];
const warnings = [];
await mkdir(output, { recursive: true });

async function copyNotice(source, relativeOutput, metadata) {
  const bytes = await readFile(source);
  if (!bytes.length) throw new Error(`空许可证文件：${path.relative(root, source)}`);
  const target = path.join(output, relativeOutput);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
  copied.push({ ...metadata, file: relativeOutput.replaceAll('\\', '/'), source: path.relative(root, source).replaceAll('\\', '/'), bytes: bytes.length, sha256: checksum(bytes) });
}

for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location || (entry.dev && location !== 'node_modules/electron')) continue;
  const folder = path.join(root, location);
  const packageName = location.slice(location.lastIndexOf('node_modules/') + 13);
  const record = { name: packageName, version: entry.version, license: entry.license || '见原文件', optional: !!entry.optional, installed: await exists(folder), location };
  inventory.push(record);
  if (!record.installed) {
    if (!entry.optional) throw new Error(`缺少锁定的生产依赖：${location}；请先 npm ci。`);
    continue; // Platform-specific optional binaries absent on this machine are not distributed.
  }
  const packageJson = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
  if (packageJson.version !== entry.version) throw new Error(`安装版本不符合锁文件：${packageJson.name}（已安装 ${packageJson.version}，锁定 ${entry.version}）。请 npm ci 后重新收集。`);
  record.name = packageJson.name;
  const targetBase = `packages/${record.name.replaceAll('@', '').replaceAll('/', '__')}@${record.version}`;
  const notices = (await readdir(folder, { withFileTypes: true })).filter(file => file.isFile() && isNotice(file.name));
  if (!notices.length && record.name.startsWith('@napi-rs/canvas-')) {
    // The native optional package has no separate text; its package.json identifies the
    // same canvas project/version and MIT license. The binary is Node-only, never copied
    // into the browser/Android/Electron app payload by our packaging scripts.
    const parent = path.join(root, 'node_modules/@napi-rs/canvas/LICENSE');
    await copyNotice(parent, `${targetBase}/LICENSE-from-canvas-project`, { package: record.name, version: record.version, license: record.license, note: '来自同版本 canvas 源项目；Node-only 可选二进制不随墨径应用分发' });
    continue;
  }
  if (!notices.length) throw new Error(`生产依赖没有可收集的全文许可证：${record.name}@${record.version}`);
  for (const notice of notices) await copyNotice(path.join(folder, notice.name), `${targetBase}/${notice.name}`, { package: record.name, version: record.version, license: record.license });
}

for (const group of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const folder = path.join(root, 'node_modules/pdfjs-dist', group);
  const entries = await readdir(folder, { withFileTypes: true });
  const notices = entries.filter(file => file.isFile() && isNotice(file.name));
  if (!notices.length) throw new Error(`PDF.js ${group} 未找到许可证。`);
  for (const notice of notices) await copyNotice(path.join(folder, notice.name), `pdf-assets/${group}/${notice.name}`, { package: `pdfjs-dist/${group}`, version: lock.packages['node_modules/pdfjs-dist'].version, license: '以各文件全文为准' });
}

const electronRoot = path.join(root, 'node_modules/electron/dist');
const electronNotices = ['LICENSE', 'LICENSES.chromium.html'];
const runtimeReady = (await Promise.all(electronNotices.map(file => exists(path.join(electronRoot, file))))).every(Boolean);
if (!runtimeReady) {
  const message = 'Electron 预编译运行时尚不完整；Windows 打包前必须下载运行时并保留 LICENSE / LICENSES.chromium.html。';
  if (process.argv.includes('--require-electron')) throw new Error(message);
  warnings.push(message);
}
// Chromium notices stay in the Windows portable folder beside the executable.
// Avoid adding the desktop-only Chromium runtime notices to every Android APK.
const metadata = { format: 'mojing.third-party-notices', version: 1, lockfileVersion: lock.lockfileVersion, lockfileSha256: checksum(await readFile(path.join(root, 'package-lock.json'))), inventory, files: copied, electronRuntime: { installed: runtimeReady, preserveFiles: electronNotices }, warnings };
await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(metadata, null, 2)}\n`);
const rows = copied.map(item => `<tr><td>${htmlEscape(item.package)}<br><small>${htmlEscape(item.version)}</small></td><td>${htmlEscape(item.license)}</td><td><a href="${item.file.split('/').map(encodeURIComponent).join('/')}">${htmlEscape(path.basename(item.file))}</a>${item.note ? `<br><small>${htmlEscape(item.note)}</small>` : ''}</td></tr>`).join('\n');
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>墨径 · 第三方许可</title><style>body{font:15px/1.8 system-ui,sans-serif;color:#24463b;background:#fafbf7;margin:32px auto;padding:0 20px;max-width:1000px}h1{font-size:24px}table{border-collapse:collapse;width:100%;background:white}td,th{border:1px solid #dce5d5;padding:12px;text-align:left;vertical-align:top}small{color:#687e61}a{color:#185c50}code{overflow-wrap:anywhere}</style><h1>墨径 · 第三方许可证全文</h1><p>此页由锁定的实际安装包生成。点击文件名查看未修改的原始许可与版权声明；其 SHA-256 及来源路径记录在 <a href="manifest.json">manifest.json</a>。</p><p>PDF.js 的 CMaps、字体、WASM 解码器和 ICC 资源分别保留其附带许可。Windows 便携目录还必须保留 Electron 的 <code>LICENSE</code> 和 <code>LICENSES.chromium.html</code>；它们包含桌面运行时的完整声明。</p><p><a href="android/index.html">Android 原生运行库的许可与声明</a></p><table><thead><tr><th>组件 / 版本</th><th>许可元数据</th><th>原始文件</th></tr></thead><tbody>${rows}</tbody></table><p>未安装的平台专用可选二进制不随本机构建分发。清单也保留了构建时安装、但不会进入浏览器包的类型定义与 Node-only Canvas 项目。</p>${warnings.length ? `<p>${warnings.map(htmlEscape).join('<br>')}</p>` : ''}</html>\n`);
console.log(`已收集 ${copied.length} 个完整许可证/声明；生产依赖清单 ${inventory.length} 项；目录 public/licenses。`);
for (const warning of warnings) console.warn(warning);
