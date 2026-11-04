# 阅读验收测试资料

- text.pdf / 含文字层的学习资料.pdf：脚本生成，3 页，可搜索与选择的英文文字层，中文标题是嵌入位图。SHA-256 0c2973eaa0c329f7f34187925b16d992df609511f6212a3fb80ff21d8630e215
- scan.pdf / 纯位图扫描模拟.pdf：脚本生成，2 页纯位图，无文字层。仅为扫描版模拟测试夹具，不宣称来自真实纸质扫描。SHA-256 acccc52f7ce665ee6425b3d8e1283e68a35f830f4b14556e99cf32e5ccc8f1bb
- tracemonkey.pdf：Mozilla PDF.js 官方在线示例使用的真实外部研究论文，由原作者保留权利。来源 https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf 。本文件只用于本地互操作测试；不作为应用内容宣传。下载结果：1016315 字节，SHA-256 3662ff519e485810520552bf301d8c3b2b917fd2f83303f4965d7abed367e113

- archival-scan.pdf：真实馆藏手稿扫描，16 页，Smithsonian Libraries and Archives 书目 letter00mace。书目 https://library.si.edu/digital-library/book/letter00mace ，原始数据 https://archive.org/metadata/letter00mace ，PDF https://archive.org/download/letter00mace/letter00mace.pdf 。第 4 页为清晰手写扫描，用于主验收；原文件部分页面有不准确的 OCR 文字（第 1 页 301 字符、第 4 页 423 字符），不是本应用产生。第 2/3/6/16 页没有文字层。SHA-256 c5eb1115c7fec4927f798051d157e6c58146b883b817aa22f4b1a875a0c39c66；SHA-1 27b87899bb073667a58270ec550ddd742c72376a（与原始数据一致）。

生成命令：node scripts/make-fixtures.mjs（使用已锁定的 pdf-lib 与 PDF.js 开发依赖中的 @napi-rs/canvas）。主验收使用真实馆藏扫描时，设置 MOJING_SCAN_PDF 为 archival-scan.pdf 的绝对路径。馆藏扫描单独下载并校验，不由生成脚本冒充扫描。
