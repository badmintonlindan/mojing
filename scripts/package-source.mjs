import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import path from 'node:path';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const skip = new Set(['.git', '.tools', 'node_modules', 'dist', 'release', '.test-data', 'test-results', 'playwright-report']);
const files = {};
async function walk(folder = '') {
  for (const item of await readdir(folder || '.', { withFileTypes: true })) {
    const relative = path.posix.join(folder, item.name);
    if (skip.has(item.name) || relative === 'public/pdf' || relative === 'android/app/src/main/assets' || relative === 'android/.gradle' || relative === 'android/local.properties' || relative === 'reports/android/tablet/render-diagnostics' || item.name === 'logcat.txt' || item.name === 'build' && folder.startsWith('android') || /\.(tsbuildinfo|log)$/.test(item.name)) continue;
    if (item.isDirectory()) await walk(relative);
    else if (item.isFile() && !(relative.startsWith('reports/') && /\.(mjstudy|zip|apk)$/.test(item.name))) files[`mojing-${version}/${relative}`] = new Uint8Array(await readFile(relative));
  }
}
await walk();
await mkdir('release', { recursive: true });
await writeFile(`release/墨径-${version}-源代码.zip`, zipSync(files, { level: 6 }));
console.log(`已打包 ${Object.keys(files).length} 个源文件、说明与测试证据。`);
