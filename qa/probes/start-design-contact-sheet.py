"""Compose the five accepted real-window captures; never synthesize UI pixels."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

p = argparse.ArgumentParser()
p.add_argument("report", type=Path)
p.add_argument("--theme", choices=["light", "dark"], default="light")
a = p.parse_args()
report = json.loads(a.report.read_text(encoding="utf-8"))
if report["status"] != "passed":
    raise SystemExit("Only an accepted native run can produce the final comparison.")
root = Path(__file__).resolve().parents[2]
versions = [("bench", "01 并肩工作台"), ("switchboard", "02 模型接线台"), ("spine", "03 从连接到见面"), ("stage", "04 桌宠在场"), ("workspaces", "05 三页工作簿")]
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17)
sheet = Image.new("RGB", (1264, 1424), "#edf0f3")
draw = ImageDraw.Draw(sheet)
for index, (id, label) in enumerate(versions):
    entry = next(s for s in report["screenshots"] if s["name"] == id + "-" + a.theme + "-1200x800")
    if [entry["width"], entry["height"], entry["zoom"]] != [1200, 800, 1]:
        raise SystemExit("Incomparable native viewport.")
    image = Image.open(root / entry["file"]).convert("RGB")
    image = ImageOps.contain(image, (600, 400), Image.Resampling.LANCZOS)
    x, y = 24 + (index % 2) * 620, 20 + (index // 2) * 468
    draw.text((x, y), label, fill="#203244", font=font)
    sheet.paste(image, (x, y + 42))
    draw.rectangle((x, y + 42, x + 599, y + 441), outline="#c6ced8", width=1)
x, y = 644, 1010
draw.text((x, y), "5 个新方案 · 同一套真实动作", fill="#203244", font=font)
draw.text((x, y + 44), "原生窗口 1200×800 / 100% zoom", fill="#506176", font=small)
draw.text((x, y + 78), "查看单图或打开 Electron 评审入口比较", fill="#506176", font=small)
output = a.report.parent / ("overview-" + a.theme + ".png")
sheet.save(output)
print(output)
