import * as THREE from 'three';
import { normalizeHex } from '../utils/color.js';
import { DEFAULT_CONFIG } from './presets.js';

// Independently colourisable channels -> composite shader uniform.
export const CHANNELS = {
  leather: { label: 'Leather', uniform: 'uLeatherColor' },
  binding: { label: 'Binding', uniform: 'uBindingColor' },
  laces: { label: 'Laces', uniform: 'uLaceColor' },
  liner: { label: 'Palm Liner', uniform: 'uLinerColor' },
  swoosh: { label: 'Swoosh', uniform: 'uSwooshColor' },
  stitching: { label: 'Swoosh Stitching', uniform: 'uStitchColor' },
  embroidery: { label: 'Embroidery', uniform: 'uEmbroideryColor' },
  swooshBase: { label: 'Swoosh Fill', uniform: 'uSwooshBaseColor' },
};

// Leather panels that follow the leather colour unless overridden. Index = uPanelOverride slot.
export const LEATHER_PANELS = [
  { key: 'Base', label: 'Wrist panel' },
  { key: 'BOH', label: 'Back of hand' },
  { key: 'Fingers', label: 'Finger inlays' },
  { key: 'Palm', label: 'Thumb / palm' },
  { key: 'Web', label: 'Web' },
  { key: 'Welting', label: 'Welting' },
];

// Single source of truth for material colours. Updating a colour only writes a shader
// uniform: no textures are touched or regenerated.
export class MaterialManager extends EventTarget {
  constructor(uniforms) {
    super();
    this.uniforms = uniforms;
    this.config = structuredClone(DEFAULT_CONFIG);
    this.undoStack = [];
    this.redoStack = [];
    this.committed = structuredClone(this.config);
  }

  // ---- history: every finished user gesture is one undo step ----
  commit() {
    if (JSON.stringify(this.config) === JSON.stringify(this.committed)) return;
    this.undoStack.push(this.committed);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.committed = structuredClone(this.config);
    this.emit({ channel: 'history' });
  }

  restore(cfg) {
    this.init(cfg);
    this.committed = structuredClone(this.config);
    this.emit({ channel: 'history' });
  }

  undo() {
    this.commit();
    if (!this.undoStack.length) return false;
    this.redoStack.push(structuredClone(this.config));
    this.restore(this.undoStack.pop());
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(structuredClone(this.config));
    this.restore(this.redoStack.pop());
    return true;
  }

  reset() {
    this.commit();
    this.init({ background: this.config.background, backgroundMode: this.config.backgroundMode });
    this.commit();
  }

  init(config = {}) {
    this.config = { ...structuredClone(DEFAULT_CONFIG), ...config, panels: { ...(config.panels || {}) } };
    for (const key of Object.keys(CHANNELS)) this.apply(key, this.config[key]);
    LEATHER_PANELS.forEach((_, i) => this.applyPanel(i));
    this.setBackground(this.config.background, this.config.backgroundMode);
  }

  apply(channel, hex) {
    const ch = CHANNELS[channel];
    // THREE.Color.set() interprets hex as sRGB and stores LINEAR (ColorManagement enabled).
    this.uniforms[ch.uniform].value.set(hex);
  }

  setColor(channel, value) {
    const hex = normalizeHex(value);
    if (!hex || !CHANNELS[channel]) return false;
    this.config[channel] = hex;
    this.apply(channel, hex);
    this.emit({ channel, hex });
    return true;
  }

  applyPanel(i) {
    const hex = this.config.panels[LEATHER_PANELS[i].key];
    const v = this.uniforms.uPanelOverride.value[i];
    if (hex) {
      const c = new THREE.Color(hex);
      v.set(c.r, c.g, c.b, 1);
    } else {
      v.set(0, 0, 0, 0);
    }
  }

  // hex = null links the panel back to the leather colour.
  setPanel(panelKey, value) {
    const i = LEATHER_PANELS.findIndex((p) => p.key === panelKey);
    if (i < 0) return false;
    const hex = value == null ? null : normalizeHex(value);
    if (value != null && !hex) return false;
    if (hex) this.config.panels[panelKey] = hex;
    else delete this.config.panels[panelKey];
    this.applyPanel(i);
    this.emit({ channel: 'panel:' + panelKey, hex });
    return true;
  }

  setBackground(value, mode = this.config.backgroundMode) {
    const hex = normalizeHex(value) || this.config.background;
    this.config.background = hex;
    this.config.backgroundMode = mode;
    this.uniforms.uBgColor.value.set(hex);
    this.uniforms.uBgMode.value = mode === 'transparent' ? 0 : 1;
    this.emit({ channel: 'background', hex, mode });
  }

  // Linear values actually sitting in the shader, for the debug panel / console.
  uniformSnapshot() {
    const out = {};
    for (const [k, ch] of Object.entries(CHANNELS)) {
      const c = this.uniforms[ch.uniform].value;
      out[k] = { hex: this.config[k], uniform: ch.uniform, linear: [c.r, c.g, c.b].map((v) => +v.toFixed(4)) };
    }
    return out;
  }

  emit(detail) {
    this.dispatchEvent(new CustomEvent('change', { detail }));
  }
}
