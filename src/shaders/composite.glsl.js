// Production composite shader: every material = selectedColor x lighting (+ controlled specular),
// weighted by its own mask. Source mask RGB is never used as colour.
import { colorSpaceFns } from './common.glsl.js';

export const VIEW = {
  FINAL: 0,
  BASE_MASK: 1,
  LEATHER_MASK: 2,
  BINDING_MASK: 3,
  LACE_MASK: 4,
  LINER_MASK: 5,
  BRANDING_MASK: 6,
  LIGHTMAP: 7,
  SHADOW: 8,
  HIGHLIGHTS: 9,
  FINAL_LEATHER: 10,
  MATERIAL_IDS: 11,
};

export const compositeFrag = /* glsl */ `
${colorSpaceFns}

// Packed masks (alpha of the source PNGs, packed once at load):
//   uMask0 = Base, BOH, Fingers, Palm
//   uMask1 = Web, Welting, Binding, Laces
//   uMask2 = Palm Liner, Swoosh, Swoosh Stitching, Embroidery(derived, subset of Base)
//   uMask3 = Swoosh Base (swoosh fill), -, -, -
// Masks a view doesn't have are bound to an empty texture.
uniform sampler2D uMask0;
uniform sampler2D uMask1;
uniform sampler2D uMask2;
uniform sampler2D uMask3;
uniform vec3 uLevels;         // per-view lightmap levels
uniform int uEmbParent;       // 0 = Base, 3 = Palm
uniform sampler2D uShadowMap; // original Shadow Layer.png, RGB = sRGB luminance (data)
uniform sampler2D uLight;     // G = small blur, B = large blur, A = closed coverage (all linear)
uniform vec2 uTexel;

// Material colours (linear RGB, converted from sRGB hex on the CPU)
uniform vec3 uLeatherColor;
uniform vec4 uPanelOverride[6]; // Base, BOH, Fingers, Palm, Web, Welting: rgb + w(1 = override)
uniform vec3 uBindingColor;
uniform vec3 uLaceColor;
uniform vec3 uLinerColor;
uniform vec3 uSwooshColor;
uniform vec3 uStitchColor;
uniform vec3 uEmbroideryColor;
uniform vec3 uSwooshBaseColor;

// Per-channel exposure (white-point normalisation from manifest.json)
uniform float uExpLeather;
uniform float uExpLiner;
uniform float uExpStitch;
uniform float uExpSwooshBase;

// Lighting controls
uniform float uLighting;    // diffuse gain
uniform float uShadow;      // shadow contrast (gamma on diffuse)
uniform float uHighlight;   // specular intensity
uniform float uAO;          // extra crease occlusion
uniform float uRoughness;   // 0 = glossy/sharp highlights, 1 = matte/broad
uniform float uGrain;       // amplification of the photo's fine leather detail
uniform float uDyeSaturation; // chroma ceiling of dyed leather (1 = exact picker chroma)
uniform float uPebble;       // procedural pebble-grain strength (0 = off)

// Output
uniform vec3 uBgColor;      // linear
uniform int uBgMode;        // 0 = transparent, 1 = solid
uniform int uView;
uniform int uFocus;         // -1 none, 0 leather, 1 binding, 2 laces, 3 liner, 4 swoosh,
                            // 5 stitching, 6 embroidery, 7 swoosh fill, 10..15 leather panel
uniform float uFocusAmt;    // 0..1, animated by the UI on hover

varying vec2 vUv;

// Lighting terms shared by all materials at this pixel
float gL;   // linear luminance of the photographed (white) glove
float gB1;  // small blur
float gB2;  // large blur (local mean)
vec2 gPx;   // pixel coordinate in the view's native canvas (drives the procedural grain)

struct Lit { float diffuse; float spec; float env; float sheen; float shadow; };

// OKLab (Ottosson 2020): perceptual space where lightness and chroma can be shaped
// independently without hue drift. Used to give dyed leather its tonal response.
vec3 linearToOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  vec3 q = pow(max(vec3(l, m, s), 0.0), vec3(1.0 / 3.0));
  return vec3(
    0.2104542553 * q.x + 0.7936177850 * q.y - 0.0040720468 * q.z,
    1.9779984951 * q.x - 2.4285922050 * q.y + 0.4505937099 * q.z,
    0.0259040371 * q.x + 0.7827717662 * q.y - 0.8086757660 * q.z);
}
vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
   -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
   -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

// Light response of a material.
//   Ld        luminance driving the diffuse term
//   Le        luminance driving the environment reflection
//   exposure  normalises the photographed albedo
//   specW     scales highlights (0 for materials whose brightness in the photo is albedo, not light)
//   roughMul  scales the global roughness
Lit lightFrom(float Ld, float Le, float exposure, float specW, float roughMul) {
  Lit o;
  float L = Ld * exposure;
  float D = L * uLighting;
  // Shadow contrast: gamma about 1.0 keeps lit areas, deepens/lifts the darks.
  D = pow(max(D, 0.0), uShadow);
  // Crease AO: how much darker this pixel is than its neighbourhood.
  float ao = clamp(gL / max(gB2, 1e-4), 0.0, 1.0);
  D *= mix(1.0, ao * ao, uAO);
  // Grain: re-amplify the photo's own fine surface detail (pixel vs small blur). No invented
  // geometry: this only scales micro-variation already present in the Shadow Layer.
  float detail = clamp(gL / max(gB1, 1e-4), 0.6, 1.6);
  D *= pow(detail, uGrain * specW);
  o.diffuse = D;

  float r = clamp(uRoughness * roughMul, 0.0, 1.0);
  float rs = 1.0 - r;
  // Highlights: shape comes from the FULL-RES photo (pixel above its local mean), so it stays
  // as sharp as the source. Blurred band-pass highlights smear into out-of-focus glows along
  // the finger rolls. To avoid the wet-plastic look the strength goes through a soft knee
  // (hp / (1 + 6hp) saturates instead of clipping to white) and drops with roughness.
  float hp = max(gL - gB2 - 0.025, 0.0);   // small floor: ignore sensor/JPEG noise
  float H = hp / (1.0 + 6.0 * hp) * smoothstep(0.3, 0.9, L);
  o.spec = H * uHighlight * specW * mix(1.3, 0.55, r);
  // Dielectric (F0 ~ 4%) reflection of the environment: what keeps black leather from
  // collapsing into a flat silhouette. Glossier = stronger.
  o.env = Le * exposure * 0.045 * mix(1.0, 0.55, r);
  // Sheen: only where there is an actual highlight (not the whole brightly lit area), so lit
  // finger tops keep their dye colour instead of turning pale.
  o.sheen = clamp(H * 7.0, 0.0, 1.0) * mix(0.6, 1.0, rs) * specW;
  // Shadow depth: where the dye colour should get richer rather than just darker.
  o.shadow = 1.0 - smoothstep(0.03, 0.3, D);
  return o;
}

Lit light(float exposure, float specW, float roughMul) {
  return lightFrom(gL, gL, exposure, specW, roughMul);
}

// Colourise: hue comes ONLY from the selected albedo; the lightmap scales it.
// dye = 1 for dyed leather: chroma is shaped in OKLab the way real leather behaves:
//   - natural dyes don't reach display primaries (uDyeSaturation),
//   - lit crowns lose chroma to the white surface sheen,
//   - deep folds go darker AND slightly richer (light that penetrates the dye layer).
// A plain RGB multiply keeps chroma/lightness constant everywhere, which is the
// "painted plastic" look. Branding uses dye = 0 and keeps the exact brand colour.
// Achromatic specular/env reflection is faded out for light albedos (already bright in the
// photo-derived diffuse) so it never washes colours out.
// ---- Procedural leather grain -------------------------------------------------------------
// The photographed glove is smooth in places (finger tops), which reads as plastic once recoloured.
// Real glove leather has a pebble grain (~1 mm cells). It is synthesised as Worley/cellular noise
// (Worley 1996): each cell is a tiny dome, the borders are creases. Used as a micro bump: shading
// from its slope, darker creases, highlights broken up by the cell tops, plus faint low-frequency
// dye mottling. Strength fades where the photo already has detail and in deep shadow.
const float GRAIN_CELL = 2.8;   // cell size in native pixels
vec2 grainHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float worley(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 r = g + grainHash(i + g) * 0.85 + 0.075 - f;
      d = min(d, dot(r, r));
    }
  }
  return sqrt(d);
}
float pebble(vec2 px) {
  return 1.0 - smoothstep(0.05, 0.75, worley(px / GRAIN_CELL));
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = grainHash(i).x, b = grainHash(i + vec2(1.0, 0.0)).x;
  float c = grainHash(i + vec2(0.0, 1.0)).x, d = grainHash(i + vec2(1.0, 1.0)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
struct Grain { float diffuse; float spec; };
Grain leatherGrain(Lit l) {
  Grain g;
  float h = pebble(gPx);
  vec2 slope = vec2(pebble(gPx + vec2(1.0, 0.0)) - h, pebble(gPx + vec2(0.0, 1.0)) - h);
  // where the photo already shows texture, add less
  float photoDetail = clamp(abs(gL - gB1) / max(gB1, 0.02) * 6.0, 0.0, 1.0);
  float amt = uPebble * mix(1.0, 0.45, photoDetail) * smoothstep(0.03, 0.35, l.diffuse);
  float bump = dot(slope, normalize(vec2(-0.55, 0.8)));          // key light from the upper left
  float mottle = valueNoise(gPx / 42.0) * 0.6 + valueNoise(gPx / 11.0) * 0.4 - 0.5;
  g.diffuse = 1.0 + amt * (0.55 * bump + 0.16 * (h - 0.474)) + uPebble * 0.06 * mottle;
  g.spec = mix(1.0, 0.29 + 1.5 * h, clamp(amt * 1.1, 0.0, 1.0));
  return g;
}

vec3 shade(vec3 albedo, Lit l, float dye) {
  vec3 lin = albedo * l.diffuse;
  float grainSpec = 1.0;
  if (dye > 0.0) {
    Grain gr = leatherGrain(l);
    lin *= mix(1.0, gr.diffuse, dye);
    grainSpec = mix(1.0, gr.spec, dye);
  }
  if (dye > 0.0) {
    vec3 lab = linearToOklab(lin);
    float k = mix(1.0, uDyeSaturation, dye);
    k *= 1.0 - 0.2 * l.sheen * dye;
    k *= 1.0 + 0.15 * l.shadow * dye;
    lab.x *= 1.0 - 0.07 * l.shadow * dye;
    lab.yz *= k;
    lin = max(oklabToLinear(lab), 0.0);
  }
  float a = luma(albedo);
  float specW = 1.0 - smoothstep(0.05, 0.85, a);
  float envW = 1.0 - smoothstep(0.0, 0.06, a);
  return lin + vec3(l.spec * specW * grainSpec + l.env * envW);
}

// Hue-preserving soft clip: scale instead of per-channel clipping so bright reds don't turn orange.
vec3 hueSafe(vec3 c) {
  float m = max(max(c.r, c.g), c.b);
  return m > 1.0 ? c / m : c;
}

vec3 panelColor(int i) {
  vec4 o = uPanelOverride[i];
  return mix(uLeatherColor, o.rgb, o.w);
}

vec4 present(vec3 linearRgb, float alpha) {
  if (uBgMode == 1) {
    vec3 c = mix(uBgColor, linearRgb, alpha);
    return vec4(linearToSrgb(c), 1.0);
  }
  return vec4(linearToSrgb(linearRgb) * alpha, alpha); // premultiplied
}

vec4 grey(float v) {
  // Data views (masks / maps): shown raw, no colour management, opaque.
  return vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
}

void main() {
  vec4 m0 = texture2D(uMask0, vUv);
  vec4 m1 = texture2D(uMask1, vUv);
  vec4 m2 = texture2D(uMask2, vUv);
  vec4 m3 = texture2D(uMask3, vUv);
  vec4 lt = texture2D(uLight, vUv);
  gL = srgbToLinear(levelled(texture2D(uShadowMap, vUv).r, uLevels));
  gB1 = lt.g;
  gB2 = lt.b;
  gPx = vUv / uTexel;

  // Seam fill: where source masks leave a hairline gap inside the glove, borrow material
  // weights from the neighbourhood so the gap renders as the adjacent material.
  float closed = lt.a;
  float raw = m0.r + m0.g + m0.b + m0.a + m1.r + m1.g + m1.b + m1.a + m2.r + m2.g + m2.b + m3.r;
  if (closed > raw + 0.02) {
    vec4 n0 = vec4(0.0), n1 = vec4(0.0), n2 = vec4(0.0), n3 = vec4(0.0);
    for (int dy = -3; dy <= 3; dy++) {
      for (int dx = -3; dx <= 3; dx++) {
        vec2 o = vUv + vec2(float(dx), float(dy)) * uTexel;
        n0 += texture2D(uMask0, o);
        n1 += texture2D(uMask1, o);
        n2 += texture2D(uMask2, o);
        n3 += texture2D(uMask3, o);
      }
    }
    float nSum = n0.r + n0.g + n0.b + n0.a + n1.r + n1.g + n1.b + n1.a + n2.r + n2.g + n2.b + n3.r;
    if (nSum > 1e-4) {
      float k = (closed - raw) / nSum;
      m0 += n0 * k; m1 += n1 * k; m2 += n2 * k; m3 += n3 * k;
    }
  }

  // Embroidery is cut out of its parent panel (Base on back/side views, Palm on the palm view).
  float emb = min(m2.a, uEmbParent == 3 ? m0.a : m0.r);
  // Weights (coverage) of every material.
  float wBase = max(m0.r - (uEmbParent == 3 ? 0.0 : emb), 0.0);
  float wBOH = m0.g, wFing = m0.b;
  float wPalm = max(m0.a - (uEmbParent == 3 ? emb : 0.0), 0.0);
  float wWeb = m1.r, wWelt = m1.g, wBind = m1.b, wLace = m1.a;
  float wLiner = m2.r, wSwoosh = m2.g, wStitch = m2.b, wSwBase = m3.r;
  float wLeather = wBase + wBOH + wFing + wPalm + wWeb + wWelt;
  float wSum = wLeather + emb + wBind + wLace + wLiner + wSwoosh + wStitch + wSwBase;
  float alpha = clamp(wSum, 0.0, 1.0);

  if (uView == ${VIEW.BASE_MASK}) { gl_FragColor = grey(m0.r); return; }
  if (uView == ${VIEW.LEATHER_MASK}) { gl_FragColor = grey(wLeather); return; }
  if (uView == ${VIEW.BINDING_MASK}) { gl_FragColor = grey(wBind); return; }
  if (uView == ${VIEW.LACE_MASK}) { gl_FragColor = grey(wLace); return; }
  if (uView == ${VIEW.LINER_MASK}) { gl_FragColor = grey(wLiner); return; }
  if (uView == ${VIEW.BRANDING_MASK}) { gl_FragColor = grey(wSwoosh + wStitch + emb + wSwBase); return; }

  // Material lighting responses.
  Lit lLeather = light(uExpLeather, 1.0, 1.0);
  Lit lLace = light(uExpLeather, 0.8, 1.15);
  Lit lLiner = light(uExpLiner, 0.4, 1.4);
  // Swoosh patch + embroidery thread are white in the photo: that brightness is albedo, so
  // they take lighting from the local neighbourhood and get no high-pass specular.
  Lit lSwoosh = lightFrom(gL, gB2, uExpLeather, 0.0, 0.8);
  Lit lStitch = light(uExpStitch, 0.5, 1.3);
  Lit lSwBase = light(uExpSwooshBase, 0.8, 0.9);   // leather swoosh fill
  Lit lEmb = lightFrom(clamp(gB2 * 2.0, 0.0, 1.0), gB2, uExpLeather, 0.0, 1.5);

  if (uView == ${VIEW.LIGHTMAP}) {
    gl_FragColor = vec4(linearToSrgb(vec3(gL)) * alpha, alpha); return;
  }
  if (uView == ${VIEW.SHADOW}) {
    gl_FragColor = vec4(linearToSrgb(vec3(lLeather.diffuse)) * alpha, alpha); return;
  }
  if (uView == ${VIEW.HIGHLIGHTS}) {
    gl_FragColor = vec4(linearToSrgb(vec3(lLeather.spec * 4.0)) * alpha, alpha); return;
  }

  vec3 cBase = shade(panelColor(0), lLeather, 1.0);
  vec3 cBOH = shade(panelColor(1), lLeather, 1.0);
  vec3 cFing = shade(panelColor(2), lLeather, 1.0);
  vec3 cPalm = shade(panelColor(3), lLeather, 1.0);
  vec3 cWeb = shade(panelColor(4), lLeather, 1.0);
  vec3 cWelt = shade(panelColor(5), lLeather, 1.0);
  vec3 leatherSum = cBase * wBase + cBOH * wBOH + cFing * wFing + cPalm * wPalm + cWeb * wWeb + cWelt * wWelt;

  if (uView == ${VIEW.FINAL_LEATHER}) {
    float a = clamp(wLeather, 0.0, 1.0);
    vec3 c = wLeather > 1e-5 ? hueSafe(leatherSum / wLeather) : vec3(0.0);
    gl_FragColor = present(c, a); return;
  }

  if (uView == ${VIEW.MATERIAL_IDS}) {
    vec3 c = vec3(0.85, 0.25, 0.25) * wBase + vec3(0.25, 0.7, 0.3) * wBOH + vec3(0.3, 0.35, 0.9) * wFing
           + vec3(0.9, 0.85, 0.2) * wPalm + vec3(0.85, 0.3, 0.85) * wWeb + vec3(0.2, 0.85, 0.85) * wWelt
           + vec3(1.0, 0.55, 0.0) * wBind + vec3(0.55, 0.35, 0.15) * wLace + vec3(0.5) * wLiner
           + vec3(1.0) * wSwoosh + vec3(0.1) * wStitch + vec3(1.0, 0.95, 0.6) * emb + vec3(0.6, 0.0, 0.6) * wSwBase;
    c = wSum > 1e-5 ? c / wSum : c;
    c *= mix(0.55, 1.0, sqrt(clamp(gL, 0.0, 1.0)));
    gl_FragColor = present(c, alpha); return;
  }

  vec3 sum = leatherSum
    + shade(uEmbroideryColor, lEmb, 0.0) * emb
    + shade(uBindingColor, lLeather, 1.0) * wBind
    + shade(uLaceColor, lLace, 1.0) * wLace
    + shade(uLinerColor, lLiner, 1.0) * wLiner
    + shade(uSwooshColor, lSwoosh, 0.0) * wSwoosh
    + shade(uStitchColor, lStitch, 0.0) * wStitch
    + shade(uSwooshBaseColor, lSwBase, 0.0) * wSwBase;

  // Coverage-weighted blend: shared anti-aliased edges (alpha sums ~1) never produce seams,
  // and no material's colour can overwrite another's.
  vec3 col = wSum > 1e-5 ? sum / wSum : vec3(0.0);

  // UI zone focus: everything outside the hovered zone is dimmed and desaturated.
  if (uFocus >= 0 && uFocusAmt > 0.0) {
    float fw =
      uFocus == 0 ? wLeather : uFocus == 1 ? wBind : uFocus == 2 ? wLace : uFocus == 3 ? wLiner :
      uFocus == 4 ? wSwoosh : uFocus == 5 ? wStitch : uFocus == 6 ? emb : uFocus == 7 ? wSwBase :
      uFocus == 10 ? wBase : uFocus == 11 ? wBOH : uFocus == 12 ? wFing :
      uFocus == 13 ? wPalm : uFocus == 14 ? wWeb : uFocus == 15 ? wWelt : 0.0;
    fw = wSum > 1e-5 ? clamp(fw / wSum, 0.0, 1.0) : 0.0;
    vec3 dim = vec3(luma(col)) * 0.22;
    col = mix(col, dim, (1.0 - fw) * uFocusAmt);
  }
  gl_FragColor = present(hueSafe(col), alpha);
}
`;
