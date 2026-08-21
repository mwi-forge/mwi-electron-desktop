# Tampermonkey 扩展目录

把从 Chrome 商店下载的 Tampermonkey CRX 解压到此目录。

## 安装步骤

1. 从 Chrome Web Store 下载 Tampermonkey CRX：
   https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo

2. 解压 CRX（zip 格式）：
   - macOS / Linux：unzip ~/Downloads/Tampermonkey.crx -d resources/tampermonkey/
   - Windows：用 7-Zip 解压到 resources 文件夹下的 tampermonkey 子目录

3. 验证：此目录应包含 manifest.json 文件

## 重要：更新扩展后必须重打兼容补丁

Electron 43 没有实现扩展的 `chrome.notifications / contextMenus / cookies / downloads / commands`
这几个 API，Violentmonkey / Tampermonkey 的 MV2 后台脚本初始化时会因此崩溃（options 页红字
`Violentmonkey cannot connect to the background page.`）。仓库自带兼容层：

- `background/mwi-shim.js`：在后台脚本之前执行，为缺失 API 打桩；
- `manifest.json` 的 `background.scripts` 第一项已指向该 shim。

**每次重新解压扩展（升级/替换）后，必须重跑**：

```
node scripts/patch-tampermonkey-shim.js
```

脚本幂等，已打补丁时会提示无需改动。打桩的 API 在 Electron 中本就不存在，功能静默降级
（系统通知 / 右键菜单 / GM_cookie / downloads），不影响用户脚本核心链路。

## 注意

- 此目录会被 electron-builder 打包到 extraResources/tampermonkey/
- 如果目录不存在或 manifest.json 缺失，应用启动账号时会记录警告日志，油猴扩展不会加载（游戏页面仍可正常运行）
- 首次启动后，扩展会在每个账号的独立 session partition 中独立加载，脚本数据互不影响
