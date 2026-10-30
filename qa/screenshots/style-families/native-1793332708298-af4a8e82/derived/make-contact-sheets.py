from pathlib import Path
import hashlib, json, textwrap
from PIL import Image, ImageDraw, ImageFont

ROOT = Path.cwd()
BASE = ROOT / 'qa/screenshots/style-families/native-1793332708298-af4a8e82'
OUT = BASE / 'derived'
REPORT = json.loads((BASE / 'native-report.json').read_text(encoding='utf-8'))
assert REPORT['status'] == 'passed'
assert len(REPORT['screenshots']) == 61
FAMILIES = ['precision', 'hearth', 'folio', 'prism', 'workbench']
NAMES = {'precision': 'Precision / instrument', 'hearth': 'Hearth / warm cards', 'folio': 'Folio / paper', 'prism': 'Prism / glass', 'workbench': 'Workbench / retained'}
CN_NAMES = {'precision': '仪表台 Precision', 'hearth': '炉边 Hearth', 'folio': '稿纸 Folio', 'prism': '棱镜 Prism', 'workbench': '饲养台 Workbench（保留）'}
FONT_CN = False

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def font(size, bold=False):
    path = Path(('C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc') if FONT_CN else ('C:/Windows/Fonts/seguisb.ttf' if bold else 'C:/Windows/Fonts/segoeui.ttf'))
    return ImageFont.truetype(str(path), size)

specs = [
    ('five-styles-representative.png', 'FIVE START STYLE FAMILIES', 'start', 'representative'),
    ('five-styles-light.png', 'FIVE START STYLES / LIGHT', 'start', 'light'),
    ('five-styles-dark.png', 'FIVE START STYLES / DARK', 'start', 'dark'),
    ('five-boards-representative.png', 'FIVE CONTROL AND STATE BOARDS', 'board', 'representative'),
]
records = []
for filename, title, view, mode in specs:
    FONT_CN = mode == 'representative'
    if FONT_CN:
        title = '五种桌宠风格' if view == 'start' else '五套控件与状态样板'
    cellw, shotw, shoth, cellh = 620, 620, 414, 486
    pad, gap, top = 24, 24, 112
    canvas = Image.new('RGB', (pad*2 + cellw*2 + gap, top + cellh*3 + 20), '#e9edef')
    draw = ImageDraw.Draw(canvas)
    draw.text((pad, 21), title, fill='#19252d', font=font(28, True))
    subtitle = '真实 Electron 窗口 · 1200×800 · 缩放 1 · 未裁切' if FONT_CN else 'Accepted native run af4a8e82 | original 1200 x 800 | zoom 1 | full frames, no crop'
    draw.text((pad, 62), subtitle, fill='#435764', font=font(16))
    inputs=[]
    for idx, family in enumerate(FAMILIES):
        chosen_mode = ('dark' if family == 'prism' else 'light') if mode == 'representative' else mode
        label = f'{family}-{chosen_mode}-{view}-1200x800'
        item = next(x for x in REPORT['screenshots'] if x['label'] == label)
        path = ROOT / item['path']
        image = Image.open(path).convert('RGB')
        assert image.size == (1200, 800)
        x = pad + (idx % 2)*(cellw+gap)
        y = top + (idx // 2)*cellh
        draw.text((x, y), (CN_NAMES if FONT_CN else NAMES)[family], fill='#19252d', font=font(20, True))
        caption = f"{'深色' if chosen_mode == 'dark' else '浅色'} · {'开始视图' if view == 'start' else '控件样板'} · 1200×800" if FONT_CN else f'{chosen_mode.upper()} | {view.upper()} | 1200 x 800'
        draw.text((x, y+29), caption, fill='#435764', font=font(14))
        canvas.paste(image.resize((shotw, shoth), Image.Resampling.LANCZOS), (x, y+52))
        draw.rectangle((x-1, y+51, x+shotw, y+52+shoth), outline='#b8c2c9', width=1)
        inputs.append({'family':family,'mode':chosen_mode,'view':view,'path':item['path'],'sha256':digest(path),'originalSize':[1200,800],'transform':'whole-frame proportional resize; no crop'})
    x = pad + cellw + gap
    y = top + cellh*2
    draw.rounded_rectangle((x, y+12, x+cellw, y+465), radius=14, fill='#dce3e7')
    notes = ['ACTUAL NATIVE EVIDENCE', 'Five presentation families; four new + retained Workbench.', 'Shared business/data owners; separate window/control languages.', '22 / 22 native checks passed. 61 original screenshots retained.', 'Each panel explicitly labels light/dark and Start/board.', 'Boards are local interaction samples, not service connection receipts.', 'Original full-size files and complete run evidence are linked in the canonical review.']
    if FONT_CN:
        notes = ['五种独立风格', '四套新方案，加一套保留的饲养台。', '本图：四家浅色，棱镜深色。', '22 项原生检查通过，61 幅原图保留。', '业务能力共用，控件与整窗各自设计。', '样板只演示本地状态，不表示服务已连接。']
    cursor=y+38
    for idx, note in enumerate(notes):
        f=font(18 if idx == 0 else 17, idx == 0)
        lines=textwrap.wrap(note, width=58)
        for line in lines:
            draw.text((x+22,cursor),line,fill='#243943',font=f)
            cursor+=26
        cursor+=13
    target=OUT/filename
    canvas.save(target, optimize=True)
    records.append({'path':target.relative_to(ROOT).as_posix(),'sha256':digest(target),'bytes':target.stat().st_size,'size':list(canvas.size),'sources':inputs})
manifest={'schemaVersion':1,'nativeReport':'qa/screenshots/style-families/native-1793332708298-af4a8e82/native-report.json','nativeReportSha256':digest(BASE/'native-report.json'),'nativeStatus':REPORT['status'],'sheets':records,'scope':'Derived comparison only; original 61 captures preserved. No new application run.'}
(OUT/'contact-sheets.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'sheets':[{'path':x['path'],'sha256':x['sha256'],'bytes':x['bytes'],'size':x['size']} for x in records]},indent=2))
