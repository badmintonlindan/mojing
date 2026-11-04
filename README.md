# 墨径

墨径是面向 Android 平板、Android 手机和 Windows 的离线 PDF 学习工作台。首版围绕“导入资料 → 阅读批注 → 摘录卡片 → 联结脑图 → 返回原文 → 问答复习”实现，名称、界面和交换格式自主设计。

项目采用 React / TypeScript / PDF.js，共用业务与数据代码；Android 由 Capacitor 包装，Windows 由 Electron 包装。无需账户，原文和学习数据保存在当前设备。

## 当前交付状态

仓库：[badmintonlindan/mojing](https://github.com/badmintonlindan/mojing)。安装包从 [GitHub Releases](https://github.com/badmintonlindan/mojing/releases) 下载；SDK、依赖目录和生成的安装包不放入 Git 源码历史。

Android 最新交付为 **0.1.1 平板阅读修复版**：宽屏可收起/展开资料栏，双指缩放采用预览与松指后清晰重绘，并修复缩放焦点和分栏键盘操作。最终入口 `index-BxRt8DSg.js` 已通过 4 项侧栏回归（14.5 秒）、4 项缩放回归（43.5 秒），以及已安装 APK 的 Android 平板模拟器覆盖升级、资料保留、双指操作与重启验证。29 项核心单测通过。版本摘要、证据与验证边界见 [0.1.1 发布记录](docs/RELEASE-0.1.1.md)；华为实体平板尚待复测。

Windows 交付仍为 **0.1.0**。0.1.0 已完成 MVP 的实际运行验收：两份 PDF（文字层与真实档案扫描）、20 张卡片和三级脑图、批注与来源返回、复习、重启恢复，以及 Windows ↔ Android 的完整包迁移。Windows 使用打包 EXE；Android 手机和平板使用已安装 APK 的 Android 15 模拟器，实体触控笔体验仍待真机复测。完整环境、分段测试说明和证据保留在 [0.1.0 测试记录](docs/TEST-REPORT.md)，本次未重跑全部 MVP 验收。

| 内容 | 路径 |
| --- | --- |
| Android 0.1.1 修复版调试 APK | `release/墨径-0.1.1-Android.apk`，直接覆盖安装 0.1.0，勿卸载清除资料 |
| 0.1.1 源码、测试与证据 | `release/墨径-0.1.1-源代码.zip`；源码包不包含其他交付产物和工具链 |
| Windows x64 便携版（仍为 0.1.0） | `release/墨径-0.1.0-Windows-x64.zip`，解压后运行 `墨径.exe`，保留整个目录 |
| 0.1.0 历史交付 | `release/墨径-0.1.0-Android.apk`、`release/墨径-0.1.0-源代码.zip` |
| 可直接导入的 20 卡示例 | `release/墨径-示例学习集.mjstudy`，包括两份 PDF、三级脑图与批注 |
| 文件完整性校验 | `release/SHA256SUMS.txt` 与 `release/manifest.json` |
| 简明使用说明 | [docs/USER-GUIDE.md](docs/USER-GUIDE.md) |
| 从源码构建 | [docs/BUILD.md](docs/BUILD.md) |
| 0.1.1 修复与验证范围 | [docs/RELEASE-0.1.1.md](docs/RELEASE-0.1.1.md) |
| 0.1.0 MVP 历史测试 | [docs/TEST-REPORT.md](docs/TEST-REPORT.md) |
| 已知限制 | [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) |
| 技术方案、官方来源与路线图 | [docs/DECISIONS.md](docs/DECISIONS.md) |
| 里程碑与进度 | [docs/PLAN.md](docs/PLAN.md) |
| 后续路线图 | [docs/ROADMAP.md](docs/ROADMAP.md) |
| 数据与交换格式 | [docs/DATA-FORMAT.md](docs/DATA-FORMAT.md) |

下载分发时请同时保留使用说明、已知问题和第三方声明。Windows 便携目录也包含这些说明；完整原始测试证据随源码包提供。

## 开发启动

本机已使用 Node.js 24.18.0；当前依赖最低要求 Node 22.13.0。从项目根目录运行：

```powershell
npm ci
npm run dev
```

打开终端显示的本机地址。首次 Vite 依赖优化可能较慢；可先 `npm run build`，再 `node scripts/serve.mjs` 从 `http://127.0.0.1:4173` 检查生产资源。浏览器版本用于开发与交互测试，数据保存在该地址对应的 IndexedDB 中；它不与安装版共享数据库。开发构建、测试、Android 和 Windows 打包步骤见构建说明。

## 首版能力

- PDF 复制导入、资料库搜索/重命名/删除，学习集关联多份资料。
- 翻页、缩放、旋转、页码跳转与阅读进度恢复；文字选择、复制、搜索、高亮；区域截图、手写、橡皮和撤销。
- 文字/图片/手工卡片，标题、正文、标签、颜色与来源位置；脑图和卡片共用内容。
- 脑图父子/同级、移动、排序、折叠、平移、缩放与自动布局。
- 问答复习、显示答案、四档反馈、下次时间与复习历史。
- 双槽校验快照自动保存；完整 `.mjstudy` 学习集导出/导入，校验后以副本导入；Markdown 与附件 ZIP 导出。

这些是代码实现范围；实际通过的操作、设备和文件以测试记录为准。`tests/fixtures/text.pdf` 为生成的可选文字层 PDF，`scan.pdf` 为纯位图模拟扫描；另以 Smithsonian 的真实档案扫描 `archival-scan.pdf` 完成扫描流程，并用 Mozilla 官方论文验证外部文件兼容性。来源及哈希见 `tests/fixtures/README.md`。

## 工程结构

```text
src/core/          模型、坐标、校验快照、脑图与复习逻辑、交换格式
src/components/    PDF 阅读、卡片、脑图和复习界面
src/platform/      Android / Electron / 浏览器文件适配
electron/          Windows 主进程及受限文件桥接
android/           Android 原生工程与文件导出桥接
tests/             数据可靠性单测、真实 PDF 与 UI 验收
scripts/           PDF 资源、许可收集、环境和打包脚本
docs/ reports/     使用/构建/设计说明、实际验证记录与证据
```

第三方组件及资源的完整声明通过 `node scripts/licenses.mjs` 收集到 `public/licenses/`，构建后随应用分发；见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
