// One-time GPU pre-passes that run at load (never on colour change).
import { colorSpaceFns } from './common.glsl.js';

// Packs the ALPHA channel of four white-on-transparent source masks into one RGBA target.
// The masks' RGB is pure white and is deliberately never read.
export const packMasksFrag = /* glsl */ `
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uC;
uniform sampler2D uD;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(
    texture2D(uA, vUv).a,
    texture2D(uB, vUv).a,
    texture2D(uC, vUv).a,
    texture2D(uD, vUv).a
  );
}
`;

// Prepares the masked lightmap for blurring: (L * U, U) where L is linear luminance from the
// Shadow Layer RGB and U is glove coverage. Blurring both and dividing gives a blur that
// ignores the white background (no bright halo / fake rim darkening at the silhouette).
export const prepLightFrag = /* glsl */ `
${colorSpaceFns}
uniform sampler2D uShadow;
uniform sampler2D uMask0;
uniform sampler2D uMask1;
uniform sampler2D uMask2;
uniform sampler2D uMask3;
uniform vec3 uLevels;
varying vec2 vUv;
void main() {
  vec4 m0 = texture2D(uMask0, vUv);
  vec4 m1 = texture2D(uMask1, vUv);
  vec4 m2 = texture2D(uMask2, vUv);
  vec4 m3 = texture2D(uMask3, vUv);
  // m2.a is the embroidery mask, which is a subset of Base, so it is excluded from the union.
  float U = clamp(m0.r + m0.g + m0.b + m0.a + m1.r + m1.g + m1.b + m1.a + m2.r + m2.g + m2.b + m3.r, 0.0, 1.0);
  float L = srgbToLinear(levelled(texture2D(uShadow, vUv).r, uLevels));
  gl_FragColor = vec4(L * U, U, 0.0, 1.0);
}
`;

// Separable gaussian on the RG pair.
export const blurFrag = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uStep;     // one texel along the blur direction
uniform float uSigma;
varying vec2 vUv;
const int MAX_R = 40;
void main() {
  vec2 acc = vec2(0.0);
  float wsum = 0.0;
  float r = min(ceil(uSigma * 3.0), float(MAX_R));
  for (int i = -MAX_R; i <= MAX_R; i++) {
    float fi = float(i);
    if (abs(fi) > r) continue;
    float w = exp(-0.5 * fi * fi / (uSigma * uSigma));
    acc += texture2D(uSrc, vUv + uStep * fi).rg * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, 0.0, 1.0);
}
`;

// Separable grayscale morphology (max = dilate, min = erode) used to close the hairline
// gaps between adjacent source masks. Reads .r, or .g when uFromG = 1.
export const morphFrag = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uStep;
uniform int uMode;   // 0 = max, 1 = min
uniform int uFromG;
varying vec2 vUv;
const int R = 3;
void main() {
  float v = uMode == 0 ? 0.0 : 1.0;
  for (int i = -R; i <= R; i++) {
    vec4 t = texture2D(uSrc, vUv + uStep * float(i));
    float s = uFromG == 1 ? t.g : t.r;
    v = uMode == 0 ? max(v, s) : min(v, s);
  }
  gl_FragColor = vec4(v, 0.0, 0.0, 1.0);
}
`;

// Final packed lighting texture:
//   R = L      linear luminance (full-res, from Shadow Layer RGB)
//   G = B1     masked small blur  (soft highlight / roughness response)
//   B = B2     masked large blur  (local mean: reference for AO + highlight extraction)
//   A = C      closed glove coverage: mask union with inter-panel seams filled, limited to
//              pixels the photo shows as glove (the photo background is pure white)
export const combineLightFrag = /* glsl */ `
uniform sampler2D uPrep;
uniform sampler2D uBlur1;
uniform sampler2D uBlur2;
uniform sampler2D uClosed;
uniform sampler2D uShadow;
varying vec2 vUv;
void main() {
  vec2 p = texture2D(uPrep, vUv).rg;
  vec2 b1 = texture2D(uBlur1, vUv).rg;
  vec2 b2 = texture2D(uBlur2, vUv).rg;
  float L = p.g > 1e-4 ? p.r / p.g : 0.0;
  float photoIsGlove = 1.0 - smoothstep(0.94, 0.995, texture2D(uShadow, vUv).r);
  float closed = max(p.g, texture2D(uClosed, vUv).r * photoIsGlove);
  gl_FragColor = vec4(
    L,
    b1.g > 1e-4 ? b1.r / b1.g : L,
    b2.g > 1e-4 ? b2.r / b2.g : L,
    closed
  );
}
`;
