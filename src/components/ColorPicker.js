import { hexToHsv, hsvToHex, normalizeHex } from '../utils/color.js';
import { el } from '../utils/dom.js';

// Inline custom colour picker: saturation/brightness pad, hue slider, HEX field and an
// eyedropper (where the browser supports it).
//   onInput(hex)  fires continuously while dragging (live preview on the glove)
//   onCommit(hex) fires once per finished gesture (undo history, recent colours)
export class ColorPicker {
  constructor({ onInput, onCommit }) {
    this.onInput = onInput;
    this.onCommit = onCommit;
    this.hsv = { h: 0, s: 0, v: 0 };

    this.thumb = el('span', { class: 'cp-thumb' });
    this.pad = el('div', { class: 'cp-pad', role: 'slider', 'aria-label': 'Saturation and brightness', tabindex: '0' }, [this.thumb]);
    this.hue = el('input', { type: 'range', class: 'cp-hue', min: 0, max: 360, step: 1, 'aria-label': 'Hue' });
    this.preview = el('span', { class: 'cp-preview' });
    this.hex = el('input', { type: 'text', class: 'cp-hex', maxlength: 7, spellcheck: 'false', 'aria-label': 'HEX colour' });
    const tools = [this.preview, el('label', { class: 'cp-hex-wrap' }, [el('span', { text: '#' }), this.hex])];
    if ('EyeDropper' in window) {
      const drop = el('button', { class: 'cp-drop', title: 'Pick a colour from the screen', 'aria-label': 'Eyedropper' });
      drop.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>';
      drop.addEventListener('click', async () => {
        try {
          const { sRGBHex } = await new window.EyeDropper().open();
          this.set(sRGBHex);
          this.emit(true);
        } catch { /* cancelled */ }
      });
      tools.push(drop);
    }
    this.node = el('div', { class: 'cp' }, [this.pad, this.hue, el('div', { class: 'cp-tools' }, tools)]);
    this.bind();
  }

  bind() {
    const fromPointer = (e) => {
      const r = this.pad.getBoundingClientRect();
      this.hsv.s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      this.hsv.v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      this.paint();
      this.emit(false);
    };
    this.pad.addEventListener('pointerdown', (e) => {
      this.pad.setPointerCapture(e.pointerId);
      this.dragging = true;
      fromPointer(e);
    });
    this.pad.addEventListener('pointermove', (e) => this.dragging && fromPointer(e));
    const end = () => {
      if (!this.dragging) return;
      this.dragging = false;
      this.emit(true);
    };
    this.pad.addEventListener('pointerup', end);
    this.pad.addEventListener('pointercancel', end);
    this.pad.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (!d) return;
      e.preventDefault();
      this.hsv.s = Math.min(1, Math.max(0, this.hsv.s + d[0]));
      this.hsv.v = Math.min(1, Math.max(0, this.hsv.v + d[1]));
      this.paint();
      this.emit(true);
    });

    this.hue.addEventListener('input', () => {
      this.hsv.h = +this.hue.value;
      this.paint();
      this.emit(false);
    });
    this.hue.addEventListener('change', () => this.emit(true));

    const commitHex = () => {
      const h = normalizeHex(this.hex.value);
      if (!h) {
        this.hex.value = this.current().slice(1);
        return;
      }
      this.set(h);
      this.emit(true);
    };
    this.hex.addEventListener('change', commitHex);
    this.hex.addEventListener('keydown', (e) => e.key === 'Enter' && commitHex());
  }

  current() {
    return hsvToHex(this.hsv);
  }

  emit(commit) {
    const hex = this.current();
    this.onInput?.(hex);
    if (commit) this.onCommit?.(hex);
  }

  // Programmatic update (no events). Keeps the hue when the colour is grey so the pad
  // doesn't jump to red.
  set(hex) {
    const n = normalizeHex(hex);
    if (!n || n === this.current()) return this.paint();
    const hsv = hexToHsv(n);
    if (hsv.s < 0.001 || hsv.v < 0.001) hsv.h = this.hsv.h;
    this.hsv = hsv;
    this.paint();
  }

  paint() {
    const { h, s, v } = this.hsv;
    this.pad.style.setProperty('--hue', `hsl(${h} 100% 50%)`);
    this.thumb.style.left = `${s * 100}%`;
    this.thumb.style.top = `${(1 - v) * 100}%`;
    const hex = this.current();
    this.thumb.style.background = hex;
    this.preview.style.background = hex;
    this.hue.value = h;
    if (document.activeElement !== this.hex) this.hex.value = hex.slice(1);
  }
}
