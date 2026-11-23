import { createGeneratedImage, createShape, createText, NO_TEXT_EFFECTS } from '../document/factory';
import { getGenerator } from '../generators/render';
import { getGraphic } from '../library/graphics';
import { defaultIconStroke, getIcon } from '../library/icons';
import type { Fill, GradientStop, Layer, ShapeLayer, TextLayer } from '../../types/document';

export interface Template {
  id: string;
  name: string;
  category: string;
  width: number;
  height: number;
  /** CSS background used for the card preview. */
  preview: string;
  build: () => { background: Fill | null; layers: Layer[] };
}

const solid = (color: string): Fill => ({ type: 'solid', color });

function text(W: number, H: number, value: string, box: { x: number; y: number; w: number }, style: Partial<TextLayer>): TextLayer {
  const fontSize = style.fontSize ?? 48;
  return {
    ...createText('body', W, H),
    name: value.split('\n')[0],
    text: value,
    x: box.x,
    y: box.y,
    width: box.w,
    height: fontSize * 1.2,
    align: 'left',
    ...style,
    fontSize,
  };
}

function generated(id: string, W: number, H: number, colors?: string[], opacity?: number): Layer {
  const def = getGenerator(id)!;
  return createGeneratedImage(def.id, def.name, colors ?? def.colors, W, H, def.blend, opacity ?? def.opacity);
}

/** A sticker, frame or illustration from the library. Height follows the graphic's proportions unless given. */
function graphic(id: string, box: { x: number; y: number; w: number; h?: number }, colors?: string[], extra: Partial<ShapeLayer> = {}): Layer {
  const def = getGraphic(id)!;
  return {
    ...createShape('graphic', 100, 100, { name: def.name, graphic: def.id, colors: colors ?? [...def.colors], fill: null, stroke: null }),
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h ?? Math.round(box.w / def.aspect),
    ...extra,
  };
}

function icon(name: string, box: { x: number; y: number; size: number }, color: string): Layer {
  const def = getIcon(name)!;
  return {
    ...createShape('icon', 100, 100, { name: def.label, icon: def.name, fill: null, stroke: { color, width: defaultIconStroke(box.size) } }),
    x: box.x,
    y: box.y,
    width: box.size,
    height: box.size,
  };
}

const linear = (angle: number, ...colors: string[]): Fill => ({
  type: 'linear',
  angle,
  stops: colors.map((color, i) => ({ offset: colors.length > 1 ? i / (colors.length - 1) : 0, color })),
});
const fx = NO_TEXT_EFFECTS;
const GOLD: GradientStop[] = [
  { offset: 0, color: '#fff3b0' },
  { offset: 0.35, color: '#f0b429' },
  { offset: 0.55, color: '#9a6700' },
  { offset: 0.7, color: '#ffd76a' },
  { offset: 1, color: '#8a5a00' },
];

/** Starter layouts. Every element is an ordinary editable layer. */
export const TEMPLATES: Template[] = [
  {
    id: 'gig-poster',
    name: 'Gig poster',
    category: 'Poster',
    width: 1800,
    height: 2400,
    preview: 'linear-gradient(160deg, #14110f 55%, #e4572e 55%)',
    build: () => {
      const W = 1800;
      const H = 2400;
      return {
        background: solid('#14110f'),
        layers: [
          createShape('ellipse', W, H, { name: 'Sun', x: 350, y: 520, width: 1100, height: 1100, fill: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#ffb347' }, { offset: 1, color: '#e4572e' }] } }),
          createShape('rect', W, H, { name: 'Horizon', x: 0, y: 1250, width: W, height: 1150, fill: solid('#14110f') }),
          text(W, H, 'NIGHT\nSIGNAL', { x: 140, y: 1330, w: 1520 }, { fontFamily: 'Bebas Neue', fontSize: 380, fontWeight: 400, lineHeight: 0.9, fill: solid('#f4efe6') }),
          text(W, H, 'LIVE AT THE FOUNDRY — 21 MARCH', { x: 148, y: 2080, w: 1500 }, { fontFamily: 'Inter', fontSize: 62, fontWeight: 600, letterSpacing: 6, fill: solid('#ffb347') }),
          text(W, H, 'Doors 8pm · Tickets at the door', { x: 148, y: 2180, w: 1500 }, { fontFamily: 'Inter', fontSize: 46, fontWeight: 400, fill: solid('#a79f94') }),
          generated('texture/film-grain', W, H, undefined, 0.55),
          generated('texture/scratches', W, H, undefined, 0.35),
        ],
      };
    },
  },
  {
    id: 'album-cover',
    name: 'Album cover',
    category: 'Album cover',
    width: 1600,
    height: 1600,
    preview: 'radial-gradient(circle at 30% 30%, #7afcff, #6a5cff 60%, #1a1433)',
    build: () => {
      const W = 1600;
      const H = 1600;
      return {
        background: solid('#1a1433'),
        layers: [
          generated('background/mesh-gradient', W, H, ['#1a1433', '#7afcff', '#ff7eb3', '#6a5cff']),
          createShape('ellipse', W, H, { name: 'Ring', x: 400, y: 400, width: 800, height: 800, fill: null, stroke: { color: '#ffffff', width: 6 }, blendMode: 'overlay' }),
          text(W, H, 'soft\nmachines', { x: 120, y: 1090, w: 1360 }, { fontFamily: 'Playfair Display', fontSize: 190, fontWeight: 700, italic: true, lineHeight: 0.95, fill: solid('#ffffff') }),
          text(W, H, 'VOLUME II', { x: 128, y: 120, w: 800 }, { fontFamily: 'Space Mono', fontSize: 40, fontWeight: 400, letterSpacing: 14, fill: solid('#ffffff') }),
          generated('texture/noise', W, H, undefined, 0.35),
        ],
      };
    },
  },
  {
    id: 'social-quote',
    name: 'Quote post',
    category: 'Social media',
    width: 1080,
    height: 1080,
    preview: 'linear-gradient(135deg, #f1ece4, #e7d8c3)',
    build: () => {
      const W = 1080;
      const H = 1080;
      return {
        background: solid('#f1ece4'),
        layers: [
          generated('texture/paper', W, H),
          createShape('rect', W, H, { name: 'Accent bar', x: 96, y: 150, width: 120, height: 14, fill: solid('#e07a5f') }),
          text(W, H, 'Make it simple,\nbut significant.', { x: 96, y: 330, w: 890 }, { fontFamily: 'Playfair Display', fontSize: 112, fontWeight: 700, lineHeight: 1.08, fill: solid('#2b2d42') }),
          text(W, H, '— Your name here', { x: 100, y: 860, w: 700 }, { fontFamily: 'Inter', fontSize: 38, fontWeight: 500, fill: solid('#e07a5f') }),
        ],
      };
    },
  },
  {
    id: 'youtube-thumb',
    name: 'Video thumbnail',
    category: 'YouTube thumbnail',
    width: 1280,
    height: 720,
    preview: 'linear-gradient(120deg, #0b132b 50%, #ffd166 50%)',
    build: () => {
      const W = 1280;
      const H = 720;
      return {
        background: solid('#0b132b'),
        layers: [
          createShape('rect', W, H, { name: 'Panel', x: 700, y: -120, width: 760, height: 960, rotation: 12, fill: solid('#ffd166') }),
          text(W, H, '5 EDITING\nTRICKS', { x: 60, y: 150, w: 720 }, { fontFamily: 'Anton', fontSize: 170, fontWeight: 400, lineHeight: 1, fill: solid('#ffffff'), stroke: { color: '#0b132b', width: 10 } }),
          text(W, H, 'you should know', { x: 66, y: 540, w: 640 }, { fontFamily: 'Inter', fontSize: 58, fontWeight: 700, fill: solid('#ffd166') }),
          createShape('star', W, H, { name: 'Star', x: 900, y: 220, width: 280, height: 280, fill: solid('#0b132b'), rotation: 14 }),
          generated('overlay/vignette', W, H, undefined, 0.6),
        ],
      };
    },
  },
  {
    id: 'business-card',
    name: 'Business card',
    category: 'Business card',
    width: 1050,
    height: 600,
    preview: 'linear-gradient(90deg, #264653 38%, #f4f1ea 38%)',
    build: () => {
      const W = 1050;
      const H = 600;
      return {
        background: solid('#f4f1ea'),
        layers: [
          createShape('rect', W, H, { name: 'Side panel', x: 0, y: 0, width: 400, height: H, fill: solid('#264653') }),
          createShape('polygon', W, H, { name: 'Mark', x: 130, y: 230, width: 140, height: 140, sides: 6, fill: null, stroke: { color: '#e9c46a', width: 8 } }),
          text(W, H, 'Avery Lindqvist', { x: 460, y: 190, w: 540 }, { fontFamily: 'Montserrat', fontSize: 54, fontWeight: 700, fill: solid('#264653') }),
          text(W, H, 'Brand Designer', { x: 462, y: 262, w: 540 }, { fontFamily: 'Montserrat', fontSize: 28, fontWeight: 500, letterSpacing: 3, fill: solid('#2a9d8f') }),
          text(W, H, 'hello@studio.example\n+1 555 0100', { x: 462, y: 370, w: 540 }, { fontFamily: 'Inter', fontSize: 24, fontWeight: 400, lineHeight: 1.5, fill: solid('#5c6b73') }),
        ],
      };
    },
  },
  {
    id: 'event-flyer',
    name: 'Event flyer',
    category: 'Flyer',
    width: 1240,
    height: 1748,
    preview: 'linear-gradient(180deg, #fefae0 60%, #606c38 60%)',
    build: () => {
      const W = 1240;
      const H = 1748;
      return {
        background: solid('#fefae0'),
        layers: [
          generated('background/abstract-shapes', W, H),
          createShape('rect', W, H, { name: 'Card', x: 110, y: 520, width: 1020, height: 760, cornerRadius: 28, fill: solid('#fefae0'), shadow: { color: '#000000', blur: 40, offsetX: 0, offsetY: 16, opacity: 0.25 } }),
          text(W, H, 'Sunday\nMakers Market', { x: 170, y: 590, w: 900 }, { fontFamily: 'DM Serif Display', fontSize: 132, fontWeight: 400, lineHeight: 1.02, fill: solid('#283618') }),
          text(W, H, 'Ceramics · Prints · Coffee · Plants', { x: 174, y: 950, w: 900 }, { fontFamily: 'Inter', fontSize: 40, fontWeight: 500, fill: solid('#bc6c25') }),
          text(W, H, '10am – 4pm · Riverside Hall · Free entry', { x: 174, y: 1130, w: 900 }, { fontFamily: 'Inter', fontSize: 34, fontWeight: 600, fill: solid('#606c38') }),
          generated('texture/canvas', W, H, undefined, 0.6),
        ],
      };
    },
  },
  {
    id: 'neon-night',
    name: 'Neon night',
    category: 'Poster',
    width: 1800,
    height: 2400,
    preview: 'radial-gradient(circle at 50% 40%, #ff2d95 0%, #2a0a3a 45%, #0b0b14 75%)',
    build: () => {
      const W = 1800;
      const H = 2400;
      return {
        background: solid('#0b0b14'),
        layers: [
          generated('overlay/bokeh', W, H, ['#ff2d95', '#7ef9ff', '#7b5cff', '#ffffff'], 0.55),
          graphic('frame/double-line', { x: 110, y: 110, w: W - 220, h: H - 220 }, ['#ff2d95']),
          text(W, H, 'Neon\nNights', { x: 150, y: 640, w: 1500 }, { align: 'center', fontFamily: 'Pacifico', fontSize: 380, fontWeight: 400, lineHeight: 1.05, fill: solid('#fff0fa'), stroke: { color: '#ff2d95', width: 5 }, effects: { ...fx, glow: { color: '#ff2d95', size: 0.4, strength: 0.9 } } }),
          icon('disc-3', { x: 780, y: 330, size: 240 }, '#7ef9ff'),
          text(W, H, 'FRIDAY 12 JULY · CLUB ORBIT', { x: 150, y: 1720, w: 1500 }, { align: 'center', fontFamily: 'Inter', fontSize: 66, fontWeight: 700, letterSpacing: 8, fill: solid('#7ef9ff'), effects: { ...fx, glow: { color: '#00c2ff', size: 0.35, strength: 0.5 } } }),
          text(W, H, 'DJs from 10pm · Free before midnight', { x: 150, y: 1850, w: 1500 }, { align: 'center', fontFamily: 'Inter', fontSize: 46, fontWeight: 400, fill: solid('#c9b8d8') }),
          generated('texture/film-grain', W, H, undefined, 0.45),
        ],
      };
    },
  },
  {
    id: 'retro-fest',
    name: 'Retro festival',
    category: 'Poster',
    width: 1800,
    height: 2400,
    preview: 'repeating-conic-gradient(from 0deg at 50% 38%, #f4a261 0 10deg, #e9c46a 10deg 20deg)',
    build: () => {
      const W = 1800;
      const H = 2400;
      return {
        background: solid('#e9c46a'),
        layers: [
          generated('background/sunburst', W, H),
          graphic('sticker/sun', { x: 620, y: 300, w: 560 }),
          text(W, H, 'LIVE MUSIC · STREET FOOD · OPEN AIR · ', { x: 440, y: 120, w: 920 }, { height: 920, align: 'center', fontFamily: 'Archivo Black', fontSize: 62, fontWeight: 400, letterSpacing: 3, fill: solid('#1d1e22'), path: { kind: 'circle', flip: false } }),
          text(W, H, 'SUMMER\nFEST', { x: 120, y: 1130, w: 1560 }, { align: 'center', fontFamily: 'Anton', fontSize: 440, fontWeight: 400, lineHeight: 0.95, letterSpacing: 6, fill: solid('#fff8e7'), stroke: { color: '#1d1e22', width: 12 }, effects: { ...fx, extrude: { color: '#e76f51', depth: 0.09, angle: 45 } } }),
          graphic('sticker/ribbon-banner', { x: 420, y: 2040, w: 960 }, ['#1d1e22', '#3a3c44']),
          text(W, H, '15 — 17 AUGUST', { x: 480, y: 2112, w: 840 }, { align: 'center', fontFamily: 'Archivo Black', fontSize: 74, fontWeight: 400, letterSpacing: 4, fill: solid('#fff8e7') }),
          generated('texture/film-grain', W, H, undefined, 0.35),
        ],
      };
    },
  },
  {
    id: 'album-gold',
    name: 'Gold record',
    category: 'Album cover',
    width: 1600,
    height: 1600,
    preview: 'linear-gradient(135deg, #0e0d0b 40%, #9a6700 50%, #0e0d0b 60%)',
    build: () => {
      const W = 1600;
      const H = 1600;
      return {
        background: solid('#0e0d0b'),
        layers: [
          generated('texture/marble', W, H, undefined, 0.22),
          graphic('frame/double-line', { x: 90, y: 90, w: W - 180, h: H - 180 }, ['#f0b429']),
          graphic('geometric/concentric-circles', { x: 520, y: 250, w: 560 }, ['#f0b429']),
          text(W, H, 'AURUM', { x: 100, y: 880, w: 1400 }, { align: 'center', fontFamily: 'Playfair Display', fontSize: 300, fontWeight: 900, letterSpacing: 10, fill: { type: 'linear', angle: 90, stops: GOLD }, effects: { ...fx, bevel: { depth: 0.65 }, extrude: { color: '#3a2500', depth: 0.03, angle: 60 } } }),
          text(W, H, 'THE MIDAS SESSIONS', { x: 100, y: 1250, w: 1400 }, { align: 'center', fontFamily: 'Inter', fontSize: 46, fontWeight: 500, letterSpacing: 22, fill: solid('#d8c9a3') }),
        ],
      };
    },
  },
  {
    id: 'story-sale',
    name: 'Sale story',
    category: 'Social media',
    width: 1080,
    height: 1920,
    preview: 'linear-gradient(180deg, #ff5f6d, #ffc371)',
    build: () => {
      const W = 1080;
      const H = 1920;
      return {
        background: linear(90, '#ff5f6d', '#ffc371'),
        layers: [
          graphic('geometric/memphis-confetti', { x: 40, y: 80, w: 1000 }, undefined, { opacity: 0.9 }),
          graphic('sticker/sale-burst', { x: 140, y: 520, w: 800 }, ['#1d1e22', '#fff8e7']),
          text(W, H, '50%\nOFF', { x: 190, y: 700, w: 700 }, { align: 'center', fontFamily: 'Archivo Black', fontSize: 230, fontWeight: 400, lineHeight: 0.95, fill: solid('#fff8e7'), effects: { ...fx, extrude: { color: '#ff5f6d', depth: 0.07, angle: 45 } } }),
          text(W, H, 'END OF SEASON', { x: 90, y: 300, w: 900 }, { align: 'center', fontFamily: 'Anton', fontSize: 120, fontWeight: 400, letterSpacing: 6, fill: solid('#1d1e22') }),
          icon('shopping-bag', { x: 470, y: 1440, size: 140 }, '#1d1e22'),
          text(W, H, 'This weekend only — in store and online', { x: 90, y: 1620, w: 900 }, { align: 'center', fontFamily: 'Inter', fontSize: 44, fontWeight: 600, fill: solid('#1d1e22') }),
        ],
      };
    },
  },
  {
    id: 'insta-launch',
    name: 'Launch post',
    category: 'Social media',
    width: 1080,
    height: 1080,
    preview: 'radial-gradient(circle at 70% 35%, #e07a5f 0 22%, #f4efe6 23%)',
    build: () => {
      const W = 1080;
      const H = 1080;
      return {
        background: solid('#f4efe6'),
        layers: [
          generated('texture/paper', W, H, undefined, 0.5),
          graphic('illustration/organic-blobs', { x: 420, y: 90, w: 600 }),
          graphic('frame/corner-brackets', { x: 60, y: 60, w: W - 120, h: H - 120 }, ['#3d405b']),
          text(W, H, 'New\nCollection', { x: 110, y: 520, w: 860 }, { fontFamily: 'Playfair Display', fontSize: 150, fontWeight: 700, italic: true, lineHeight: 1.02, fill: solid('#3d405b') }),
          text(W, H, 'OUT NOW — SPRING / SUMMER', { x: 116, y: 900, w: 860 }, { fontFamily: 'Space Mono', fontSize: 34, fontWeight: 700, letterSpacing: 6, fill: solid('#e07a5f') }),
        ],
      };
    },
  },
  {
    id: 'channel-banner',
    name: 'Channel banner',
    category: 'Banner',
    width: 2560,
    height: 1440,
    preview: 'linear-gradient(120deg, #141e30, #243b55)',
    build: () => {
      const W = 2560;
      const H = 1440;
      return {
        background: linear(20, '#141e30', '#243b55'),
        layers: [
          graphic('geometric/sunburst-lines', { x: 1500, y: 150, w: 1140 }, undefined, { opacity: 0.35 }),
          graphic('geometric/dot-grid', { x: 120, y: 980, w: 320 }, undefined, { opacity: 0.5 }),
          text(W, H, 'MAKER DIARIES', { x: 280, y: 480, w: 2000 }, { align: 'center', fontFamily: 'Anton', fontSize: 300, fontWeight: 400, letterSpacing: 10, fill: linear(90, '#ffffff', '#aab4c0', '#4a5563', '#dfe6ee', '#7f8b99'), stroke: { color: '#0b1220', width: 4 }, effects: { ...fx, bevel: { depth: 0.7 } } }),
          text(W, H, 'Builds, experiments and honest reviews — new video every Thursday', { x: 180, y: 860, w: 2200 }, { align: 'center', fontFamily: 'Inter', fontSize: 54, fontWeight: 500, fill: solid('#c8d3e0') }),
          icon('play', { x: 1210, y: 250, size: 140 }, '#ffd166'),
        ],
      };
    },
  },
  {
    id: 'web-banner',
    name: 'Newsletter banner',
    category: 'Banner',
    width: 1500,
    height: 500,
    preview: 'linear-gradient(90deg, #003049 60%, #669bbc)',
    build: () => {
      const W = 1500;
      const H = 500;
      return {
        background: solid('#003049'),
        layers: [
          generated('background/wave-lines', W, H, ['#003049', '#1b6a94']),
          text(W, H, 'Fresh ideas, weekly.', { x: 90, y: 130, w: 860 }, { fontFamily: 'Playfair Display', fontSize: 84, fontWeight: 700, fill: solid('#fdf0d5') }),
          text(W, H, 'One short email every Sunday. No noise.', { x: 94, y: 262, w: 860 }, { fontFamily: 'Inter', fontSize: 36, fontWeight: 400, fill: solid('#b8d4e3') }),
          graphic('sticker/curved-arrow', { x: 930, y: 150, w: 220 }, ['#ffd166']),
          createShape('rect', W, H, { name: 'Button', x: 1120, y: 290, width: 300, height: 96, cornerRadius: 48, fill: solid('#ffd166') }),
          text(W, H, 'Subscribe', { x: 1120, y: 314, w: 300 }, { align: 'center', fontFamily: 'Inter', fontSize: 40, fontWeight: 700, fill: solid('#003049') }),
        ],
      };
    },
  },
  {
    id: 'thumb-challenge',
    name: 'Challenge thumbnail',
    category: 'YouTube thumbnail',
    width: 1280,
    height: 720,
    preview: 'linear-gradient(135deg, #ffd60a 55%, #ef233c 55%)',
    build: () => {
      const W = 1280;
      const H = 720;
      return {
        background: linear(0, '#ffd60a', '#ffaa00'),
        layers: [
          generated('background/rings', W, H, ['#ffd60a', '#ffc300', '#ffdd33'], 0.9),
          graphic('sticker/pow-burst', { x: 760, y: 60, w: 470 }),
          text(W, H, '30\nDAYS', { x: 835, y: 150, w: 320 }, { align: 'center', fontFamily: 'Anton', fontSize: 120, fontWeight: 400, lineHeight: 0.95, fill: solid('#ffffff'), stroke: { color: '#1d1e22', width: 6 } }),
          text(W, H, 'I TRIED IT\nEVERY DAY', { x: 60, y: 150, w: 760 }, { fontFamily: 'Anton', fontSize: 170, fontWeight: 400, lineHeight: 0.98, fill: solid('#ffffff'), stroke: { color: '#1d1e22', width: 14 }, effects: { ...fx, extrude: { color: '#1d1e22', depth: 0.07, angle: 50 } } }),
          graphic('sticker/curved-arrow', { x: 520, y: 500, w: 260 }, ['#ef233c']),
          text(W, H, 'here is what happened', { x: 70, y: 560, w: 460 }, { fontFamily: 'Caveat', fontSize: 64, fontWeight: 700, fill: solid('#1d1e22') }),
        ],
      };
    },
  },
  {
    id: 'flyer-market',
    name: 'Market flyer',
    category: 'Flyer',
    width: 1240,
    height: 1748,
    preview: 'linear-gradient(180deg, #f1e9d8 62%, #2d6a4f 62%)',
    build: () => {
      const W = 1240;
      const H = 1748;
      return {
        background: solid('#f1e9d8'),
        layers: [
          generated('texture/paper', W, H, undefined, 0.6),
          graphic('frame/rounded-dashed', { x: 60, y: 60, w: W - 120, h: H - 120 }, ['#2d6a4f']),
          graphic('illustration/potted-plant', { x: 370, y: 150, w: 500 }),
          text(W, H, 'PLANT\nMARKET', { x: 120, y: 760, w: 1000 }, { align: 'center', fontFamily: 'Anton', fontSize: 250, fontWeight: 400, lineHeight: 0.98, letterSpacing: 4, fill: solid('#2d6a4f'), effects: { ...fx, distress: { amount: 0.3, scale: 0.4, seed: 5 } } }),
          text(W, H, 'Saturday 4 May · 9am – 3pm\nRiverside Yard, Mill Lane', { x: 120, y: 1330, w: 1000 }, { align: 'center', fontFamily: 'Inter', fontSize: 50, fontWeight: 500, lineHeight: 1.4, fill: solid('#3b3a36') }),
          graphic('sticker/scallop-seal', { x: 870, y: 500, w: 260 }, undefined, { rotation: 12 }),
          text(W, H, 'FREE\nENTRY', { x: 870, y: 575, w: 260 }, { align: 'center', rotation: 12, fontFamily: 'Archivo Black', fontSize: 46, fontWeight: 400, lineHeight: 1.05, fill: solid('#fff8e7') }),
        ],
      };
    },
  },
  {
    id: 'invitation',
    name: 'Garden invitation',
    category: 'Invitation',
    width: 1500,
    height: 2100,
    preview: 'linear-gradient(180deg, #fbf6ee 70%, #d9e4d2 70%)',
    build: () => {
      const W = 1500;
      const H = 2100;
      return {
        background: solid('#fbf6ee'),
        layers: [
          generated('texture/paper', W, H, undefined, 0.5),
          graphic('frame/ornate-corners', { x: 90, y: 90, w: W - 180, h: H - 180 }, ['#7a8f6a']),
          graphic('illustration/monstera-leaf', { x: 560, y: 210, w: 380 }, ['#7a8f6a', '#fbf6ee']),
          text(W, H, 'You are invited', { x: 200, y: 700, w: 1100 }, { align: 'center', fontFamily: 'Great Vibes', fontSize: 170, fontWeight: 400, fill: solid('#3f4f3a') }),
          text(W, H, 'TO A SUMMER GARDEN PARTY', { x: 200, y: 960, w: 1100 }, { align: 'center', fontFamily: 'Cormorant Garamond', fontSize: 58, fontWeight: 600, letterSpacing: 10, fill: solid('#7a8f6a') }),
          createShape('line', W, H, { name: 'Divider', x: 600, y: 1090, width: 300, height: 24, stroke: { color: '#b9a26a', width: 3 } }),
          text(W, H, 'Saturday, the twenty-first of June\nat four in the afternoon', { x: 200, y: 1170, w: 1100 }, { align: 'center', fontFamily: 'Cormorant Garamond', fontSize: 62, fontWeight: 500, lineHeight: 1.45, fill: solid('#3f4f3a') }),
          text(W, H, '12 Orchard Lane · RSVP by 1 June', { x: 200, y: 1480, w: 1100 }, { align: 'center', fontFamily: 'Cormorant Garamond', fontSize: 46, fontWeight: 500, letterSpacing: 3, fill: solid('#7a8f6a') }),
          icon('flower-2', { x: 690, y: 1640, size: 120 }, '#b9a26a'),
        ],
      };
    },
  },
  {
    id: 'certificate',
    name: 'Certificate',
    category: 'Certificate',
    width: 2000,
    height: 1414,
    preview: 'linear-gradient(90deg, #f7f3e8 8%, #ffffff 8% 92%, #f7f3e8 92%)',
    build: () => {
      const W = 2000;
      const H = 1414;
      return {
        background: solid('#fffdf7'),
        layers: [
          graphic('frame/bold-inline', { x: 60, y: 60, w: W - 120, h: H - 120 }, ['#1f3a5f', '#b9975b']),
          text(W, H, 'CERTIFICATE', { x: 300, y: 190, w: 1400 }, { align: 'center', fontFamily: 'Playfair Display', fontSize: 150, fontWeight: 800, letterSpacing: 18, fill: solid('#1f3a5f') }),
          text(W, H, 'OF ACHIEVEMENT', { x: 300, y: 380, w: 1400 }, { align: 'center', fontFamily: 'Inter', fontSize: 44, fontWeight: 600, letterSpacing: 22, fill: solid('#b9975b') }),
          text(W, H, 'This is proudly presented to', { x: 300, y: 520, w: 1400 }, { align: 'center', fontFamily: 'Lora', fontSize: 44, fontWeight: 400, italic: true, fill: solid('#4a4a4a') }),
          text(W, H, 'Recipient Name', { x: 300, y: 610, w: 1400 }, { align: 'center', fontFamily: 'Great Vibes', fontSize: 190, fontWeight: 400, fill: solid('#1f3a5f') }),
          createShape('line', W, H, { name: 'Name rule', x: 560, y: 850, width: 880, height: 24, stroke: { color: '#b9975b', width: 3 } }),
          text(W, H, 'for outstanding dedication and the successful completion of the programme', { x: 400, y: 890, w: 1200 }, { align: 'center', fontFamily: 'Lora', fontSize: 36, fontWeight: 400, lineHeight: 1.4, fill: solid('#4a4a4a') }),
          graphic('sticker/scallop-seal', { x: 900, y: 1010, w: 200 }, ['#1f3a5f', '#b9975b']),
          createShape('line', W, H, { name: 'Signature line', x: 280, y: 1110, width: 420, height: 24, stroke: { color: '#4a4a4a', width: 2 } }),
          text(W, H, 'Date', { x: 280, y: 1146, w: 420 }, { align: 'center', fontFamily: 'Inter', fontSize: 30, fontWeight: 500, letterSpacing: 4, fill: solid('#7a7a7a') }),
          createShape('line', W, H, { name: 'Signature line', x: 1300, y: 1110, width: 420, height: 24, stroke: { color: '#4a4a4a', width: 2 } }),
          text(W, H, 'Signature', { x: 1300, y: 1146, w: 420 }, { align: 'center', fontFamily: 'Inter', fontSize: 30, fontWeight: 500, letterSpacing: 4, fill: solid('#7a7a7a') }),
        ],
      };
    },
  },
  {
    id: 'wallpaper',
    name: 'Desktop wallpaper',
    category: 'Wallpaper',
    width: 1920,
    height: 1080,
    preview: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
    build: () => {
      const W = 1920;
      const H = 1080;
      return {
        background: linear(30, '#0f0c29', '#302b63', '#24243e'),
        layers: [
          generated('overlay/stars', W, H, undefined, 0.9),
          graphic('illustration/mountain-sun', { x: 560, y: 380, w: 800 }, undefined, { opacity: 0.92 }),
          generated('overlay/fog', W, H, undefined, 0.45),
          text(W, H, 'keep going', { x: 460, y: 150, w: 1000 }, { align: 'center', fontFamily: 'Montserrat', fontSize: 110, fontWeight: 800, letterSpacing: 6, fill: solid('#ffffff'), effects: { ...fx, glow: { color: '#8ab4ff', size: 0.5, strength: 0.45 } } }),
          generated('texture/film-grain', W, H, undefined, 0.3),
        ],
      };
    },
  },
];
