import { VIEW } from '../shaders/composite.glsl.js';
import { LIGHTING_PARAMS } from '../materials/LightingController.js';
import { hexToSrgb, hueSat, hueDistance, rgbToHex } from '../utils/color.js';
import { el } from '../utils/dom.js';

const VIEWS = [
  ['Show Base Mask', VIEW.BASE_MASK],
  ['Show Leather Mask', VIEW.LEATHER_MASK],
  ['Show Binding Mask', VIEW.BINDING_MASK],
  ['Show Lace Mask', VIEW.LACE_MASK],
  ['Show Liner Mask', VIEW.LINER_MASK],
  ['Show Branding Mask', VIEW.BRANDING_MASK],
  ['Show Lightmap', VIEW.LIGHTMAP],
  ['Show Shadow', VIEW.SHADOW],
  ['Show Highlights', VIEW.HIGHLIGHTS],
  ['Show Final Leather', VIEW.FINAL_LEATHER],
  ['Show Material IDs', VIEW.MATERIAL_IDS],
  ['Show Final Composite', VIEW.FINAL],
];
const VIEW_NAMES = Object.fromEntries(Object.entries(VIEW).map(([k, v]) => [v, k]));

export class DebugPanel {
  constructor(root, { gloveRenderer, materials, lighting, manifest, requestRender }) {
    this.root = root;
    this.gr = gloveRenderer;
    this.requestRender = requestRender || (() => this.gr.requestRender());
    this.materials = materials;
    this.lighting = lighting;
    this.manifest = manifest;
    this.build();
  }

  build() {
    const viewBox = el('div', { class: 'views' });
    this.viewChecks = VIEWS.map(([label, id]) => {
      const cb = el('input', { type: 'checkbox', checked: id === VIEW.FINAL });
      cb.addEventListener('change', () => this.setView(cb.checked ? id : VIEW.FINAL));
      viewBox.append(el('label', {}, [cb, el('span', { text: label })]));
      return [cb, id];
    });

    const sliders = el('div', { class: 'sliders' });
    this.sliderSync = [];
    for (const [key, p] of Object.entries(LIGHTING_PARAMS)) {
      const input = el('input', { type: 'range', min: p.min, max: p.max, step: p.step });
      const out = el('output');
      input.addEventListener('input', () => {
        this.lighting.set(key, input.value);
        this.requestRender();
        out.textContent = (+input.value).toFixed(2);
      });
      this.sliderSync.push(() => {
        input.value = this.lighting.get(key);
        out.textContent = (+this.lighting.get(key)).toFixed(2);
      });
      sliders.append(el('label', {}, [el('span', { text: p.label }), input, out]));
    }
    const reset = el('button', { class: 'ghost', text: 'Reset lighting' });
    reset.addEventListener('click', () => { this.lighting.reset(); this.syncSliders(); this.requestRender(); });

    this.diag = el('pre', { class: 'diag' });
    const check = el('button', { class: 'ghost', text: 'Run pipeline check' });
    check.addEventListener('click', () => this.runPipelineCheck());
    const log = el('button', { class: 'ghost', text: 'Log to console' });
    log.addEventListener('click', () => this.logPipeline());

    this.root.append(
      el('h4', { text: 'Views' }), viewBox,
      el('h4', { text: 'Lighting' }), sliders, reset,
      el('h4', { text: 'Diagnostics' }), el('div', { class: 'row' }, [check, log]), this.diag,
    );
    this.syncSliders();
  }

  // Diagnostics follow the active camera view.
  setRenderer(gr, manifest) {
    this.gr = gr;
    this.manifest = manifest;
    this.lightStats = null;
    this.check = null;
    this.refreshDiag();
  }

  syncSliders() {
    this.sliderSync.forEach((f) => f());
  }

  setView(id) {
    this.viewChecks.forEach(([cb, v]) => (cb.checked = v === id));
    this.gr.uniforms.uView.value = id; // shared: applies to every visible view
    this.requestRender();
    console.debug(`[glove] shader mode -> ${VIEW_NAMES[id]} (uView=${id})`);
    this.refreshDiag();
  }

  // Requirement 27: prove the selected colour reaches the shader and drives the output.
  runPipelineCheck() {
    const sel = this.materials.config.leather;
    const target = hueSat(hexToSrgb(sel));
    const buf = this.gr.renderToPixels({ uView: VIEW.FINAL, uBgMode: 0 });
    const m = this.gr.measureLeather(buf);
    const u = this.gr.uniforms.uLeatherColor.value;
    const chromatic = target.sat > 0.2 && target.val > 0.1;
    const hueOk = !chromatic || (m.hue != null && hueDistance(m.hue, target.hue) <= 12);
    const sourceRgbLeak = m.meanSat < 0.05 && chromatic; // would mean white mask RGB is being used
    this.check = {
      selectedColor: sel,
      uniformLinear: [u.r, u.g, u.b].map((v) => +v.toFixed(4)),
      renderedLeatherMean: rgbToHex(m.mean),
      renderedHue: m.hue == null ? 'achromatic' : +m.hue.toFixed(1),
      selectedHue: chromatic ? +target.hue.toFixed(1) : 'achromatic',
      renderedMeanSaturation: +m.meanSat.toFixed(3),
      samples: m.samples,
      verdict: sourceRgbLeak ? 'FAIL: output is grey, colour not applied' : hueOk ? 'PASS' : 'WARN: hue drift',
    };
    console.info('[glove] pipeline check', this.check);
    this.refreshDiag();
    return this.check;
  }

  logPipeline() {
    const info = this.collect();
    console.group('[glove] rendering pipeline');
    console.info('selected colours (sRGB hex -> linear uniform):', info.colors);
    console.info('mask coverage:', info.maskCoverage);
    console.info('lightmap stats:', info.lightmap);
    console.info('final shader mode:', info.mode);
    console.info('exposure:', info.exposure, 'lighting:', info.lighting);
    console.groupEnd();
  }

  collect() {
    if (!this.lightStats) this.lightStats = this.gr.lightmapStats();
    const lighting = Object.fromEntries(Object.keys(LIGHTING_PARAMS).map((k) => [k, +(+this.lighting.get(k)).toFixed(2)]));
    return {
      colors: this.materials.uniformSnapshot(),
      maskCoverage: this.gr.maskCoverage,
      lightmap: this.lightStats,
      mode: `${VIEW_NAMES[this.gr.uniforms.uView.value]} (uView=${this.gr.uniforms.uView.value})`,
      exposure: this.manifest.exposure,
      lighting,
    };
  }

  refreshDiag() {
    if (!this.root.offsetParent) return; // hidden
    const i = this.collect();
    const lines = [
      `camera view     ${this.manifest.label} (${this.gr.width}x${this.gr.height}), levels w=${this.manifest.levels?.white} γ=${this.manifest.levels?.gamma}`,
      `mode            ${i.mode}`,
      `leather         ${i.colors.leather.hex}  -> uLeatherColor ${i.colors.leather.linear.join(', ')}`,
      `laces           ${i.colors.laces.hex}  binding ${i.colors.binding.hex}`,
      `lightmap sRGB   min ${i.lightmap.sRGB.min}  max ${i.lightmap.sRGB.max}  mean ${i.lightmap.sRGB.mean}`,
      `lightmap linear min ${i.lightmap.linear.min}  max ${i.lightmap.linear.max}`,
      `exposure        liner x${i.exposure.liner}  stitch x${i.exposure.stitching}  swoosh fill x${i.exposure.swooshBase ?? 1}`,
      `gpu prepass     ${this.gr.layers.buildMs.toFixed(1)} ms, light RT ${this.gr.layers.lightType === 1016 ? 'half-float' : '8-bit'}`,
      `last draw       ${this.gr.lastRenderMs.toFixed(2)} ms (frames ${this.gr.frameCount})`,
      '',
      'mask coverage (px > 0):',
      ...Object.entries(i.maskCoverage).map(([k, v]) => `  ${k.padEnd(17)} ${String(v.px).padStart(6)}  ${v.pct}%`),
    ];
    if (this.check) {
      lines.push('', 'pipeline check:', ...Object.entries(this.check).map(([k, v]) => `  ${k.padEnd(23)} ${Array.isArray(v) ? v.join(', ') : v}`));
    }
    this.diag.textContent = lines.join('\n');
  }
}
