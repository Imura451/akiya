# -*- coding: utf-8 -*-
"""SNSで共有したときに出る画像（1200x630）を、3言語分つくる。

   Zalo・Facebook・LINE でリンクを送ると、この画像が大きく表示されます。
   キャッチコピーを変えたら、このスクリプトを実行し直してください。

     python tools/make-ogp.py
"""
import json, os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets')
FONTS = r'C:\Windows\Fonts'

# 配色は CLAUDE.md の「今後の配色」（白・レッド・ブラック・薄いグレー）
INK = (26, 26, 26)
RED = (227, 6, 19)
WHITE = (255, 255, 255)
SUB = (97, 97, 97)

# ベトナム語の声調記号を確実に出すため、ベトナム語・英語は Segoe UI、日本語は Noto Sans JP を使います
FONT = {
    'vi': (os.path.join(FONTS, 'segoeuib.ttf'), os.path.join(FONTS, 'segoeui.ttf')),
    'en': (os.path.join(FONTS, 'segoeuib.ttf'), os.path.join(FONTS, 'segoeui.ttf')),
    'ja': (os.path.join(FONTS, 'NotoSansJP-VF.ttf'), os.path.join(FONTS, 'NotoSansJP-VF.ttf')),
}


def wrap(draw, text, font, width):
    """幅に収まるように改行します。
       まず読点（, や 、）で区切り、それでも長い句だけを細かく折ります。
       「Việt Nam」のような言葉が途中で切れないようにするためです"""
    import re
    phrases = [x for x in re.split(r'(?<=[,、])\s*', text) if x]
    if len(phrases) > 1 and draw.textlength(text, font=font) > width:
        lines, cur = [], ''
        for ph in phrases:
            sep = ' ' if cur and ' ' in text else ''
            test = cur + sep + ph if cur else ph
            if draw.textlength(test, font=font) <= width:
                cur = test
            else:
                if cur:
                    lines.append(cur)
                cur = ph
        if cur:
            lines.append(cur)
        if all(draw.textlength(l, font=font) <= width for l in lines):
            return lines
    return _wrap_words(draw, text, font, width)


def _wrap_words(draw, text, font, width):
    """日本語は1文字ずつ、ほかは単語ごとに折ります"""
    words = list(text) if ' ' not in text else text.split(' ')
    joiner = '' if ' ' not in text else ' '
    lines, cur = [], ''
    for w in words:
        test = (cur + joiner + w) if cur else w
        if draw.textlength(test, font=font) <= width:
            cur = test
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def make(lang):
    t = json.load(open(os.path.join(ROOT, 'lang', lang + '.json'), encoding='utf-8'))
    W, H = 1200, 630
    im = Image.new('RGB', (W, H), WHITE)
    d = ImageDraw.Draw(im)

    # 上端と下端のレッドの帯
    d.rectangle([0, 0, W, 14], fill=RED)
    d.rectangle([0, H - 6, W, H], fill=RED)

    bold, reg = FONT[lang]
    fb = ImageFont.truetype(bold, 64)
    fs = ImageFont.truetype(reg, 30)
    fn = ImageFont.truetype(bold, 34)
    if lang == 'ja':
        try:
            fb.set_variation_by_name('Bold')
            fn.set_variation_by_name('Bold')
            fs.set_variation_by_name('Regular')   # 指定しないと、いちばん細い太さになります
        except Exception:
            pass

    # 家の印
    x0, y0 = 80, 90
    d.rounded_rectangle([x0, y0, x0 + 72, y0 + 72], radius=16, fill=RED)
    d.line([(x0 + 14, y0 + 36), (x0 + 36, y0 + 16), (x0 + 58, y0 + 36)], fill=WHITE, width=6, joint='curve')
    d.line([(x0 + 21, y0 + 33), (x0 + 21, y0 + 58), (x0 + 51, y0 + 58), (x0 + 51, y0 + 33)], fill=WHITE, width=6)
    d.rectangle([x0 + 31, y0 + 40, x0 + 41, y0 + 58], fill=WHITE)
    d.text((x0 + 92, y0 + 16), t['meta']['siteName'], font=fn, fill=INK)

    # キャッチコピー
    y = 230
    for line in wrap(d, t['home']['heroTitle'], fb, W - 160):
        d.text((80, y), line, font=fb, fill=INK)
        y += 88

    # レッドの線
    d.rectangle([80, y + 14, 200, y + 20], fill=RED)

    # ひとこと
    y += 44
    for line in wrap(d, t['common']['ctaConsultSub'], fs, W - 160)[:2]:
        d.text((80, y), line, font=fs, fill=SUB)
        y += 44

    p = os.path.join(OUT, 'ogp-%s.png' % lang)
    im.save(p, optimize=True)
    print('作成:', os.path.relpath(p, ROOT))


for L in ['vi', 'ja', 'en']:
    make(L)
