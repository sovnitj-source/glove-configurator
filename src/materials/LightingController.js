// Lighting / material-response parameters -> composite shader uniforms.
export const LIGHTING_PARAMS = {
  lighting: { label: 'Lighting intensity', uniform: 'uLighting', min: 0.5, max: 1.6, step: 0.01, default: 1.0 },
  shadow: { label: 'Shadow intensity', uniform: 'uShadow', min: 0.6, max: 1.6, step: 0.01, default: 1.0 },
  highlight: { label: 'Highlight intensity', uniform: 'uHighlight', min: 0, max: 2, step: 0.01, default: 1.0 },
  ao: { label: 'AO intensity', uniform: 'uAO', min: 0, max: 1, step: 0.01, default: 0.35 },
  // Oiled glove leather sits in the worn/full-grain band (~0.5-0.7); <0.3 reads as plastic.
  roughness: { label: 'Leather roughness', uniform: 'uRoughness', min: 0, max: 1, step: 0.01, default: 0.6 },
  grain: { label: 'Leather grain', uniform: 'uGrain', min: 0, max: 1.5, step: 0.01, default: 0.3 },
  // Procedural pebble grain (Worley cells) layered on the photo; fixes smooth "plastic" areas.
  pebble: { label: 'Pebble grain', uniform: 'uPebble', min: 0, max: 1.5, step: 0.01, default: 0.6 },
  dyeSaturation: { label: 'Dye saturation', uniform: 'uDyeSaturation', min: 0.6, max: 1.1, step: 0.01, default: 0.95 },
};

export class LightingController extends EventTarget {
  constructor(uniforms) {
    super();
    this.uniforms = uniforms;
    this.reset();
  }

  set(key, value) {
    const p = LIGHTING_PARAMS[key];
    if (!p) return;
    const v = Math.min(p.max, Math.max(p.min, Number(value)));
    this.uniforms[p.uniform].value = v;
    this.dispatchEvent(new CustomEvent('change', { detail: { key, value: v } }));
  }

  get(key) {
    return this.uniforms[LIGHTING_PARAMS[key].uniform].value;
  }

  reset() {
    for (const [k, p] of Object.entries(LIGHTING_PARAMS)) this.uniforms[p.uniform].value = p.default;
    this.dispatchEvent(new CustomEvent('change', { detail: { key: '*' } }));
  }
}
