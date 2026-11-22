import { createGeneratedImage, createShape, createText } from '../document/factory';
import { getGenerator } from '../generators/render';
import type { Fill, Layer, TextLayer } from '../../types/document';

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
];
