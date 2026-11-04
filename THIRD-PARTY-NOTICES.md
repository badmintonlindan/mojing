# 墨径第三方组件与资源声明

依赖的精确版本由 `package-lock.json` 固定。以下表格便于定位，不能替代随应用提供的许可证全文。

| 组件 | 本次锁定版本 | 许可元数据 | 用途 |
| --- | --- | --- | --- |
| React / React DOM | 19.3.1 | MIT | 共用界面 |
| PDF.js (`pdfjs-dist`) | 6.5.438 | Apache-2.0 | PDF 解析、文字层、渲染 |
| Capacitor Core / Android | 8.6.0 | MIT | Android 原生包装与桥接 |
| Capacitor Filesystem | 8.1.5 | MIT | Android 应用私有文件 |
| fflate | 0.8.3 | MIT | 完整学习集及 Markdown ZIP |
| Lucide React | 1.67.0 | ISC | 界面图标 |
| Electron | 45.2.2 | MIT，另含 Chromium/Node 等声明 | Windows 桌面运行时 |
| TypeScript | 7.0.2 | Apache-2.0 | 构建工具；不随网页作为运行时分发 |

`node scripts/licenses.mjs` 从实际安装且与锁文件一致的生产依赖、Electron 包以及 PDF.js 附带资源中收集原始全文，输出到 `public/licenses/`。`public/licenses/index.html` 提供可离线打开的目录；`manifest.json` 记录依赖版本、许可元数据、原文件路径、大小和 SHA-256。构建后这些文件位于 `dist/licenses/`，再随 Android assets 或 Windows app 资源分发。

本次收集的 PDF.js 附带资源包括：

- `cmaps/LICENSE`。
- `standard_fonts/LICENSE_FOXIT`、`LICENSE_LIBERATION`。
- `wasm/LICENSE_JBIG2`、`LICENSE_OPENJPEG`、`LICENSE_QCMS`、`LICENSE_QUICKJS`，以及对应 PDF.js 适配代码的 Apache 许可声明。
- `iccs/LICENSE`。

原始许可同时保留在随应用复制的 `pdf/` 对应资源目录。资源许可各不相同，分发时不能仅保留 PDF.js 主许可证。应用只通过 API 使用 PDF.js，未将其源码声明替换为墨径的版权声明。

Windows 包通过完整复制 Electron 官方预编译目录构建，必须保留可执行程序旁的 `LICENSE`、`LICENSES.chromium.html` 及原有运行时资源；Chromium/Node/多媒体和其他底层组件的全文以这些官方随附文件为准。`node scripts/licenses.mjs --require-electron` 会检查这两个原始文件存在。不能只分发 `墨径.exe`。

锁文件还包含 Node 环境的可选 `@napi-rs/canvas` 及各平台二进制。它们不被本项目打包脚本复制进浏览器资源、APK 或 Windows app 载荷；未安装的其他平台二进制在清单中显式记录为未安装。实际安装的原生可选包没有单独 LICENSE 时，收集脚本保留同版本 Canvas 源项目的 MIT 原文并说明来源。类型定义等构建时安装文件也可出现在完整清单中；清单不是浏览器 bundle 的逐字节组成报告。

商业分发的组件条款及官方来源见 [技术决策记录](docs/DECISIONS.md)。MIT、ISC、0BSD、Apache-2.0 等均需按原条款保留适用版权、许可和声明；Windows 的底层第三方条款以官方分发的完整声明为准。用户导入的文档、图片和笔记归各自权利人，应用没有附带第三方商业教材。
