// Minimal stand-ins for the two Three.js value classes used by the shared colour code
// (src/materials/MaterialManager.js). The Fabric.js version maps the "three" import here,
// so no Three.js is loaded. Semantics match THREE.Color with ColorManagement enabled:
// hex strings are sRGB, stored components are LINEAR.
import { hexToLinear, normalizeHex } from '../src/utils/color.js';

export class Color {
  constructor(v) {
    this.r = 0; this.g = 0; this.b = 0;
    if (v !== undefined) this.set(v);
  }
  set(v) {
    const hex = typeof v === 'number' ? '#' + v.toString(16).padStart(6, '0') : normalizeHex(v);
    if (hex) [this.r, this.g, this.b] = hexToLinear(hex);
    return this;
  }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  clone() { return new Color().copy(this); }
}

export class Vector4 {
  constructor(x = 0, y = 0, z = 0, w = 0) { this.set(x, y, z, w); }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  setW(w) { this.w = w; return this; }
  copy(v) { return this.set(v.x, v.y, v.z, v.w); }
  clone() { return new Vector4().copy(this); }
}
