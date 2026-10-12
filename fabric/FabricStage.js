import { StaticCanvas, FabricImage, FabricText, config } from 'fabric';
import { GloveFilter } from './GloveFilter.js';
import { el } from '../src/utils/dom.js';

const ASSETS = new URL('../src/assets/', import.meta.url);
const GAP = 24;
const CROP_PAD = 0.045;
const PAD = 12;

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`Failed to load ${url}`));
  img.src = url;
});

// One Fabric.js StaticCanvas holds every camera view as a FabricImage. Each image's source is
// the view's light map; a GloveFilter (custom WebGL filter) recolours it from the masks.
// Colour change -> image.applyFilters() (GPU) -> canvas.requestRenderAll().
export class FabricStage extends EventTarget {
  constructor(container, switcherRoot, shared, materials) {
    super();
    this.container = container;
    this.switcherRoot = switcherRoot;
    this.shared = shared;
    this.materials = materials;
    this.views = [];
    this.mode = null;
    this.mobile = window.matchMedia('(max-width: 900px)');
  }

  async init() {
    config.textureSize = 2048; // every view fits in one WebGL tile
    const list = (await (await fetch(new URL('views.json', ASSETS))).json()).views;
    this.views = await Promise.all(list.map(async (v) => {
      const base = new URL(`views/${v.id}/`, ASSETS);
      const manifest = await (await fetch(new URL('manifest.json', base))).json();
      const f = (n) => new URL(`derived/fabric/${n}`, base).href;
      const [light, ...packs] = await Promise.all(['light.png', 'pack0.png', 'pack1.png', 'pack2.png', 'pack3.png', 'pack4.png'].map((n) => loadImage(f(n))));
      const filter = new GloveFilter();
      filter.viewId = v.id;
      filter.packs = packs;
      filter.shared = this.shared;
      filter.view = {
        width: v.width, height: v.height,
        levels: manifest.levels || { black: 0, white: 1, gamma: 1 },
        exposure: manifest.exposure || {},
        embParent: manifest.derived?.Embroidery?.parent === 'Palm' ? 3 : 0,
      };
      const [x0, y0, x1, y1] = manifest.gloveBBox;
      const pad = Math.round(Math.max(x1 - x0, y1 - y0) * CROP_PAD);
      const crop = { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad) };
      crop.w = Math.min(v.width, x1 + pad) - crop.x;
      crop.h = Math.min(v.height, y1 + pad) - crop.y;
      const image = new FabricImage(light, {
        cropX: crop.x, cropY: crop.y, width: crop.w, height: crop.h,
        originX: 'left', originY: 'top', selectable: false, evented: false, objectCaching: false,
        filters: [filter],
      });
      image.applyFilters();
      const tag = new FabricText(v.label.toUpperCase(), {
        fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, charSpacing: 140,
        fill: '#d6d6db', backgroundColor: 'rgba(12,12,13,.7)', padding: 6,
        selectable: false, evented: false, visible: false,
      });
      return { ...v, manifest, image, tag, crop, norm: 1 / Math.sqrt((x1 - x0) * (y1 - y0)) };
    }));

    this.canvasEl = el('canvas', { id: 'glove-canvas', 'aria-label': 'Glove preview' });
    this.container.append(this.canvasEl);
    this.canvas = new StaticCanvas(this.canvasEl, { enableRetinaScaling: true, renderOnAddRemove: false });
    for (const v of this.views) this.canvas.add(v.image, v.tag);

    this.buildSwitcher();
    new ResizeObserver(() => this.layout()).observe(this.container.parentElement);
    this.mobile.addEventListener('change', () => this.layout());
    this.setMode(this.views[0].id);
  }

  buildSwitcher() {
    const items = [...this.views.map((v) => ({ id: v.id, label: v.label, views: [v] })), { id: 'all', label: 'All', views: this.views }];
    this.switchButtons = items.map((it) => {
      const thumbs = it.views.map((v) => {
        const c = el('canvas', { class: 'thumb', width: Math.round((v.crop.w / v.crop.h) * 92), height: 92 });
        (v.thumbs ||= []).push(c);
        return c;
      });
      const b = el('button', { class: 'view-btn', title: `${it.label} view` }, [el('span', { class: 'thumbs' }, thumbs), el('span', { class: 'view-label', text: it.label })]);
      b.addEventListener('click', () => this.setMode(it.id));
      this.switcherRoot.append(b);
      return [it.id, b];
    });
  }

  get visible() {
    return this.mode === 'all' ? this.views : this.views.filter((v) => v.id === this.mode);
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== 'all') this.activeId = mode;
    for (const v of this.views) {
      v.image.visible = mode === 'all' || v.id === mode;
      v.tag.visible = mode === 'all';
    }
    this.switchButtons.forEach(([id, b]) => b.classList.toggle('active', id === mode));
    this.layout();
    this.render();
    this.dispatchEvent(new CustomEvent('mode', { detail: { mode } }));
  }

  // Same sizing rules as the Three.js version: crop to the glove, equal glove area in "All",
  // row or column (whichever is larger), capped upscaling.
  layout() {
    if (!this.canvas) return;
    const all = this.mode === 'all';
    const mobile = this.mobile.matches;
    const r = this.container.parentElement.getBoundingClientRect();
    const W = Math.max(1, r.width);
    const vh = window.innerHeight;
    const H = mobile ? (all ? vh * 0.42 * this.visible.length : vh * 0.6) : Math.max(1, r.height);
    const boxes = this.visible.map((v) => {
      const s = all ? v.norm : 1;
      return { v, s, w: v.crop.w * s, h: v.crop.h * s };
    });
    const gaps = GAP * (boxes.length - 1);
    const sumW = boxes.reduce((a, b) => a + b.w, 0);
    const sumH = boxes.reduce((a, b) => a + b.h, 0);
    const maxW = Math.max(...boxes.map((b) => b.w));
    const maxH = Math.max(...boxes.map((b) => b.h));
    const kRow = Math.min((W - gaps - 2 * PAD) / sumW, (H - 2 * PAD) / maxH);
    const kCol = Math.min((W - 2 * PAD) / maxW, (H - gaps - 2 * PAD) / sumH);
    const column = mobile || kCol > kRow;
    let k = column ? kCol : kRow;
    if (mobile && all) k = Math.min((W - 2 * PAD) / maxW, ...boxes.map((b) => (vh * 0.42) / b.h));
    k = Math.min(k, ...boxes.map((b) => 1.6 / b.s));

    const totalW = column ? maxW * k : sumW * k + gaps;
    const totalH = column ? sumH * k + gaps : maxH * k;
    const cw = mobile ? W : W;
    const ch = mobile ? Math.ceil(totalH + 2 * PAD) : H;
    this.canvas.setDimensions({ width: cw, height: ch });
    let x = (cw - totalW) / 2;
    let y = (ch - totalH) / 2;
    for (const b of boxes) {
      const f = k * b.s;
      const w = b.v.crop.w * f;
      const h = b.v.crop.h * f;
      const left = column ? (cw - w) / 2 : x;
      const top = column ? y : (ch - h) / 2;
      b.v.image.set({ left, top, scaleX: f, scaleY: f });
      b.v.tag.set({ left: left + 10, top: top + 10 });
      b.v.screen = { left, top, w, h, f };
      if (column) y += h + GAP; else x += w + GAP;
    }
    this.canvas.requestRenderAll();
  }

  applyBackground(transparentOverride) {
    const c = this.materials.config;
    const transparent = transparentOverride ?? c.backgroundMode === 'transparent';
    this.canvas.backgroundColor = transparent ? '' : c.background;
  }

  // Re-run the GPU filter for the visible views and redraw (coalesced per frame).
  render() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const t = performance.now();
      this.applyBackground();
      for (const v of this.visible) v.image.applyFilters();
      this.canvas.renderAll();
      this.lastRenderMs = performance.now() - t;
      this.scheduleThumbs();
    });
  }

  scheduleThumbs() {
    clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(() => {
      for (const v of this.views) {
        if (!this.visible.includes(v)) v.image.applyFilters();
        const src = v.image.getElement();
        for (const t of v.thumbs || []) {
          const ctx = t.getContext('2d');
          ctx.clearRect(0, 0, t.width, t.height);
          ctx.drawImage(src, v.crop.x, v.crop.y, v.crop.w, v.crop.h, 0, 0, t.width, t.height);
        }
      }
    }, 140);
  }

  // Export with Fabric's own toDataURL: crop to the visible gloves, multiplier chosen so no
  // view is exported below its native resolution... or upscaled above it.
  async toBlob({ transparent = false } = {}) {
    const vis = this.visible;
    const m = Math.min(...vis.map((v) => 1 / v.screen.f));
    const pad = this.mode === 'all' ? GAP : 0;
    const left = Math.min(...vis.map((v) => v.screen.left)) - pad;
    const top = Math.min(...vis.map((v) => v.screen.top)) - pad;
    const right = Math.max(...vis.map((v) => v.screen.left + v.screen.w)) + pad;
    const bottom = Math.max(...vis.map((v) => v.screen.top + v.screen.h)) + pad;
    const tags = vis.map((v) => v.tag.visible);
    vis.forEach((v) => { v.tag.visible = false; });
    this.applyBackground(transparent || undefined);
    const url = this.canvas.toDataURL({ format: 'png', left, top, width: right - left, height: bottom - top, multiplier: m, enableRetinaScaling: false });
    vis.forEach((v, i) => { v.tag.visible = tags[i]; });
    this.applyBackground();
    this.canvas.requestRenderAll();
    return (await fetch(url)).blob();
  }
}
