# 墨径 0.1.0 实际验证记录

日期：2026-11-04，用户时区 Asia/Shanghai。本文件只将有实际运行证据的项目记为通过。原始 JSON、系统截图和可重复脚本随源码交付于 `reports/`、`tests/` 与 `scripts/`；便携程序内的说明引用这些源码证据路径。

## 当前证据

| 层级 | 已观察结果 | 证据 |
|---|---|---|
| 核心数据单测 | 29 项通过：坐标四向旋转/缩放/裁切偏移往返、双槽保存中断回退、版本迁移、脑图关系、20 卡数据及复习恢复、备份损坏和冲突副本导入；并发同资产只写一次、失败可重试 | `npm test`；`tests/core.test.ts` |
| 浏览器知识交互 | 3 项通过：三级脑图与共享编辑/折叠/防环/删除提升；问答反馈与历史恢复；手机 412×915、平板竖屏 900×1200 无横向溢出 | `reports/knowledge/README.md` 与三张截图；`tests/knowledge.spec.ts` |
| PDF 真实文件与完整学习集 | 完整一轮通过（约1.5分钟）：2份PDF、20张卡片、20节点三级脑图、文字高亮、扫描第4页手写/擦除/撤销/截图、真实复制、旋转后选字与定位、卡片/脑图来源、复习记录、重载、独立存储导入和重复冲突副本。无pageerror。另有官方14页论文验证 | `tests/reader.spec.ts`；`reports/reader-evidence.json`、`reader-last-attempt.json`、`acceptance.mjstudy` 与PNG |
| 共享前端构建 | TypeScript 与 Vite 生产打包通过，PDF worker/CMaps/fonts/WASM/ICC 离线分发；采用 legacy JS，已在真实 Android WebView 与 Electron 运行 | `npm run build`；最终入口 `index-CunP_kr-.js` |
| Windows 原生完整运行 | 已打包EXE实际运行，完整验收48.6秒通过：20卡/三级图、真实fs全部资产SHA、卡片/脑图来源、系统剪贴板、Ctrl O/K/S/E、三类真实窗口、复习、编辑后立即关闭进程并重开、原生IPC导出完整包与Markdown。无pageerror。后续候选专项26秒通过：直接导入PDF后快捷键、同PNG三次并发上传只留一份、Ctrl+wheel、重启 | `reports/windows-evidence.json`、`windows-candidate-evidence.json` 与实际窗口截图；`tests/electron.spec.ts` |
| Android 构建与安装 | JDK21、SDK36、build-tools35/36、Gradle8.14.3；`:app:assembleDebug`成功，APK v2签名验证通过。手机与平板AVD实际安装的base.apk与交付APK SHA完全一致 | `reports/android/build-verification.json`、两端 `installed-artifact.json` |
| Android 手机完整离线流程 | Windows包通过真实系统选择器导入；原生文件全部SHA与关系通过。卡/脑图来源、选字复制后系统粘贴、扫描截图新增第21卡、手指/模拟笔压力、仅笔过滤、擦除撤销、90°/120%缩放、横竖屏、复习、force-stop恢复均通过。真实系统保存导出14,032,185字节，缓存清空；另外真实触摸导航和取消导出通过 | `reports/android/phone/result.json`、`touch-result.json`、`cancel-export-result.json` 与OS截图 |
| Android 平板完整离线流程 | 同一APK、真实系统选择器及原生文件导入；卡/脑图来源、系统剪贴板、扫描截图第21卡、手指与模拟笔、擦除撤销、90°/120%、800×1200竖屏和1280×720横屏双栏、复习均通过。真实ADB触摸分栏57%→40.159%→57.113%；另段force-stop PID13630→13947、revision65及全量数据保留；真实系统导出14,153,828字节并清缓存 | `reports/android/tablet/acceptance-final.json`、`full-before-restart-result.json`、`resume-restart-result.json`、`physical-splitter-result.json` 与OS截图 |
| Android → Windows 实际回导 | 手机和平板各自系统导出的最终包均在打包EXE生产UI、原生文件适配器导入，分别14.4/12.2秒通过；2PDF/21卡/20节点/3批注/3复习记录/4资产，全部字节摘要、字段和关系一致；文字/图片卡返回原文，关闭进程重开保留 | `reports/roundtrip/windows-from-android-phone.json`、`windows-from-android-tablet.json` 与各3张PNG |
| 布局与资料库补充 | 4项通过：915×412手机横屏单栏；900×1200/1200×800平板双栏及触摸调整比例；PDF中文重命名、搜索命中/无结果、删除后重载2→1份资料 | `reports/layout-final/`；`tests/layout-library.spec.ts` |

Windows原生完整流程与候选修复记录来自较早构建；最终 `index-CunP_kr-.js` 已由Android完整流程、Windows反向回导与重启再次运行。末次前端变更仅优化Base64解码，不改变数据格式、阅读或知识逻辑。Windows保存测试只替换系统对话框返回路径，实际生产UI→preload→IPC→fs同步/改名与导出文件均执行；Android则实际操作系统选择/保存器。

平板验收采用两个明确关联的实际会话：前段完成至复习时，测试驱动在force-stop后连到已关闭的旧WebView，`result.json`及其副本仍保留 `completed:false` 和原始失败。修复驱动的PID/页面可见性重试后，`resume-restart-result.json`记录真实再次force-stop、完整语义与阅读位置对比、原文像素和系统保存，且用SHA关联前段报告。最终汇总只表示这些实际步骤全部获得证据，不把前段失败报告改成通过。

## 交付构建标识

- 应用0.1.0，Android包名 `cn.mojing.study`；Android调试签名，Windows x64便携且未代码签名。
- APK 7,574,793字节，SHA-256 `6202d9f89ad41cfa97ba910f87be3ee3e693ae69f9d59eaba94afe2a3ba3820b`；最终共享入口 `index-CunP_kr-.js`，CSS `index-B8GE47T1.css`。
- Windows运行时Electron45.2.2/Chromium156；Windows11 x64。Android两种专用WHPX模拟器为Android15/API35、System WebView124.0.6367.219，验证时开启飞行模式；不是实体手机/平板。
- 最后核心检查：2026-11-04 13:31，29项单测通过，TypeScript通过；原生许可清单51个运行时二进制、81份全文离线摘要核验通过。
- Windows原始导出包SHA-256 `d0c529b30769692e5f494a83bce08d495971322963a6dc6159f6addc0766cec7`；手机系统导出SHA-256 `61c7a312c46b210648a01c24cfc06147a66cfa0330fe870c77ab550154b56d3e`。完整交付文件的摘要见 `release/SHA256SUMS.txt`。
- 平板系统导出SHA-256 `44163ef4273872751b5a9cc5f1f3a2b1fa4b4a0a71f16bd684ce94538eace089`；准备16.0秒、含系统保存自动操作35.3秒。`scripts/verify-delivery.mjs`还核对两端实装APK、最终Windows/APK共享资源逐字节一致，以及反向回导使用的精确包摘要。

## MVP 完成条件逐项核对

| 条件 | 实际结果 |
|---|---|
| 至少两份PDF并建学习集 | 3页文字层资料与16页真实档案扫描，通过UI创建中文学习集并导入 |
| 高亮、手写、截图摘录 | 文字层实际拖选高亮；扫描第4页真实像素摘录；笔迹、整条橡皮与撤销 |
| 至少20卡与三级脑图 | 通过UI创建20卡、20节点、最大深度3；Android各再新增1张来源截图卡 |
| 卡片与脑图返回来源 | 原文文档、页码、PDF区域与实际非白像素均核对；缩放旋转后位置保留 |
| 复习并记录 | 浏览器、Windows和Android均执行显示答案、反馈、下一次安排与记录保存 |
| 关闭并重开 | 浏览器新加载、Windows真实进程退出重开、Android force-stop/新PID恢复 |
| 在另一目标平台恢复完整包 | Windows→Android手机/平板；两份Android系统保存包→打包Windows，全部资产与语义字段关系比对 |
| 三类布局 | 手机单栏切换，平板横竖双栏及真实触摸分栏，Windows真实窗口缩放和快捷键 |
| 可安装交付与说明 | APK、包含完整Electron运行时的Windows便携包、源码、使用/构建/测试/已知问题及第三方许可 |

## 测试文件

- `text.pdf`：生成的 3 页可选文字测试资料；中文文件名副本用于路径检查。
- `scan.pdf`：生成的 2 页纯位图扫描模拟，无文字层，明确不是物理扫描件。
- `tracemonkey.pdf`：Mozilla PDF.js 官方示例使用的真实外部论文，来源和 SHA-256 在 `tests/fixtures/README.md`。
- `archival-scan.pdf`：Smithsonian Libraries 公共域手稿档案 `letter00mace` 的真实扫描 PDF，由 Internet Archive 分发，16 页。SHA-1 `27b87899bb073667a58270ec550ddd742c72376a` 与来源元数据一致；SHA-256 `c5eb1115c7fec4927f798051d157e6c58146b883b817aa22f4b1a875a0c39c66`。部分页面有档案原有 OCR 层（手写页识别不准确），第 2/3/6/16 页无文字层；应用没有运行 OCR。用于真实扫描摘录验收。

来源：[Smithsonian 书目](https://library.si.edu/digital-library/book/letter00mace)、[档案元数据](https://archive.org/metadata/letter00mace)、[原扫描 PDF](https://archive.org/download/letter00mace/letter00mace.pdf)。

## 实际发现并修复的问题

1. PDF.js 6 的 API 变化：清理文档应调用 loadingTask.destroy，移除了旧 isEvalSupported 参数，编译检查已通过。
2. 90°旋转后透明文字层尺寸回落为旋转后父尺寸，导致选区错位。补齐 viewer 尺寸变量，并为旧 WebView 提供明确的未旋转 px 尺寸。旋转后与实际文字的重合、真实鼠标选字纳入回归测试。
3. 大 JPX 扫描页加载消耗来源框的 6 秒显示时间。改为渲染完成后计时。
4. 取消关联仍有摘录/批注的文档会破坏关系校验。现阻止该操作并说明原因。
5. Windows 不支持原生 window.prompt。创建/重命名已使用应用内表单。
6. 卡片标签输入时过早归一化会吞掉分隔逗号。保留编辑文本，保存为标签数组。
7. Windows 关闭窗口加入等待保存；同数据目录加入单实例锁。原生编辑后立即关闭并重开已确认数据完整。
8. 高像素JPX扫描的能力探测/解码开销：改用官方 `canvasMaxAreaInBytes=64MiB` 的显示降采样预算，不丢图、不修改原PDF。55MP字典的手稿页浏览器约5.2秒、Windows约3.6–5.9秒完成，像素实际可见；见 `reader-archival-stress.json` / `windows-native-pdf-smoke.json`。
9. 渲染任务在文字加载期间被取消时，拒绝尚未被监听，造成未处理RenderingCancelledException。立即观察渲染promise并保留原异常处理；最新原生导入/切换/缩放/重开无pageerror。完成标记覆盖文档、页码、宽度、缩放和旋转。
10. 并发导入同一图片可重复登记同hash并竞争同一临时文件。现按hash共享进行中的写入promise；29项单测和Windows三次连续同图上传均通过。
11. Android系统文件选择器不认识`.mjstudy`扩展时将文件灰选。已在accept过滤补充`application/octet-stream`，仍以ZIP清单和SHA严格校验；真实系统选择器导入已通过。
12. Android导出完整包时，Capacitor待回调参数曾将大Base64重复写入Activity状态，触发 `TransactionTooLargeException`。改为后台流式写入私有缓存，只在状态保留UUID，保存器回调流式复制并清理。真实手机系统保存成功与取消均通过；失败时原有双槽数据仍完整。见ADR-004。
13. Android旧WebView对 `Uint8Array.from(str, callback)` 解码大型文件耗时过长；改为预分配字节数组逐字节解码。13.7MB样本本机基准约1341ms→53ms，SHA一致；手机完整包准备约16.7秒，连同系统对话框自动操作约34.1秒，不把此数当作设备通用性能。
14. 旋转扫描页的CDP截图曾显示白页；真实Android系统截图、canvas像素与原生getContext检查均确认原文正确。已撤销所有诊断渲染覆盖，正式验收采用OS截图。`reports/android/tablet/screenshot-comparison/`保留成对证据，不将截图工具漏掉硬件合成层误判为产品缺陷。

## 验证边界

- 实体触控笔的延迟、防误触与硬件兼容性仍无设备证据，不能用鼠标/模拟器结果替代。
- 手机横屏核心操作可用，但818×388时阅读可视区约80 CSS像素，建议持续阅读用竖屏；布局无溢出不等于横屏阅读体验充分优化。

已知功能边界见 [KNOWN-ISSUES.md](KNOWN-ISSUES.md)。未用实体硬件替代模拟器措辞，也未以单测或构建成功替代功能验收。
