// Automated visual QA: renders the glove in the validation colours, all debug views, the
// colour-test grid and the UI at desktop + mobile sizes. Output -> qa/
//   npm run qa
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = new URL('../qa/', import.meta.url);
const PORT = 5199;
await mkdir(out, { recursive: true });

const server = spawn(process.execPath, ['tools/serve.mjs', String(PORT)], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = { errors: [], colors: [], views: [], grid: null };

async function open(page, query = '') {
  page.on('console', (m) => m.type() === 'error' && report.errors.push(m.text()));
  page.on('pageerror', (e) => report.errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/${query}`);
  await page.waitForSelector('body[data-ready="1"]', { timeout: 20000 });
}

const savePng = (name, dataUrl) => writeFile(new URL(name, out), Buffer.from(dataUrl.split(',')[1], 'base64'));

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await open(page);

  // 1. Validation colours: leather + binding change, laces / branding stay independent.
  const VALIDATION = [
    ['red', '#C62828'], ['blue', '#1D4FA8'], ['green', '#2E7D32'], ['black', '#000000'],
    ['tan', '#C68E4E'], ['white', '#F2F0EB'], ['navy', '#123B75'], ['yellow', '#F2C200'],
  ];
  for (const [name, hex] of VALIDATION) {
    const res = await page.evaluate(({ hex }) => {
      const { gr, materials, debug } = window.glove;
      materials.setColor('leather', hex);
      materials.setColor('binding', '#141414');
      materials.setColor('laces', hex === '#000000' ? '#C68E4E' : '#141414');
      materials.setBackground('#111111', 'transparent');
      gr.uniforms.uView.value = 0;
      const pngs = {};
      const checks = {};
      for (const v of window.glove.vm.views) {
        window.glove.vm.setMode(v.id);
        v.gr.render();
        pngs[v.id] = v.gr.canvas.toDataURL('image/png');
        checks[v.id] = debug.runPipelineCheck();
      }
      window.glove.vm.setMode(window.glove.vm.views[0].id);
      return { pngs, checks };
    }, { hex });
    for (const [view, png] of Object.entries(res.pngs)) {
      await savePng(`leather_${name}_${view}.png`, png);
      report.colors.push({ name: `${name} (${view})`, hex, ...res.checks[view] });
    }
  }

  // Spec example: navy leather, white swoosh, red stitching, black binding + laces on dark bg.
  const combo = await page.evaluate(() => {
    const { gr, materials } = window.glove;
    materials.init({ leather: '#123B75', binding: '#141414', laces: '#141414', swoosh: '#F7F7F5', stitching: '#C62828', embroidery: '#F7F7F5', liner: '#B3191F', background: '#111111', backgroundMode: 'solid' });
    gr.render();
    return gr.canvas.toDataURL('image/png');
  });
  await savePng('combo_navy_white_red.png', combo);
  const comboSide = await page.evaluate(() => {
    const v = window.glove.vm.views.find((x) => x.id === 'side');
    v.gr.render();
    return v.gr.canvas.toDataURL('image/png');
  });
  await savePng('combo_navy_white_red_side.png', comboSide);

  // 2. Debug views.
  const VIEWS = ['FINAL', 'BASE_MASK', 'LEATHER_MASK', 'BINDING_MASK', 'LACE_MASK', 'LINER_MASK', 'BRANDING_MASK', 'LIGHTMAP', 'SHADOW', 'HIGHLIGHTS', 'FINAL_LEATHER', 'MATERIAL_IDS'];
  for (const v of VIEWS) {
    const png = await page.evaluate((v) => {
      const { gr, materials } = window.glove;
      materials.init({ leather: '#B3191F', binding: '#141414', laces: '#141414', background: '#111111', backgroundMode: 'solid' });
      return import('./src/shaders/composite.glsl.js').then(({ VIEW }) => {
        gr.uniforms.uView.value = VIEW[v];
        gr.render();
        const d = gr.canvas.toDataURL('image/png');
        gr.uniforms.uView.value = 0;
        return d;
      });
    }, v);
    await savePng(`view_${v.toLowerCase()}.png`, png);
    report.views.push(v);
  }

  // 3. Colour-test grid.
  await page.evaluate(() => window.glove.materials.init({}));
  await page.click('#btn-grid');
  await page.waitForTimeout(300);
  report.grid = await page.evaluate(() => window.glove.grid.run());
  await page.locator('dialog').screenshot({ path: fileURLToPath(new URL('color_test_grid.png', out)) });
  await page.click('#btn-grid-close');

  // 4. PNG export: transparent background must stay transparent, glove opaque.
  report.export = await page.evaluate(async () => {
    const { exporter, materials } = window.glove;
    materials.init({ leather: '#C62828' });
    const check = async (transparent) => {
      const blob = await exporter.toBlob({ transparent });
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const corner = ctx.getImageData(2, 2, 1, 1).data;
      const glove = ctx.getImageData(250, 300, 1, 1).data;
      return { size: [bmp.width, bmp.height], bytes: blob.size, cornerRGBA: [...corner], gloveRGBA: [...glove] };
    };
    const single = { transparent: await check(true), solid: await check(false) };
    window.glove.vm.setMode("all");
    const both = await exporter.toBlob({ transparent: false });
    const bb = await createImageBitmap(both);
    window.glove.vm.setMode(window.glove.vm.views[0].id);
    return { ...single, both: { size: [bb.width, bb.height], bytes: both.size } };
  });
  console.log('export', JSON.stringify(report.export));

  // 5. 360° 3D view (AI-reconstructed mesh): photographed back angle + generated angles.
  await page.evaluate(() => { window.glove.materials.init({ leather: '#B3191F', laces: '#141414', binding: '#141414', embroidery: '#F7F7F5', stitching: '#F7F7F5' }); window.glove.vm.set3D(true); });
  await page.waitForTimeout(1500);
  report.views3d = [];
  for (const deg of [0, 45, 90, 135, 180, 270]) {
    await page.evaluate((deg) => {
      const v = window.glove.viewer; const f = v.presets.back.clone().normalize(); const r = v.presets.side.clone().normalize();
      const a = (deg * Math.PI) / 180;
      v.camera.position.copy(f.multiplyScalar(Math.cos(a)).add(r.multiplyScalar(Math.sin(a))).normalize().multiplyScalar(2.1));
      v.controls.update(); v.draw();
    }, deg);
    await page.waitForTimeout(300);
    await page.locator('#viewer3d').screenshot({ path: fileURLToPath(new URL(`view3d_${deg}.png`, out)) });
    report.views3d.push(deg);
  }
  await page.screenshot({ path: fileURLToPath(new URL('ui_desktop_3d.png', out)) });
  await page.evaluate(() => window.glove.vm.set3D(false));

  // 6. UI screenshots.
  await page.evaluate(() => { window.glove.materials.init({ leather: '#B3191F', laces: '#141414', binding: '#141414', swoosh: '#F7F7F5', stitching: '#141414', embroidery: '#F7F7F5' }); window.glove.gr.render(); });
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]');
  await page.screenshot({ path: fileURLToPath(new URL('ui_desktop.png', out)) });
  await page.click('.view-btn:has-text("All")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: fileURLToPath(new URL('ui_desktop_all.png', out)) });
  await page.click('.view-btn:has-text("Back")');
  await page.click('#btn-debug');
  await page.waitForTimeout(200);
  await page.screenshot({ path: fileURLToPath(new URL('ui_desktop_debug.png', out)) });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await open(mobile, '?leather=1D4FA8&laces=F2F0EB&binding=F2F0EB&camera=all');
  await mobile.screenshot({ path: fileURLToPath(new URL('ui_mobile.png', out)), fullPage: false });
} finally {
  await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
  await browser.close();
  server.kill();
}

console.log(`errors: ${report.errors.length}`);
report.errors.forEach((e) => console.log('  ' + e));
console.table(report.colors.map(({ name, selectedColor, renderedLeatherMean, selectedHue, renderedHue, renderedMeanSaturation, verdict }) =>
  ({ name, selectedColor, renderedLeatherMean, selectedHue, renderedHue, sat: renderedMeanSaturation, verdict })));
if (report.grid) console.log(`grid: ${report.grid.filter((r) => r.pass).length}/${report.grid.length} passed`);
