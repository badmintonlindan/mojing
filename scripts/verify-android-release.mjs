/** Check the Android artifact against its actual native/browser evidence. */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireTrue = (value, message) => { if (!value) throw new Error(message); };
const { version } = await json('package.json');
const artifact = `release/墨径-${version}-Android.apk`;
const bytes = await readFile(artifact), digest = hash(bytes), files = unzipSync(bytes);
const native = await json(`reports/${version}/android-tablet/result.json`);
requireTrue(native.completed && !native.errors.length && native.apkSha256 === digest && native.installedSha256 === digest, '交付APK与实际安装测试不一致');
const entry = native.entry.split('/').at(-1);
requireTrue((await readFile('dist/index.html', 'utf8')).includes(entry), '生产入口与原生测试不同');
let count = 0;
async function verifyDist(directory = '') {
  for (const item of await readdir(`dist/${directory}`, { withFileTypes: true })) {
    const relative = directory + item.name;
    if (item.isDirectory()) { await verifyDist(`${relative}/`); continue; }
    const payload = await readFile(`dist/${relative}`);
    requireTrue(files[`assets/public/${relative}`] && hash(files[`assets/public/${relative}`]) === hash(payload), `APK资源字节不一致: ${relative}`);
    count++;
  }
}
await verifyDist();
const sidebar = [], zoom = [];
for (const filename of (await readdir('reports/sidebar')).filter(name => name.endsWith('.json'))) {
  const result = await json(`reports/sidebar/${filename}`);
  requireTrue(result.completed && !result.errors.length && result.rendererEntry.endsWith(entry), `侧栏回归未通过当前版本: ${filename}`);
  sidebar.push(filename);
}
for (const filename of (await readdir(`reports/zoom-${version}/final`)).filter(name => name.endsWith('.json'))) {
  const result = await json(`reports/zoom-${version}/final/${filename}`);
  requireTrue(result.status === 'passed' && !result.errors.length && result.runtime.scripts.some(url => url.endsWith(entry)), `缩放回归未通过当前版本: ${filename}`);
  zoom.push(filename);
}
requireTrue(sidebar.length === 4 && zoom.length === 4, '必须具备4项侧栏和4项缩放交互证据');
const result = { completed: true, version, verifiedAt: new Date().toISOString(), artifact, bytes: bytes.length, sha256: digest, entry, identicalDistFiles: count, nativeEvidence: `reports/${version}/android-tablet/result.json`, sidebarTests: sidebar.length, zoomTests: zoom.length, limits: 'Android tablet AVD and installed Chrome; no claim of Huawei hardware verification.' };
await writeFile(`reports/${version}/delivery-verification.json`, JSON.stringify(result, null, 2) + '\n');
console.log(`Android交付核验通过：${count}个资源逐字节一致；4项侧栏、4项缩放与实装APK均为${entry}。`);
