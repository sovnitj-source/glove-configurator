import { GloveRenderer, createSharedUniforms } from './GloveRenderer.js';
import { el } from '../utils/dom.js';

const GAP = 24;          // px between views in "All" mode
const CROP_PAD = 0.045;  // padding around the glove, fraction of the glove's larger side
const MAX_UPSCALE = 1.6; // never blow a view up beyond this over its native pixels

// Owns one GloveRenderer (own canvas + WebGL context) per camera view. All renderers share
// the colour / lighting uniform objects, so a colour change is a single uniform write that
// every view picks up on its next draw. Only visible views are drawn.
//
// Sizing: the photos frame the glove differently (different canvas sizes and margins), so
// every view is cropped to its glove bounds (manifest.gloveBBox) and, in "All" mode, scaled
// so each glove covers the same on-screen area. Layout is computed in JS on resize.
export class ViewManager extends EventTarget {
  constructor(framesRoot, switcherRoot) {
    super();
    this.framesRoot = framesRoot;
    this.switcherRoot = switcherRoot;
    this.shared = createSharedUniforms();
    this.views = []; // { id, label, width, height, gr, frame, crop, norm, thumbs }
    this.mode = null; // view id or 'all'
    this.is3D = false;
    this.viewer = null; // ModelViewer (360° 3D), attached by main
    this.pending = false;
  }

  async init(loader) {
    this.inner = el('div', { class: 'frames-inner' });
    this.framesRoot.append(this.inner);
    const list = await loader.listViews();
    const loaded = await Promise.all(list.map((v) => loader.loadView(v.id)));
    list.forEach((v, i) => {
      const manifest = loaded[i].manifest;
      const canvas = el('canvas', { width: v.width, height: v.height, 'aria-label': `${v.label} view` });
      const frame = el('div', { class: 'frame', 'data-view': v.id }, [canvas, el('span', { class: 'frame-label', text: v.label })]);
      frame.addEventListener('click', () => this.mode === 'all' && this.setMode(v.id));
      this.inner.append(frame);
      const gr = new GloveRenderer(canvas, v.width, v.height, this.shared);
      gr.build(loaded[i]);
      const crop = this.cropFor(manifest, v.width, v.height);
      const [gx0, gy0, gx1, gy1] = manifest.gloveBBox || [0, 0, v.width, v.height];
      // Equal on-screen glove area: scale each view by 1/sqrt(glove bbox area).
      const norm = 1 / Math.sqrt((gx1 - gx0) * (gy1 - gy0));
      this.views.push({ ...v, gr, frame, canvas, manifest, crop, norm });
    });
    this.buildSwitcher();
    new ResizeObserver(() => this.layout()).observe(this.framesRoot);
    this.mobile = window.matchMedia('(max-width: 900px)');
    this.mobile.addEventListener('change', () => this.layout());
    this.setMode(this.views[0].id);
  }

  cropFor(manifest, w, h) {
    const [x0, y0, x1, y1] = manifest.gloveBBox || [0, 0, w, h];
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * CROP_PAD);
    const x = Math.max(0, x0 - pad);
    const y = Math.max(0, y0 - pad);
    return { x, y, w: Math.min(w, x1 + pad) - x, h: Math.min(h, y1 + pad) - y };
  }

  buildSwitcher() {
    const items = [
      ...this.views.map((v) => ({ id: v.id, label: v.label, views: [v] })),
      { id: 'all', label: this.views.length === 2 ? 'Both' : 'All', views: this.views },
    ];
    this.switchButtons = items.map((it) => {
      const thumbs = it.views.map((v) => {
        const th = 46;
        const c = el('canvas', { class: 'thumb', width: Math.round((v.crop.w / v.crop.h) * th * 2), height: th * 2 });
        (v.thumbs ||= []).push(c);
        return c;
      });
      const b = el('button', { class: 'view-btn', title: `${it.label} view${it.views.length > 1 ? 's' : ''}` }, [
        el('span', { class: 'thumbs' }, thumbs),
        el('span', { class: 'view-label', text: it.label }),
      ]);
      b.addEventListener('click', () => this.setMode(it.id));
      this.switcherRoot.append(b);
      return [it.id, b];
    });
    this.switcherRoot.append(el('span', { class: 'switch-divider' }));
    this.toggle3D = el('button', { class: 'view-btn toggle-3d', title: 'Toggle 360° 3D view', 'aria-pressed': 'false' }, [
      el('span', { class: 'cube' }),
      el('span', { class: 'view-label' }, [el('span', { class: 'mini-switch' }), el('span', { text: '3D' })]),
    ]);
    this.toggle3D.firstChild.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4Z"/><path d="m4 7.4 8 4.6 8-4.6M12 12v9.2"/></svg>';
    this.toggle3D.addEventListener('click', () => this.set3D(!this.is3D));
    this.switcherRoot.append(this.toggle3D);
  }

  attachViewer(viewer) {
    this.viewer = viewer;
    viewer.addEventListener('orbit', (e) => {
      if (!this.is3D) return;
      this.switchButtons.forEach(([id, b]) => b.classList.toggle('active', id === e.detail.nearest));
    });
  }

  set3D(on) {
    if (!this.viewer) return;
    this.is3D = on;
    document.body.classList.toggle('mode-3d', on);
    this.toggle3D.classList.toggle('active', on);
    this.toggle3D.setAttribute('aria-pressed', on);
    this.framesRoot.hidden = on;
    this.renderAll();
    this.viewer.setEnabled(on);
    if (on) {
      if (this.mode === 'all') this.mode = this.activeId;
      this.viewer.goTo(this.activeId);
    } else {
      this.setMode(this.mode || this.activeId);
    }
    this.dispatchEvent(new CustomEvent('mode', { detail: { mode: this.mode, active: this.activeId, is3D: on } }));
  }

  get visible() {
    // In 3D every view is a texture source for the viewer, so all of them are drawn.
    if (this.is3D || this.mode === 'all') return this.views;
    return this.views.filter((v) => v.id === this.mode);
  }

  // Draw one view. In 3D the sources render with a transparent background (the viewer
  // draws its own backdrop behind the relief).
  draw(v) {
    if (!this.is3D) return v.gr.render();
    const u = this.shared.uBgMode;
    const prev = u.value;
    u.value = 0;
    v.gr.render();
    u.value = prev;
  }

  // The view that debug tools, the colour test and single-view export act on.
  get activeView() {
    return this.views.find((v) => v.id === this.activeId) || this.views[0];
  }

  get active() {
    return this.activeView.gr;
  }

  setMode(mode) {
    if (mode === 'both') mode = 'all';
    if (this.is3D) {
      // In 3D the view buttons orbit to that photographed angle.
      if (mode !== 'all') {
        this.activeId = mode;
        this.viewer.goTo(mode);
        this.dispatchEvent(new CustomEvent('mode', { detail: { mode, active: mode, is3D: true } }));
      }
      return;
    }
    this.mode = mode;
    if (mode !== 'all') this.activeId = mode;
    this.framesRoot.classList.toggle('all', mode === 'all');
    for (const v of this.views) v.frame.hidden = !(mode === 'all' || v.id === mode);
    this.switchButtons.forEach(([id, b]) => b.classList.toggle('active', id === mode));
    this.layout();
    this.renderAll();
    this.dispatchEvent(new CustomEvent('mode', { detail: { mode, active: this.activeId } }));
  }

  // Relative box of each visible view before the global fit factor k is applied.
  boxes(all) {
    return this.visible.map((v) => {
      const s = all ? v.norm : 1;
      return { v, s, w: v.crop.w * s, h: v.crop.h * s };
    });
  }

  layout() {
    if (!this.views.length) return;
    const all = this.mode === 'all';
    const mobile = this.mobile?.matches;
    const r = this.framesRoot.getBoundingClientRect();
    const W = Math.max(1, r.width);
    const boxes = this.boxes(all);
    // Mobile/tablet: views stack, so cap their height to a share of the screen so the colour
    // panel is always reachable (single view ~60% of the screen, each stacked view ~40%).
    const vh = window.innerHeight;
    const H = mobile ? (all ? vh * 0.42 * boxes.length + GAP * (boxes.length - 1) : vh * 0.6) : Math.max(1, r.height);
    const gaps = GAP * (boxes.length - 1);
    const sumW = boxes.reduce((a, b) => a + b.w, 0);
    const sumH = boxes.reduce((a, b) => a + b.h, 0);
    const maxW = Math.max(...boxes.map((b) => b.w));
    const maxH = Math.max(...boxes.map((b) => b.h));
    const kRow = Math.min((W - gaps) / sumW, H / maxH);
    const kCol = Math.min(W / maxW, (H - gaps) / sumH);
    const column = mobile || kCol > kRow;
    let k = column ? kCol : kRow;
    if (mobile && all) k = Math.min(W / maxW, ...boxes.map((b) => (vh * 0.42) / b.h)); // each stacked view ≤ 42% of screen
    // Cap upscaling relative to native pixels (per view, using its own scale factor).
    k = Math.min(k, ...boxes.map((b) => MAX_UPSCALE / b.s));
    this.inner.classList.toggle('column', column);
    for (const b of boxes) {
      const f = k * b.s;
      const { v } = b;
      v.frame.style.width = `${Math.round(v.crop.w * f)}px`;
      v.frame.style.height = `${Math.round(v.crop.h * f)}px`;
      Object.assign(v.canvas.style, {
        width: `${v.width * f}px`,
        height: `${v.height * f}px`,
        left: `${-v.crop.x * f}px`,
        top: `${-v.crop.y * f}px`,
      });
    }
  }

  renderAll() {
    for (const v of this.visible) this.draw(v);
    this.dispatchEvent(new Event('rendered'));
    this.scheduleThumbs();
  }

  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.renderAll();
    });
  }

  // Thumbnails show every view (also hidden ones) so the switcher previews the current colours.
  scheduleThumbs() {
    clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(() => {
      const u = this.shared;
      const focus = u.uFocusAmt.value;
      u.uFocusAmt.value = 0;
      for (const v of this.views) {
        this.draw(v);
        for (const t of v.thumbs || []) {
          const ctx = t.getContext('2d');
          ctx.clearRect(0, 0, t.width, t.height);
          ctx.drawImage(v.gr.canvas, v.crop.x, v.crop.y, v.crop.w, v.crop.h, 0, 0, t.width, t.height);
        }
      }
      u.uFocusAmt.value = focus;
      if (focus > 0) for (const v of this.visible) this.draw(v);
      if (this.is3D) this.dispatchEvent(new Event('rendered'));
    }, 120);
  }

  // Export layout for "All": same equal-glove-area scaling as the screen, at a resolution where
  // the smallest-scaled view is at native size (nothing is upscaled).
  composeAll(renderFinal, { transparent, background }) {
    const boxes = this.views.map((v) => ({ v, s: v.norm, w: v.crop.w * v.norm, h: v.crop.h * v.norm }));
    const k = Math.min(...boxes.map((b) => 1 / b.s));
    const gap = Math.round(GAP * 2);
    const sizes = boxes.map((b) => ({ ...b, W: Math.round(b.w * k), H: Math.round(b.h * k) }));
    const outH = Math.max(...sizes.map((b) => b.H)) + gap * 2;
    const outW = sizes.reduce((a, b) => a + b.W, 0) + gap * (sizes.length + 1);
    const canvas = el('canvas', { width: outW, height: outH });
    const ctx = canvas.getContext('2d');
    if (!transparent) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, outW, outH);
    }
    ctx.imageSmoothingQuality = 'high';
    let x = gap;
    for (const b of sizes) {
      const src = renderFinal(b.v.gr);
      const { crop } = b.v;
      ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, x, Math.round((outH - b.H) / 2), b.W, b.H);
      x += b.W + gap;
    }
    return canvas;
  }

  // Smoothly fade the hovered-zone highlight in/out on every visible view.
  setFocus(zone) {
    const u = this.shared;
    if (zone != null) u.uFocus.value = zone;
    this.focusTarget = zone == null ? 0 : 1;
    if (this.focusAnimating) return;
    this.focusAnimating = true;
    const step = () => {
      const d = this.focusTarget - u.uFocusAmt.value;
      u.uFocusAmt.value = Math.abs(d) < 0.02 ? this.focusTarget : u.uFocusAmt.value + d * 0.25;
      for (const v of this.visible) this.draw(v);
      this.dispatchEvent(new Event('rendered'));
      if (u.uFocusAmt.value !== this.focusTarget) requestAnimationFrame(step);
      else {
        this.focusAnimating = false;
        if (this.focusTarget === 0) u.uFocus.value = -1;
      }
    };
    requestAnimationFrame(step);
  }
}
