// Verify the artifacts actually exercised by native tests before archiving a release.
import { readFile, readdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const assert = (value, message) => { if (!value) throw new Error(message); };
const build = await json('reports/android/build-verification.json');
const apk = await readFile('release/墨径-0.1.0-Android.apk');
assert(hash(apk) === build.sha256, '交付APK与构建记录不一致');
assert(hash(await readFile(build.apk)) === build.sha256, '构建输出与交付APK不一致');
const apkFiles = unzipSync(apk);
let distFiles = 0;
async function verifyDist(folder = '') {
  for (const entry of await readdir(`dist/${folder}`, { withFileTypes: true })) {
    const relative = `${folder}${entry.name}`;
    if (entry.isDirectory()) { await verifyDist(`${relative}/`); continue; }
    const bytes = await readFile(`dist/${relative}`), digest = hash(bytes);
    assert(digest === hash(await readFile(`release/墨径-Windows-x64/resources/app/dist/${relative}`)), `Windows资源不同: ${relative}`);
    assert(apkFiles[`assets/public/${relative}`] && digest === hash(apkFiles[`assets/public/${relative}`]), `APK资源不同: ${relative}`);
    distFiles++;
  }
}
await verifyDist();
for (const file of ['main.cjs', 'preload.cjs']) assert(hash(await readFile(`electron/${file}`)) === hash(await readFile(`release/墨径-Windows-x64/resources/app/electron/${file}`)), `Windows桥接不同: ${file}`);
await access('release/墨径-Windows-x64/LICENSE');
await access('release/墨径-Windows-x64/LICENSES.chromium.html');
const phone = await json('reports/android/phone/result.json');
const tablet = await json('reports/android/tablet/resume-restart-result.json');
assert((await json('reports/android/tablet/acceptance-final.json')).completed === true, '平板汇总验收未完成');
const exchanges = [];
for (const [label, report] of [['phone', phone], ['tablet', tablet]]) {
  assert(report.completed === true && !report.errors.length, `${label}运行未通过`);
  assert(report.runtime.scripts.some(url => url.endsWith(build.js)), `${label}测试入口不是交付入口`);
  assert(report.network.airplaneMode === '1', `${label}缺少离线证据`);
  const installed = await json(`reports/android/${label}/installed-artifact.json`);
  assert(installed.installedSha256 === build.sha256, `${label}实装APK不同`);
  const bytes = await readFile(report.export.path);
  assert(hash(bytes) === report.export.sha256 && bytes.length === report.export.bytes && report.export.cacheCleaned, `${label}系统导出不完整`);
  const reverse = await json(`reports/roundtrip/windows-from-android-${label}.json`);
  assert(reverse.completed === true && !reverse.errors.length && reverse.inputSha256 === hash(bytes), `${label}Windows回导未通过`);
  assert(reverse.rendererEntry.endsWith(build.js), `${label}Windows回导构建不同`);
  exchanges.push({ platform: label, bytes: bytes.length, sha256: hash(bytes), metrics: reverse.metrics });
}
const preRestartBytes = await readFile('reports/android/tablet/result.json');
assert(hash(preRestartBytes) === tablet.resumes.sha256, '平板前后阶段关联摘要不一致');
assert(JSON.parse(preRestartBytes).steps.length >= 8, '平板前段步骤不足');
assert((await json('reports/android/tablet/physical-splitter-result.json')).completed, '平板真实触摸分栏未通过');
assert((await json('reports/android/phone/touch-result.json')).completed, '手机真实触摸导航未通过');
assert((await json('reports/android/phone/cancel-export-result.json')).completed, 'Android取消导出未通过');
for (const file of ['README.md', 'docs/USER-GUIDE.md', 'docs/BUILD.md', 'docs/TEST-REPORT.md', 'docs/KNOWN-ISSUES.md', 'docs/PLAN.md', 'docs/ROADMAP.md']) await access(file);
const result = { completed: true, verifiedAt: new Date().toISOString(), application: '墨径', version: '0.1.0', apk: { bytes: apk.length, sha256: hash(apk) }, entry: build.js, identicalDistFilesAcrossWindowsAndApk: distFiles, exchanges, scope: 'Artifact identity and existing native-test evidence; this does not replace the UI tests or claim physical stylus testing.' };
await writeFile('reports/delivery-verification.json', JSON.stringify(result, null, 2) + '\n');
console.log(`交付核验通过：${distFiles}个共享资源逐字节一致，两个Android实际导出包均由交付Windows程序回导并重启。`);
