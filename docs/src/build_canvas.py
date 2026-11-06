"""Build the Excalidraw edition of the blog and its web twin.

    python docs/src/build_canvas.py

Writes
  docs/stageleaf-blog.excalidraw   the post as ten Excalidraw frames
  docs/src/figures.excalidraw      the figures alone, one frame each, for the web edition
  docs/blog.md                     the web edition's text, from the same strings

Text is measured with the Excalifont, Nunito and Cascadia files that ship with
@excalidraw/excalidraw, so wrapped lines match what Excalidraw draws. Needs
Pillow and fontTools (with brotli). Set EXCALIDRAW_FONTS to the package's
dist/prod/fonts folder.
"""
import base64, glob, hashlib, io, json, math, os, pathlib, random, re, sys

from PIL import Image
from fontTools.ttLib import TTFont

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import blog_text as T  # noqa: E402

DOCS = HERE.parent
ASSETS = HERE / 'assets'
FONTS = pathlib.Path(os.environ.get(
    'EXCALIDRAW_FONTS', '/tmp/excalidraw-render/node_modules/@excalidraw/excalidraw/dist/prod/fonts'))

W, L, CW = 1600, 110, 1380          # frame width, left margin, content width
GAP = 150                           # space between frames
EXC, NUN, MONO = 5, 6, 3            # Excalidraw font ids: Excalifont, Nunito, Cascadia
INK, BODY, MUTED = '#1e1e1e', '#343a40', '#7b8088'
RED, ACC = '#e03131', '#e8590c'
PAPER, EDGE = '#fffdf8', '#ddd4c2'
LEAF, NAVY, GREEN = '#2f6b57', '#1e325c', '#2b8a3e'
STICKY = {'yellow': ('#fff3bf', '#f2c94c'), 'blue': ('#dbeafe', '#74a8e8'),
          'green': ('#d8f5dc', '#69c27a'), 'pink': ('#ffe3ec', '#e891ad'),
          'orange': ('#ffe8d9', '#f4a261')}
UPDATED = 1793980800000
rng = random.Random(20261106)


def plain(s):
    """Markdown to canvas text: drop backticks, keep link text."""
    s = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', s)
    return s.replace('`', '')


# ---------------------------------------------------------------- text metrics
class Metrics:
    def __init__(self, family):
        self.adv, self.upm = {}, 1000
        for f in sorted(glob.glob(str(FONTS / family / '*.woff2'))):
            t = TTFont(f)
            self.upm = t['head'].unitsPerEm
            hmtx = t['hmtx'].metrics
            for cp, g in t.getBestCmap().items():
                self.adv.setdefault(cp, hmtx[g][0])
        self.fallback = self.adv.get(ord('n'), 500)

    def width(self, s, size):
        return sum(self.adv.get(ord(ch), self.fallback) for ch in s) * size / self.upm


MET = {EXC: Metrics('Excalifont'), NUN: Metrics('Nunito'), MONO: Metrics('Cascadia')}


def wrap(s, fam, size, width):
    lines = []
    for para in s.split('\n'):
        cur = ''
        for word in para.split(' '):
            trial = word if not cur else cur + ' ' + word
            if MET[fam].width(trial, size) <= width * 0.985 or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = word
        lines.append(cur)
    return lines


# ---------------------------------------------------------------- scene model
class Canvas:
    def __init__(self):
        self.els, self.files, self.n = [], {}, 0
        self.frame_id, self.frame_start = None, 0

    def _id(self, p='el'):
        self.n += 1
        return f'{p}{self.n:04d}'

    def base(self, typ, x, y, w, h, **kw):
        d = dict(id=self._id(), type=typ, x=float(x), y=float(y), width=float(w), height=float(h), angle=0,
                 strokeColor=INK, backgroundColor='transparent', fillStyle='solid', strokeWidth=2,
                 strokeStyle='solid', roughness=1, opacity=100, groupIds=[], frameId=self.frame_id,
                 roundness=None, seed=rng.randint(1, 2**31 - 1), version=1,
                 versionNonce=rng.randint(1, 2**31 - 1), isDeleted=False, boundElements=None,
                 updated=UPDATED, link=None, locked=False)
        d.update(kw)
        self.els.append(d)
        return d

    def begin(self, name):
        self.frame_id = self._id('frame')
        self.frame_start = len(self.els)
        self.frame_name = name

    def end(self, y, h, x=0, w=W, stroke=EDGE):
        fid = self.frame_id
        frame = dict(id=fid, type='frame', x=float(x), y=float(y), width=float(w), height=float(h), angle=0,
                     strokeColor='#bbb', backgroundColor='transparent', fillStyle='solid', strokeWidth=2,
                     strokeStyle='solid', roughness=0, opacity=100, groupIds=[], frameId=None, roundness=None,
                     seed=rng.randint(1, 2**31 - 1), version=1, versionNonce=rng.randint(1, 2**31 - 1),
                     isDeleted=False, boundElements=None, updated=UPDATED, link=None, locked=False,
                     name=self.frame_name)
        pg = dict(frame, id=self._id(), type='rectangle', backgroundColor=PAPER, strokeColor=stroke,
                  strokeWidth=1, roughness=0, frameId=fid)
        pg.pop('name')
        self.els[self.frame_start:self.frame_start] = [frame, pg]
        self.frame_id = None

    def text(self, x, y, s, fam=NUN, size=22, color=BODY, width=None, align='left', lh=None, angle=0,
             link=None, opacity=100):
        lh = lh or (1.25 if fam == EXC else 1.42 if fam == NUN else 1.35)
        lines = wrap(s, fam, size, width) if width else s.split('\n')
        tw = max(MET[fam].width(l, size) for l in lines) + 2
        h = len(lines) * size * lh
        if align == 'center':
            x -= tw / 2
        elif align == 'right':
            x -= tw
        txt = '\n'.join(lines)
        return self.base('text', x, y, tw, h, text=txt, originalText=txt, fontSize=size, fontFamily=fam,
                         textAlign=align, verticalAlign='top', containerId=None, autoResize=True,
                         lineHeight=lh, strokeColor=color, angle=angle, link=link, opacity=opacity)

    def rect(self, x, y, w, h, fill='transparent', stroke=INK, sw=2, rough=1, style='solid', fs='solid',
             rounded=True, opacity=100, angle=0):
        return self.base('rectangle', x, y, w, h, backgroundColor=fill, strokeColor=stroke, strokeWidth=sw,
                         roughness=rough, strokeStyle=style, fillStyle=fs, opacity=opacity, angle=angle,
                         roundness={'type': 3} if rounded else None)

    def ellipse(self, cx, cy, w, h, stroke=RED, sw=2.5, rough=1.4, fill='transparent', fs='solid', opacity=100):
        return self.base('ellipse', cx - w / 2, cy - h / 2, w, h, strokeColor=stroke, strokeWidth=sw,
                         roughness=rough, backgroundColor=fill, fillStyle=fs, opacity=opacity)

    def line(self, pts, color=INK, sw=2, rough=1, style='solid', arrow=None, start=None, curved=False,
             typ='line', opacity=100, fill='transparent'):
        x0, y0 = pts[0]
        rel = [[float(px - x0), float(py - y0)] for px, py in pts]
        xs, ys = [p[0] for p in rel], [p[1] for p in rel]
        d = self.base(typ, x0, y0, max(xs) - min(xs), max(ys) - min(ys), strokeColor=color, strokeWidth=sw,
                      roughness=rough, strokeStyle=style, opacity=opacity, backgroundColor=fill,
                      roundness={'type': 2} if curved else None, points=rel, lastCommittedPoint=None,
                      startBinding=None, endBinding=None, startArrowhead=start, endArrowhead=arrow)
        if typ == 'arrow':
            d['elbowed'] = False
        return d

    def arrow(self, pts, color=RED, sw=2, curved=True, rough=1, head='arrow', start=None, style='solid'):
        return self.line(pts, color=color, sw=sw, rough=rough, arrow=head, start=start, curved=curved,
                         typ='arrow', style=style)

    def image(self, src, x, y, w=None, h=None, fmt='JPEG', quality=88, angle=0, scale=2.0, link=None):
        im = src if isinstance(src, Image.Image) else Image.open(src)
        if w is None:
            w = h * im.width / im.height
        if h is None:
            h = w * im.height / im.width
        target = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
        if target[0] < im.width:
            im = im.resize(target, Image.LANCZOS)
        buf = io.BytesIO()
        if fmt == 'PNG':
            im.convert('RGBA').save(buf, 'PNG', optimize=True)
            mime = 'image/png'
        else:
            im.convert('RGB').save(buf, 'JPEG', quality=quality, optimize=True, progressive=True)
            mime = 'image/jpeg'
        data = buf.getvalue()
        fid = hashlib.sha1(data).hexdigest()
        self.files[fid] = dict(mimeType=mime, id=fid, created=UPDATED, lastRetrieved=UPDATED,
                               dataURL=f'data:{mime};base64,' + base64.b64encode(data).decode())
        return self.base('image', x, y, w, h, fileId=fid, status='saved', scale=[1, 1], crop=None,
                         strokeColor='transparent', angle=angle, roughness=0, strokeWidth=1, link=link)


def rotate_group(els, cx, cy, deg):
    a = math.radians(deg)
    gid = 'g' + hashlib.sha1(''.join(e['id'] for e in els).encode()).hexdigest()[:10]
    for e in els:
        ex, ey = e['x'] + e['width'] / 2, e['y'] + e['height'] / 2
        dx, dy = ex - cx, ey - cy
        nx, ny = cx + dx * math.cos(a) - dy * math.sin(a), cy + dx * math.sin(a) + dy * math.cos(a)
        e['x'] += nx - ex
        e['y'] += ny - ey
        e['angle'] = (e.get('angle', 0) + a) % (2 * math.pi)
        e['groupIds'] = e['groupIds'] + [gid]
    return gid


def group(els):
    gid = 'g' + hashlib.sha1(''.join(e['id'] for e in els).encode()).hexdigest()[:10]
    for e in els:
        e['groupIds'] = e['groupIds'] + [gid]
    return gid


def asset(name, box=None):
    im = Image.open(ASSETS / name).convert('RGB')
    return im.crop(box) if box else im


# ---------------------------------------------------------------- reusable parts
def balanced(s, fam, size, width):
    """Break a heading that needs two lines where the two lines come out closest in length."""
    if len(wrap(s, fam, size, width)) < 2:
        return s
    words = s.split(' ')
    best, best_w = s, float('inf')
    for i in range(1, len(words)):
        a, b = ' '.join(words[:i]), ' '.join(words[i:])
        w = max(MET[fam].width(a, size), MET[fam].width(b, size))
        if w <= width * 0.985 and w < best_w:
            best, best_w = a + '\n' + b, w
    return best


def kicker_head(c, y, kicker, head, size=54, width=1340):
    c.text(L, y, kicker, EXC, 22, ACC)
    t = c.text(L, y + 46, balanced(head, EXC, size, width), EXC, size, INK, lh=1.15)
    return y + 46 + t['height'] + 30


def para(c, x, y, s, width, size=22, color=BODY):
    t = c.text(x, y, plain(s), NUN, size, color, width=width, lh=1.5)
    return t['height']


def paras(c, x, y, items, width, size=22, gap=14):
    for s in items:
        y += para(c, x, y, s, width, size) + gap
    return y - gap


def columns(c, y, items, n=2, size=22, gap=60):
    width = (CW - gap * (n - 1)) / n
    bottom = y
    for i, s in enumerate(items):
        bottom = max(bottom, y + para(c, L + i * (width + gap), y, s, width, size))
    return bottom


def sticky(c, x, y, w, s, color='yellow', size=26, deg=0, fam=EXC, pad=28, title=None, tsize=27):
    fill, edge = STICKY[color]
    inner = w - 2 * pad
    th = len(wrap(title, EXC, tsize, inner)) * tsize * 1.25 + 10 if title else 0
    lh = 1.3 if fam == EXC else 1.45
    h = len(wrap(s, fam, size, inner)) * size * lh + 2 * pad + th
    els = [c.rect(x + 6, y + 8, w, h, fill='#d9d1c0', stroke='transparent', rough=0, opacity=55),
           c.rect(x, y, w, h, fill=fill, stroke=edge, sw=1.5, rough=1)]
    if title:
        els.append(c.text(x + pad, y + pad, title, EXC, tsize, INK, width=inner, lh=1.25))
        els.append(c.text(x + pad, y + pad + th, s, fam, size, BODY, width=inner, lh=lh))
    else:
        t = c.text(x + w / 2, y + pad, s, fam, size, INK, width=inner, align='center', lh=lh)
        t['x'] = x + (w - t['width']) / 2
        els.append(t)
    if deg:
        rotate_group(els, x + w / 2, y + h / 2, deg)
    else:
        group(els)
    return h


def num_note(c, x, y, n, s, width=320, size=21, color=RED):
    """A red circled number with a handwritten note beside it. Returns its height."""
    c.ellipse(x + 17, y + 16, 36, 34, stroke=color, sw=2, rough=1.1)
    c.text(x + 17, y + 3, str(n), EXC, 21, color, align='center')
    t = c.text(x + 46, y, s, EXC, size, color, width=width - 46, lh=1.2)
    return max(34, t['height'])


def shot(c, im, x, y, w, deg=0, tape=False, pad=0, shadow=True):
    """A screenshot laid on the page: thin border, soft shadow, optional tape."""
    h = w * im.height / im.width
    els = []
    if shadow:
        els.append(c.rect(x + 5, y + 7, w + 2 * pad, h + 2 * pad, fill='#d6cdbb', stroke='transparent',
                          rough=0, opacity=55, rounded=False))
    els.append(c.rect(x, y, w + 2 * pad, h + 2 * pad, fill='#ffffff', stroke='#d9d3c7', sw=1, rough=0,
                      rounded=False))
    els.append(c.image(im, x + pad, y + pad, w=w, h=h))
    if deg:
        gid = rotate_group(els, x + w / 2 + pad, y + h / 2 + pad, deg)
    else:
        gid = group(els)
    if tape:
        for tx in ([x + 30, x + w + 2 * pad - 130] if tape == 2 else [x + w / 2 - 55]):
            t = c.rect(tx, y - 14, 110, 30, fill='#ffe066', stroke='transparent', rough=1, opacity=70,
                       rounded=False, angle=math.radians(-deg * 1.5 + rng.uniform(-3, 3)))
            t['groupIds'] = [gid]
    return h + 2 * pad


def polaroid(c, im, x, y, iw, title, sub, deg=0, link=None):
    ih = iw * im.height / im.width
    pw, ph = iw + 40, ih + 40 + 104
    els = [c.rect(x + 7, y + 9, pw, ph, fill='#d6cdbb', stroke='transparent', rough=0, opacity=60),
           c.rect(x, y, pw, ph, fill='#ffffff', stroke='#e3ddd0', sw=1, rough=0, rounded=False),
           c.image(im, x + 20, y + 20, w=iw, h=ih, link=link),
           c.text(x + 24, y + ih + 34, title, EXC, 34, INK),
           c.text(x + 24, y + ih + 80, sub, NUN, 17, MUTED, width=iw - 10, lh=1.35)]
    gid = rotate_group(els, x + pw / 2, y + ph / 2, deg)
    tape = c.rect(x + pw / 2 - 62, y - 16, 124, 34, fill='#ffe066', stroke='transparent', rough=1,
                  opacity=70, rounded=False, angle=math.radians(-deg * 1.6))
    tape['groupIds'] = [gid]
    return ph


def code_card(c, x, y, w, code, size=16, dark=True, title=None):
    """A sketched terminal (dark) or code card (light) with monospace lines."""
    lines = code.split('\n')
    lh = 1.45
    top = 46 if dark else 22
    h = top + len(lines) * size * lh + 26
    fill, stroke = ('#24292f', INK) if dark else ('#f6f4ee', '#cfc6b4')
    c.rect(x + 6, y + 8, w, h, fill='#d9d1c0', stroke='transparent', rough=0, opacity=50)
    c.rect(x, y, w, h, fill=fill, stroke=stroke, sw=2 if dark else 1.5, rough=1)
    if dark:
        for k, col in enumerate(['#ff6b6b', '#ffd43b', '#69db7c']):
            c.ellipse(x + 24 + k * 22, y + 22, 12, 12, stroke=col, sw=1, rough=0.4, fill=col)
        if title:
            c.text(x + w / 2, y + 11, title, MONO, 14, '#adb5bd', align='center')
    yy = y + top
    for ln in lines:
        if ln.strip():
            comment = ln.lstrip().startswith('#') or ln.lstrip().startswith('//')
            col = ('#8ce99a' if comment else '#e9ecef') if dark else ('#868e96' if comment else '#212529')
            c.text(x + 22, yy, ln, MONO, size, col, lh=lh)
        yy += size * lh
    return h


def xmark(c, cx, cy, r=16, color=RED):
    c.line([(cx - r, cy - r), (cx + r, cy + r)], color=color, sw=3, rough=1.2)
    c.line([(cx + r, cy - r), (cx - r, cy + r)], color=color, sw=3, rough=1.2)


def check(c, cx, cy, r=16, color=GREEN):
    c.line([(cx - r, cy), (cx - r * 0.3, cy + r * 0.8), (cx + r * 1.1, cy - r)], color=color, sw=3, rough=1.2)


def pill(c, x, y, s, color, size=16):
    w = MET[EXC].width(s, size) + 22
    c.rect(x, y, w, size + 12, fill=color + '22', stroke=color, sw=1.2, rough=0.8)
    c.text(x + 11, y + 4, s, EXC, size, color)
    return w


# ================================================================ figures
def fig_cover(c, x0, y0):
    thread = asset('mm-04-published-thread.png', (763, 56, 1913, 918))
    polaroid(c, thread, x0 + 6, y0 + 40, 650, T.COVER_CAPTIONS[0][0], T.COVER_CAPTIONS[0][1], deg=-1.8)
    plan = asset('sl-04-changes-approved.png', (345, 655, 1255, 1078))
    polaroid(c, plan, x0 + 800, y0 + 210, 530, T.COVER_CAPTIONS[1][0], T.COVER_CAPTIONS[1][1], deg=1.6)
    # Switch, bridging the two
    c.arrow([(x0 + 600, y0 + 110), (x0 + 770, y0 + 30), (x0 + 960, y0 + 196)], color=ACC, sw=3,
            start='arrow')
    c.text(x0 + 770, y0 - 40, 'Switch', EXC, 44, ACC, align='center')
    c.text(x0 + 1000, y0 + 84, 'events down,\noperations up', EXC, 20, ACC)
    return 40 + 650 * 862 / 1150 + 144 + 20


def fig_short(c, x0, y0):
    colw = 560
    title_y = y0 + 36
    items_y = title_y + 70
    heights = [len(wrap(plain(s), NUN, 22, colw)) * 22 * 1.5 for s in T.SHORT]
    row_h = [max(heights[0], heights[1]) + 44, max(heights[2], heights[3]) + 44]
    h = items_y - y0 + sum(row_h) + 14
    c.rect(x0, y0, CW, h, fill='#fff9e6', stroke='#e9d8a6', sw=1.5, rough=1)
    c.text(x0 + 44, title_y, T.SHORT_TITLE, EXC, 38, INK)
    for i, s in enumerate(T.SHORT):
        col, row = i % 2, i // 2
        ix = x0 + 44 + col * (colw + 120)
        iy = items_y + sum(row_h[:row])
        c.ellipse(ix + 22, iy + 18, 48, 46, stroke=RED, sw=2.2, rough=1.2)
        c.text(ix + 22, iy + 3, str(i + 1), EXC, 26, RED, align='center')
        c.text(ix + 66, iy, plain(s), NUN, 22, BODY, width=colw, lh=1.5)
    return h


THREAD_CROPS = [
    # (file, box, [(note index, y of the message inside the crop, in source pixels)])
    ('mm-02-proposal.png', (795, 505, 1905, 908), [(0, 40), (1, 230), (2, 356)]),
    ('mm-03-approved.png', (795, 215, 1905, 500), [(3, 35), (4, 205)]),
    ('mm-04-published-thread.png', (795, 585, 1905, 908), [(5, 35), (6, 220)]),
]


def fig_thread(c, x0, y0):
    sw = 940
    nx = x0 + sw + 60
    y = y0
    for k, (name, box, notes) in enumerate(THREAD_CROPS):
        im = asset(name, box)
        s = sw / im.width
        h = shot(c, im, x0, y, sw, deg=[-0.5, 0.4, -0.3][k], tape=(k == 0))
        ny_prev = y - 100
        for idx, my in notes:
            ty = y + my * s
            ny = max(ty - 16, ny_prev + 8)
            nh = num_note(c, nx + 30, ny, idx + 1, T.THREAD_NOTES[idx], width=CW - sw - 90)
            c.arrow([(nx + 22, ny + 16), (nx - 10, ny + 12 + (ty - ny - 12) * 0.6), (x0 + sw - 30, ty)],
                    color=RED, sw=1.8)
            ny_prev = ny + nh
        y += h + 44
    # last row: the summary in the room, then the acks in the thread
    room = asset('mm-05-announcement.png', (370, 728, 1405, 908))
    rw = 600
    rh = shot(c, room, x0, y + 10, rw, deg=-0.5)
    num_note(c, x0 + 10, y + 10 + rh + 40, 8, T.THREAD_NOTES[7], width=rw - 20)
    c.arrow([(x0 + 60, y + rh + 46), (x0 + 52, y + rh + 34), (x0 + 74, y + rh + 20)], color=RED, sw=1.8)
    acks = asset('mm-06-acks.png', (1440, 345, 1905, 908))
    aw = 300
    ax_ = x0 + sw - aw
    ah = shot(c, acks, ax_, y, aw, deg=0.6)
    ty = y + 300
    num_note(c, nx + 30, ty - 16, 9, T.THREAD_NOTES[8], width=CW - sw - 90)
    c.arrow([(nx + 22, ty), (nx - 10, ty + 4), (ax_ + aw - 30, ty + 10)], color=RED, sw=1.8)
    return y + max(ah, rh + 150) - y0


def machine(c, x, y, w, h, title, sub, parts, fill, stroke, tcolor):
    c.rect(x + 6, y + 8, w, h, fill='#d9d1c0', stroke='transparent', rough=0, opacity=45)
    c.rect(x, y, w, h, fill=fill, stroke=stroke, sw=2, rough=1.2)
    c.text(x + w / 2, y + 18, title, EXC, 30, tcolor, align='center')
    c.text(x + w / 2, y + 60, sub, EXC, 19, MUTED, align='center')
    py = y + 104
    for p in parts:
        c.rect(x + 22, py, w - 44, 46, fill='#ffffff', stroke=stroke, sw=1.2, rough=0.9)
        c.text(x + w / 2, py + 11, p, EXC, 19, INK, align='center')
        py += 58


def fig_pieces(c, x0, y0):
    bw, bh, gap = 262, 350, 110
    xs = [x0 + i * (bw + gap) for i in range(4)]
    y = y0 + 70
    # Docker Compose wraps Mattermost and Switch
    c.rect(xs[0] - 16, y - 50, 2 * bw + gap + 28, bh + 74, stroke=MUTED, sw=1.5, rough=1, style='dashed')
    c.text(xs[0], y - 42, 'docker compose', MONO, 17, MUTED)
    machine(c, xs[0], y, bw, bh, 'Mattermost', '#fieldwork-forum-ops',
            ['Maya, Sam, Jamie ...', 'Alex, the planner', 'threads, @-mentions'], '#e9eef7', NAVY, NAVY)
    machine(c, xs[1], y, bw, bh, 'Switch', 'switch-core  :8000',
            ['Mattermost bridge', 'rooms + agent API', 'Postgres', 'Gateway  :3000'], '#fff0e6', ACC, ACC)
    machine(c, xs[2], y, bw, bh, '@stageleaf', 'the agent, in Node',
            ['protocol client', 'Claude tool loop', 'rules mode'], '#e6f4ee', LEAF, LEAF)
    machine(c, xs[3], y, bw, bh, 'Stageleaf', 'web app + API  :4317',
            ['run of show', 'checks', 'versions', 'decisions + acks'], '#f1f3f5', INK, INK)
    mid = y + 150
    # arrows between the boxes
    c.arrow([(xs[0] + bw + 8, mid), (xs[1] - 8, mid)], color=INK, sw=2, curved=False, start='arrow')
    c.text((xs[0] + bw + xs[1]) / 2, mid - 34, 'bridge', EXC, 18, INK, align='center')
    c.arrow([(xs[1] + bw + 8, mid - 22), (xs[2] - 8, mid - 22)], color=ACC, sw=2, curved=False)
    c.text((xs[1] + bw + xs[2]) / 2 + 10, mid - 58, 'events', EXC, 18, ACC, align='center')
    c.arrow([(xs[2] - 8, mid + 22), (xs[1] + bw + 8, mid + 22)], color=LEAF, sw=2, curved=False)
    c.text((xs[1] + bw + xs[2]) / 2 + 12, mid + 32, 'operations', EXC, 18, LEAF, align='center')
    c.arrow([(xs[2] + bw + 8, mid), (xs[3] - 8, mid)], color=INK, sw=2, curved=False, start='arrow')
    c.text((xs[2] + bw + xs[3]) / 2, mid - 34, 'agent API', EXC, 18, INK, align='center')
    c.text((xs[2] + bw + xs[3]) / 2, mid + 12, 'and token', EXC, 18, INK, align='center')
    # one line under each box
    ny = y + bh + 50
    bottom = ny
    for i, (name, s) in enumerate(T.PIECES):
        t = c.text(xs[i] + 4, ny, s, EXC, 20, BODY, width=bw - 4, lh=1.25)
        bottom = max(bottom, ny + t['height'])
    return bottom - y0


SERVER_TERMINAL = """# server versions are listed in the container registry
$ oras repo tags ghcr.io/sandbox-quantum/standalone-compose

$ curl -fsSL -o docker-compose.switch.yml \\
  https://raw.githubusercontent.com/sandbox-quantum/switch/\\
switch-v0.31.0/deploy/local/standalone-docker-compose.yml

$ docker compose -f docker-compose.switch.yml --env-file .env \\
    --profile collab --profile gateway up -d

$ curl http://127.0.0.1:8000/health"""

CONTAINERS = [
    ('switch', ':8000', 'switch-core: rooms, agent API, Mattermost bridge', None),
    ('postgres', ':5432', 'storage', None),
    ('mattermost', ':8065', 'the team chat', 'collab'),
    ('setup', '', 'seeds Mattermost with a team and a first user', 'collab'),
    ('gateway', ':3000', 'operator dashboard', 'gateway'),
]


def fig_server(c, x0, y0):
    tw = 800
    th = code_card(c, x0, y0, tw, SERVER_TERMINAL, size=16, title='switch/up.sh does this for you')
    # what starts
    cx = x0 + tw + 70
    cw = CW - tw - 70
    c.text(cx, y0 - 6, 'What starts', EXC, 30, INK)
    y = y0 + 48
    for name, port, what, profile in CONTAINERS:
        c.rect(cx, y, cw, 70, fill='#ffffff', stroke=INK if not profile else (NAVY if profile == 'collab' else ACC),
               sw=1.6, rough=1)
        c.text(cx + 18, y + 8, name, MONO, 19, INK)
        if port:
            c.text(cx + 18 + MET[MONO].width(name, 19) + 12, y + 9, port, MONO, 17, MUTED)
        c.text(cx + 18, y + 38, what, NUN, 15, MUTED, width=cw - (130 if profile else 36))
        if profile:
            pw = MET[EXC].width(profile, 15) + 22
            pill(c, cx + cw - pw - 14, y + 10, profile, NAVY if profile == 'collab' else ACC, size=15)
        y += 82
    c.text(cx, y + 2, 'no profile: always on', EXC, 17, MUTED)
    bottom = max(y0 + th, y + 30) + 54
    h1 = sticky(c, x0 + 10, bottom, 600, T.SERVER_STICKY_VERSION, 'yellow', size=24, deg=-1.2)
    h2 = sticky(c, x0 + 700, bottom + 10, 600, T.SERVER_STICKY_FLAG, 'blue', size=24, deg=1.0,
                title='FEATURE_FLAGS_ENABLED=\nfollow_the_conversation', tsize=22)
    return bottom + max(h1, h2 + 10) + 10 - y0


def fig_agent(c, x0, y0):
    cw, gap = 430, 45
    bottom = y0
    for i, (title, code, note) in enumerate(T.AGENT_CARDS):
        x = x0 + i * (cw + gap)
        c.ellipse(x + 22, y0 + 20, 44, 42, stroke=RED, sw=2.2, rough=1.2)
        c.text(x + 22, y0 + 4, str(i + 1), EXC, 26, RED, align='center')
        c.text(x + 58, y0 + 2, title, EXC, 32, INK)
        h = code_card(c, x, y0 + 64, cw, code, size=16, dark=False)
        ny = y0 + 64 + h + 34
        c.arrow([(x + 60, ny + 4), (x + 40, ny - 14), (x + 52, ny - 30)], color=RED, sw=1.8)
        t = c.text(x + 80, ny, note, EXC, 22, RED, width=cw - 90, lh=1.2)
        bottom = max(bottom, ny + t['height'])
    return bottom - y0


SEQ = [
    # (direction, label, sub, color)
    ('down', 'GET /agents/{id}/events?connection_id=...&protocol=6', 'one stream, kept open', INK),
    ('up', 'connection_state { generation: 1, heartbeat_interval_seconds: 2 }', 'the first event', ACC),
    ('down', 'POST /agents/{id}/connection/beat { connection_id, generation }', 'every 2 seconds', INK),
    ('up', 'message { sender_name: "maya", body, message_id, thread_id }', 'someone wrote in the room', ACC),
    ('down', 'POST /agents/{id}/ops/connect_to_room', 'returns instructions, participants', LEAF),
    ('down', 'POST /agents/{id}/ops/post_message { body, thread_id }', 'the reply, in the thread', LEAF),
]


def fig_protocol(c, x0, y0):
    ax, sx = x0 + 140, x0 + CW - 290
    # lifelines
    for x, name, sub, col in [(ax, '@stageleaf agent', 'agent/switch-client.mjs', LEAF),
                              (sx, 'Switch', 'switch-core  :8000', ACC)]:
        c.rect(x - 140, y0, 280, 84, fill='#ffffff', stroke=col, sw=2, rough=1.1)
        c.text(x, y0 + 12, name, EXC, 28, col, align='center')
        c.text(x, y0 + 50, sub, MONO, 14, MUTED, align='center')
    top = y0 + 84
    step = 96
    end = top + 40 + step * len(SEQ)
    for x in (ax, sx):
        c.line([(x, top), (x, end)], color=MUTED, sw=1.5, style='dashed', rough=0.5)
    y = top + 70
    circles = []
    gw = MET[MONO].width('generation', 17)
    for k, (d, label, sub, col) in enumerate(SEQ):
        pts = [(ax + 6, y), (sx - 6, y)] if d == 'down' else [(sx - 6, y), (ax + 6, y)]
        c.arrow(pts, color=col, sw=2, curved=False)
        t = c.text((ax + sx) / 2, y - 34, label, MONO, 17, INK if col == INK else col, align='center')
        c.text(ax + 24, y + 8, sub, EXC, 18, MUTED)
        if 'generation' in label:
            gx = t['x'] + MET[MONO].width(label[:label.index('generation')], 17) + gw / 2
            c.ellipse(gx, y - 23, gw + 30, 40, stroke=RED, sw=2.5)
            circles.append((gx, y - 23))
        y += step
    # the same number goes back on every beat
    (g1x, g1y), (g2x, g2y) = circles
    c.arrow([(g1x + 24, g1y + 22), ((g1x + g2x) / 2 + 10, (g1y + g2y) / 2 + 4), (g2x - 34, g2y - 22)],
            color=RED, sw=2)
    c.text((g1x + g2x) / 2 + 40, (g1y + g2y) / 2 - 24, 'send it back', EXC, 20, RED)
    # the red-pen warning, in the margin beside the heartbeat
    wx = sx + 34
    c.text(wx, g2y - 50, 'without it:\n409 unfenced,\nthen evicted\nafter 6 s', EXC, 22, RED, width=230)
    c.arrow([(wx - 6, g2y + 4), (g2x + gw / 2 + 60, g2y + 30), (g2x + gw / 2 + 18, g2y + 4)], color=RED, sw=2)
    # legend
    ly = end + 26
    c.line([(x0, ly + 12), (x0 + 60, ly + 12)], color=ACC, sw=2.5)
    c.text(x0 + 72, ly, 'events from Switch (server-sent events)', EXC, 19, ACC)
    c.line([(x0 + 560, ly + 12), (x0 + 620, ly + 12)], color=LEAF, sw=2.5)
    c.text(x0 + 632, ly, 'operations from the agent (HTTP)', EXC, 19, LEAF)
    return ly + 36 - y0


def fig_who(c, x0, y0):
    bw, gap = 300, 60
    y = y0
    xs = [x0 + i * (bw + gap) for i in range(4)]
    cols = [ACC, LEAF, '#5f3dc4', INK]
    for i, (title, body) in enumerate(T.WHO_STEPS):
        c.rect(xs[i] + 5, y + 7, bw, 190, fill='#d9d1c0', stroke='transparent', rough=0, opacity=45)
        c.rect(xs[i], y, bw, 190, fill='#ffffff', stroke=cols[i], sw=2, rough=1.1)
        c.text(xs[i] + 20, y + 14, title, EXC, 26, cols[i])
        c.text(xs[i] + 20, y + 60, body, MONO, 16, INK, lh=1.45)
        if i < 3:
            c.arrow([(xs[i] + bw + 8, y + 95), (xs[i + 1] - 8, y + 95)], color=INK, sw=2, curved=False)
    # the verdict, circled on the line that fails
    line2 = y + 60 + 16 * 1.45
    ow = MET[MONO].width('affected owner: no', 16)
    c.ellipse(xs[3] + 20 + ow / 2, line2 + 13, ow + 30, 30, stroke=RED, sw=2.2, rough=1.1)
    xmark(c, xs[3] + 20 + ow + 44, line2 + 11, 12)
    for i, (s, col) in enumerate([('from Switch', ACC), ('built in code', LEAF), ('picks the action', '#5f3dc4'),
                                  ('refuses with a tool error', RED)]):
        c.text(xs[i] + 20, y + 206, s, EXC, 20, col)
    y += 280
    # what Robin saw, and what Alex sees
    robin = asset('mm-03-approved.png', (795, 352, 1905, 500))
    rh = shot(c, robin, x0, y + 20, 780, deg=-0.5, tape=True)
    c.text(x0, y + 20 + rh + 24, 'In the room, the agent explains the refusal.', EXC, 20, MUTED)
    decisions = asset('sl-04-changes-approved.png', (345, 860, 965, 1078))
    dh = shot(c, decisions, x0 + 850, y + 10, 530, deg=0.8, tape=True)
    c.text(x0 + 850, y + 10 + dh + 24, 'In Stageleaf, each decision shows\nwho made it and in which room.', EXC, 20, MUTED)
    return y + 20 + max(rh, dh) + 90 - y0


# the run of show from 11:00 on: (label, start, minutes, kind)
DAY = [('Welcome', '11:00', 15, 'plain'), ('Keynote', '11:15', 45, 'keynote'), ('Lunch', '12:00', 60, 'fixed'),
       ('Workshop', '13:00', 90, 'plain'), ('Panel', '14:30', 45, 'panel'), ('Close', '15:15', 15, 'plain'),
       ('Breakdown', '15:30', 75, 'breakdown')]
OPT_A = [('Welcome', '11:00', 15, 'plain'), ('Lunch', '12:00', 60, 'fixed'), ('Keynote', '13:00', 45, 'keynote'),
         ('Workshop', '13:45', 90, 'plain'), ('Panel', '15:15', 45, 'panel'), ('Close', '16:00', 15, 'plain'),
         ('Breakdown', '16:15', 75, 'breakdown')]
OPT_B = [('Welcome', '11:00', 15, 'plain'), ('Panel', '11:15', 45, 'panel'), ('Lunch', '12:00', 60, 'fixed'),
         ('Workshop', '13:00', 90, 'plain'), ('Keynote', '14:30', 45, 'keynote'), ('Close', '15:15', 15, 'plain'),
         ('Breakdown', '15:30', 75, 'breakdown')]
KIND = {'plain': ('#f1f3f5', '#868e96'), 'keynote': ('#ffdeeb', '#c2255c'), 'fixed': ('#e9ecef', '#495057'),
        'panel': ('#dbe4ff', '#3b5bdb'), 'breakdown': ('#fff3bf', '#e67700')}


def mins(s):
    h, m = s.split(':')
    return int(h) * 60 + int(m)


def fig_checks(c, x0, y0):
    lx = x0 + 250                       # where the time axis starts
    t0, t1 = mins('11:00'), mins('17:45')
    px = (CW - 250) / (t1 - t0)
    X = lambda t: lx + (mins(t) if isinstance(t, str) else t) * px - t0 * px  # noqa: E731
    # hour ticks
    for hh in range(11, 18):
        x = X(f'{hh}:00')
        c.text(x, y0, f'{hh}:00', EXC, 17, MUTED, align='center')
        c.line([(x, y0 + 28), (x, y0 + 40)], color=MUTED, sw=1.2, rough=0.4)
    rows = [('The plan', 'Maya can\'t make 11:15', DAY), (T.CHECK_A[0], T.CHECK_A[1], OPT_A),
            (T.CHECK_B[0], T.CHECK_B[1], OPT_B)]
    y = y0 + 64
    rh, rgap = 70, 64
    cut = X('17:00')
    for r, (name, sub, blocks) in enumerate(rows):
        nt = c.text(x0, y - 4, name, EXC, 24, INK, width=232)
        c.text(x0, y - 4 + nt['height'] + 4, sub, NUN, 15, MUTED, width=226, lh=1.3)
        for label, start, dur, kind in blocks:
            fill, stroke = KIND[kind]
            bx, bwid = X(start), dur * px
            c.rect(bx + 1, y, bwid - 2, rh, fill=fill, stroke=stroke, sw=1.5, rough=0.9,
                   fs='hachure' if kind == 'fixed' else 'solid')
            if bwid > 60:
                c.text(bx + bwid / 2, y + 22, label, EXC, 18, stroke, align='center')
        if r == 0:
            kx = X('11:15') + 45 * px / 2
            c.ellipse(kx, y + rh / 2, 45 * px + 40, rh + 34, stroke=RED, sw=2.4)
            c.text(kx - 40, y + rh + 22, 'Maya arrives 11:45', EXC, 20, RED)
        if r == 1:
            end_x = X('16:15') + 75 * px
            c.ellipse(end_x - 30, y + rh / 2, 110, rh + 30, stroke=RED, sw=2.4)
            xmark(c, end_x + 50, y + rh / 2, 16)
        if r == 2:
            check(c, X('16:45') + 44, y + rh / 2, 16)
            c.arrow([(X('11:15') + 60, y + rh + 8), (X('13:00'), y + rh + 46), (X('14:30') + 40, y + rh + 8)],
                    color='#3b5bdb', sw=1.8, start='arrow')
            c.text(X('13:00'), y + rh + 52, 'trade places', EXC, 18, '#3b5bdb', align='center')
        y += rh + rgap
    # Sam's crew leaves at 17:00
    c.line([(cut, y0 + 50), (cut, y - rgap + 26)], color=RED, sw=2, style='dashed', rough=0.6)
    c.text(cut - 4, y - rgap + 34, "Sam's crew leaves at 17:00", EXC, 20, RED, align='center')
    return y - rgap + 96 - y0


def fig_lessons(c, x0, y0):
    colors = ['yellow', 'blue', 'green', 'pink', 'orange']
    degs = [-1.4, 0.9, -0.6, 1.2, -0.9]
    w, gap = 420, 60
    pos = [(x0, y0), (x0 + w + gap, y0 + 14), (x0 + 2 * (w + gap), y0)]
    hs = []
    for i in range(3):
        title, body = T.LESSONS[i]
        hs.append(sticky(c, pos[i][0], pos[i][1], w, plain(body), colors[i], size=19, deg=degs[i],
                         fam=NUN, title=f'{i + 1}. {title}', tsize=26))
    y2 = y0 + max(hs) + 60
    w2 = 560
    hs2 = []
    for j, i in enumerate([3, 4]):
        title, body = T.LESSONS[i]
        hs2.append(sticky(c, x0 + 80 + j * (w2 + 100), y2 + j * 12, w2, plain(body), colors[i], size=19,
                          deg=degs[i], fam=NUN, title=f'{i + 1}. {title}', tsize=26))
    return y2 + max(hs2) + 20 - y0


def fig_try(c, x0, y0):
    th = code_card(c, x0, y0, 860, T.TRY_CODE, size=16)
    still = Image.open(ASSETS / 'video-endcard.jpg').convert('RGB')
    ph = polaroid(c, still, x0 + 930, y0 - 10, 400, 'The demo', '2 min 24 s, recorded live on Switch 0.31',
                  deg=1.4, link=T.REPO)
    return max(th, ph)


# ================================================================ frames
def frame_cover(c, Y):
    c.begin('00 · Building an event-day agent on Switch')
    y = Y + 86
    c.text(L, y, T.KICKER, EXC, 22, ACC)
    y += 54
    t = c.text(L, y, balanced(T.TITLE, EXC, 80, 1300), EXC, 80, INK, lh=1.12)
    y += t['height'] + 30
    t = c.text(L, y, plain(T.DEK), NUN, 26, BODY, width=1120, lh=1.5)
    y += t['height'] + 18
    c.text(L, y, f'{T.AUTHOR}  ·  github.com/tpavankalyan/stageleaf', NUN, 19, MUTED, link=T.REPO)
    y += 120
    y += fig_cover(c, L, y) + 60
    y += fig_short(c, L, y) + 90
    c.end(Y, y - Y)
    return y - Y


def frame_thread(c, Y):
    c.begin('01 · What I built')
    y = kicker_head(c, Y + 80, T.THREAD_KICKER, T.THREAD_HEAD)
    y = para(c, L, y, T.THREAD_P1, 1000) + y + 20
    y = columns(c, y, [T.THREAD_P2, T.THREAD_P3]) + 70
    y += fig_thread(c, L, y) + 90
    c.end(Y, y - Y)
    return y - Y


def frame_pieces(c, Y):
    c.begin('02 · The pieces')
    y = kicker_head(c, Y + 80, T.PIECES_KICKER, T.PIECES_HEAD)
    y += para(c, L, y, T.PIECES_P1, 1000) + 50
    y += fig_pieces(c, L, y) + 90
    c.end(Y, y - Y)
    return y - Y


def frame_server(c, Y):
    c.begin('03 · Setup: the server')
    y = kicker_head(c, Y + 80, T.SERVER_KICKER, T.SERVER_HEAD)
    y = columns(c, y, [T.SERVER_P1, T.SERVER_P2]) + 60
    y += fig_server(c, L, y) + 50
    y += para(c, L, y, T.SERVER_P3, 1100) + 90
    c.end(Y, y - Y)
    return y - Y


def frame_agent(c, Y):
    c.begin('04 · Setup: the agent')
    y = kicker_head(c, Y + 80, T.AGENT_KICKER, T.AGENT_HEAD)
    y = columns(c, y, [T.AGENT_P1, T.AGENT_P2]) + 60
    y += fig_agent(c, L, y) + 60
    y = columns(c, y, [T.AGENT_P3, T.AGENT_P4]) + 90
    c.end(Y, y - Y)
    return y - Y


def frame_protocol(c, Y):
    c.begin('05 · The agent protocol')
    y = kicker_head(c, Y + 80, T.PROTO_KICKER, T.PROTO_HEAD)
    y = columns(c, y, [T.PROTO_P1, T.PROTO_P2]) + 60
    y += fig_protocol(c, L, y) + 50
    y = columns(c, y, [T.PROTO_P3, T.PROTO_P4]) + 90
    c.end(Y, y - Y)
    return y - Y


def frame_who(c, Y):
    c.begin('06 · Who decides')
    y = kicker_head(c, Y + 80, T.WHO_KICKER, T.WHO_HEAD)
    y += para(c, L, y, T.WHO_P1, 1100) + 20
    y = columns(c, y, [T.WHO_P2, T.WHO_P3]) + 70
    y += fig_who(c, L, y) + 80
    c.end(Y, y - Y)
    return y - Y


def frame_checks(c, Y):
    c.begin('07 · Checks')
    y = kicker_head(c, Y + 80, T.CHECK_KICKER, T.CHECK_HEAD)
    y = columns(c, y, [T.CHECK_P1, T.CHECK_P2]) + 70
    y += fig_checks(c, L, y) + 90
    c.end(Y, y - Y)
    return y - Y


def frame_lessons(c, Y):
    c.begin('08 · Lessons')
    y = kicker_head(c, Y + 80, T.LESSON_KICKER, T.LESSON_HEAD)
    y += 20
    y += fig_lessons(c, L, y) + 100
    c.end(Y, y - Y)
    return y - Y


def frame_try(c, Y):
    c.begin('09 · Try it')
    y = kicker_head(c, Y + 80, T.TRY_KICKER, T.TRY_HEAD)
    y += para(c, L, y, T.TRY_P1, 1100) + 40
    y += fig_try(c, L, y) + 50
    y = columns(c, y, [T.TRY_P2, T.TRY_P3]) + 70
    t = c.text(L, y, T.CLOSING, EXC, 31, INK, width=CW, link=T.REPO)
    c.line([(L - 4, y + t['height'] + 8), (L + t['width'] * 0.5, y + t['height'] + 12),
            (L + t['width'] + 4, y + t['height'] + 6)], color=ACC, sw=3, rough=1.4, curved=True)
    y += t['height'] + 110
    c.end(Y, y - Y)
    return y - Y


FRAMES = [frame_cover, frame_thread, frame_pieces, frame_server, frame_agent, frame_protocol, frame_who,
          frame_checks, frame_lessons, frame_try]
FIGURES = [('hero', fig_cover, 70), ('thread', fig_thread, 30), ('pieces', fig_pieces, 30),
           ('server', fig_server, 30), ('agent', fig_agent, 30), ('protocol', fig_protocol, 30),
           ('who', fig_who, 30), ('checks', fig_checks, 30)]


def scene(c):
    return {'type': 'excalidraw', 'version': 2, 'source': 'https://excalidraw.com', 'elements': c.els,
            'appState': {'viewBackgroundColor': '#f4efe4', 'gridSize': None, 'currentItemFontFamily': EXC},
            'files': c.files}


def build_canvas():
    c = Canvas()
    y = 0
    for f in FRAMES:
        y += f(c, y) + GAP
    return c


def build_figures():
    c = Canvas()
    y = 0
    for name, fig, top in FIGURES:
        c.begin(f'fig-{name}')
        h = fig(c, L, y + top)
        c.end(y, h + top + 40, x=L - 40, w=CW + 80, stroke='transparent')
        y += h + top + 40 + GAP
    return c


# ================================================================ web edition
PAGES = 'https://tpavankalyan.github.io/stageleaf/'


def blocks():
    """The web edition as a list of blocks, from the same strings as the canvas."""
    P = lambda s: ('p', s)  # noqa: E731
    C = lambda lang, s: ('code', lang, s)  # noqa: E731
    F = lambda name, alt: ('fig', name, alt)  # noqa: E731
    S = lambda k, h: ('section', k, h)  # noqa: E731
    return [
        F('hero', "The team's Mattermost room and Stageleaf, connected by Switch"),
        ('video',),
        ('short',),
        S(T.THREAD_KICKER, T.THREAD_HEAD), P(T.THREAD_P1), P(T.THREAD_P2),
        F('thread', "The recorded thread, from Maya's report to the acknowledgments"), P(T.THREAD_P3),
        S(T.PIECES_KICKER, T.PIECES_HEAD), P(T.PIECES_P1),
        F('pieces', 'Mattermost and Switch in Docker, with the agent and Stageleaf beside them'),
        ('ul', T.PIECES_WEB),
        S(T.SERVER_KICKER, T.SERVER_HEAD), P(T.SERVER_P1), P(T.SERVER_P2), C('sh', T.SERVER_CODE),
        P(T.SERVER_P3), P(T.SERVER_P4), C('sh', T.SERVER_FLAG),
        F('server', 'The commands, and the containers each profile starts'),
        S(T.AGENT_KICKER, T.AGENT_HEAD), P(T.AGENT_P1), C('js', T.AGENT_CODE_REGISTER), P(T.AGENT_P2),
        C('js', T.AGENT_CODE_POLICY), P(T.AGENT_P3), C('js', T.AGENT_CODE_ROOM), P(T.AGENT_P4),
        F('agent', 'Register the agent, open it to the team, create the room'),
        S(T.PROTO_KICKER, T.PROTO_HEAD), P(T.PROTO_P1),
        F('protocol', 'One event stream down, HTTP operations up'), P(T.PROTO_P2), P(T.PROTO_P3),
        C('js', T.PROTO_CODE), P(T.PROTO_P4),
        S(T.WHO_KICKER, T.WHO_HEAD), P(T.WHO_P1), P(T.WHO_P2),
        F('who', "Robin's approval, from the Switch event to Stageleaf's check"), P(T.WHO_P3),
        S(T.CHECK_KICKER, T.CHECK_HEAD), P(T.CHECK_P1),
        F('checks', 'Two fixes for the late keynote, checked against the day'), P(T.CHECK_P2),
        S(T.LESSON_KICKER, T.LESSON_HEAD), ('lessons',),
        S(T.TRY_KICKER, T.TRY_HEAD), P(T.TRY_P1), C('sh', T.TRY_CODE), P(T.TRY_P2), P(T.TRY_P3),
    ]


def to_markdown():
    out = ['---', f'title: "{T.TITLE}"', f'description: "{T.DEK}"', f'author: "{T.AUTHOR}"', '---', '',
           f'# {T.TITLE}', '', f'*{T.DEK}*', '',
           f'{T.AUTHOR} · [Code]({T.REPO}) · [Web edition]({PAGES}) · '
           f'[Excalidraw edition]({PAGES}stageleaf-blog.excalidraw) · [Demo video]({PAGES}stageleaf-demo.mp4)', '']
    for b in blocks():
        kind = b[0]
        if kind == 'p':
            out += [b[1], '']
        elif kind == 'code':
            out += [f'```{b[1]}', b[2], '```', '']
        elif kind == 'fig':
            out += [f'![{b[2]}]({PAGES}figures/{b[1]}.png)', '']
        elif kind == 'section':
            out += [f'## {b[2]}', '']
        elif kind == 'ul':
            out += [f'- {s}' for s in b[1]] + ['']
        elif kind == 'short':
            out += [f'**{T.SHORT_TITLE}**', ''] + [f'{i + 1}. {s}' for i, s in enumerate(T.SHORT)] + ['']
        elif kind == 'lessons':
            out += [f'{i + 1}. **{t}** {d}' for i, (t, d) in enumerate(T.LESSONS)] + ['']
    return '\n'.join(out).rstrip() + '\n'


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def inline(s):
    parts = re.split(r'(`[^`]+`)', s)
    out = []
    for part in parts:
        if part.startswith('`') and part.endswith('`'):
            out.append(f'<code>{esc(part[1:-1])}</code>')
        else:
            t = esc(part)
            t = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', t)
            t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', t)
            t = re.sub(r'(?<![="/])(https?://[^\s<,)]+[^\s<,).])', r'<a href="\1">\1</a>', t)
            out.append(t)
    return ''.join(out)


def code_html(code):
    lines = []
    for ln in code.split('\n'):
        stripped = ln.lstrip()
        if stripped.startswith('#') or stripped.startswith('//'):
            lines.append(f'<span class="c">{esc(ln)}</span>')
            continue
        m = re.search(r'\s{2,}(#|//)\s', ln)
        if m:
            lines.append(esc(ln[:m.start()]) + f'<span class="c">{esc(ln[m.start():])}</span>')
        else:
            lines.append(esc(ln))
    return '\n'.join(lines)


CSS = """
@font-face { font-family: Excalifont; src: url(fonts/Excalifont.woff2) format("woff2"); font-display: swap; }
@font-face { font-family: Nunito; src: url(fonts/Nunito.woff2) format("woff2"); font-display: swap; }
@font-face { font-family: Cascadia; src: url(fonts/CascadiaCode.woff2) format("woff2"); font-display: swap; }
:root { --ink: #1e1e1e; --body: #343a40; --muted: #7b8088; --red: #e03131; --acc: #e8590c;
        --paper: #fffdf8; --desk: #f4efe4; --edge: #ddd4c2; }
* { box-sizing: border-box; }
html { background: var(--desk); }
body { margin: 0; color: var(--body); font: 19px/1.7 Nunito, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.page { max-width: 1040px; margin: 40px auto 72px; background: var(--paper); border: 1px solid var(--edge);
        box-shadow: 0 18px 50px rgba(90, 70, 30, .07); padding: 76px 0 90px; }
.col { max-width: 730px; margin: 0 auto; padding: 0 28px; }
.kicker { font: 21px/1.3 Excalifont; color: var(--acc); margin: 0 0 4px; white-space: pre-wrap; }
h1 { font: 400 clamp(40px, 6vw, 60px)/1.08 Excalifont; color: var(--ink); margin: 8px 0 24px; }
.nw { white-space: nowrap; }
.dek { font-size: 21px; line-height: 1.6; margin: 0 0 16px; }
.byline { color: var(--muted); font-size: 16px; margin: 0 0 22px; }
.links { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 8px; }
.links a { font: 19px Excalifont; color: var(--ink); text-decoration: none; padding: 5px 15px 4px;
           border: 2px solid var(--ink); border-radius: 12px 15px 11px 14px; background: #fff;
           box-shadow: 3px 3px 0 var(--ink); transition: transform .12s, box-shadow .12s; }
.links a:hover { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--ink); }
.links a.hot { background: #ffe8d9; }
section { margin-top: 84px; }
h2 { font: 400 40px/1.14 Excalifont; color: var(--ink); margin: 0 0 20px; }
p { margin: 0 0 18px; }
a { color: #1c5d99; text-decoration-thickness: 1px; text-underline-offset: 3px; }
ul, ol { padding-left: 24px; margin: 0 0 20px; } li { margin-bottom: 10px; }
strong { color: var(--ink); }
code { font: .84em Cascadia, ui-monospace, monospace; background: #f1ece1; padding: 1px 5px; border-radius: 5px; }
pre { background: #24292f; color: #e9ecef; font: 14.5px/1.6 Cascadia, ui-monospace, monospace;
      padding: 18px 22px; margin: 6px 0 24px; border: 2px solid var(--ink); border-radius: 13px 16px 12px 15px;
      box-shadow: 5px 6px 0 #d9d1c0; overflow-x: auto; }
pre code { background: none; padding: 0; font: inherit; color: inherit; }
pre .c { color: #8ce99a; }
figure { margin: 38px auto 34px; max-width: 980px; padding: 0 20px; }
figure img { display: block; width: 100%; height: auto; }
figcaption { font: 18px/1.35 Excalifont; color: var(--muted); text-align: center; margin-top: 10px; }
.short { background: #fff9e6; border: 1.5px solid #e9d8a6; border-radius: 18px 24px 16px 22px; padding: 28px 30px 8px; margin: 46px 0 0; }
.short h2 { font-size: 34px; }
.short ol { list-style: none; padding: 0; counter-reset: n; }
.short li { counter-increment: n; position: relative; padding-left: 54px; margin-bottom: 18px; }
.short li::before { content: counter(n); position: absolute; left: 0; top: -1px; width: 37px; height: 35px;
                    border: 2px solid var(--red); border-radius: 50% 46% 52% 48%; color: var(--red);
                    font: 21px/33px Excalifont; text-align: center; }
.video { margin: 34px 0 0; }
.video video { width: 100%; display: block; border-radius: 10px; border: 1px solid var(--edge); background: #1d3b30; }
.video p { font: 18px Excalifont; color: var(--muted); text-align: center; margin: 10px 0 0; }
.lessons li { margin-bottom: 14px; }
footer { margin-top: 70px; padding-top: 22px; border-top: 1.5px dashed var(--edge); color: var(--muted); font-size: 16px; }
@media (max-width: 720px) {
  body { font-size: 17.5px; } .page { margin: 0; border: 0; padding-top: 44px; }
  h2 { font-size: 33px; } .dek { font-size: 19px; } figure { padding: 0 8px; } pre { font-size: 13px; }
}
"""


def to_html():
    head_desc = esc(T.DEK)
    body = []
    state = {'col': True, 'section': False}   # the header's column is open when blocks start

    def col():
        if not state['col']:
            body.append('<div class="col">')
            state['col'] = True

    def uncol():
        if state['col']:
            body.append('</div>')
            state['col'] = False

    for b in blocks():
        kind = b[0]
        if kind == 'section':
            uncol()
            if state['section']:
                body.append('</section>')
            body.append('<section>')
            state['section'] = True
            col()
            body.append(f'<p class="kicker">{esc(b[1])}</p><h2>{inline(b[2])}</h2>')
        elif kind == 'fig':
            uncol()
            body.append(f'<figure><img src="figures/{b[1]}.png" alt="{esc(b[2])}" loading="lazy">'
                        f'<figcaption>{esc(b[2])}</figcaption></figure>')
        else:
            col()
            if kind == 'p':
                body.append(f'<p>{inline(b[1])}</p>')
            elif kind == 'code':
                body.append(f'<pre><code class="language-{b[1]}">{code_html(b[2])}</code></pre>')
            elif kind == 'ul':
                body.append('<ul>' + ''.join(f'<li>{inline(s)}</li>' for s in b[1]) + '</ul>')
            elif kind == 'video':
                body.append('<div class="video"><video controls preload="metadata" poster="figures/video-poster.jpg" '
                            'src="stageleaf-demo.mp4"></video><p>The demo, recorded live on Switch 0.31 (2 min 24 s)</p></div>')
            elif kind == 'short':
                body.append(f'<div class="short"><h2>{esc(T.SHORT_TITLE)}</h2><ol>'
                            + ''.join(f'<li>{inline(s)}</li>' for s in T.SHORT) + '</ol></div>')
            elif kind == 'lessons':
                body.append('<ol class="lessons">' + ''.join(f'<li><strong>{inline(t)}</strong> {inline(d)}</li>'
                                                             for t, d in T.LESSONS) + '</ol>')
    col()
    body.append(f'<footer>Drawn in Excalidraw. The canvas, the figures and this page are built from the same text in '
                f'<a href="{T.REPO}/tree/main/docs/src">docs/src</a>.</footer></div>')
    if state['section']:
        body.append('</section>')
    links = (f'<a class="hot" href="{T.REPO}">Code on GitHub</a>'
             f'<a href="stageleaf-demo.mp4">Demo video</a>'
             f'<a href="stageleaf-blog.excalidraw" download>Excalidraw edition</a>'
             f'<a href="stageleaf-blog.pdf">PDF</a>')
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(T.TITLE)}</title>
<meta name="description" content="{head_desc}">
<meta name="author" content="{esc(T.AUTHOR)}">
<meta property="og:type" content="article">
<meta property="og:title" content="{esc(T.TITLE)}">
<meta property="og:description" content="{head_desc}">
<meta property="og:image" content="{PAGES}figures/hero.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="fonts/Excalifont.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/Nunito.woff2" as="font" type="font/woff2" crossorigin>
<style>{CSS}</style>
</head>
<body>
<article class="page">
<div class="col">
<header>
<p class="kicker">{esc(T.KICKER)}</p>
<h1>{esc(T.TITLE).replace('event-day', '<span class="nw">event-day</span>')}</h1>
<p class="dek">{inline(T.DEK)}</p>
<p class="byline">{esc(T.AUTHOR)} · Built for Flip the Switch 2026</p>
<nav class="links">{links}</nav>
</header>
{chr(10).join(body)}
</article>
</body>
</html>
"""


if __name__ == '__main__':
    canvas = build_canvas()
    (DOCS / 'stageleaf-blog.excalidraw').write_text(json.dumps(scene(canvas)))
    figs = build_figures()
    (HERE / 'figures.excalidraw').write_text(json.dumps(scene(figs)))
    (DOCS / 'blog.md').write_text(to_markdown())
    (DOCS / 'index.html').write_text(to_html())
    n_frames = sum(1 for e in canvas.els if e['type'] == 'frame')
    print(f'canvas: {n_frames} frames, {len(canvas.els)} elements, {len(canvas.files)} images, '
          f'{(DOCS / "stageleaf-blog.excalidraw").stat().st_size / 1e6:.1f} MB')
    print(f'figures: {sum(1 for e in figs.els if e["type"] == "frame")} frames')
