import { TEST_GRID_COLORS } from '../materials/presets.js';
import { hexToSrgb, hueSat, hueDistance, rgbToHex, normalizeHex } from '../utils/color.js';
import { el } from '../utils/dom.js';

const TARGETS = {
  leather: { label: 'Leather', channels: ['leather'] },
  shell: { label: 'Leather + binding', channels: ['leather', 'binding'] },
  laces: { label: 'Laces', channels: ['laces'] },
  all: { label: 'Everything', channels: ['leather', 'binding', 'laces', 'liner'] },
};

// Developer QA: renders the same glove in a series of colours with identical lighting and
// checks the rendered leather hue/saturation against the selected colour.
export class ColorTestGrid {
  constructor(root, { gloveRenderer, materials }) {
    this.root = root;
    this.gr = gloveRenderer;
    this.materials = materials;
    this.customHex = '#7B1FA2';
    this.target = 'leather';
    this.build();
  }

  build() {
    const custom = el('input', { type: 'color', value: this.customHex });
    custom.addEventListener('input', () => { this.customHex = normalizeHex(custom.value); this.run(); });
    const target = el('select', {}, Object.entries(TARGETS).map(([k, t]) => el('option', { value: k, text: t.label })));
    target.addEventListener('change', () => { this.target = target.value; this.run(); });
    const rerun = el('button', { class: 'ghost', text: 'Re-render' });
    rerun.addEventListener('click', () => this.run());
    this.summary = el('span', { class: 'summary' });
    this.grid = el('div', { class: 'test-grid' });
    this.root.append(
      el('div', { class: 'grid-toolbar' }, [
        el('label', {}, [el('span', { text: 'Apply to' }), target]),
        el('label', {}, [el('span', { text: 'Custom colour' }), custom]),
        rerun,
        this.summary,
      ]),
      this.grid,
    );
  }

  colors() {
    return [...TEST_GRID_COLORS, { name: 'Custom', hex: this.customHex }];
  }

  // Each tile is rendered on the GPU into an offscreen target with only uniforms changed.
  run() {
    const { width, height } = this.gr;
    const u = this.gr.uniforms;
    const channels = TARGETS[this.target].channels;
    const uniformFor = { leather: 'uLeatherColor', binding: 'uBindingColor', laces: 'uLaceColor', liner: 'uLinerColor' };
    const saved = channels.map((c) => u[uniformFor[c]].value.clone());
    const savedPanels = u.uPanelOverride.value.map((v) => v.clone());
    if (channels.includes('leather')) u.uPanelOverride.value.forEach((v) => v.setW(0));

    this.grid.replaceChildren();
    const results = [];
    for (const c of this.colors()) {
      channels.forEach((ch) => u[uniformFor[ch]].value.set(c.hex));
      const buf = this.gr.renderToPixels({ uView: 0, uBgMode: 1 });
      const canvas = el('canvas', { width, height });
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(width, height);
      // GL rows are bottom-up.
      const row = width * 4;
      for (let y = 0; y < height; y++) img.data.set(buf.subarray((height - 1 - y) * row, (height - y) * row), y * row);
      ctx.putImageData(img, 0, 0);

      let metric = null;
      if (channels.includes('leather')) {
        const m = this.gr.measureLeather(buf);
        const t = hueSat(hexToSrgb(c.hex));
        const chromatic = t.sat > 0.2 && t.val > 0.1;
        const dHue = chromatic && m.hue != null ? hueDistance(m.hue, t.hue) : null;
        const pass = chromatic ? dHue != null && dHue <= 12 && m.meanSat > 0.35 * t.sat : m.meanSat < 0.2;
        metric = { name: c.name, hex: c.hex, rendered: rgbToHex(m.mean), dHue, sat: m.meanSat, pass };
        results.push(metric);
      }
      this.grid.append(el('figure', { class: 'tile' }, [
        canvas,
        el('figcaption', {}, [
          el('span', { class: 'chip', style: `--c:${c.hex}` }),
          el('strong', { text: c.name }),
          el('code', { text: c.hex }),
          metric ? el('span', {
            class: 'badge ' + (metric.pass ? 'ok' : 'bad'),
            text: metric.pass ? 'PASS' : 'CHECK',
            title: `rendered mean ${metric.rendered}, hue Δ ${metric.dHue == null ? 'n/a (achromatic)' : metric.dHue.toFixed(1) + '°'}, sat ${metric.sat.toFixed(2)}`,
          }) : null,
        ]),
        metric ? el('small', { text: `mean ${metric.rendered} · Δhue ${metric.dHue == null ? '—' : metric.dHue.toFixed(1) + '°'} · sat ${metric.sat.toFixed(2)}` }) : null,
      ]));
    }
    channels.forEach((ch, i) => u[uniformFor[ch]].value.copy(saved[i]));
    savedPanels.forEach((v, i) => u.uPanelOverride.value[i].copy(v));
    this.gr.requestRender();

    const passed = results.filter((r) => r.pass).length;
    this.summary.textContent = results.length ? `${passed}/${results.length} colour-independence checks passed` : '';
    console.table(results);
    return results;
  }
}
