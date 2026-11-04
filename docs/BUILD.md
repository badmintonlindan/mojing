# 从源码构建墨径

以下命令在项目根目录的 PowerShell 执行。路径可包含中文和空格，请使用带引号的完整路径。构建步骤和实际验收是两件事：最终产物、日志、运行设备及未完成项见 [TEST-REPORT.md](TEST-REPORT.md)。

## 1. 公共环境

本机开发使用 Windows 11 x64、Node.js 24.18.0、npm 11.16.0。建议复用 Node 24；当前 PDF.js 包要求至少 Node 22.13.0（或 24 以上），仅安装较早 Node 22 可能失败。依赖由 `package-lock.json` 固定，重新构建使用 `npm ci`，不要删除锁文件升级依赖。

```powershell
npm ci
npm test
npm run build
```

`prebuild` 复制 PDF.js 的本地 CMaps、字体、WASM、ICC 资源，收集 JavaScript 许可证并离线核验已随源码提供的 Android 原生全文声明；`build` 执行 TypeScript 检查与 Vite 打包，输出 `dist/`。所有 PDF 解析资源随包分发，运行应用不需要 CDN。首次下载 npm、Electron、Android SDK 或 Gradle/Maven 依赖需要网络，应用的核心学习功能无需网络。

开发服务器：

```powershell
npm run dev
```

Vite 第一次依赖优化可能较慢。如果开发服务器长时间等待依赖优化，可先完成 `npm run build`，再使用生产资源静态测试：

```powershell
node scripts/serve.mjs
```

默认地址是 `http://127.0.0.1:4173`。静态服务仅用于本机测试，不是交付给用户的跨平台安装版本。

## 2. Windows x64

Electron 的预编译运行时通常在 `npm ci` 的安装脚本中下载。确认 `node_modules/electron/dist/electron.exe`、`LICENSE`、`LICENSES.chromium.html` 存在；下载未完成时应重试官方安装脚本，而不要仅复制一个来历不明的 EXE：

```powershell
node node_modules/electron/install.js
npm run build
npm run desktop
```

测试开发运行版后打包：

```powershell
npm run package:windows
```

输出为 `release/墨径-Windows-x64/墨径.exe`。便携分发必须包含整个目录，不能只交付 EXE。保留 Electron 的原始 `LICENSE`、`LICENSES.chromium.html`、资源目录，以及 `resources/app/dist/licenses` 的应用依赖许可。打包脚本的严格许可检查不能替代实际启动和功能验证。

启动前关闭同目录正在运行的旧版程序，以免覆盖失败。可用一个新的测试数据目录检查重启恢复，不要删除现有用户数据：

```powershell
$env:MOJING_DATA_DIR = Join-Path (Get-Location) '.test-data\windows-check'
& '.\release\墨径-Windows-x64\墨径.exe'
```

环境变量只对当前 PowerShell 启动的进程生效。正常使用不设置它，Windows 数据默认保存在用户 Roaming AppData 下的 `墨径/workspace`。目录内有双槽状态文件和内容寻址原文/图片。

本次方案使用 Electron 的现成 Windows 二进制，不要求安装 Visual Studio C++ 编译器。当前工程只配置 Windows x64 便携包，未配置安装向导、自动更新或代码签名。

## 3. Android

当前原生工程 `applicationId=cn.mojing.study`，`minSdk=24`、`compileSdk=36`、`targetSdk=36`，Android Gradle Plugin 8.13.0，Gradle wrapper 8.14.3，使用 JDK 21。最低 SDK 只是安装声明；旧设备和旧 System WebView 的实际 PDF/交互兼容性仍需运行检查。

工具下载来源、版本和校验和见 [DECISIONS.md](DECISIONS.md)。本项目的本地工具布局如下，不提交到源码仓库：

```text
.tools/jdk/<JDK 21 目录>/bin/java.exe
.tools/android-sdk/cmdline-tools/latest/bin/sdkmanager.bat
.tools/android-sdk/platform-tools/adb.exe
.tools/android-sdk/platforms/android-36/
.tools/android-sdk/build-tools/36.0.0/
```

若 JDK 直接解压为 `.tools/jdk/bin/java.exe`，环境脚本也能识别。注意 command-line tools 的 `bin` 应在 `latest/` 下，避免多套一层 `cmdline-tools/cmdline-tools`。

配置当前终端并安装所需 SDK：

```powershell
. .\scripts\android-env.ps1
sdkmanager.bat --sdk_root="$env:ANDROID_HOME" --licenses
sdkmanager.bat --sdk_root="$env:ANDROID_HOME" "platform-tools" "platforms;android-36" "build-tools;35.0.0" "build-tools;36.0.0"
```

按 SDK 许可提示阅读并确认。环境脚本只修改当前进程的 Java/SDK/PATH，不覆盖系统全局配置。若网络需要当前 Windows 用户代理，可使用 `. .\scripts\android-env.ps1 -UseSystemProxy`；不在源码保存代理账号或凭据。

同步网页与原生插件，再生成 APK：

```powershell
npm run android:sync
Push-Location android
.\gradlew.bat :app:assembleDebug
Pop-Location
```

若 wrapper 下载受网络阻碍，而已校验的 Gradle 8.14.3 安装在 `.tools/gradle-8.14.3/`，环境脚本会将其放入当前 PATH，可在 `android/` 下使用 `gradle.bat :app:assembleDebug`。`:app:assembleDebug` 只构建应用及其编译依赖，避免根级任务额外组装所有原生库AAR并下载无关lint工具。不要无依据更改 Gradle/AGP 版本来绕过下载失败。

APK 输出为 `android/app/build/outputs/apk/debug/app-debug.apk`，使用本机调试签名，适合此次安装验收。正式商店分发需要独立的签名/发布配置。

安装到已授权 USB 调试设备或模拟器：

```powershell
adb devices -l
adb install -r '.\android\app\build\outputs\apk\debug\app-debug.apk'
adb shell am start -n cn.mojing.study/.MainActivity
```

初次连接设备需要在设备上允许调试。更新调试 APK 时保持包名和签名一致；卸载会清空应用私有资料，先导出学习集。Android 文件导出使用系统文档保存器，不要求全面存储权限。

## 4. 自动化与人工验收

核心数据测试：

```powershell
npm test
```

内容覆盖来源坐标、损坏/中断保存恢复、迁移、脑图关系、复习调度、完整备份、冲突/篡改/路径校验和 Markdown 附件。核心单测中的文件签名字节只用于数据层测试，不能证明 PDF 可读。

UI 测试使用 `tests/fixtures/` 的真实 PDF，通过本机 Chrome 执行。文字层样例有 3 页，纯位图模拟扫描有 2 页；真实 Smithsonian 档案扫描有 16 页，另有 Mozilla 官方 14 页论文。来源与哈希见 `tests/fixtures/README.md`。生成或更新样例后必须重新验收：

```powershell
node scripts/make-fixtures.mjs
```

先在一个终端启动静态服务，使用测试配置默认的 5173 端口：

```powershell
$env:PORT = '5173'
node scripts/serve.mjs
```

在另一个终端运行：

```powershell
npm run test:e2e # 浏览器：知识、真实阅读、布局与资料库
```

`playwright.config.ts` 当前使用系统 `channel: chrome`，需要本机 Google Chrome。知识流程测试也支持 `$env:MOJING_URL='http://127.0.0.1:4173'` 指向其他测试端口。浏览器记录、失败 trace 与截图不能替代 Android/Windows 原生文件桥接验证。

原生验证独立运行（需要先构建对应程序并生成验收交换包）：

```powershell
npm run test:windows
node scripts/test-android.mjs --serial emulator-5554 --label phone
node scripts/test-android.mjs --serial emulator-5556 --label tablet
npm run test:roundtrip
node scripts/verify-delivery.mjs
```

Android脚本只操作明确的专用AVD，使用真实系统文件选择器与原生存储；反向导入测试需要这两端实际导出的文件，缺少时会失败。首版平板曾遇驱动连接已关闭旧WebView，使用 `--mode resume-restart` 在保留前段报告的前提下补测；脚本现包含PID/可见性重试。交付核验脚本只核对已经完成的证据及实际产物一致性，不替代运行测试。源码包不包含SDK、node_modules、生成APK或测试交换包。

实际验证范围：两份 PDF 导入，高亮/手写/截图，20 卡三级脑图，卡片和脑图来源跳回，一次复习，关闭重启，跨平台完整学习集导出导入，以及手机/平板/桌面布局。未获得证据的项保留未完成，不以已构建代替已运行。

## 5. 许可收集复核

```powershell
node scripts/licenses.mjs
node scripts/licenses.mjs --require-electron
node scripts/licenses-android.mjs --verify-existing
```

普通模式生成 `public/licenses/index.html` 与清单及全文；严格模式还要求 Electron 运行时的完整许可证存在。清单记录来源路径、文件字节数和 SHA-256，方便核对。更改锁文件、升级依赖或替换 PDF 解码器后重新生成、构建并检查分发内容。详见 [第三方声明](../THIRD-PARTY-NOTICES.md)。
