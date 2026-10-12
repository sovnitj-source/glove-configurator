import { filters, classRegistry } from 'fabric';
import { colorSpaceFns } from '../src/shaders/common.glsl.js';
import { compositeFrag } from '../src/shaders/composite.glsl.js';

// The leather/material model (light(), shade(), OKLab dye response, hueSafe, panelColor) is taken
// verbatim from the Three.js composite shader so both versions render identically.
// Fabric filters run on WebGL1 (GLSL ES 1.0), which forbids indexing a uniform array with a
// function parameter, so panelColor()'s lookup is rewritten as a constant-index chain.
const SHADING = compositeFrag
  .slice(compositeFrag.indexOf('struct Lit'), compositeFrag.indexOf('vec4 present('))
  .replace('vec4 o = uPanelOverride[i];',
    'vec4 o = i == 0 ? uPanelOverride[0] : i == 1 ? uPanelOverride[1] : i == 2 ? uPanelOverride[2] : '
    + 'i == 3 ? uPanelOverride[3] : i == 4 ? uPanelOverride[4] : uPanelOverride[5];');

const FRAG = /* glsl */ `
precision highp float;
${colorSpaceFns}

uniform sampler2D uTexture;   // light.png: R = photo luminance (sRGB), G = B1, B = B2 (sRGB-encoded)
uniform sampler2D uP0;        // Base, BOH, Fingers
uniform sampler2D uP1;        // Palm, Web, Welting
uniform sampler2D uP2;        // Binding, Laces, Palm Liner
uniform sampler2D uP3;        // Swoosh, Stitching, Swoosh Base
uniform sampler2D uP4;        // Embroidery, closed coverage, union
uniform vec2 uTexel;
uniform vec3 uLevels;
uniform int uEmbParent;

uniform vec3 uLeatherColor;
uniform vec4 uPanelOverride[6];
uniform vec3 uBindingColor;
uniform vec3 uLaceColor;
uniform vec3 uLinerColor;
uniform vec3 uSwooshColor;
uniform vec3 uStitchColor;
uniform vec3 uEmbroideryColor;
uniform vec3 uSwooshBaseColor;
uniform float uExpLeather;
uniform float uExpLiner;
uniform float uExpStitch;
uniform float uExpSwooshBase;
uniform float uLighting;
uniform float uShadow;
uniform float uHighlight;
uniform float uAO;
uniform float uRoughness;
uniform float uGrain;
uniform float uDyeSaturation;
uniform float uPebble;

varying vec2 vTexCoord;

float gL;
float gB1;
float gB2;
vec2 gPx;

${SHADING}

void main() {
  vec2 uv = vTexCoord;
  vec3 p0 = texture2D(uP0, uv).rgb;
  vec3 p1 = texture2D(uP1, uv).rgb;
  vec3 p2 = texture2D(uP2, uv).rgb;
  vec3 p3 = texture2D(uP3, uv).rgb;
  vec3 p4 = texture2D(uP4, uv).rgb;
  vec3 lt = texture2D(uTexture, uv).rgb;
  gL = srgbToLinear(levelled(lt.r, uLevels));
  gB1 = srgbToLinear(lt.g);
  gB2 = srgbToLinear(lt.b);
  gPx = vec2(uv.x, 1.0 - uv.y) / uTexel; // Fabric texcoords are top-down; match the Three.js grain

  // Seam fill (same as the Three.js version): borrow neighbouring material weights in hairline gaps.
  float closed = p4.g;
  float raw = p0.r + p0.g + p0.b + p1.r + p1.g + p1.b + p2.r + p2.g + p2.b + p3.r + p3.g + p3.b;
  if (closed > raw + 0.02) {
    vec3 n0 = vec3(0.0), n1 = vec3(0.0), n2 = vec3(0.0), n3 = vec3(0.0);
    for (int dy = -3; dy <= 3; dy++) {
      for (int dx = -3; dx <= 3; dx++) {
        vec2 o = uv + vec2(float(dx), float(dy)) * uTexel;
        n0 += texture2D(uP0, o).rgb;
        n1 += texture2D(uP1, o).rgb;
        n2 += texture2D(uP2, o).rgb;
        n3 += texture2D(uP3, o).rgb;
      }
    }
    float nSum = n0.r + n0.g + n0.b + n1.r + n1.g + n1.b + n2.r + n2.g + n2.b + n3.r + n3.g + n3.b;
    if (nSum > 1e-4) {
      float k = (closed - raw) / nSum;
      p0 += n0 * k; p1 += n1 * k; p2 += n2 * k; p3 += n3 * k;
    }
  }

  float emb = min(p4.r, uEmbParent == 3 ? p1.r : p0.r);
  float wBase = max(p0.r - (uEmbParent == 3 ? 0.0 : emb), 0.0);
  float wBOH = p0.g, wFing = p0.b;
  float wPalm = max(p1.r - (uEmbParent == 3 ? emb : 0.0), 0.0);
  float wWeb = p1.g, wWelt = p1.b;
  float wBind = p2.r, wLace = p2.g, wLiner = p2.b;
  float wSwoosh = p3.r, wStitch = p3.g, wSwBase = p3.b;
  float wLeather = wBase + wBOH + wFing + wPalm + wWeb + wWelt;
  float wSum = wLeather + emb + wBind + wLace + wLiner + wSwoosh + wStitch + wSwBase;
  float alpha = clamp(wSum, 0.0, 1.0);

  Lit lLeather = light(uExpLeather, 1.0, 1.0);
  Lit lLace = light(uExpLeather, 0.8, 1.15);
  Lit lLiner = light(uExpLiner, 0.4, 1.4);
  Lit lSwoosh = lightFrom(gL, gB2, uExpLeather, 0.0, 0.8);
  Lit lStitch = light(uExpStitch, 0.5, 1.3);
  Lit lSwBase = light(uExpSwooshBase, 0.8, 0.9);
  Lit lEmb = lightFrom(clamp(gB2 * 2.0, 0.0, 1.0), gB2, uExpLeather, 0.0, 1.5);

  vec3 sum = shade(panelColor(0), lLeather, 1.0) * wBase
    + shade(panelColor(1), lLeather, 1.0) * wBOH
    + shade(panelColor(2), lLeather, 1.0) * wFing
    + shade(panelColor(3), lLeather, 1.0) * wPalm
    + shade(panelColor(4), lLeather, 1.0) * wWeb
    + shade(panelColor(5), lLeather, 1.0) * wWelt
    + shade(uEmbroideryColor, lEmb, 0.0) * emb
    + shade(uBindingColor, lLeather, 1.0) * wBind
    + shade(uLaceColor, lLace, 1.0) * wLace
    + shade(uLinerColor, lLiner, 1.0) * wLiner
    + shade(uSwooshColor, lSwoosh, 0.0) * wSwoosh
    + shade(uStitchColor, lStitch, 0.0) * wStitch
    + shade(uSwooshBaseColor, lSwBase, 0.0) * wSwBase;
  vec3 col = wSum > 1e-5 ? sum / wSum : vec3(0.0);
  // Fabric's filter canvas is non-premultiplied: straight alpha, sRGB-encoded colour.
  gl_FragColor = vec4(linearToSrgb(hueSafe(col)), alpha);
}
`;

const COLOR_UNIFORMS = ['uLeatherColor', 'uBindingColor', 'uLaceColor', 'uLinerColor', 'uSwooshColor', 'uStitchColor', 'uEmbroideryColor', 'uSwooshBaseColor'];
const FLOAT_UNIFORMS = ['uExpLeather', 'uExpLiner', 'uExpStitch', 'uExpSwooshBase', 'uLighting', 'uShadow', 'uHighlight', 'uAO', 'uRoughness', 'uGrain', 'uDyeSaturation', 'uPebble'];

// Fabric.js WebGL image filter that recolours one glove view.
//   image source  = light.png of the view
//   packs         = [pack0..pack4] HTMLImageElements, bound as extra textures (units 1-5)
//   shared        = the shared uniform object (colours + lighting), written by MaterialManager
//   view          = { levels, exposure, embParent, width, height }
export class GloveFilter extends filters.BaseFilter {
  static type = 'GloveFilter';
  static defaults = {};
  static uniformLocations = ['uP0', 'uP1', 'uP2', 'uP3', 'uP4', 'uTexel', 'uLevels', 'uEmbParent', 'uPanelOverride', ...COLOR_UNIFORMS, ...FLOAT_UNIFORMS];

  getCacheKey() {
    return this.type;
  }

  getFragmentSource() {
    return FRAG;
  }

  isNeutralState() {
    return false;
  }

  applyToWebGL(options) {
    const gl = options.context;
    const units = [gl.TEXTURE1, gl.TEXTURE2, gl.TEXTURE3, gl.TEXTURE4, gl.TEXTURE5];
    this.packs.forEach((img, i) => {
      const tex = options.filterBackend.getCachedTexture(`${this.viewId}_pack${i}`, img);
      this.bindAdditionalTexture(gl, tex, units[i]);
    });
    super.applyToWebGL(options);
    units.forEach((u) => this.unbindAdditionalTexture(gl, u));
  }

  sendUniformData(gl, loc) {
    const s = this.shared;
    const v = this.view;
    ['uP0', 'uP1', 'uP2', 'uP3', 'uP4'].forEach((n, i) => gl.uniform1i(loc[n], i + 1));
    gl.uniform2f(loc.uTexel, 1 / v.width, 1 / v.height);
    gl.uniform3f(loc.uLevels, v.levels.black, v.levels.white, v.levels.gamma);
    gl.uniform1i(loc.uEmbParent, v.embParent);
    gl.uniform1f(loc.uExpLeather, v.exposure.leather ?? 1);
    gl.uniform1f(loc.uExpLiner, v.exposure.liner ?? 1);
    gl.uniform1f(loc.uExpStitch, v.exposure.stitching ?? 1);
    gl.uniform1f(loc.uExpSwooshBase, v.exposure.swooshBase ?? 1);
    for (const n of COLOR_UNIFORMS) {
      const c = s[n].value;
      gl.uniform3f(loc[n], c.r, c.g, c.b);
    }
    for (const n of ['uLighting', 'uShadow', 'uHighlight', 'uAO', 'uRoughness', 'uGrain', 'uDyeSaturation', 'uPebble']) {
      gl.uniform1f(loc[n], s[n].value);
    }
    gl.uniform4fv(loc.uPanelOverride, s.uPanelOverride.value.flatMap((p) => [p.x, p.y, p.z, p.w]));
  }

  // The 2D (CPU) backend is not supported: the configurator needs WebGL.
  applyTo2d() {}
}
classRegistry.setClass(GloveFilter);
