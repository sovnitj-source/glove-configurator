import { AssetLoader } from './renderer/AssetLoader.js';
import { ViewManager } from './renderer/ViewManager.js';
import { ModelViewer } from './renderer/ModelViewer.js';
import { ExportManager } from './renderer/ExportManager.js';
import { MaterialManager, CHANNELS, LEATHER_PANELS } from './materials/MaterialManager.js';
import { LightingController, LIGHTING_PARAMS } from './materials/LightingController.js';
import { ColorController } from './components/ColorController.js';
import { DebugPanel } from './components/DebugPanel.js';
import { ColorTestGrid } from './components/ColorTestGrid.js';
import { normalizeHex } from './utils/color.js';

// URL overrides, e.g. ?leather=C62828&laces=000&bg=transparent&camera=all&debug=1&grid=1&view=7
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
    const vm = new ViewManager(document.getElementById('frames'), document.getElementById('view-switcher'));
    await vm.init(new AssetLoader());

    const materials = new MaterialManager(vm.shared);
    const viewer = new ModelViewer(document.getElementById('viewer3d'), vm, materials);
    await viewer.init();
    vm.attachViewer(viewer);
    const lighting = new LightingController(vm.shared);

    const { cfg, q } = configFromUrl();
    materials.restore(cfg); // initial state = first undo baseline
    for (const k of Object.keys(LIGHTING_PARAMS)) if (q.has(k)) lighting.set(k, q.get(k));

    const stage = document.querySelector('.stage');
    const syncStage = () => stage.classList.toggle('transparent', materials.config.backgroundMode === 'transparent');

    const debug = new DebugPanel(document.getElementById('debug-body'), {
      gloveRenderer: vm.active, materials, lighting, manifest: vm.activeView.manifest, requestRender: () => vm.requestRender(),
    });
    const grid = new ColorTestGrid(document.getElementById('grid-body'), { gloveRenderer: vm.active, materials });
    const exporter = new ExportManager(vm, materials);
    vm.addEventListener('mode', () => {
      // Debug tools + colour test always act on the active (last single-selected) view.
      debug.setRenderer(vm.active, vm.activeView.manifest);
      grid.gr = vm.active;
      document.getElementById('export-label').textContent = vm.is3D ? 'Download 3D snapshot'
        : vm.mode === 'all' ? `Download all ${vm.views.length} views` : 'Download PNG';
    });

    new ColorController(document.getElementById('controls'), {
      materials,
      summaryRoot: document.getElementById('summary'),
      onChange: () => {
        syncStage();
        vm.requestRender();
        viewer.render();
        debug.refreshDiag();
      },
    });
    materials.addEventListener('change', (e) => {
      const { channel, hex } = e.detail;
      console.debug(`[glove] ${channel} -> ${hex} (uniform updated, no texture work)`);
    });

    // Header actions
    const drawer = document.getElementById('debug');
    document.getElementById('btn-debug').addEventListener('click', () => {
      drawer.hidden = !drawer.hidden;
      document.body.classList.toggle('debug-open', !drawer.hidden);
      if (!drawer.hidden) debug.refreshDiag();
    });
    document.getElementById('btn-debug-close').addEventListener('click', () => {
      drawer.hidden = true;
      document.body.classList.remove('debug-open');
    });
    const dialog = document.getElementById('grid-dialog');
    document.getElementById('btn-grid').addEventListener('click', () => { dialog.showModal(); grid.run(); });
    document.getElementById('btn-grid-close').addEventListener('click', () => dialog.close());
    document.getElementById('btn-export').addEventListener('click', () =>
      exporter.download({ transparent: document.getElementById('export-transparent').checked }));

    syncStage();
    vm.renderAll();
    status.remove();

    const camera = q.get('camera');
    if (camera && (camera === 'both' || camera === 'all' || vm.views.some((v) => v.id === camera))) vm.setMode(camera);
    if (q.get('3d') === '1') vm.set3D(true);
    if (q.has('view')) debug.setView(Number(q.get('view')));
    if (q.has('debug')) document.getElementById('btn-debug').click();
    if (q.has('grid')) document.getElementById('btn-grid').click();

    console.info('[glove] ready', vm.views.map((v) => ({
      view: v.id,
      canvas: `${v.width}x${v.height}`,
      levels: v.manifest.levels,
      prepassMs: +v.gr.layers.buildMs.toFixed(1),
      lightTarget: v.gr.layers.lightType === 1016 ? 'half-float' : '8-bit',
    })));
    debug.logPipeline();

    // Automation / QA hook
    window.glove = { vm, viewer, get gr() { return vm.active; }, materials, lighting, debug, grid, exporter };
    document.body.dataset.ready = '1';
  } catch (err) {
    console.error(err);
    status.textContent = `Failed to start renderer: ${err.message}`;
    status.classList.add('error');
    if (location.protocol === 'file:') status.textContent += ' — serve the folder over http (see README).';
  }
}

main();
