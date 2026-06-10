from pathlib import Path
import textwrap

from PIL import Image, ImageDraw, ImageFont


OUT = Path(r"C:\Users\user\Documents\Codex\CHIWA-live\delivery\chiwa-subscription-fees-20260601.png")
OUT.parent.mkdir(parents=True, exist_ok=True)

FONT_REG = r"C:\Windows\Fonts\NotoSansTC-VF.ttf"
FONT_BOLD = r"C:\Windows\Fonts\Noto Sans SC Bold (TrueType).otf"
if not Path(FONT_BOLD).exists():
    FONT_BOLD = FONT_REG


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


W, H = 1700, 1180
img = Image.new("RGB", (W, H), "#08090f")
d = ImageDraw.Draw(img)

gold = "#F3D65C"
white = "#F6F3E8"
muted = "#AEB4D4"
line = "#30364D"
card = "#111522"
card2 = "#151B2D"
green = "#55D68A"
red = "#FF8B8B"

d.rounded_rectangle((45, 42, W - 45, 160), radius=28, fill="#111827", outline="#2d344c", width=2)
d.text((85, 65), "吉娃 AI｜目前網站公開費用與訂閱週期整理", fill=gold, font=font(44, True))
d.text((88, 122), "依目前可讀取的網站前台 / 工作台程式文字整理，日期：2026-06-01", fill=muted, font=font(23))

cards = [
    ("一鍵工作流 / 後台系統", "未找到獨立訂閱費", "目前看起來是學員工作台功能，不是單獨售價頁。"),
    ("方案 A 代運營", "按月計費", "有 1 / 3 / 6 / 12 個月合約期；公開頁未列月費金額。"),
    ("方案 B 自學課程", "NT$29,800", "一次性收費，無月費。"),
]
x0, y0, cw, ch, gap = 55, 190, 510, 170, 30
for i, (a, b, c) in enumerate(cards):
    x = x0 + i * (cw + gap)
    d.rounded_rectangle((x, y0, x + cw, y0 + ch), radius=20, fill=card, outline="#2f3856", width=2)
    d.text((x + 28, y0 + 24), a, fill=muted, font=font(25, True))
    d.text((x + 28, y0 + 65), b, fill=gold if i != 0 else red, font=font(38, True))
    for j, line_txt in enumerate(textwrap.wrap(c, width=28)[:2]):
        d.text((x + 28, y0 + 116 + j * 28), line_txt, fill=white, font=font(20))

left, top = 55, 410
colw = [250, 235, 310, 535, 255]
headers = ["項目", "收費週期", "目前公開費用", "目前網站寫法 / 包含內容", "判斷"]
rows = [
    ["一鍵工作流", "未列獨立訂閱", "未公開", "選題→口播文案→語音→形象克隆→字幕/成片測試；屬工作台流程", "不像獨立月費"],
    ["學員後台 / Workspace", "每月重置額度", "未公開獨立費用", "AI 300 次、語音 10,000 字、影像克隆 1,800 秒；依學員方案給權限", "包含在學員權限"],
    ["方案 A 代運營服務", "按月計費", "月費未列", "有 1 個月體驗、3 個月、6 個月、12 個月；承諾期越長月費越低", "月訂閱 / 合約制"],
    ["AI 啟動費", "一次性", "NT$10,000", "首次建立形象克隆＋語音克隆；僅 1 個月體驗方案需自付，3 個月以上免收", "一次性費用"],
    ["方案 B 自學課程", "一次性", "NT$29,800", "一次性收費，無月費；購買後提供課程與工作台權限", "非月/年訂閱"],
    ["外部 AI 工具", "月費另計", "Claude Pro 約 NT$650/月", "課程主要使用 Claude Pro；其他工具依當時可用方案說明", "學員自付"],
    ["交叉優惠", "一次折抵", "NT$5,000", "購買課程後 12 個月內加入代運營，或反向加入，可折抵", "優惠非訂閱"],
]
rowh = 86
d.rounded_rectangle((left, top, left + sum(colw), top + 58), radius=16, fill="#1c2438", outline="#3a4564", width=2)
x = left
for i, h in enumerate(headers):
    d.text((x + 14, top + 14), h, fill=gold, font=font(22, True))
    x += colw[i]

for r, row in enumerate(rows):
    y = top + 58 + r * rowh
    fill = card if r % 2 == 0 else card2
    d.rounded_rectangle((left, y, left + sum(colw), y + rowh - 3), radius=10, fill=fill, outline="#242b41", width=1)
    x = left
    for i, cell in enumerate(row):
        max_chars = [10, 10, 13, 29, 10][i]
        lines = textwrap.wrap(cell, width=max_chars)
        color = white
        if i == 2 and ("NT$" in cell or "650" in cell):
            color = gold
        if i == 4:
            color = green if ("月" in cell or "包含" in cell) else muted
        for j, line_txt in enumerate(lines[:3]):
            d.text((x + 14, y + 13 + j * 24), line_txt, fill=color, font=font(19, i in (0, 2)))
        x += colw[i]
    xx = left
    for w in colw[:-1]:
        xx += w
        d.line((xx, y + 8, xx, y + rowh - 12), fill=line, width=1)

note_y = top + 58 + len(rows) * rowh + 28
d.rounded_rectangle((55, note_y, W - 55, H - 55), radius=20, fill="#111827", outline="#33405e", width=2)
notes = [
    "重點結論：目前網站看得到「方案 B 自學課程 NT$29,800 一次性、無月費」；「方案 A 代運營」是按月/合約期，但沒有公開實際月費。",
    "一鍵工作流與後台 Workspace 沒有找到獨立月費或年費欄位；目前比較像包含在學員權限與方案內的系統功能。",
    "若要對外銷售「一鍵工作流系統訂閱」，仍需要另外定義月繳 / 年繳價格與方案權限。",
]
for i, n in enumerate(notes):
    d.text((90, note_y + 25 + i * 39), "• " + n, fill=white if i == 0 else muted, font=font(22, i == 0))

img.save(OUT, quality=95)
print(OUT)
