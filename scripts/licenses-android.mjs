/** Collect Android *runtime* notices; never treat the whole Gradle cache as an APK inventory. */
import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import path from 'node:path';
import { unzipSync } from 'fflate';

const root = path.resolve(import.meta.dirname, '..');
setDefaultResultOrder('ipv4first');
const output = path.join(root, 'public/licenses/android');
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const reportPath = path.resolve(option('--runtime-report', path.join(root, 'reports/android-runtime-dependencies.txt')));
const cache = path.resolve(option('--cache', process.env.GRADLE_USER_HOME ? path.join(process.env.GRADLE_USER_HOME, 'caches/modules-2/files-2.1') : path.join(root, '.tools/gradle-cache/caches/modules-2/files-2.1')));
const sourcesOnly = process.argv.includes('--sources-only');
const offline = process.argv.includes('--offline');
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const relative = file => path.relative(root, file).replaceAll('\\', '/');
const escaped = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const xmlText = value => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
const tag = (xml, name) => xmlText(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))?.[1] ?? '');
const files = [];
const warnings = [];
await mkdir(output, { recursive: true });
const buildInputs = ['android/app/build.gradle', 'android/variables.gradle', 'android/app/capacitor.build.gradle', 'node_modules/@capacitor/android/capacitor/build.gradle', 'node_modules/@capacitor/filesystem/android/build.gradle', 'node_modules/@capacitor/android/package.json', 'node_modules/@capacitor/filesystem/package.json'];
if (process.argv.includes('--verify-existing')) {
  const existing = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  if (!existing.completeRuntimeInventory || !Array.isArray(existing.files) || !Array.isArray(existing.buildInputs)) throw new Error('Android运行时许可清单尚不完整，请从最终runtime报告重新生成。');
  for (const item of existing.files) {
    const filename = path.resolve(output, item.file);
    if (!filename.startsWith(`${output}${path.sep}`)) throw new Error('声明清单含不安全文件路径');
    const bytes = await readFile(filename);
    if (hash(bytes) !== item.sha256 || bytes.length !== item.bytes) throw new Error(`Android许可全文校验失败：${item.file}`);
  }
  for (const input of existing.buildInputs) if (hash(await readFile(path.join(root, input.file))) !== input.sha256) throw new Error(`原生依赖配置已变更：${input.file}；请重新解析debugRuntimeClasspath并生成Android许可清单。`);
  console.log(`Android运行时许可核验通过：${existing.inventory.filter(item => !item.metadataOnly).length} 个二进制组件，${existing.files.length} 份完整文件；无需访问Gradle缓存或网络。`);
  process.exit(0);
}

async function recordFile(target, bytes, metadata) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  const item = { ...metadata, file: path.relative(output, target).replaceAll('\\', '/'), bytes: bytes.length, sha256: hash(bytes) };
  files.push(item);
  return item.file;
}

async function download(url, destination, kind) {
  const target = path.join(output, destination);
  let bytes;
  if (await exists(target) && !process.argv.includes('--refresh')) bytes = await readFile(target);
  else {
    if (offline) throw new Error(`离线缺少许可全文：${destination}`);
    let error;
    for (let n = 0; n < 3; n++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'Mojing-license-audit/0.1' } });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
        bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length || /<html|<!doctype html/i.test(new TextDecoder().decode(bytes.slice(0, 400)))) throw new Error(`返回内容不是许可文本：${url}`);
        break;
      } catch (e) { error = e; }
    }
    if (!bytes) throw new Error(`许可下载失败 ${url}: ${error?.message || error}`);
  }
  return recordFile(target, bytes, { kind, sourceUrl: url, unmodified: true });
}

// Exact tagged source notices supplement AAR/JARs that publish only a license URL.
// Kotlin stdlib has incorporated BSD/Boost/Google-derived code; Apache-2.0 alone is insufficient.
const sourceSpecs = [
  ['common/Apache-2.0.txt', 'https://raw.githubusercontent.com/apache/cordova-android/14.0.1/LICENSE', 'license-full-text'],
  ['cordova-android-14.0.1/NOTICE', 'https://raw.githubusercontent.com/apache/cordova-android/14.0.1/NOTICE', 'upstream-notice'],
  ['ionfilesystem-android-1.1.1/LICENSE', 'https://raw.githubusercontent.com/ionic-team/ion-android-filesystem/main/LICENSE', 'license-full-text'],
  ['kotlin-2.2.20/LICENSE.txt', 'https://raw.githubusercontent.com/JetBrains/kotlin/v2.2.20/license/LICENSE.txt', 'license-full-text'],
  ['kotlin-2.2.20/COPYRIGHT.txt', 'https://raw.githubusercontent.com/JetBrains/kotlin/v2.2.20/license/COPYRIGHT.txt', 'upstream-copyright'],
  ['kotlin-2.2.20/README.md', 'https://raw.githubusercontent.com/JetBrains/kotlin/v2.2.20/license/README.md', 'upstream-license-map'],
  ...['gwt_license.txt', 'threetenbp_license.txt', 'guava_license.txt', 'boost_LICENSE.txt'].map(name => [`kotlin-2.2.20/third_party/${name}`, `https://raw.githubusercontent.com/JetBrains/kotlin/v2.2.20/license/third_party/${name}`, 'stdlib-incorporated-code-license']),
  ['kotlinx-coroutines-1.10.2/LICENSE.txt', 'https://raw.githubusercontent.com/Kotlin/kotlinx.coroutines/1.10.2/LICENSE.txt', 'license-full-text'],
  ['jetbrains-annotations-23.0.0/LICENSE.txt', 'https://raw.githubusercontent.com/JetBrains/java-annotations/23.0.0/LICENSE.txt', 'license-full-text'],
  ['jspecify-1.0.0/LICENSE', 'https://raw.githubusercontent.com/jspecify/jspecify/v1.0.0/LICENSE', 'license-full-text'],
  ['guava-listenablefuture-1.0/COPYING', 'https://raw.githubusercontent.com/google/guava/v26.0/COPYING', 'license-full-text'],
];
if (process.argv.includes('--download-plan')) { console.log(JSON.stringify(sourceSpecs)); process.exit(0); }
const downloads = await Promise.allSettled(sourceSpecs.map(([destination, url, kind]) => download(url, destination, kind)));
for (const item of downloads) if (item.status === 'rejected') throw item.reason;

const nativeProjects = [];
for (const [project, location] of [[':capacitor-android', '@capacitor/android'], [':capacitor-filesystem', '@capacitor/filesystem']]) {
  const folder = path.join(root, 'node_modules', location);
  const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
  const names = await readdir(folder);
  const name = names.find(name => /^licen[cs]e(?:\.txt|\.md)?$/i.test(name));
  if (!name) throw new Error(`${location} 未找到完整许可证`);
  const file = await recordFile(path.join(output, `native-projects/${location.replaceAll('/', '__').replaceAll('@', '')}@${pkg.version}/${name}`), await readFile(path.join(folder, name)), { kind: 'native-project-license', project, source: relative(path.join(folder, name)), unmodified: true });
  nativeProjects.push({ project, package: pkg.name, version: pkg.version, license: pkg.license, noticeFiles: [file] });
}

const pomCache = new Map();
async function artifactFiles(group, artifact, version) {
  const folder = path.join(cache, group, artifact, version);
  const result = [];
  if (!await exists(folder)) return result;
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const name of await readdir(path.join(folder, entry.name))) result.push(path.join(folder, entry.name, name));
  }
  return result;
}
async function pomDetails(group, artifact, version, visited = new Set()) {
  const coordinate = `${group}:${artifact}:${version}`;
  if (pomCache.has(coordinate)) return pomCache.get(coordinate);
  if (visited.has(coordinate)) throw new Error(`POM parent循环：${coordinate}`);
  const candidates = await artifactFiles(group, artifact, version);
  const filename = candidates.find(file => path.basename(file) === `${artifact}-${version}.pom`);
  if (!filename) return null;
  const xml = await readFile(filename, 'utf8');
  const licensesXml = xml.match(/<licenses>([\s\S]*?)<\/licenses>/)?.[1] ?? '';
  let licenses = [...licensesXml.matchAll(/<license>([\s\S]*?)<\/license>/g)].map(match => ({ name: tag(match[1], 'name'), url: tag(match[1], 'url') }));
  const parentXml = xml.match(/<parent>([\s\S]*?)<\/parent>/)?.[1];
  let inheritedFrom;
  if (!licenses.length && parentXml) {
    const parent = [tag(parentXml, 'groupId'), tag(parentXml, 'artifactId'), tag(parentXml, 'version')];
    const info = await pomDetails(...parent, new Set(visited).add(coordinate));
    if (info) { licenses = info.licenses; inheritedFrom = parent.join(':'); }
  }
  const info = { filename, xml, licenses, inheritedFrom, projectUrl: tag(xml, 'url'), organization: tag(xml.match(/<organization>([\s\S]*?)<\/organization>/)?.[1] ?? '', 'name') };
  pomCache.set(coordinate, info); return info;
}

function runtimeCoordinates(report) {
  const coordinates = new Map();
  let inRuntime = false;
  for (const line of report.split(/\r?\n/)) {
    if (/^debugRuntimeClasspath\b/.test(line)) { inRuntime = true; continue; }
    if (!inRuntime) continue;
    if (/^\S/.test(line) && !/^[+\\| ]/.test(line)) { if (/^\w.*Classpath\b/.test(line)) inRuntime = false; }
    if (line.includes(' FAILED')) throw new Error(`Runtime依赖未完整解析：${line.trim()}`);
    if (/\(c\)\s*$/.test(line)) continue;
    const match = line.match(/(?:\+---|\\---)\s+([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([^\s]+)(?:\s+->\s+([^\s]+))?/);
    if (!match) continue;
    const [, group, artifact, declared, replacement] = match;
    let version = replacement ?? declared;
    // Component replacement may include a full group:name:version, not just a version.
    if (version.includes(':')) {
      const replacementParts = version.split(':');
      if (replacementParts.length !== 3) throw new Error(`不支持的runtime替换行：${line}`);
      coordinates.set(replacementParts.join(':'), replacementParts); continue;
    }
    if (/[\[\]{}(),]/.test(version)) throw new Error(`Runtime版本未固定：${line}`);
    coordinates.set(`${group}:${artifact}:${version}`, [group, artifact, version]);
  }
  if (!coordinates.size) throw new Error('依赖报告缺少已解析的 debugRuntimeClasspath 树');
  return [...coordinates.values()].sort((a, b) => a.join(':').localeCompare(b.join(':')));
}

const isNotice = name => /(?:^|\/)(?:license(?:s)?|licence|notice|copying|copyright)(?:[._-]|$)/i.test(name);
async function embeddedNotices(bytes, base, provenance, depth = 0) {
  if (depth > 2) throw new Error('运行时归档嵌套超出预期');
  const archive = unzipSync(bytes), result = [];
  for (const [name, data] of Object.entries(archive)) {
    if (name.includes('..') || name.includes('\\') || name.startsWith('/')) throw new Error('运行时归档包含不安全路径');
    if (isNotice(name)) result.push(await recordFile(path.join(output, base, name), data, { ...provenance, kind: 'embedded-notice', entry: name, unmodified: true }));
    else if (name.endsWith('.jar')) result.push(...await embeddedNotices(data, `${base}/${name}.contents`, { ...provenance, enclosingEntry: name }, depth + 1));
  }
  return result;
}
function supplementalFiles(group, artifact) {
  if (group.startsWith('androidx.')) return ['common/Apache-2.0.txt'];
  if (group === 'org.apache.cordova') return ['common/Apache-2.0.txt', 'cordova-android-14.0.1/NOTICE'];
  if (group === 'io.ionic.libs' && artifact === 'ionfilesystem-android') return ['ionfilesystem-android-1.1.1/LICENSE'];
  if (group === 'org.jetbrains.kotlin' && artifact === 'kotlin-stdlib') return files.filter(file => file.file.startsWith('kotlin-2.2.20/')).map(file => file.file);
  if (group === 'org.jetbrains.kotlinx' && ['kotlinx-coroutines-core-jvm', 'kotlinx-coroutines-android'].includes(artifact)) return ['kotlinx-coroutines-1.10.2/LICENSE.txt'];
  if (group === 'org.jetbrains' && artifact === 'annotations') return ['jetbrains-annotations-23.0.0/LICENSE.txt'];
  if (group === 'org.jspecify' && artifact === 'jspecify') return ['jspecify-1.0.0/LICENSE'];
  if (group === 'com.google.guava' && artifact === 'listenablefuture') return ['guava-listenablefuture-1.0/COPYING'];
  throw new Error(`新增Android运行时组件尚需人工核实许可：${group}:${artifact}`);
}

const inventory = [];
let report;
if (!sourcesOnly) {
  report = await readFile(reportPath, 'utf8');
  for (const [group, artifact, version] of runtimeCoordinates(report)) {
    const coordinate = `${group}:${artifact}:${version}`;
    const candidates = await artifactFiles(group, artifact, version);
    const binaries = candidates.filter(file => [`.jar`, `.aar`].some(ext => path.basename(file) === `${artifact}-${version}${ext}`));
    const pom = await pomDetails(group, artifact, version);
    if (!pom) throw new Error(`缺少运行时POM：${coordinate}`);
    if (!pom.licenses.length) throw new Error(`POM未声明可解析的许可：${coordinate}`);
    const sourceLockedVersions = { 'org.apache.cordova:framework': '14.0.1', 'io.ionic.libs:ionfilesystem-android': '1.1.1', 'org.jetbrains.kotlin:kotlin-stdlib': '2.2.20', 'org.jetbrains:annotations': '23.0.0', 'org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm': '1.10.2', 'org.jetbrains.kotlinx:kotlinx-coroutines-android': '1.10.2', 'org.jspecify:jspecify': '1.0.0', 'com.google.guava:listenablefuture': '1.0' };
    if (binaries.length && sourceLockedVersions[`${group}:${artifact}`] && sourceLockedVersions[`${group}:${artifact}`] !== version) throw new Error(`需更新对应版本的源项目许可证及审计：${coordinate}`);
    const moduleFile = candidates.find(file => path.basename(file) === `${artifact}-${version}.module`);
    const redirectsToPlatformVariant = moduleFile ? (await readFile(moduleFile, 'utf8')).includes('"available-at"') : false;
    if (!binaries.length && tag(pom.xml, 'packaging') !== 'pom' && !redirectsToPlatformVariant) throw new Error(`缺少已解析组件的实际二进制，不能标记为元数据：${coordinate}`);
    const verifiedLicense = group === 'io.ionic.libs' && artifact === 'ionfilesystem-android' ? 'MIT' : pom.licenses.every(license => /apache\.org\/licenses\/LICENSE-2\.0/i.test(license.url)) ? 'Apache-2.0' : null;
    if (binaries.length && !verifiedLicense) throw new Error(`需单独核实非Apache/MIT运行时许可：${coordinate}`);
    const base = `artifacts/${group}__${artifact}@${version}`;
    const pomFile = await recordFile(path.join(output, base, `${artifact}-${version}.pom`), await readFile(pom.filename), { kind: 'runtime-pom', coordinate, source: relative(pom.filename), unmodified: true });
    const binaryRecords = [], noticeFiles = [];
    for (const filename of binaries) {
      const bytes = await readFile(filename);
      binaryRecords.push({ name: path.basename(filename), bytes: bytes.length, sha256: hash(bytes) });
      noticeFiles.push(...await embeddedNotices(bytes, `${base}/${path.basename(filename)}.contents`, { coordinate, source: relative(filename) }));
    }
    if (binaries.length) noticeFiles.push(...supplementalFiles(group, artifact));
    inventory.push({ coordinate, group, artifact, version, metadataOnly: !binaries.length, projectUrl: pom.projectUrl, organization: pom.organization, verifiedLicense, licenses: pom.licenses, inheritedFrom: pom.inheritedFrom, pomFile, binaries: binaryRecords, noticeFiles: [...new Set(noticeFiles)] });
  }
  for (const [coordinate, pom] of pomCache) if (!files.some(item => item.coordinate === coordinate && item.kind === 'runtime-pom')) {
    await recordFile(path.join(output, `inherited-poms/${coordinate.replaceAll(':', '__')}.pom`), await readFile(pom.filename), { kind: 'inherited-parent-pom', coordinate, source: relative(pom.filename), unmodified: true });
  }
} else warnings.push('仅下载源项目许可补充；尚未读取最终 debugRuntimeClasspath，不可视为APK运行时完整审计。');

const manifest = { format: 'mojing.android-runtime-notices', version: 1, generatedAt: new Date().toISOString(), completeRuntimeInventory: !sourcesOnly, configuration: 'debugRuntimeClasspath', dependencyReport: report ? relative(reportPath) : null, dependencyReportSha256: report ? hash(Buffer.from(report)) : null, buildInputs: await Promise.all(buildInputs.map(async file => ({ file, sha256: hash(await readFile(path.join(root, file))) }))), nativeProjects, inventory, files, warnings, excluded: ['Android Gradle Plugin', 'Kotlin compiler / Gradle plugins', 'JDK and Android SDK tools', 'testImplementation/androidTestImplementation', 'Device-installed Android System WebView/OS'] };
await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
if (report) await copyFile(reportPath, path.join(output, 'runtime-dependencies.txt'));
const rows = inventory.map(item => `<tr><td>${escaped(item.coordinate)}${item.metadataOnly ? '<br><small>仅解析元数据，不含运行时二进制</small>' : ''}</td><td>${item.licenses.map(license => `${escaped(license.name)}<br><a href="${escaped(license.url)}">POM许可来源</a>`).join('<br>')}</td><td><a href="${item.pomFile}">原始POM</a>${item.noticeFiles.map(file => `<br><a href="${file}">${escaped(file)}</a>`).join('')}</td></tr>`).join('\n');
await writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>墨径 Android 原生运行时许可</title><style>body{font:14px/1.7 system-ui,sans-serif;max-width:1100px;margin:30px auto;padding:0 16px;color:#24473b}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dce5d5;padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}a{color:#185c50}small{color:#72836d}</style><h1>Android 原生运行时许可证与声明</h1><p>此清单仅依据应用的 <code>debugRuntimeClasspath</code> 解析结果及确切版本缓存，不将整个 Gradle 构建工具缓存认作应用组件。完整清单、二进制/声明 SHA-256 和来源见 <a href="manifest.json">manifest.json</a>。</p>${warnings.map(warning => `<p>${escaped(warning)}</p>`).join('')}<p>APK还使用网页层的 <a href="../index.html">JavaScript、PDF.js 解码器和字体声明</a>。Kotlin标准库源项目标明的 Google、BSD-3-Clause、Boost 派生代码许可已保留全文。原生 Capacitor / Filesystem 的 MIT 全文也在本目录。</p><table><thead><tr><th>实际解析组件</th><th>POM许可声明</th><th>未修改的全文/NOTICE/POM</th></tr></thead><tbody>${rows}</tbody></table><h2>源项目补充许可全文</h2><ul>${files.filter(file => file.kind !== 'runtime-pom' && file.kind !== 'embedded-notice').map(file => `<li><a href="${file.file}">${escaped(file.file)}</a></li>`).join('')}</ul></html>\n`);
console.log(`Android原生许可：${inventory.filter(i => !i.metadataOnly).length} 个运行时二进制组件，${files.length} 个全文/声明/POM，完整运行时清单=${!sourcesOnly}。`);
