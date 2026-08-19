#!/usr/bin/env python3
"""
MWI Multi-Account Manager - 应用图标 + LOGO 生成器
输入：cow-face_1f42e.png (512x512 PNG RGBA)
输出：build/mwi.iconset/ + build/icon.icns + build/icon.ico + brand/logo-*.png
配色：DSH 深色基底 + 主蓝 #7B9EFF
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_PNG = os.path.join(PROJ, ".tmp-cow-face-source.png")
BUILD = os.path.join(PROJ, "build")
BRAND = os.path.join(PROJ, "brand")

# ===== 设计 Token (与 src/css/tokens.css 对齐) =====
COLOR_BG_BASE = (20, 20, 23)         # #141417 mwi-bg-base
COLOR_BG_ELEVATED = (33, 33, 41)     # #212129 mwi-bg-elevated
COLOR_BG_SIDEBAR = (22, 22, 26)     # #16161A
COLOR_ACCENT = (123, 158, 255)      # #7B9EFF mwi-accent
COLOR_ACCENT_STRONG = (147, 172, 255) # #93ACFF
COLOR_ACCENT_SOFT = (123, 158, 255, 32) # rgba(123,158,255,0.13)
COLOR_TEXT_PRIMARY = (241, 242, 246) # #F1F2F6
COLOR_TEXT_SECONDARY = (167, 168, 179) # #A7A8B3
COLOR_TEXT_MUTED = (113, 114, 124)   # #71727C
COLOR_BORDER = (59, 59, 71)         # #3B3B47 mwi-border-strong

# ===== 字体查找 (按系统优先级) =====
# ===== 字体查找 (按系统优先级) =====
# MWI 主文字（英文大写）→ HelveticaNeue（macOS 英文默认）
# 多账号管理器（中文）→ Hiragino Sans GB（中文界面）
FONT_LATIN = "/System/Library/Fonts/HelveticaNeue.ttc"
FONT_LATIN_INDEX = 0  # Regular
FONT_CJK = "/System/Library/Fonts/Hiragino Sans GB.ttc"
FONT_CJK_INDEX = 0
FONT_FALLBACK = "/System/Library/Fonts/STHeiti Medium.ttc"

def _load_font(path, size, index=0):
    if os.path.exists(path):
        try:
            return ImageFont.truetype(path, size, index=index)
        except Exception:
            pass
    if os.path.exists(FONT_FALLBACK):
        try:
            return ImageFont.truetype(FONT_FALLBACK, size)
        except Exception:
            pass
    return ImageFont.load_default()

def find_font(size, cjk=False):
    if cjk:
        return _load_font(FONT_CJK, size, index=FONT_CJK_INDEX)
    return _load_font(FONT_LATIN, size, index=FONT_LATIN_INDEX)

# ===== 加载源图 =====
# SRC: 透明背景抠图版（用于 brand/LOGO + toolbar 透明图标）
SRC = Image.open(SRC_PNG).convert("RGBA")
SRC_1024 = SRC.resize((1024, 1024), Image.LANCZOS)
SRC_512  = SRC.resize((512, 512), Image.LANCZOS)
# SRC_APP: 应用图标专用（含深蓝渐变背景 + 圆角 + 主体，JPEG 1024）
SRC_APP_PATH = os.path.join(PROJ, ".tmp-milk-app-source.png")
SRC_APP = Image.open(SRC_APP_PATH).convert("RGBA")
SRC_APP_1024 = SRC_APP.resize((1024, 1024), Image.LANCZOS)

# ===== 工具：构图用的圆形 mask + 柔光晕 =====
def render_icon(size, with_glow=False, bg_color=None, rounded=False):
    """生成单张图标. size 输出正方形."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    if bg_color is not None:
        # 实心背景（深色卡片，用于带光晕的 LOGO 框）
        radius = int(size * 0.22) if rounded else 0
        if radius > 0:
            draw.rounded_rectangle((0, 0, size, size), radius=radius, fill=bg_color)
        else:
            draw.rectangle((0, 0, size, size), fill=bg_color)

    if with_glow:
        # 主蓝外光晕（在图标背后画柔和光圈）
        glow_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow_layer)
        pad = int(size * 0.08)
        gd.ellipse((pad, pad, size - pad, size - pad),
                   fill=(123, 158, 255, int(255 * 0.18)))
        glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(radius=size * 0.04))
        canvas = Image.alpha_composite(canvas, glow_layer)
        draw = ImageDraw.Draw(canvas)

    # 居中放源图（留 6% padding，避免 macOS 圆角裁切到耳朵/角）
    inner = int(size * 0.94)
    pad = (size - inner) // 2
    src_resized = SRC.resize((inner, inner), Image.LANCZOS)
    canvas.paste(src_resized, (pad, pad), src_resized)

    return canvas

def render_app_icon(size):
    """macOS 应用图标：1024x1024 高清源图直接多分辨率.
    源图自带深蓝渐变背景 + 主体，缩放到各尺寸保持清晰."""
    return SRC_APP.resize((size, size), Image.LANCZOS)


# ===== 应用图标全套尺寸（macOS Apple 推荐 iconset 命名）=====
# Apple iconset 必须严格按文件名 icon_<W>x<H>.png / icon_<W>x<H>@2x.png
APP_ICON_SIZES = [
    (16,  "icon_16x16.png"),
    (32,  "icon_16x16@2x.png"),
    (32,  "icon_32x32.png"),
    (64,  "icon_32x32@2x.png"),
    (128, "icon_128x128.png"),
    (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"),
    (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"),
    (1024,"icon_512x512@2x.png"),
]

# Linux 应用图标标准尺寸（高 DPI 友好）
LINUX_SIZES = [512, 256, 128, 64]

# Windows .ico 推荐尺寸
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

# ===== LOGO 横排版：图标 + 文字 =====
def render_logo_horizontal(height=240):
    """
    横排 LOGO：左侧原图（透明背景）+ 右侧 MWI 主文字 + 多账号管理器 副文字
    尺寸：高度 = height, 宽度自适应（图标 + 间距 + 文字）
    背景：透明（无框无背景）
    """
    icon_size = height

    # 文字宽度估算：英文主文字 + 中文副文字
    font_main = find_font(int(height * 0.50), cjk=False)
    font_sub  = find_font(int(height * 0.16), cjk=True)

    # 用临时 draw 量文字尺寸
    tmp = Image.new("RGBA", (1, 1))
    td = ImageDraw.Draw(tmp)
    main_text = "MWI"
    sub_text  = "多账号管理器"
    main_bbox = td.textbbox((0, 0), main_text, font=font_main)
    sub_bbox  = td.textbbox((0, 0), sub_text, font=font_sub)
    main_w = main_bbox[2] - main_bbox[0]
    main_h = main_bbox[3] - main_bbox[1]
    sub_w  = sub_bbox[2]  - sub_bbox[0]
    sub_h  = sub_bbox[3]  - sub_bbox[1]

    gap = int(height * 0.20)
    text_w = max(main_w, sub_w) + int(height * 0.05)
    canvas_w = icon_size + gap + text_w + int(height * 0.10)
    canvas_h = height

    # 透明背景
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))

    # 左侧原图（透明背景，直接贴）
    pad_y = 0
    pad_x = 0
    src_resized = SRC.resize((icon_size, icon_size), Image.LANCZOS)
    canvas.paste(src_resized, (pad_x, pad_y), src_resized)

    # 右侧文字
    text_x = pad_x + icon_size + gap
    draw = ImageDraw.Draw(canvas)
    text_total_h = main_h + int(height * 0.06) + sub_h
    text_block_y = (canvas_h - text_total_h) // 2
    main_y = text_block_y - main_bbox[1]
    draw.text((text_x, main_y), main_text,
              font=font_main, fill=COLOR_ACCENT)
    sub_y = text_block_y + main_h + int(height * 0.06) - sub_bbox[1]
    draw.text((text_x, sub_y), sub_text,
              font=font_sub, fill=COLOR_TEXT_SECONDARY)

    return canvas


# ===== LOGO 竖排版：图标在上 + 文字在下 =====
def render_logo_stacked(size=512):
    """
    竖排 LOGO：图标在上（透明背景）+ 文字在下（透明背景）
    尺寸：size x size 方形
    """
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    icon_size = int(size * 0.70)
    icon_x = (size - icon_size) // 2
    icon_y = int(size * 0.06)

    # 原图（透明背景）
    src_resized = SRC.resize((icon_size, icon_size), Image.LANCZOS)
    canvas.paste(src_resized, (icon_x, icon_y), src_resized)

    # 文字区
    font_main = find_font(int(size * 0.16), cjk=False)
    font_sub  = find_font(int(size * 0.052), cjk=True)
    main_text = "MWI"
    sub_text  = "多账号管理器"

    tmp = Image.new("RGBA", (1, 1))
    td = ImageDraw.Draw(tmp)
    main_bbox = td.textbbox((0, 0), main_text, font=font_main)
    sub_bbox  = td.textbbox((0, 0), sub_text, font=font_sub)
    main_w = main_bbox[2] - main_bbox[0]
    main_h = main_bbox[3] - main_bbox[1]
    sub_w  = sub_bbox[2]  - sub_bbox[0]
    sub_h  = sub_bbox[3]  - sub_bbox[1]

    draw = ImageDraw.Draw(canvas)
    main_x = (size - main_w) // 2
    main_y = icon_y + icon_size + int(size * 0.04)
    draw.text((main_x, main_y - main_bbox[1]), main_text,
              font=font_main, fill=COLOR_ACCENT_STRONG)

    sub_x = (size - sub_w) // 2
    sub_y = main_y + main_h + int(size * 0.02)
    draw.text((sub_x, sub_y - sub_bbox[1]), sub_text,
              font=font_sub, fill=COLOR_TEXT_SECONDARY)

    return canvas

# ===== 主逻辑 =====
def main():
    print("=" * 60)
    print("MWI Multi-Account Manager - 图标 + LOGO 生成器")
    print("=" * 60)
    print("源图：%s (%dx%d)" % (SRC_PNG, SRC.size[0], SRC.size[1]))

    # 1) macOS iconset (覆盖 build/mwi.iconset/)
    iconset_dir = os.path.join(BUILD, "mwi.iconset")
    if os.path.exists(iconset_dir):
        import shutil
        shutil.rmtree(iconset_dir)
    os.makedirs(iconset_dir, exist_ok=True)
    print("\n[1/5] 生成 macOS iconset (%d 个尺寸) ..." % len(APP_ICON_SIZES))
    for size, fname in APP_ICON_SIZES:
        img = render_app_icon(size)
        out = os.path.join(iconset_dir, fname)
        img.save(out, "PNG", optimize=True)
        print("    %-32s  %dx%d  %d bytes" % (fname, size, size, os.path.getsize(out)))

    # 2) macOS icon.icns （Pillow IcnsImagePlugin 直接拼）
    print("\n[2/5] 生成 build/icon.icns ...")
    # Apple iconset 标准 ICNS 尺寸（Apple 推荐：16/32/64/128/256/512/1024）
    icns_sizes = [16, 32, 64, 128, 256, 512, 1024]
    # 从 iconset 解析：icon_<W>x<H>.png = WxW；icon_<W>x<H>@2x.png = (2W)x(2W)
    icon_files = {}
    for fname in sorted(os.listdir(iconset_dir)):
        if not fname.endswith(".png"):
            continue
        stem = fname[:-4]  # 去 .png
        # 解析名义尺寸
        is_retina = "@2x" in stem
        base = stem.split("@")[0]  # "icon_128x128"
        size_str = base.replace("icon_", "")  # "128x128"
        w = int(size_str.split("x")[0])
        actual = w * 2 if is_retina else w
        # 优先同名非 @2x，再 @2x
        if actual not in icon_files:
            icon_files[actual] = fname
        elif is_retina and "@2x" not in icon_files[actual]:
            icon_files[actual] = fname

    print("    iconset 尺寸映射:", dict(sorted(icon_files.items())))

    icns_imgs = []
    for size in icns_sizes:
        fname = icon_files.get(size)
        if fname is None:
            print("    WARN: iconset 缺 %dx%d.png，跳过 icns 该尺寸" % (size, size))
            continue
        base = Image.open(os.path.join(iconset_dir, fname))
        icns_imgs.append(base)

    icns_out = os.path.join(BUILD, "icon.icns")
    # Pillow 的 IcnsImagePlugin 支持 sizes=[...] 直接合成
    icns_imgs[0].save(icns_out, format="ICNS", sizes=[s for s, _ in zip(icns_sizes, icns_imgs)])
    print("    %s  %d bytes" % (icns_out, os.path.getsize(icns_out)))

    # 3) Windows .ico （多尺寸合一，PNG-in-ICO 格式，Vista+ 全支持）
    print("\n[3/5] 生成 build/icon.ico ...")
    import struct, io as _io
    ico_entries = []
    for size in ICO_SIZES:
        img = render_app_icon(size)
        png_buf = _io.BytesIO()
        img.save(png_buf, format="PNG")
        ico_entries.append((size, size, png_buf.getvalue()))
    # ICONDIR + ICONDIRENTRY + PNG bytes
    header = struct.pack("<HHH", 0, 1, len(ico_entries))
    entries_bin = b""
    data_bin = b""
    offset = 6 + 16 * len(ico_entries)
    for w, h, png_bytes in ico_entries:
        entries_bin += struct.pack("<BBBBHHII",
            0 if w >= 256 else w, 0 if h >= 256 else h,
            0, 0, 1, 32, len(png_bytes), offset)
        data_bin += png_bytes
        offset += len(png_bytes)
    ico_out = os.path.join(BUILD, "icon.ico")
    with open(ico_out, "wb") as f:
        f.write(header + entries_bin + data_bin)
    print("    %s  %d bytes (%d 个尺寸: %s)" % (
        ico_out, os.path.getsize(ico_out), len(ico_entries),
        ", ".join(str(s) for s in ICO_SIZES)))

    # 4) Linux 应用图标 PNG 多尺寸（额外放 build/icons/）
    linux_dir = os.path.join(BUILD, "icons")
    os.makedirs(linux_dir, exist_ok=True)
    print("\n[4/5] 生成 build/icons/ (Linux 多尺寸) ...")
    for size in LINUX_SIZES:
        img = render_app_icon(size)
        out = os.path.join(linux_dir, "%dx%d.png" % (size, size))
        img.save(out, "PNG", optimize=True)
        print("    %dx%d.png  %d bytes" % (size, size, os.path.getsize(out)))

    # 5) 品牌 LOGO（brand/）
    os.makedirs(BRAND, exist_ok=True)
    print("\n[5/5] 生成 brand/ 品牌 LOGO ...")
    # 横排 240/512/1024 三档
    for h in [240, 512, 1024]:
        img = render_logo_horizontal(height=h)
        out = os.path.join(BRAND, "logo-horizontal-%d.png" % h)
        img.save(out, "PNG", optimize=True)
        print("    logo-horizontal-%d.png  %dx%d  %d bytes" % (h, img.size[0], img.size[1], os.path.getsize(out)))
    # 竖排 256/512/1024 三档
    for s in [256, 512, 1024]:
        img = render_logo_stacked(size=s)
        out = os.path.join(BRAND, "logo-stacked-%d.png" % s)
        img.save(out, "PNG", optimize=True)
        print("    logo-stacked-%d.png      %dx%d  %d bytes" % (s, s, s, os.path.getsize(out)))

    print("\n" + "=" * 60)
    print("完成。")
    print("=" * 60)

if __name__ == "__main__":
    main()
