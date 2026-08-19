# Tampermonkey 扩展目录

把从 Chrome 商店下载的 Tampermonkey CRX 解压到此目录。

## 安装步骤

1. 从 Chrome Web Store 下载 Tampermonkey CRX：
   https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo

2. 解压 CRX（zip 格式）：
   - macOS / Linux：unzip ~/Downloads/Tampermonkey.crx -d resources/tampermonkey/
   - Windows：用 7-Zip 解压到 resources 文件夹下的 tampermonkey 子目录

3. 验证：此目录应包含 manifest.json 文件

## 注意

- 此目录会被 electron-builder 打包到 extraResources/tampermonkey/
- 如果目录不存在或 manifest.json 缺失，应用启动账号时会记录警告日志，油猴扩展不会加载（游戏页面仍可正常运行）
- 首次启动后，扩展会在每个账号的独立 session partition 中独立加载，脚本数据互不影响
