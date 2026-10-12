import * as THREE from 'three';
import { fullscreenVert } from '../shaders/common.glsl.js';
import { compositeFrag, VIEW } from '../shaders/composite.glsl.js';
import { LayerManager, MASK_LAYOUT } from './LayerManager.js';
import { hueSat } from '../utils/color.js';

// One WebGL renderer, one scene, one camera, one full-screen quad. The composite shader does
// all material work on the GPU; colour changes only update uniforms and re-draw once.
export function createSharedUniforms() {
  return {
    uLeatherColor: { value: new THREE.Color() },
    uPanelOverride: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
    uBindingColor: { value: new THREE.Color() },
    uLaceColor: { value: new THREE.Color() },
    uLinerColor: { value: new THREE.Color() },
    uSwooshColor: { value: new THREE.Color() },
    uStitchColor: { value: new THREE.Color() },
    uEmbroideryColor: { value: new THREE.Color() },
    uSwooshBaseColor: { value: new THREE.Color() },
    uLighting: { value: 1 },
    uShadow: { value: 1 },
    uHighlight: { value: 1 },
    uAO: { value: 0.35 },
    uRoughness: { value: 0.6 },
    uGrain: { value: 0.3 },
    uDyeSaturation: { value: 0.95 },
    uPebble: { value: 0.6 },
    uBgColor: { value: new THREE.Color(0x111111) },
    uBgMode: { value: 1 },
    uView: { value: VIEW.FINAL },
    uFocus: { value: -1 },
    uFocusAmt: { value: 0 },
  };
}

export class GloveRenderer {
  constructor(canvas, width, height, shared = createSharedUniforms()) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: true, // export + pixel readback
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false); // drawing buffer = native asset size, CSS scales it
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = true;

    // Shared uniform objects (colours, lighting, background, debug view, focus) are the same JS
    // objects in every view's renderer, so one MaterialManager update recolours all views.
    // Everything per-view (textures, levels, exposure) is owned here.
    this.uniforms = {
      ...shared,
      uMask0: { value: null },
      uMask1: { value: null },
      uMask2: { value: null },
      uMask3: { value: null },
      uShadowMap: { value: null },
      uLight: { value: null },
      uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
      uLevels: { value: new THREE.Vector3(0, 1, 1) },
      uEmbParent: { value: 0 },
      uExpLeather: { value: 1 },
      uExpLiner: { value: 1 },
      uExpStitch: { value: 1 },
      uExpSwooshBase: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: compositeFrag,
      uniforms: this.uniforms,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);

    this.layers = new LayerManager(this.renderer, width, height);
    this.readTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.UnsignedByteType, depthBuffer: false, colorSpace: THREE.NoColorSpace,
    });
    this.pending = false;
    this.frameCount = 0;
    this.lastRenderMs = 0;
  }

  // view = { manifest, masks, shadow } from AssetLoader.loadView()
  build({ manifest, masks, shadow }) {
    this.manifest = manifest;
    const lv = manifest.levels || { black: 0, white: 1, gamma: 1 };
    this.uniforms.uLevels.value.set(lv.black, lv.white, lv.gamma);
    this.uniforms.uEmbParent.value = manifest.derived?.Embroidery?.parent === 'Palm' ? 3 : 0;
    const e = manifest.exposure || {};
    this.uniforms.uExpLeather.value = e.leather ?? 1;
    this.uniforms.uExpLiner.value = e.liner ?? 1;
    this.uniforms.uExpStitch.value = e.stitching ?? 1;
    this.uniforms.uExpSwooshBase.value = e.swooshBase ?? 1;
    const { maskTextures, lightTexture, shadowTexture } = this.layers.build({ masks, shadow, levels: this.uniforms.uLevels.value });
    this.uniforms.uMask0.value = maskTextures[0];
    this.uniforms.uMask1.value = maskTextures[1];
    this.uniforms.uMask2.value = maskTextures[2];
    this.uniforms.uMask3.value = maskTextures[3];
    this.uniforms.uLight.value = lightTexture;
    this.uniforms.uShadowMap.value = shadowTexture;
    this.collectMaskData();
  }

  setView(view) {
    this.uniforms.uView.value = view;
    this.requestRender();
  }

  // Coalesce any number of uniform changes in one frame into a single draw.
  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  render() {
    const t = performance.now();
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
    this.lastRenderMs = performance.now() - t;
    this.frameCount++;
  }

  // Render with temporary uniform overrides into the 8-bit read target and return RGBA bytes
  // (bottom-up rows, same orientation as the mask readback).
  renderToPixels(overrides = {}) {
    overrides = { uFocusAmt: 0, ...overrides };
    const saved = {};
    for (const [k, v] of Object.entries(overrides)) {
      saved[k] = this.uniforms[k].value;
      this.uniforms[k].value = v;
    }
    this.renderer.setRenderTarget(this.readTarget);
    this.renderer.render(this.scene, this.camera);
    const buf = new Uint8Array(this.width * this.height * 4);
    this.renderer.readRenderTargetPixels(this.readTarget, 0, 0, this.width, this.height, buf);
    this.renderer.setRenderTarget(null);
    for (const [k, v] of Object.entries(saved)) this.uniforms[k].value = v;
    return buf;
  }

  readTargetPixels(rt) {
    const buf = new Uint8Array(this.width * this.height * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, this.width, this.height, buf);
    return buf;
  }

  // One-time CPU readback of the packed masks for diagnostics + QA sampling.
  collectMaskData() {
    const n = this.width * this.height;
    const coverage = {};
    const packed = this.layers.maskTargets.map((rt) => this.readTargetPixels(rt));
    MASK_LAYOUT.forEach((names, t) => {
      names.forEach((name, c) => {
        if (!name || !this.layers.present.includes(name)) return;
        let px = 0;
        let sum = 0;
        const buf = packed[t];
        for (let i = 0; i < n; i++) {
          const v = buf[i * 4 + c];
          if (v > 0) px++;
          sum += v;
        }
        coverage[name] = { px, pct: +((100 * px) / n).toFixed(2), weightedPx: Math.round(sum / 255) };
      });
    });
    // Pure-leather pixels (all leather panels, minus embroidery) used to measure rendered hue.
    const leatherIdx = [];
    const [p0, p1, p2] = packed;
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      const leather = p0[j] + p0[j + 1] + p0[j + 2] + p0[j + 3] + p1[j] + p1[j + 1] - p2[j + 3];
      if (leather >= 250) leatherIdx.push(i);
    }
    this.maskCoverage = coverage;
    this.leatherIndices = Uint32Array.from(leatherIdx);
  }

  lightmapStats() {
    const buf = this.renderToPixels({ uView: VIEW.LIGHTMAP, uBgMode: 0 });
    let min = 255, max = 0, sum = 0, cnt = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const a = buf[i + 3];
      if (a < 250) continue;
      const v = buf[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      cnt++;
    }
    const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return {
      sRGB: { min, max, mean: +(sum / cnt).toFixed(1) },
      linear: { min: +lin(min).toFixed(4), max: +lin(max).toFixed(4) },
      samplesInsideGlove: cnt,
    };
  }

  // Mean colour / hue of rendered pure-leather pixels. Used for the pipeline self-check and
  // the colour-test grid: proves the selected colour (not the mask RGB) drives the output.
  measureLeather(buf) {
    let r = 0, g = 0, b = 0, cnt = 0, hueX = 0, hueY = 0, satSum = 0, hueN = 0;
    const idx = this.leatherIndices;
    for (let k = 0; k < idx.length; k += 3) {
      const j = idx[k] * 4;
      const a = buf[j + 3] / 255 || 1;
      const px = [buf[j] / 255 / a, buf[j + 1] / 255 / a, buf[j + 2] / 255 / a];
      r += px[0]; g += px[1]; b += px[2]; cnt++;
      const hs = hueSat(px);
      if (hs.val > 0.08 && hs.sat > 0.08) {
        hueX += Math.cos((hs.hue * Math.PI) / 180) * hs.sat;
        hueY += Math.sin((hs.hue * Math.PI) / 180) * hs.sat;
        hueN++;
      }
      satSum += hs.sat;
    }
    const mean = [r / cnt, g / cnt, b / cnt];
    let hue = (Math.atan2(hueY, hueX) * 180) / Math.PI;
    if (hue < 0) hue += 360;
    return { mean, hue: hueN ? hue : null, meanSat: satSum / cnt, samples: cnt };
  }
}
