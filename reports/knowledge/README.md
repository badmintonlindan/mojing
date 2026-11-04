# 知识整理与复习交互证据

日期：2026-11-04。运行环境：Windows 11 x64，Google Chrome 156.0.8078.80，Playwright `channel: chrome`，无状态注入，通过应用的文件导入与表单操作创建数据。

执行命令：

```powershell
npx playwright test tests/knowledge.spec.ts --reporter=line --output=test-results/knowledge
```

实际结果：**3 passed (2.0m)**。该次运行连接 `http://127.0.0.1:5173` 的 Vite 应用；此记录不能替代打包后 Windows 程序、Android APK 或真机触控笔的验证。

| 交互测试 | 已观察结果 | 截图 |
| --- | --- | --- |
| 桌面 1440×1000 | 导入真实文字层 PDF；3 张手工卡组成三级脑图；折叠/展开；父级选项排除自己及子树；脑图编辑同步卡片；移除中间节点后子节点提升且卡片保留；完成一次复习；重载后脑图、内容及复习记录保留；无 pageerror | [desktop-mind-map.png](desktop-mind-map.png) |
| 手机 412×915 | 创建问答，显示答案，反馈掌握程度；记录保存且页面重载可见；无页面横向溢出 | [phone-review-record.png](phone-review-record.png) |
| 平板竖屏 900×1200 | 同一复习流程通过，记录重载保留，无页面横向溢出 | [tablet-portrait-review-record.png](tablet-portrait-review-record.png) |

三张截图均已目视检查。手机与平板为 Chrome 视口/触摸仿真，并非 Android 实机证据。此测试只创建 3 张卡片；20 卡贯通验收另行记录。
