// Shared GLSL snippets.

export const fullscreenVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Exact piecewise sRGB transfer functions. Colour pickers are converted to linear on the CPU
// (THREE.Color), the lightmap is decoded here, and the final pixel is encoded back to sRGB.
export const colorSpaceFns = /* glsl */ `
float srgbToLinear(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.0031308))));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// Per-view lightmap levels (black, white, gamma) from manifest.json. Maps a dark-glove photo
// onto the same tonal range as a light-glove photo; identity for the back view.
float levelled(float s, vec3 lv) {
  return pow(clamp((s - lv.x) / max(lv.y - lv.x, 1e-4), 0.0, 1.0), lv.z);
}
`;
