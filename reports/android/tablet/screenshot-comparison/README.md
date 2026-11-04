# Android 平板截图对照结论

在 Android 15 Pixel Tablet AVD、WebView 124 中，同一份原版 APK、同一时刻的真实扫描第 4 页（90°、120%）表现如下：

- Android OS `screencap` 在像素读回**之前**已清楚显示手稿和蓝色手写批注。
- 紧接着的 CDP `page.screenshot()` 部分截图省略了 PDF Canvas2D，只留下白色页底及独立 SVG 批注。
- 同时 `getImageData()` 和 `canvas.toDataURL()` 给出的原始画布像素完整、非白，目视 canvas PNG 与 OS 实屏内容一致。
- 在竖屏、横屏均复现该截图差异。首次与竖屏两组的读回前后 OS PNG 的 SHA-256 分别完全相同；第三组未作字节相同断言，完整结果保留在 `conclusion.json`。因此不是 `getImageData()` 让原本白屏恢复。

这组基线测试先关闭旧调试连接，再 force-stop 冷启原 APK，新 PID 为 6993，不安装任何 initScript。`native-context.json` 验证 `getContext` 是原生函数；默认上下文 `alpha=true`，无 context loss。各阶段完整像素、尺寸、滚动位置、上下文属性见 `result.json`。

最直接的目视对照：`fresh-rotation90-zoom120-os-before-readback.png` 与 `fresh-rotation90-zoom120-cdp-before-readback.png`。`portrait-rotation90-zoom120-os-before-readback.png` 也显示正常的原文及墨迹。

本次证据否定先前仅依据 CDP 白色截图作出的“PDF 旋转后实际白页”判断。该环境的正式 Android 验收改用 OS/设备截图，并在渲染完成后检查实际画布像素；不据此修改产品 PDF 渲染配置。这里只记录本机 AVD/WebView/CDP 的实测差异，不将其宣称为已核实的通用上游缺陷。

先前全局强制所有画布 `alpha=false` 的软件上下文试验还改变了 PDF.js 内部遮罩画布，产生黑底图像；它不属于本组基线，也不作为产品修复或验收证据。
