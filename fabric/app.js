// Fabric.js version of the glove configurator. Shares the colour UI, presets, history and
// shading model with the Three.js version; rendering is a Fabric.js canvas + custom filter.
import { Color, Vector4 } from './three-shim.js';
import { FabricStage } from './FabricStage.js';
import { MaterialManager, CHANNELS, LEATHER_PANELS } from '../src/materials/MaterialManager.js';
import { LIGHTING_PARAMS } from '../src/materials/LightingController.js';
import { ColorController } from '../src/components/ColorController.js';
import { normalizeHex } from '../src/utils/color.js';

function createSharedUniforms() {
  const u = {
    uLeatherColor: { value: new Color() },
    uPanelOverride: { value: Array.from({ length: 6 }, () => new Vector4()) },
    uBindingColor: { value: new Color() },
    uLaceColor: { value: new Color() },
    uLinerColor: { value: new Color() },
    uSwooshColor: { value: new Color() },
    uStitchColor: { value: new Color() },
    uEmbroideryColor: { value: new Color() },
    uSwooshBaseColor: { value: new Color() },
    uBgColor: { value: new Color('#111111') },
    uBgMode: { value: 1 },
  };
  for (const p of Object.values(LIGHTING_PARAMS)) u[p.uniform] = { value: p.default };
  return u;
}

// Same URL parameters as the Three.js version (?leather=C62828&laces=000&camera=all&bg=transparent).
function configFromUrl() {
  const q = new URLSearchParams(location.search);
  const cfg = { panels: {} };
  for (const k of Object.keys(CHANNELS)) {
    const h = normalizeHex(q.get(k) || '');
    if (h) cfg[k] = h;
  }
  for (const p of LEATHER_PANELS) {
    const h = normalizeHex(q.get(p.key) || '');
    if (h) cfg.panels[p.key] = h;
  }
  const bg = q.get('bg');
  if (bg === 'transparent') cfg.backgroundMode = 'transparent';
  else if (normalizeHex(bg || '')) { cfg.background = normalizeHex(bg); cfg.backgroundMode = 'solid'; }
  return { cfg, q };
}

async function main() {
  const status = document.getElementById('status');
  try {
    const shared = createSharedUniforms();
    const materials = new MaterialManager(shared);
    const { cfg, q } = configFromUrl();
    materials.restore(cfg);

    const stage = new FabricStage(document.getElementById('fabric-host'), document.getElementById('view-switcher'), shared, materials);
    await stage.init();

    const stageEl = document.querySelector('.stage');
    const syncStage = () => stageEl.classList.toggle('transparent', materials.config.backgroundMode === 'transparent');
    new ColorController(document.getElementById('controls'), {
      materials,
      summaryRoot: document.getElementById('summary'),
      onChange: () => { syncStage(); stage.render(); },
    });
    stage.addEventListener('mode', () => {
      document.getElementById('export-label').textContent = stage.mode === 'all' ? `Download all ${stage.views.length} views` : 'Download PNG';
    });

    document.getElementById('btn-export').addEventListener('click', async () => {
      const transparent = document.getElementById('export-transparent').checked;
      const blob = await stage.toBlob({ transparent });
      const c = materials.config;
      const view = stage.mode === 'all' ? 'all-views' : stage.activeId;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `glove_${view}_${c.leather.slice(1)}_${c.laces.slice(1)}${transparent ? '_transparent' : ''}.png`.toLowerCase();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    const camera = q.get('camera');
    if (camera === 'all' || camera === 'both') stage.setMode('all');
    else if (stage.views.some((v) => v.id === camera)) stage.setMode(camera);

    syncStage();
    stage.render();
    status.remove();
    window.glove = { stage, materials, shared, engine: 'fabric' };
    requestAnimationFrame(() => requestAnimationFrame(() => { document.body.dataset.ready = '1'; }));
    console.info('[glove] Fabric.js renderer ready', stage.views.map((v) => `${v.id} ${v.width}x${v.height}`));
  } catch (err) {
    console.error(err);
    status.textContent = `Failed to start renderer: ${err.message}`;
    status.classList.add('error');
  }
}

main();
