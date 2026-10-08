import { CHANNELS, LEATHER_PANELS } from '../materials/MaterialManager.js';
import { LEATHER_PRESETS, LACE_PRESETS, LINER_PRESETS, BRAND_PRESETS, BACKGROUND_PRESETS } from '../materials/presets.js';
import { contrastOn } from '../utils/color.js';
import { el } from '../utils/dom.js';
import { ColorPicker } from './ColorPicker.js';

// Zones grouped the way a buyer thinks about the glove. `focus` = shader uFocus id.
const GROUPS = [
  {
    title: 'Leather',
    zones: [
      { id: 'leather', presets: LEATHER_PRESETS, hint: 'Shell, finger inlays, palm, web, welting', focus: 0, panels: true },
      { id: 'binding', presets: LEATHER_PRESETS, hint: 'Wrist opening and hem', focus: 1 },
      { id: 'laces', presets: LACE_PRESETS, hint: 'All lacing, knots and tails', focus: 2 },
      { id: 'liner', presets: LINER_PRESETS, hint: 'Visible inside the wrist opening', focus: 3 },
    ],
  },
  {
    title: 'Branding',
    zones: [
      { id: 'swoosh', presets: BRAND_PRESETS, hint: 'Leather swoosh patch', focus: 4 },
      { id: 'stitching', presets: BRAND_PRESETS, hint: 'Stitched border around the swoosh', focus: 5 },
      { id: 'swooshBase', presets: BRAND_PRESETS, hint: 'Inside of the swoosh (side view)', focus: 7 },
      { id: 'embroidery', presets: BRAND_PRESETS, hint: 'VAPOR Elite wrist logo', focus: 6 },
    ],
  },
];
const ALL_PRESETS = [LEATHER_PRESETS, LACE_PRESETS, LINER_PRESETS, BRAND_PRESETS, BACKGROUND_PRESETS].flat();
const RECENT_KEY = 'glove.recentColours';

const icon = (path, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const ICONS = {
  chevron: icon('<path d="m6 9 6 6 6-6"/>'),
  undo: icon('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: icon('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  reset: icon('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>', 14),
  link: icon('<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><path d="M8 12h8"/>', 13),
};

function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}
function writeRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

// Customisation panel. Every interaction goes through MaterialManager, which only writes
// shader uniforms; the renderer redraws on the next animation frame.
export class ColorController {
  constructor(root, { materials, onChange, onFocus, summaryRoot }) {
    this.root = root;
    this.materials = materials;
    this.onChange = onChange;
    this.onFocus = onFocus;
    this.summaryRoot = summaryRoot;
    this.sync = [];
    this.zones = new Map();
    this.recent = readRecent();
    this.panelTarget = null; // null = whole leather, else a LEATHER_PANELS key
    this.build();
    materials.addEventListener('change', (e) => e.detail.channel === 'history' && this.refresh());
  }

  nameOf(hex) {
    return ALL_PRESETS.find((p) => p.hex.toUpperCase() === hex)?.name || 'Custom';
  }

  // ---------- building blocks ----------

  swatchGrid(presets, getHex, apply) {
    const grid = el('div', { class: 'swatch-grid', role: 'radiogroup' });
    const items = presets.map((p) => {
      const b = el('button', {
        class: 'sw', role: 'radio', title: `${p.name}  ${p.hex}`, 'aria-label': p.name,
        style: `--c:${p.hex};--on:${contrastOn(p.hex)}`,
      });
      b.addEventListener('click', () => apply(p.hex, true));
      grid.append(b);
      return [b, p.hex.toUpperCase()];
    });
    const update = () => {
      const hex = getHex();
      items.forEach(([b, h]) => {
        const on = h === hex;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on);
      });
    };
    return { node: grid, update };
  }

  customArea(getHex, apply) {
    const picker = new ColorPicker({
      onInput: (hex) => apply(hex, false),
      onCommit: (hex) => { apply(hex, true); this.addRecent(hex); },
    });
    const recentRow = el('div', { class: 'recent' });
    const area = el('div', { class: 'custom-area' }, [picker.node, el('div', { class: 'recent-label', text: 'Recent' }), recentRow]);
    area.hidden = true;
    const toggle = el('button', { class: 'custom-toggle' });
    toggle.innerHTML = `${ICONS.plus}<span>Custom colour</span>`;
    toggle.addEventListener('click', () => {
      area.hidden = !area.hidden;
      toggle.classList.toggle('open', !area.hidden);
      if (!area.hidden) picker.set(getHex());
    });
    const update = () => {
      if (!area.hidden && !picker.dragging) picker.set(getHex());
      recentRow.replaceChildren(...this.recent.map((hex) => {
        const b = el('button', { class: 'sw small', title: hex, style: `--c:${hex};--on:${contrastOn(hex)}` });
        b.classList.toggle('active', hex === getHex());
        b.addEventListener('click', () => apply(hex, true));
        return b;
      }));
      recentRow.previousSibling.hidden = recentRow.hidden = !this.recent.length;
    };
    return { toggle, area, update };
  }

  addRecent(hex) {
    this.recent = [hex, ...this.recent.filter((h) => h !== hex)].slice(0, 10);
    writeRecent(this.recent);
    this.refresh();
  }

  // ---------- zones ----------

  build() {
    const m = this.materials;
    const head = el('div', { class: 'cfg-head' }, [
      el('div', {}, [el('h2', { text: 'Customise' }), el('p', { text: 'Choose a zone, then a colour' })]),
    ]);
    const hist = el('div', { class: 'hist' });
    const mk = (name, title, fn) => {
      const b = el('button', { class: 'icon-btn', title, 'aria-label': title });
      b.innerHTML = ICONS[name];
      b.addEventListener('click', () => { fn(); this.refresh(); });
      hist.append(b);
      return b;
    };
    this.undoBtn = mk('undo', 'Undo (⌘Z)', () => m.undo());
    this.redoBtn = mk('redo', 'Redo (⇧⌘Z)', () => m.redo());
    mk('reset', 'Reset colours', () => m.reset());
    head.append(hist);
    this.root.append(head);

    document.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.target.matches('input[type=text]')) return;
      e.preventDefault();
      (e.shiftKey ? m.redo() : m.undo()) && this.refresh();
    });

    for (const g of GROUPS) {
      const group = el('div', { class: 'group' }, [el('div', { class: 'group-title', text: g.title })]);
      g.zones.forEach((z) => group.append(this.buildZone(z)));
      this.root.append(group);
    }
    const scene = el('div', { class: 'group' }, [el('div', { class: 'group-title', text: 'Scene' })]);
    scene.append(this.buildBackground());
    this.root.append(scene);

    this.open('leather');
    this.refresh();
  }

  zoneShell(id, label, hint, focus) {
    const chip = el('span', { class: 'zone-chip' });
    const value = el('span', { class: 'zone-value' });
    const headBtn = el('button', { class: 'zone-head', 'aria-expanded': 'false' }, [
      chip,
      el('span', { class: 'zone-text' }, [el('strong', { text: label }), el('small', { text: hint })]),
      value,
      el('span', { class: 'chev' }),
    ]);
    headBtn.lastChild.innerHTML = ICONS.chevron;
    const body = el('div', { class: 'zone-body' });
    const section = el('section', { class: 'zone', 'data-zone': id }, [headBtn, el('div', { class: 'zone-collapse' }, [body])]);
    headBtn.addEventListener('click', () => this.open(this.openId === id ? null : id));
    if (focus != null) {
      section.addEventListener('mouseenter', () => this.onFocus?.(focus));
      section.addEventListener('mouseleave', () => this.onFocus?.(null));
    }
    this.zones.set(id, { section, headBtn });
    return { section, body, chip, value };
  }

  buildZone(z) {
    const m = this.materials;
    const label = CHANNELS[z.id].label;
    const { section, body, chip, value } = this.zoneShell(z.id, label, z.hint, z.focus);

    // For leather, swatches/picker target either the whole leather or one panel.
    const getHex = () => (z.panels && this.panelTarget ? m.config.panels[this.panelTarget] || m.config.leather : m.config[z.id]);
    const apply = (hex, commit) => {
      if (z.panels && this.panelTarget) m.setPanel(this.panelTarget, hex);
      else m.setColor(z.id, hex);
      if (commit) m.commit();
      this.refresh();
    };

    let panelBar = null;
    if (z.panels) panelBar = this.buildPanelBar();
    const grid = this.swatchGrid(z.presets, getHex, apply);
    const selName = el('div', { class: 'sel-name' });
    const custom = this.customArea(getHex, apply);
    body.append(...[panelBar?.node, grid.node, el('div', { class: 'sel-row' }, [selName, custom.toggle]), custom.area].filter(Boolean));

    this.sync.push(() => {
      const hex = m.config[z.id];
      chip.style.setProperty('--c', hex);
      const overrides = z.panels ? Object.keys(m.config.panels).length : 0;
      value.textContent = this.nameOf(hex) + (overrides ? ` +${overrides}` : '');
      const cur = getHex();
      selName.innerHTML = '';
      selName.append(el('span', { text: this.nameOf(cur) }), el('code', { text: cur }));
      grid.update();
      custom.update();
      panelBar?.update();
    });
    return section;
  }

  buildPanelBar() {
    const m = this.materials;
    const bar = el('div', { class: 'panel-bar' });
    const all = el('button', { class: 'pill', text: 'All leather' });
    all.addEventListener('click', () => { this.panelTarget = null; this.refresh(); });
    all.addEventListener('mouseenter', () => this.onFocus?.(0));
    bar.append(all);
    const pills = LEATHER_PANELS.map((p, i) => {
      const dot = el('span', { class: 'dot' });
      const relink = el('span', { class: 'relink', title: 'Link back to leather colour', role: 'button' });
      relink.innerHTML = ICONS.link;
      relink.addEventListener('click', (e) => {
        e.stopPropagation();
        m.setPanel(p.key, null);
        m.commit();
        if (this.panelTarget === p.key) this.panelTarget = null;
        this.refresh();
      });
      const b = el('button', { class: 'pill' }, [dot, el('span', { text: p.label }), relink]);
      b.addEventListener('click', () => { this.panelTarget = p.key; this.refresh(); });
      b.addEventListener('mouseenter', () => this.onFocus?.(10 + i));
      b.addEventListener('mouseleave', () => this.onFocus?.(0));
      bar.append(b);
      return { b, dot, relink, key: p.key };
    });
    const update = () => {
      all.classList.toggle('active', !this.panelTarget);
      pills.forEach(({ b, dot, relink, key }) => {
        const ov = m.config.panels[key];
        dot.style.setProperty('--c', ov || m.config.leather);
        b.classList.toggle('active', this.panelTarget === key);
        b.classList.toggle('overridden', !!ov);
        relink.hidden = !ov;
      });
    };
    return { node: el('div', { class: 'panel-target' }, [el('div', { class: 'mini-label', text: 'Apply to' }), bar]), update };
  }

  buildBackground() {
    const m = this.materials;
    const { section, body, chip, value } = this.zoneShell('background', 'Background', 'Preview and export backdrop', null);
    const modes = el('div', { class: 'segmented' });
    const opts = [
      ['Dark', () => m.setBackground('#111111', 'solid')],
      ['White', () => m.setBackground('#FFFFFF', 'solid')],
      ['Transparent', () => m.setBackground(m.config.background, 'transparent')],
    ];
    const btns = opts.map(([name, fn]) => {
      const b = el('button', { text: name });
      b.addEventListener('click', () => { fn(); m.commit(); this.refresh(); });
      modes.append(b);
      return [name, b];
    });
    const getHex = () => m.config.background;
    const apply = (hex, commit) => { m.setBackground(hex, 'solid'); if (commit) m.commit(); this.refresh(); };
    const grid = this.swatchGrid(BACKGROUND_PRESETS, getHex, apply);
    const custom = this.customArea(getHex, apply);
    body.append(modes, grid.node, el('div', { class: 'sel-row' }, [el('span'), custom.toggle]), custom.area);
    this.sync.push(() => {
      const c = m.config;
      const transparent = c.backgroundMode === 'transparent';
      chip.style.setProperty('--c', transparent ? 'transparent' : c.background);
      chip.classList.toggle('checker', transparent);
      value.textContent = transparent ? 'Transparent' : this.nameOf(c.background);
      btns.forEach(([name, b]) => b.classList.toggle('active',
        (name === 'Transparent' && transparent) ||
        (!transparent && ((name === 'Dark' && c.background === '#111111') || (name === 'White' && c.background === '#FFFFFF')))));
      grid.update();
      custom.update();
    });
    return section;
  }

  open(id) {
    this.openId = id;
    for (const [zid, { section, headBtn }] of this.zones) {
      const on = zid === id;
      section.classList.toggle('open', on);
      headBtn.setAttribute('aria-expanded', on);
    }
  }

  // ---------- summary strip (footer) ----------

  renderSummary() {
    if (!this.summaryRoot) return;
    const m = this.materials;
    const ids = ['leather', 'binding', 'laces', 'liner', 'swoosh', 'swooshBase', 'stitching', 'embroidery'];
    this.summaryRoot.replaceChildren(...ids.map((id) => {
      const b = el('button', { class: 'sum-chip', title: `${CHANNELS[id].label}: ${this.nameOf(m.config[id])} ${m.config[id]}`, style: `--c:${m.config[id]}` });
      b.addEventListener('click', () => {
        this.open(id);
        this.zones.get(id).section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      return b;
    }));
  }

  refresh() {
    this.sync.forEach((f) => f());
    this.renderSummary();
    if (this.undoBtn) {
      this.undoBtn.disabled = !this.materials.undoStack.length && JSON.stringify(this.materials.config) === JSON.stringify(this.materials.committed);
      this.redoBtn.disabled = !this.materials.redoStack.length;
    }
    this.onChange?.();
  }
}
