import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const files = [];
for (const name of await readdir('release')) {
  if (!/\.(apk|zip|mjstudy)$/.test(name)) continue;
  const bytes = await readFile(`release/${name}`), info = await stat(`release/${name}`);
  files.push({ file: name, bytes: info.size, sha256: createHash('sha256').update(bytes).digest('hex') });
}
files.sort((a,b) => a.file.localeCompare(b.file, 'zh-CN'));
const manifest = { application: '墨径', version: '0.1.0', generatedAt: new Date().toISOString(), files };
await writeFile('release/manifest.json', JSON.stringify(manifest,null,2)+'\n');
await writeFile('release/SHA256SUMS.txt', files.map(item => `${item.sha256} *${item.file}`).join('\n')+'\n');
console.log(`已记录 ${files.length} 份交付文件的字节数与 SHA-256。`);
