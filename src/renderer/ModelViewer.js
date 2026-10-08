import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { colorSpaceFns } from '../shaders/common.glsl.js';

// 360° viewer for the AI-reconstructed glove mesh (src/assets/model, built by
// tools/build_model.py from the Hunyuan3D-2mv reconstruction; see RESEARCH_3D.md).
//
// Shading per fragment:
//   - Where the back photo's camera sees the surface, the live recoloured BACK render is
//     projected onto the mesh (exact photo detail + current colours). Visibility comes from
//     a depth pre-pass rendered from that camera.
//   - Everywhere else the panel colour (per-vertex label from the back masks, propagated to
//     unseen areas) is lit with a simple leather material.
// Accuracy: the back side matches the photo; side/palm geometry is AI-estimated.

const LABEL_GLSL = /* glsl */ `
uniform vec3 uLeatherColor;
uniform vec4 uPanelOverride[6];
uniform vec3 uBindingColor;
uniform vec3 uLaceColor;
uniform vec3 uLinerColor;
uniform vec3 uSwooshColor;
uniform vec3 uStitchColor;
uniform vec3 uEmbroideryColor;
uniform vec3 uSwooshBaseColor;
// Labels: 0 Base 1 BOH 2 Fingers 3 Palm 4 Web 5 Welting 6 Binding 7 Laces 8 Liner
//         9 Swoosh 10 Stitching 11 Swoosh Base 12 Embroidery
vec3 labelColor(int l) {
  if (l <= 5) { vec4 o = uPanelOverride[l]; return mix(uLeatherColor, o.rgb, o.w); }
  if (l == 6) return uBindingColor;
  if (l == 7) return uLaceColor;
  if (l == 8) return uLinerColor;
  if (l == 9) return uSwooshColor;
  if (l == 10) return uStitchColor;
  if (l == 11) return uSwooshBaseColor;
  return uEmbroideryColor;
}
bool inFocus(int l, int f) {
  if (f == 0) return l <= 5;
  if (f == 1) return l == 6;
  if (f == 2) return l == 7;
  if (f == 3) return l == 8;
  if (f == 4) return l == 9;
  if (f == 5) return l == 10;
  if (f == 6) return l == 12;
  if (f == 7) return l == 11;
  if (f >= 10) return l == f - 10;
  return true;
}
`;

const PROJECT_GLSL = /* glsl */ `
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uScale;
uniform vec2 uOffset;
uniform vec2 uCanvas;
uniform vec2 uFRange;
// mesh-space point -> (back canvas uv, normalised depth toward the back camera)
vec3 backProject(vec3 p) {
  float px = uScale * dot(p, uRight) + uOffset.x;
  float py = uScale * -dot(p, uUp) + uOffset.y;
  float d = (dot(p, uFwd) - uFRange.x) / (uFRange.y - uFRange.x);
  return vec3(px / uCanvas.x, 1.0 - py / uCanvas.y, d);
}
`;

const depthVert = /* glsl */ `
${PROJECT_GLSL}
varying float vDepth;
void main() {
  vec3 b = backProject(position);
  vDepth = b.z;
  gl_Position = vec4(b.xy * 2.0 - 1.0, (1.0 - b.z) * 2.0 - 1.0, 1.0);
}
`;
const depthFrag = /* glsl */ `
varying float vDepth;
void main() { gl_FragColor = vec4(vDepth, 0.0, 0.0, 1.0); }
`;

const vert = /* glsl */ `
attribute vec4 color;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vViewNormal;
varying vec3 vViewPos;
varying float vLabel;
varying float vSeen;
void main() {
  vPos = position;
  vNormal = normalize(normal);
  vViewNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vLabel = color.r * 255.0;
  vSeen = color.g;
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */ `
${colorSpaceFns}
${LABEL_GLSL}
${PROJECT_GLSL}
uniform sampler2D uBackTex;     // live back-view render (sRGB, straight alpha)
uniform sampler2D uBackDepth;   // depth from the back camera
uniform float uPhoto;           // 0..1 photo projection strength
uniform int uFocus;
uniform float uFocusAmt;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vViewNormal;
varying vec3 vViewPos;
varying float vLabel;
varying float vSeen;

void main() {
  int label = int(floor(vLabel + 0.5));
  vec3 n = normalize(vNormal);
  vec3 vn = normalize(vViewNormal);
  if (!gl_FrontFacing) { n = -n; vn = -vn; }
  vec3 V = normalize(-vViewPos);

  // Leather material for everything the photo can't cover: headlight-ish key + fill + hemi.
  vec3 albedo = labelColor(label);
  vec3 L1 = normalize(vec3(0.35, 0.55, 0.75));
  vec3 L2 = normalize(vec3(-0.6, 0.1, 0.4));
  float diff = max(dot(vn, L1), 0.0) * 0.85 + max(dot(vn, L2), 0.0) * 0.25;
  float hemi = 0.5 + 0.5 * vn.y;
  float ambient = mix(0.10, 0.22, hemi);
  vec3 H = normalize(L1 + V);
  float spec = pow(max(dot(vn, H), 0.0), 24.0) * 0.06;
  float rim = pow(1.0 - max(dot(vn, V), 0.0), 3.0) * 0.05;
  vec3 lit = albedo * (ambient + diff * 0.75) + vec3(spec + rim);

  // Projected back photo where the back camera sees this surface.
  vec3 b = backProject(vPos);
  float inside = step(0.0, b.x) * step(b.x, 1.0) * step(0.0, b.y) * step(b.y, 1.0);
  float stored = texture2D(uBackDepth, b.xy).r;
  float visible = 1.0 - smoothstep(0.012, 0.03, stored - b.z);   // nearest surface only
  float facing = smoothstep(0.3, 0.6, dot(n, uFwd));
  vec4 photo = texture2D(uBackTex, b.xy);
  float w = inside * visible * facing * smoothstep(0.3, 0.8, photo.a) * uPhoto;
  vec3 col = mix(lit, vec3(srgbToLinear(photo.r), srgbToLinear(photo.g), srgbToLinear(photo.b)), w);

  if (uFocus >= 0 && uFocusAmt > 0.0 && !inFocus(label, uFocus)) {
    col = mix(col, vec3(luma(col)) * 0.22, uFocusAmt);
  }
  gl_FragColor = vec4(linearToSrgb(col), 1.0);
}
`;

export class ModelViewer extends EventTarget {
  constructor(container, viewManager, materials) {
    super();
    this.container = container;
    this.vm = viewManager;
    this.materials = materials;
    this.enabled = false;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewer3d-canvas';
    this.hint = document.createElement('div');
    this.hint.className = 'viewer3d-hint';
    this.hint.textContent = 'Drag to rotate 360° · scroll to zoom · double-click to reset';
    this.badge = document.createElement('div');
    this.badge.className = 'viewer3d-badge';
    this.badge.textContent = 'AI-reconstructed 3D · back side matches the photo, other sides approximate';
    this.container.append(this.canvas, this.hint, this.badge);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.0;
    this.controls.maxDistance = 4.5;
    this.controls.addEventListener('change', () => this.render());
    this.controls.addEventListener('start', () => this.hint.classList.add('hidden'));
    this.canvas.addEventListener('dblclick', () => this.goTo('back'));
    new ResizeObserver(() => this.resize()).observe(this.container);
  }

  async init() {
    const base = new URL('../assets/model/', import.meta.url);
    const [model, gltf] = await Promise.all([
      fetch(new URL('model.json', base)).then((r) => r.json()),
      new GLTFLoader().loadAsync(new URL('glove.glb', base).href),
    ]);
    this.model = model;
    let geometry = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !geometry) geometry = o.geometry; });
    if (!geometry.attributes.normal) geometry.computeVertexNormals();

    const cam = model.backCamera;
    const back = this.vm.views.find((v) => v.id === 'back');
    this.backTexture = new THREE.CanvasTexture(back.canvas);
    this.backTexture.colorSpace = THREE.NoColorSpace;
    this.backTexture.premultiplyAlpha = false;
    this.backTexture.minFilter = THREE.LinearFilter;
    this.backTexture.generateMipmaps = false;

    const proj = {
      uRight: { value: new THREE.Vector3(...cam.right) },
      uUp: { value: new THREE.Vector3(...cam.up) },
      uFwd: { value: new THREE.Vector3(...cam.forward) },
      uScale: { value: cam.scale },
      uOffset: { value: new THREE.Vector2(...cam.offset) },
      uCanvas: { value: new THREE.Vector2(...cam.canvas) },
      uFRange: { value: new THREE.Vector2(...cam.forwardRange) },
    };

    // Depth pre-pass from the back camera (static geometry: rendered once).
    const [cw, ch] = cam.canvas;
    this.depthTarget = new THREE.WebGLRenderTarget(cw, ch, { type: THREE.HalfFloatType, depthBuffer: true });
    const depthScene = new THREE.Scene();
    depthScene.add(new THREE.Mesh(geometry, new THREE.ShaderMaterial({ vertexShader: depthVert, fragmentShader: depthFrag, uniforms: proj, side: THREE.DoubleSide })));
    this.renderer.setRenderTarget(this.depthTarget);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(depthScene, this.camera);
    this.renderer.setRenderTarget(null);

    const s = this.vm.shared;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.DoubleSide,
      uniforms: {
        ...proj,
        uBackTex: { value: this.backTexture },
        uBackDepth: { value: this.depthTarget.texture },
        uPhoto: { value: 1 },
        uLeatherColor: s.uLeatherColor,
        uPanelOverride: s.uPanelOverride,
        uBindingColor: s.uBindingColor,
        uLaceColor: s.uLaceColor,
        uLinerColor: s.uLinerColor,
        uSwooshColor: s.uSwooshColor,
        uStitchColor: s.uStitchColor,
        uEmbroideryColor: s.uEmbroideryColor,
        uSwooshBaseColor: s.uSwooshBaseColor,
        uFocus: s.uFocus,
        uFocusAmt: s.uFocusAmt,
      },
    });
    this.scene.add(new THREE.Mesh(geometry, this.material));

    // Camera presets: back = the photo's camera; side = thumb side (+right); palm = opposite.
    const f = new THREE.Vector3(...cam.forward);
    const r = new THREE.Vector3(...cam.right);
    this.up = new THREE.Vector3(...cam.up);
    this.presets = { back: f.clone(), side: r.clone(), palm: f.clone().negate() };
    this.camera.up.copy(this.up);
    this.camera.position.copy(f).multiplyScalar(2.1);
    this.controls.update();
    this.vm.addEventListener('rendered', () => this.enabled && this.refresh());
  }

  goTo(id) {
    const dir = this.presets?.[id];
    if (!dir) return;
    const from = this.camera.position.clone();
    const dist = 2.1;
    const to = dir.clone().normalize().multiplyScalar(dist);
    const t0 = performance.now();
    cancelAnimationFrame(this.tween);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 700);
      const e = 1 - Math.pow(1 - t, 3);
      // spherical interpolation keeps the camera on the orbit
      const len = from.length() + (dist - from.length()) * e;
      this.camera.position.copy(from.clone().normalize().lerp(to.clone().normalize(), e).normalize().multiplyScalar(len));
      this.controls.update();
      this.render();
      if (t < 1) this.tween = requestAnimationFrame(step);
    };
    this.tween = requestAnimationFrame(step);
  }

  nearest() {
    const d = this.camera.position.clone().normalize();
    let best = 'back';
    let bestDot = -2;
    for (const [id, v] of Object.entries(this.presets || {})) {
      const dot = d.dot(v.clone().normalize());
      if (dot > bestDot) { bestDot = dot; best = id; }
    }
    return best;
  }

  setEnabled(on) {
    this.enabled = on;
    this.container.hidden = !on;
    if (on) {
      this.hint.classList.remove('hidden');
      this.resize();
      this.refresh();
    }
  }

  refresh() {
    if (!this.backTexture) return;
    this.backTexture.needsUpdate = true;
    this.render();
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render({ transparent } = {}) {
    if (!this.enabled || !this.material) return;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw({ transparent });
    });
  }

  draw({ transparent } = {}) {
    const cfg = this.materials.config;
    if (transparent || cfg.backgroundMode === 'transparent') this.renderer.setClearColor(0x000000, 0);
    else this.renderer.setClearColor(new THREE.Color(cfg.background), 1);
    if (this.controls.update()) this.render(); // keep damping going
    this.renderer.render(this.scene, this.camera);
    this.dispatchEvent(new CustomEvent('orbit', { detail: { nearest: this.nearest() } }));
  }

  toBlob({ transparent }) {
    this.draw({ transparent });
    return new Promise((res) => this.canvas.toBlob((b) => { this.draw(); res(b); }, 'image/png'));
  }
}
