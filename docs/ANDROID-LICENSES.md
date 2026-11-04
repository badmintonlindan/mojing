# Android 原生运行时许可审计

2026-11-04，依据成功构建的 `:app:debugRuntimeClasspath`，已核实 51 个实际运行时二进制组件、4 个仅供解析的元数据组件，以及源码形式接入的 Capacitor / Filesystem 原生模块。最终树见 [android-runtime-dependencies.txt](../reports/android-runtime-dependencies.txt)，完整归属、POM、二进制与许可文件 SHA-256 见 [manifest.json](../public/licenses/android/manifest.json)。完整文件可从 [本地许可索引](../public/licenses/android/index.html) 离线查看。

收集结果包含 81 份未经改写的许可、版权声明、NOTICE 和 POM，约 390 KB；其中 9 份许可证直接从本次实际 AAR 中提取。其他没有内置许可全文的 AAR/JAR，以其确切版本 POM 声明和官方源项目全文补充。APK 的 JavaScript、PDF.js WASM 解码器、CMaps、字体和 ICC 声明由原有 `scripts/licenses.mjs` 独立收集。

| 运行时组件 | 本次版本 | 已保留的全文与归属 |
| --- | --- | --- |
| AndroidX | 以最终运行时树逐项记录 | 实际 AAR/JAR 内 LICENSE/NOTICE，原始 POM 的 AOSP 归属与 Apache-2.0 声明，以及 Apache-2.0 全文 |
| Capacitor Android / Filesystem 原生源码 | 8.6.0 / 8.1.5 | 安装包中的 MIT 全文，含 Ionic 版权 |
| `io.ionic.libs:ionfilesystem-android` | 1.1.1 | 官方 MIT 全文；POM 只写“License”，因此不能仅靠名称判断 |
| `org.apache.cordova:framework` | 14.0.1 | 官方对应标签 LICENSE 与 NOTICE |
| Kotlin JVM 标准库 | 2.2.20 | 官方对应标签 Apache-2.0、JetBrains 版权和标准库纳入的 GWT/Guava、ThreeTen BSD-3-Clause、Boost 许可全文 |
| Kotlin Coroutines Android / JVM | 1.10.2 | 对应标签 Apache-2.0 全文与确切版本 POM |
| JetBrains annotations | 23.0.0 | 对应标签 Apache-2.0 全文与 POM |
| JSpecify annotations | 1.0.0 | 对应标签 Apache-2.0 全文与 POM |
| Guava ListenableFuture | 1.0 | 实际 POM 及父 POM 的 Apache-2.0 声明，Guava v26.0 的 COPYING 全文 |

这些主许可允许商业使用及再分发；分发仍须保留适用的许可文本、版权和 NOTICE。Kotlin 不能只附一个 Apache-2.0 文件：其官方版本许可映射明确列出了 JVM/通用标准库纳入的 BSD、Boost 和 Google 派生代码。未将编译器、IDE、JS/Native/WASM 标准库等未随本 APK 分发的组件当作运行时纳入。原始映射 README 保留作审计依据，其中其他编译工具章节不表示这些工具被打入应用。

官方核实来源：[Ion Android Filesystem LICENSE](https://github.com/ionic-team/ion-android-filesystem/blob/main/LICENSE)、[Cordova 14.0.1 LICENSE](https://github.com/apache/cordova-android/blob/14.0.1/LICENSE)、[Cordova NOTICE](https://github.com/apache/cordova-android/blob/14.0.1/NOTICE)、[Kotlin v2.2.20 许可映射](https://github.com/JetBrains/kotlin/blob/v2.2.20/license/README.md)、[Coroutines 1.10.2 LICENSE](https://github.com/Kotlin/kotlinx.coroutines/blob/1.10.2/LICENSE.txt)、[JetBrains annotations 23.0.0 LICENSE](https://github.com/JetBrains/java-annotations/blob/23.0.0/LICENSE.txt)、[JSpecify v1.0.0 LICENSE](https://github.com/jspecify/jspecify/blob/v1.0.0/LICENSE)。AndroidX 各组件的确切 POM 和发布页链接保存在本地清单中。

## 分发与再生

最小完整分发方式是保留 `public/licenses` 全目录，经 Vite 构建复制到 `dist/licenses`，再由 Capacitor 同步进 APK 的 `assets/public/licenses`。根许可页链接到 `android/index.html`。Windows 分发同样可以保留该目录，并在可执行程序旁额外保留 Electron `LICENSE` 和 `LICENSES.chromium.html`。不要只保留 SPDX 名称或在线 URL；这些都不能替代随应用交付的全文。

普通前端/Windows 构建使用以下命令核验已经随源码提供的完整声明，不需要 Gradle 缓存或网络：

```powershell
node scripts/licenses-android.mjs --verify-existing
```

修改 Android 原生依赖后，先成功构建 APK，再用同一 Gradle 环境导出最终运行时树：

```powershell
# 在 android/ 目录，沿用本项目构建说明中的 JAVA_HOME / GRADLE_USER_HOME / SDK 环境
.\gradlew.bat :app:dependencies --configuration debugRuntimeClasspath --console=plain |
  Set-Content -Encoding utf8 ../reports/android-runtime-dependencies.txt

# 回项目根目录。默认缓存为 .tools/gradle-cache，可用 --cache 指定其他实际缓存。
node scripts/licenses-android.mjs --offline
node scripts/licenses-android.mjs --verify-existing
```

脚本只读取 `debugRuntimeClasspath` 和对应缓存，保留依赖选择后的最终版本；不会把 `.gradle` 内所有插件当成 APK 依赖。继承自父 POM 的许可会连父 POM 一并保存。BOM、指向 JVM 变体的元数据与真正二进制分别标记。存在未解析依赖、缺少二进制/POM、未知许可或新版本源项目未审计时，生成命令明确失败。

首次补充源项目许可可使用 `--sources-only`，但该模式会明确生成“不完整运行时清单”，不能替代最终审计。完整许可已经纳入源码，通常无需再下载；若确需获取，可以用 `--download-plan` 输出官方来源列表。Node 直连受代理限制时，使用系统代理的 `Invoke-WebRequest` 下载对应文件后再 `--offline` 汇总，避免把代理错误页面当成许可文本。

AGP、Kotlin 编译器/Gradle 插件、JDK、Android SDK、测试库和设备自带的 WebView/Android OS 不随本 APK 作为应用组件分发，因此未纳入本运行时清单。
