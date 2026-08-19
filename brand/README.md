# MWI Multi-Account Manager · 品牌资产

本目录存放应用图标、品牌 LOGO 及生成脚本。所有产物由 `scripts/build-brand-assets.py` 自动生成。

## 源图

- `cow-face_1f42e.png`（emoji 风格奶牛脸，512x512 PNG RGBA，由产品提供）

## 应用图标

`build/` 目录由 `scripts/build-brand-assets.py` 写入：

| 文件 | 用途 | 平台 |
|------|------|------|
| `build/icon.icns` | macOS 应用图标（多分辨率） | macOS / electron-builder mac target |
| `build/icon.ico` | Windows 应用图标（多分辨率） | Windows / electron-builder win target |
| `build/mwi.iconset/` | macOS iconset 源（10 个 PNG） | 重新生成 `icon.icns` |
| `build/icons/64x64.png` ~ `512x512.png` | Linux 应用图标 | electron-builder linux target |

`package.json` 的 `build.directories.buildResources` 指向 `build/`，electron-builder 自动识别 `icon.icns` / `icon.ico`。

## 品牌 LOGO

-| `logo-horizontal-240.png` | 横排 LOGO（紧凑） | 小尺寸场景 |
-| `logo-horizontal-512.png` | 横排 LOGO（标准） | 官网/文档/卡片 |
-| `logo-horizontal-1024.png` | 横排 LOGO（高分辨率） | 高分屏/印刷 |
-| `logo-stacked-256.png` | 竖排 LOGO（紧凑） | favicon/移动端 |
-| `logo-stacked-512.png` | 竖排 LOGO（标准） | 应用 About 面板/启动屏 |
-| `logo-stacked-1024.png` | 竖排 LOGO（高分辨率） | 高分屏/印刷 |

配色（与 `src/css/tokens.css` 对齐）：

- 背景 `--mwi-bg-base` #141417
- 强调 `--mwi-accent` #7B9EFF（主蓝光晕）
- 文字 `--mwi-text-primary` #F1F2F6 / `--mwi-text-secondary` #A7A8B3
- 字体：英文 HelveticaNeue，中文 Hiragino Sans GB（macOS 系统字体）

## 重新生成

```bash
# 1. 把新源图放到 .tmp-cow-face-source.png（任意 512x512+ PNG）
cp /path/to/new-source.png /Users/shenhuanjie/Documents/01-项目开发/02-个人项目/mwi-miuoooooo/mwi-electron-desktop/.tmp-cow-face-source.png

# 2. 跑生成脚本
python3 scripts/build-brand-assets.py
```

脚本会写入：

- `build/mwi.iconset/`（10 个 PNG）
- `build/icon.icns`（Pillow IcnsImagePlugin 拼装，7 个尺寸 16/32/64/128/256/512/1024）
- `build/icon.ico`（手写 struct 拼装，PNG-in-ICO 7 个尺寸 16/24/32/48/64/128/256）
- `build/icons/64x64.png ~ 512x512.png`（Linux 多尺寸）
- `brand/logo-horizontal-{240,512,1024}.png`
- `brand/logo-stacked-{256,512,1024}.png`

## 注意

- macOS Big Sur+ 自动给 PNG 应用图标加圆角；脚本输出保留透明背景，不预加圆角
- Windows ICO 用 PNG-in-ICO 格式（Vista+ 全支持），不是 BMP
- Linux 不需要 `.ico` / `.icns`，直接用 `build/icons/` 里的 PNG
- 配色严格遵循 `src/css/tokens.css`；改主题色需同步改脚本 `COLOR_*` 常量