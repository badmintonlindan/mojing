# 技术决策记录

记录日期：2026-11-04。产品名称：**墨径**。状态：实施方案已选择；本文的依赖能力来自官方资料核实，原型及平台验收结果另记入测试记录。文档、编译成功和桌面浏览器预览均不代表 Android 或 Windows 应用验收通过。

## ADR-001：共享 TypeScript 应用，Android 使用 Capacitor，Windows 使用 Electron

### 环境依据与取舍

初始目录无现有应用代码。本机可直接使用 Node、npm、Git、CMake；Flutter、Dart、Java、adb、Rust 不在 PATH，未发现可直接使用的 Flutter/Visual Studio C++/Rust 构建链。因此首版选择 **React + TypeScript + PDF.js** 共用界面、业务模型、坐标转换和交换包逻辑，使用 **Capacitor Android** 与 **Electron Windows** 包装。Android 工具链仍需补齐并实际构建、运行。

| 路线 | PDF、触笔与画布 | 存储、构建与维护 | 本次结论 |
| --- | --- | --- | --- |
| Flutter + pdfrx | PDFium 渲染，内置文本选择与搜索，字符框与裁切渲染；原生 PointerEvent 可读取笔类型、压力与倾角；适合自绘脑图 | Android/Windows 共用 Dart；还需 Flutter SDK、Android SDK 和 Windows C++ workload，pdfrx 在 Windows 需要 Developer Mode；需适配其新 Material UI 本地化 | 长期可行，当前需新增较多工具；本次不选 |
| Tauri 2 + PDF.js | 网页文字层、SVG/Canvas 和 Pointer Events 可复用；移动设备交互仍须真机检查 | 同一框架支持桌面/移动，但还需 Rust、Windows C++/WebView2、Android SDK/NDK | 安装包较轻，但本机缺少的编译链更多；本次不选 |
| Capacitor + Electron + PDF.js | 共用 PDF.js 渲染/文字层、Canvas/SVG 和 Pointer Events | Node 已可用；Android 仍需 JDK/SDK；维护两个薄壳，文件访问通过统一接口隔离 | **本次选定**，优先产出可运行闭环及可验证安装包 |
| Android 与 Windows 分别原生实现 | 输入和系统集成控制直接 | 两套阅读、画布及 UI，协调成本最高 | 首版不选 |

Electron 会将 Chromium 与 Node 一同分发，磁盘占用和内存通常明显高于采用系统 WebView 的方案。这是当前降低 Windows 编译链成本的明确代价；最终体积以实际打包产物记录，不在此虚构数字。Capacitor 官方支持 Android、iOS、Web，**Windows 由 Electron 独立负责**，不能将 Capacitor 本身视为 Windows 支持。

参考：[Flutter Windows 构建要求](https://docs.flutter.dev/platform-integration/windows/setup)、[pdfrx 官方包说明](https://pub.dev/packages/pdfrx)、[Flutter PointerEvent](https://api.flutter.dev/flutter/gestures/PointerEvent-class.html)、[Tauri 环境要求](https://v2.tauri.app/start/prerequisites/)、[Capacitor 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)、[Electron 分发说明](https://www.electronjs.org/docs/latest/tutorial/distribution-overview)。

### 原型门槛

在进入完整功能验收前，实际验证：本地文字层 PDF 打开、选文和坐标回跳；扫描版 PDF 裁切成图片；笔迹随缩放及四种旋转正确显示；本地文件复制到应用目录后关闭重启可读。任何一项失败先修复。未运行的平台与输入设备保持未验证状态。

## ADR-002：PDF.js 负责解析与渲染，学习批注由应用持有

### 版本与离线资源

2026-11-04 使用 npm 注册表核实 `pdfjs-dist` 为 **6.5.438**（Apache-2.0），`@capacitor/core` 为 **8.6.0**（MIT），Electron 为 **45.2.2**（MIT）。实际安装版本以 `package.json` 和 `package-lock.json` 为准；不使用浮动 CDN。React、TypeScript 等同样锁入依赖清单，不要求追逐最新大版本。

PDF.js 的 `PDFPageProxy` 提供 `getTextContent()`、`getViewport()`、`render()`、`view` 和页面旋转信息。渲染 Canvas 叠加文字层，实现选择、复制与搜索；应用在独立覆盖层绘制高亮与笔迹并保存到学习数据。PDF 文件保留为原文，首版不要求把应用批注写回 PDF。

构建产物应包含 PDF worker、CMaps、standard fonts、WASM/相关解码资源及其许可。`cMapUrl`、`standardFontDataUrl`、`wasmUrl` 指向包内相对资源，测试时断网检查中文文档和扫描图片。不依赖在线字体、远程 PDF 或账户服务。

参考：[PDF.js 6.5.438 官方发布](https://github.com/mozilla/pdf.js/releases/tag/v6.5.438)、[Getting Started](https://mozilla.github.io/pdf.js/getting_started/)、[PDFPageProxy API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html)、[加载参数及资源 URL](https://mozilla.github.io/pdf.js/api/draft/api.js.html)。

### 持久化坐标契约

- 来源定位保存文档稳定 ID、从 **1** 开始的页码及未旋转的 **PDF user space** 矩形数组 `[x1,y1,x2,y2]`；笔迹点和笔宽也使用页面坐标。多行摘录保存多个矩形，避免仅以一个大包围框覆盖中间无关内容。
- 不保存屏幕绝对像素作为来源。PDF crop box、页面原始旋转和 `userUnit` 均通过当前页面的 `PageViewport` 处理；不假设原点一定为 `(0,0)`。
- 指针和 DOM 选区先减去页面元素的 CSS 偏移，再经 `convertToPdfPoint()` 变为持久化坐标；重绘通过 `convertToViewportPoint()` / `convertToViewportRectangle()` 变回显示坐标。
- CSS 像素与 Canvas backing-store 像素分开。设备像素比仅用于渲染清晰度，不再乘入选区坐标。缩放、旋转、分栏和窗口调整均重新生成 viewport。
- 返回来源时先打开目标文档与页码，再滚动至目标矩形并显示短暂定位框。自动化测试检查目标文档、页号与坐标，平台运行检查视觉落点。

参考：[锁定版本 PageViewport 实现](https://github.com/mozilla/pdf.js/blob/v6.5.438/src/display/page_viewport.js)。

### 输入和安全边界

Pointer Events 统一鼠标、手指、触笔输入，并通过 `pointerType` 区分；使用 pointer capture 避免笔划出界丢失。笔迹模式控制 `touch-action`，阅读模式保留触屏滚动/缩放，撤销和橡皮操作写入相同批注模型。压力、防误触和延迟属于硬件验收项，浏览器模拟不能替代真机。

Electron 仅加载本地应用资源，关闭 renderer 的 Node integration，启用 context isolation，通过受限 preload/IPC 暴露文件能力；卡片内容按文本处理。Android 与桌面文件服务共用 `FileStore` 契约。

参考：[Mozilla Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)、[Electron 安全说明](https://www.electronjs.org/docs/latest/tutorial/security)。

## ADR-003：稳定 ID、文件副本与版本化学习集

模型使用稳定 ID 关联学习集、文档、卡片、批注、脑图节点、复习与记录；脑图节点仅引用卡片 ID，卡片内容只有一份。文档与图片导入后复制进应用数据目录，不依赖原始路径或 Android 临时 URI。资产保存大小、MIME 和 SHA-256，用于备份校验。

学习状态包含独立 schemaVersion 与 revision；迁移在加载时显式执行，未知的新版本拒绝加载并保留原始文件。自动保存应串行提交、提供写入失败反馈，并保留可恢复的上次完整状态。文件写入完成后再提交引用，避免数据指向未保存资产。

完整学习集使用带格式版本的交换包：包含学习集数据、关联 PDF/图片、资产校验信息。导入先验证格式、摘要、大小、ID 唯一性、引用完整性、脑图父子关系与无环约束，再持久化；相同 ID 的已有数据通过显式复制并映射 ID 或明确提示处理，禁止静默覆盖。Markdown 导出包含正文、图片和原文名称/页码/定位信息。以上属于设计约束，实际测试结果以测试记录为准。

## 许可与商业分发记录

| 组件 | 核实许可 | 分发要求 |
| --- | --- | --- |
| PDF.js / pdfjs-dist | Apache-2.0 | 附 LICENSE、相关 NOTICE，说明修改；一并保留字体、CMaps、WASM 等附带资产各自声明 |
| Capacitor | MIT | 保留版权与许可文本 |
| Electron | MIT | 保留 Electron 及其随附 Chromium/Node/第三方许可证文件 |
| React | MIT | 保留版权与许可文本 |
| TypeScript | Apache-2.0 | 保留许可证和适用声明，构建工具许可也记录在依赖清单 |
| Flutter（备选） | BSD 风格 | 保留版权、条件及免责声明 |
| pdfrx（备选） | MIT | 还需 PDFium 与其第三方依赖声明，不能仅附 pdfrx MIT |
| Tauri（备选） | MIT / Apache-2.0 | 按所选许可保留声明，核对插件及底层依赖 |

上述开源条款未要求为商业使用购买组件授权；仍须履行各自声明与分发条件，用户导入文档的版权归原权利人。发布时依据实际锁定依赖生成第三方许可清单，不能以本表替代完整清单。

官方原文：[PDF.js LICENSE](https://github.com/mozilla/pdf.js/blob/v6.5.438/LICENSE)、[Capacitor LICENSE](https://github.com/ionic-team/capacitor/blob/main/LICENSE)、[Electron LICENSE](https://github.com/electron/electron/blob/main/LICENSE)、[React LICENSE](https://github.com/facebook/react/blob/main/LICENSE)、[TypeScript LICENSE](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt)、[Flutter LICENSE](https://github.com/flutter/flutter/blob/master/LICENSE)、[pdfrx LICENSE](https://github.com/espresso3389/pdfrx/blob/master/LICENSE)、[PDFium LICENSE](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/LICENSE)、[Tauri 仓库](https://github.com/tauri-apps/tauri)。

## Android 构建工具来源

以下下载来源和摘要已核实。工具链已安装于项目 `.tools`，APK 的实际构建、签名与运行结果分别记录在 `reports/android/build-verification.json` 和各设备测试报告；不能由工具安装推断功能验收通过。

- Android Windows command-line tools：[`commandlinetools-win-15859902_latest.zip`](https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip)，官网 SHA-256：`90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a`。[官方页面](https://developer.android.com/studio#command-tools)
- JDK 21：Adoptium 官方 API 返回 Temurin **21.0.13+9**，[Windows x64 ZIP](https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jdk_x64_windows_hotspot_21.0.13_9.zip)，SHA-256：`a4dbaa05fca4bd89d84584e58c459bd732efebb1722af80ab13c6516832004f9`。[版本选择页](https://adoptium.net/temurin/releases/?version=21&os=windows&arch=x64)
- Android SDK 平台、build-tools、Gradle 与 JDK 的最终版本以 Capacitor 8.6.0 生成的 Android 工程为准；通过 Gradle 实际构建检查兼容性，不依据 Android Studio 页面上的最低 API 推断 compileSdk。

## ADR-004：Android 系统导出仅在 Activity 状态保存短标识

实际 APK 验证发现，把完整学习集 Base64 保留在 Capacitor 待回调的 `PluginCall` 中，会在系统保存器启动时被写入 Activity Bundle，触发约 76 MB 的 `TransactionTooLargeException`。修复采用应用私有缓存临时文件：后台流式解码、落盘并同步后，立即移除调用参数中的 Base64，仅保留随机 UUID；系统回调校验 UUID 与规范化缓存路径，再流式复制至用户选择的 URI，并在成功、取消或失败时清理。该方案不申请广泛文件访问权限。

导出验证必须包含真实 `ACTION_CREATE_DOCUMENT` 保存、取回文件后逐项摘要与学习关系校验，以及临时缓存清理；仅看到系统选择器不能视为通过。Android UI 验证采用系统 `screencap`，并检查 PDF canvas 原文像素：实测 CDP 截图会漏掉 WebView 硬件合成的 PDF canvas，不能以其白页截图直接判定实际屏幕未渲染。

## 后续路线图

首版验收后再评估 EPUB、网页和视频导入、OCR、AI 摘要与问答、实时云同步、多人协作、插件市场、付费系统，以及 MarginNote 私有格式导入。导入器、文件服务和 schema 版本保留扩展点，不在首版界面放置尚不可用的功能入口。
