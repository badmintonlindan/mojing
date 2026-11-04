import { cp, mkdir } from 'node:fs/promises';
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await mkdir(`public/pdf/${name}`, { recursive: true });
  await cp(`node_modules/pdfjs-dist/${name}`, `public/pdf/${name}`, { recursive: true });
}
