import * as THREE from 'three';
import { fullscreenVert } from '../shaders/common.glsl.js';
import { packMasksFrag, prepLightFrag, blurFrag, morphFrag, combineLightFrag } from '../shaders/prepass.glsl.js';

// Mask packing layout (semantic keys): 4 RGBA targets x 4 channels.
// Must match the uMask0..3 documentation in composite.glsl.js. Slots a view doesn't have
// (null, or a key missing from that view) are filled from an empty texture.
export const MASK_LAYOUT = [
  ['Base', 'BOH', 'Fingers', 'Palm'],
  ['Web', 'Welting', 'Binding', 'Laces'],
  ['Palm Liner', 'Swoosh', 'Swoosh Stitching', 'Embroidery'],
  ['Swoosh Base', null, null, null],
];

const EMPTY = new THREE.DataTexture(new Uint8Array(4), 1, 1);
EMPTY.needsUpdate = true;

const BLUR_SMALL_SIGMA = 2.5;
const BLUR_LARGE_SIGMA = 12.0;

// Owns the one-time GPU pre-processing: mask packing and lighting-map derivation.
// After build() the source textures are reduced to 4 GPU textures that the composite
// shader samples. Nothing here runs when a colour changes.
export class LayerManager {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this.width = width;
    this.height = height;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const gl = renderer.getContext();
    const floatOk = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.lightType = floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.maxTextureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
  }

  target(type = THREE.UnsignedByteType) {
    return new THREE.WebGLRenderTarget(this.width, this.height, {
      type,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      colorSpace: THREE.NoColorSpace,
    });
  }

  pass(fragmentShader, uniforms, target) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader,
      uniforms,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    mat.dispose();
  }

  // masks: { semanticKey: texture }, shadow: lightmap texture, levels: THREE.Vector3
  build({ masks, shadow, levels }) {
    const t0 = performance.now();
    for (const k of ['Base', 'Laces']) if (!masks[k]) throw new Error(`Missing required mask: ${k}`);
    this.present = MASK_LAYOUT.flat().filter((k) => k && masks[k]);
    // 1. Pack mask alpha channels.
    this.maskTargets = MASK_LAYOUT.map((names) => {
      const rt = this.target();
      const tex = (n) => (n && masks[n]) || EMPTY;
      this.pass(packMasksFrag, {
        uA: { value: tex(names[0]) },
        uB: { value: tex(names[1]) },
        uC: { value: tex(names[2]) },
        uD: { value: tex(names[3]) },
      }, rt);
      return rt;
    });

    // 2. Lighting maps derived from the original shadow photo RGB (after view levels).
    const prep = this.target(this.lightType);
    this.pass(prepLightFrag, {
      uShadow: { value: shadow },
      uMask0: { value: this.maskTargets[0].texture },
      uMask1: { value: this.maskTargets[1].texture },
      uMask2: { value: this.maskTargets[2].texture },
      uMask3: { value: this.maskTargets[3].texture },
      uLevels: { value: levels },
    }, prep);

    const tmp = this.target(this.lightType);
    const blur = (sigma) => {
      const out = this.target(this.lightType);
      this.pass(blurFrag, { uSrc: { value: prep.texture }, uStep: { value: new THREE.Vector2(1 / this.width, 0) }, uSigma: { value: sigma } }, tmp);
      this.pass(blurFrag, { uSrc: { value: tmp.texture }, uStep: { value: new THREE.Vector2(0, 1 / this.height) }, uSigma: { value: sigma } }, out);
      return out;
    };
    const b1 = blur(BLUR_SMALL_SIGMA);
    const b2 = blur(BLUR_LARGE_SIGMA);

    // 3. Morphological closing of coverage (dilate then erode) to seal inter-mask seams.
    const mA = this.target();
    const mB = this.target();
    const sx = new THREE.Vector2(1 / this.width, 0);
    const sy = new THREE.Vector2(0, 1 / this.height);
    this.pass(morphFrag, { uSrc: { value: prep.texture }, uStep: { value: sx }, uMode: { value: 0 }, uFromG: { value: 1 } }, mA);
    this.pass(morphFrag, { uSrc: { value: mA.texture }, uStep: { value: sy }, uMode: { value: 0 }, uFromG: { value: 0 } }, mB);
    this.pass(morphFrag, { uSrc: { value: mB.texture }, uStep: { value: sx }, uMode: { value: 1 }, uFromG: { value: 0 } }, mA);
    this.pass(morphFrag, { uSrc: { value: mA.texture }, uStep: { value: sy }, uMode: { value: 1 }, uFromG: { value: 0 } }, mB);

    this.lightTarget = this.target(this.lightType);
    this.pass(combineLightFrag, {
      uPrep: { value: prep.texture }, uBlur1: { value: b1.texture }, uBlur2: { value: b2.texture },
      uClosed: { value: mB.texture }, uShadow: { value: shadow },
    }, this.lightTarget);
    [prep, tmp, b1, b2, mA, mB].forEach((rt) => rt.dispose());

    this.shadowTexture = shadow;
    this.buildMs = performance.now() - t0;
    return {
      maskTextures: this.maskTargets.map((rt) => rt.texture),
      lightTexture: this.lightTarget.texture,
      shadowTexture: shadow,
    };
  }
}
