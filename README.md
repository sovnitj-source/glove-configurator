# Glove Studio: WebGL glove colour configurator

A browser-based configurator that recolours the supplied Nike Vapor Elite (Trap web) glove assets on the GPU. The renderer only reads the supplied PNGs. It never modifies or regenerates them, and it never uses AI imagery. A colour change updates one shader uniform and triggers one redraw.

## Camera views

The configurator shows the same glove from three angles, and all of them use one shared colour state.

| View | Source folder | Photo | Canvas |
|---|---|---|---|
| **Back** | `src/assets/views/back/` (from `Trap 1/`) | white glove | 679×975 |
| **Side** | `src/assets/views/side/` (from `Trap 2/`) | black glove | 890×647 |
| **Palm** | `src/assets/views/palm/` (from `Trap 3/`) | black glove | 860×852 |

- **Switching views.** The switcher under the glove offers **Back**, **Side**, **Palm** or **All**, and each button shows a live thumbnail in the current colours. In All mode the views sit side by side (stacked on mobile), and clicking any one opens it on its own.
- **Equal glove size.** The photos frame the glove differently: each has a different canvas size and a different margin around the glove. So every view is cropped to its glove bounds (`gloveBBox` in the manifest, plus 4.5% padding). In All mode each glove is then scaled to the same on-screen area; in the last test the three areas matched within 0.1%. `ViewManager.layout()` does this on resize and picks a row or column arrangement, whichever fits larger.
- **One colour state for all views.** Each view has its own WebGL renderer, but every renderer shares the same colour and lighting uniform objects. A colour change is therefore a single uniform write, and every visible view redraws.
- **Download.** It exports the current view at native resolution. In All mode it exports all views side by side in one PNG, with the same equal-size scaling and no upscaling.
- **Side view only:** the **Swoosh Fill** channel (`Swoosh Base.png`). It sits in the Branding group of the panel.
- **The side and palm photos are of a black glove.** The analysis tool computes per-view **levels**: a white point and gamma that map the leather's median and highlight range onto the same range as the white-glove photo. With levels, one material model works for both photos. In QA, each colour renders to almost the same mean colour in both views (red `#8A2423` / `#8F2523`).
- **Embroidery per view.** The embroidery mask is cut out of the panel it sits on: `Base` on the back and side views, `Palm` on the palm view (`embroideryParent` in `analyze_assets.py`).
- **The palm view has no liner or swoosh layers.** Those zones simply don't appear in it. Its small swoosh is debossed into the leather, so it stays part of the lighting.
- **URL parameter:** `?camera=back|side|palm|all`.

## 3D view (360°)

The **3D** toggle in the view switcher replaces the photo views with a rotatable 3D glove. You can drag to rotate it all the way round, scroll to zoom and double-click to reset. In 3D, the Back, Side and Palm buttons fly the camera to that angle, and "Download" saves a 3D snapshot.

**How it was made, and how accurate it is** (details in `RESEARCH_3D.md`):
- **Mesh.** It was reconstructed from our three photos by **Hunyuan3D-2mv**, an image-to-3D AI model run on the public Hugging Face Space. It was built with the side photo passed as "left"; passing it as "right" produced a mirrored glove.
- **Camera fitting.** A camera was fitted to each photo by matching the mesh silhouette to our masks.
  - The **back photo matches the mesh** (silhouette IoU 0.87–0.90).
  - **Side and palm do not match.** The AI invents geometry for those sides, so their photos are not used in 3D.
- **The back surface shows the exact back photo.** The live recoloured back render is projected onto the mesh through the fitted camera, with a depth pre-pass so only the nearest surface receives it.
- **Every other surface shows its panel colour** with simple leather lighting. Panel labels come from the back masks. Unseen areas take the nearest leather panel's label, while laces and binding only continue a short distance past the photographed edge.
- **Limit: laces on the far side mostly show the leather colour.** The AI fused them into the surface; ray-cast thickness tests couldn't separate them from the web.
- **On-screen label.** The viewer says this: "AI-reconstructed 3D · back side matches the photo, other sides approximate".

**Rebuilding.** `npm run model` (`tools/build_model.py`) rebuilds `src/assets/model/` from `research/3d-ai/`. For an exact 3D glove, replace the mesh with a scan or a panel-split `.glb` (see `RESEARCH_3D.md`).

## Fabric.js version (`/fabric/`)

There's a second implementation of the same configurator, built on **Fabric.js 7.4**, at `/fabric/`. Locally that's http://localhost:5173/fabric/, and it's live at `…/fabric/` on both sites.

**How it works:**
- **One Fabric `StaticCanvas` holds every camera view as a `FabricImage`.** Each image is cropped to its glove with `cropX`, `cropY`, `width` and `height`.
- **`GloveFilter` (`fabric/GloveFilter.js`) is a custom Fabric WebGL image filter.** It subclasses `filters.BaseFilter` and binds five extra textures (the mask packs), the same pattern Fabric's own `BlendImage` filter uses. Its shading code is imported from the Three.js shader (`src/shaders/composite.glsl.js`), so both versions use one material model. The only change is that `panelColor()` is rewritten for WebGL1, because Fabric's filters run on WebGL1.
- **Colour changes are GPU work only.** A colour change updates shared uniform values, then `image.applyFilters()` re-runs on the GPU and `canvas.requestRenderAll()` redraws.
- **Lighting maps are pre-baked.** Fabric filters are single-pass, so the maps that the Three.js version computes in GPU pre-passes (masked blurs and seam closing) are baked offline by `tools/build_fabric_maps.py` (`npm run fabric-maps`) into opaque RGB PNGs under `views/<id>/derived/fabric/`.
- **The UI code is shared.** The colour UI, presets, undo/redo and URL parameters are the same modules as the Three.js version. `fabric/three-shim.js` replaces the two Three.js value classes the shared colour manager imports, so the Fabric page loads no Three.js.
- **Export uses Fabric.** `canvas.toDataURL({ left, top, width, height, multiplier })` crops to the visible gloves at native resolution.
- **Parity with the Three.js version.** The rendered output is identical: across all three views the mean colour difference is 0.12/255 and the alpha is identical. The Back, Side, Palm and All views, the colour panels, per-panel leather colours, background options, undo/redo and download all work the same.

**Not in the Fabric version:**
- **The 360° 3D view.** Fabric.js is a 2D canvas library and has no 3D engine.
- **The developer panel and colour-test grid.** These are Three.js debugging tools.

## Run locally

Requires Node 18 or later. There is no build step, and Three.js is vendored under `vendor/three`, so the app runs offline.

```bash
cd glove-configurator
npm start                 # → http://localhost:5173
# or: python3 -m http.server 5173
```

The page must be served over HTTP. Opening `index.html` as a `file://` URL blocks texture loading.

Optional tooling:

```bash
npm run analyze           # re-inspect every view: manifests, levels, derived/Embroidery.png, views.json
python3 tools/analyze_assets.py --lightmaps   # also write reference GLOVE_*_LIGHTMAP PNGs
npm install && npm run qa # headless Chromium QA → qa/*.png + qa/report.json
```

`analyze` needs Python 3 with `numpy`, `pillow` and `scipy`. `qa` needs Playwright, which `npm install` installs.

## What the asset inspection found

`tools/analyze_assets.py` classifies every PNG from its pixels and writes the results to `src/assets/manifest.json`.

| Asset | Pixels | Treated as |
|---|---|---|
| Base, BOH, Fingers, Palm, Web, Welting, Binding, Laces, Palm Liner, Swoosh, Swoosh Stitching | RGB is constant `255,255,255`. Alpha holds the geometry with anti-aliased edges. | Material masks. Only the alpha channel is used. |
| Shadow Layer.png | Grayscale with R=G=B and values 0–255 across 100% of the canvas. Alpha is semi-transparent everywhere and correlates with luminance (r = 0.90). | The lightmap source. The renderer uses its RGB and ignores its alpha. |

Key findings:

- **The Shadow Layer must not be overlaid.** Composited with source-over onto white, it only spans 0.90–1.00, which produces the flat, washed-out result. Its RGB channel is a full-range luminance photo of a white glove. The renderer decodes it from sRGB to linear and uses it as a multiplicative lightmap.
- **The masks partition the glove.** Alpha sums to about 1 at shared edges, and only 57 pixels overlap. Layer order therefore doesn't matter. Materials are combined with a coverage-weighted blend, `Σ mᵢ·cᵢ / Σ mᵢ`, so one material can never overwrite another and shared edges don't seam.
- **The mask names don't match the glove regions.** `Base` is the wrist back panel and `BOH` is the finger-stall shells. Run the "Material IDs" debug view to see each mask in its own colour.
- **The "VAPOR / swoosh / Elite" embroidery has no mask of its own.** It exists only as bright detail in the Shadow Layer, on top of `Base`. The analysis tool derives `derived/Embroidery.png` from that detail (a local high-pass, clustered to exclude the rivets), so the embroidery has its own colour channel.
- **About 6.2k interior pixels sit on hairline gaps between adjacent masks.** A GPU morphological closing seals these gaps. It is gated by the photo, so real background is never filled, and the gap pixels take their material from the neighbouring masks.
- **Some regions are very dark in the photo for reasons other than lighting.** The palm liner (median luminance 35/255) and the swoosh stitching are normalised per channel using exposure values computed into the manifest. Without this, their colour pickers would have almost no visible effect.
- **Source issue to be aware of:** `Shadow Layer.png` contains a few hard-edged rectangular retouch patches inside the web lacing, at roughly x 433–477, y 313–442. The renderer reproduces the lightmap faithfully, so these patches show slightly, most visibly on black laces. They should be fixed in the source artwork.
- The `GLOVE_*_LIGHTMAP` files mentioned in the brief were not supplied. The renderer doesn't need them. `--lightmaps` writes equivalent reference files.

## Rendering model

The renderer uses one `WebGLRenderer`, one scene, one orthographic camera and one full-screen quad. The drawing buffer is the native 679×975 size, and CSS scales it while preserving the aspect ratio.

**At load time**, a set of GPU pre-passes run once, in `LayerManager`:

1. Mask alphas are packed into 3 RGBA targets of 4 masks each.
2. The Shadow Layer RGB is decoded to linear luminance `L`.
3. Two masked Gaussian blurs are computed: `B1` (σ 2.5) and `B2` (σ 12). They are masked with `blur(L·U)/blur(U)` so the white photo background never leaks in.
4. The coverage is closed morphologically to seal seams.

After these passes, the composite shader samples only 5 textures.

**Per pixel, for each material**, the shader in `src/shaders/composite.glsl.js` computes:

```
D      = (L · exposure · uLighting) ^ uShadow · mix(1, (L/B2)², uAO) · (L/B1)^uGrain
hp     = max(L − B2 − 0.025, 0)                              full-res, noise floor
H      = hp / (1 + 6·hp) · smoothstep(.3,.9,L)                 soft knee, no blur
spec   = H · uHighlight · specWeight
env    = L · 0.045 · gloss                                    dielectric F0≈4% sheen
dyed   = OKLab(albedo · D) with chroma × uDyeSaturation × (1 − 0.2·sheen(H)) × (1 + 0.15·shadow)
colour = dyed + (spec·specW(albedo) + env·envW(albedo))
```

- **The hue comes only from the selected colour.** The lightmap scales its brightness, and the mask RGB is never read.
- **Leather is shaded with an OKLab dye response.** A plain RGB multiply keeps the ratio of chroma to lightness constant from highlight to shadow, and that reads as painted plastic. Instead, the shader works in OKLab, a perceptual colour space where lightness and chroma can be shaped independently without the hue drifting:
  - lit crowns lose a little chroma to the surface sheen,
  - deep folds become darker and slightly richer,
  - dye chroma is capped just below display primaries (`uDyeSaturation`, default 0.95).
- **Brand elements keep their exact colours.** The swoosh, stitching and embroidery are excluded from the dye response.
- **Highlights keep the photo's own sharpness but never clip to white.** The highlight shape comes from the full-resolution photo: each pixel above its local mean. An earlier version built a "soft" highlight from blurred maps, and it smeared into out-of-focus glows along the finger rolls. Highlight strength now goes through a soft knee, so it saturates instead of turning into wet-plastic white, and it drops as roughness rises.
- **Sheen desaturation applies only where there is an actual highlight**, not across whole brightly lit areas. The near-blown-out finger tops in the source photo therefore keep their dye colour instead of going pale.
- **Roughness defaults to 0.6.** Glove leather is oiled, which places it in the worn/full-grain range of roughly 0.5–0.7. Values below about 0.3 look like plastic.
- **Procedural pebble grain.** Some areas of the photos are smooth, the back-view finger tops in particular, and they read as plastic once recoloured. Real glove leather has a pebble grain of about 1 mm cells, so the shader synthesises it with Worley/cellular noise at a 2.8 px cell size.
  - The grain acts as a micro bump: light hits the slope from the upper left, the creases are slightly darker, and the cell tops break up the specular highlights.
  - A faint low-frequency mottling is added, because tanned leather never dyes perfectly evenly.
  - The grain is strongest where the photo is smooth and lit. It fades in deep shadow and where the photo already shows texture.
  - The grain is centred on its measured average, so overall brightness doesn't change; the QA mean colours are identical.
  - The "Pebble grain" slider in the Developer panel controls the strength (`uPebble`, default 0.6). The Fabric version uses the same code, with its coordinates flipped so the pattern matches exactly.
- **Grain comes from the photo itself.** The grain slider amplifies the fine detail already in the Shadow Layer (the ratio of each pixel to its small blur). It doesn't invent geometry.
- **Specular and environment reflections are white light, as on real leather.** They fade out for light albedos, which already appear bright through `D`.
- **The black-leather depth comes from the env and spec terms.** That reflected light keeps black leather shaded instead of collapsing to a flat silhouette.
- **The swoosh and embroidery thread are lit from the local lighting `B2`, with no high-pass specular.** Their brightness in the photo is albedo, not light.
- **Clipping is hue-preserving.** An over-bright colour is scaled down as a whole, not clipped per channel.

**Colour space:**
- Picker hex values are sRGB. `THREE.Color` converts them to linear before they reach the uniforms.
- Masks and the lightmap are uploaded as data (`NoColorSpace`, not premultiplied).
- The lightmap is decoded with the exact sRGB EOTF in the shader.
- The output is encoded back to sRGB in the shader. A transparent background is written as premultiplied alpha.

## Features

- **The customisation panel:**
  - **Grouped zones.** The zones are grouped into Leather (Leather, Binding, Laces, Palm Liner), Branding (Swoosh, Swoosh Stitching, Embroidery) and Scene (Background). They open as an accordion, one at a time, and each row shows its current colour chip and name.
  - **Zone highlighting.** Hovering a zone or a panel pill highlights that area on the glove, and everything else fades.
  - **Named preset swatches.** The active swatch has a checkmark.
  - **Custom colour picker.** It has a saturation/brightness pad, a hue slider, a HEX field and an eyedropper (in Chromium browsers). Changes preview live while you drag. The last 10 colours you used are kept in a Recent row.
  - **Per-panel leather.** In the Leather zone, the "Apply to" pills choose between all leather and a single panel: wrist, back of hand, finger inlays, thumb/palm, web or welting. Overridden panels are marked, and their link icon re-links them to the leather colour.
  - **Undo, redo and reset.** Use the buttons or ⌘Z / ⇧⌘Z (Ctrl on Windows). Each finished gesture is one undo step; dragging the picker counts as one.
  - **"Your build" footer.** It shows every zone's colour at a glance, and clicking a chip jumps to that zone. The footer also has the transparent-PNG switch and the Download PNG button.
  - **Background options.** Dark `#111111` (the default), White, Transparent (shown on a checkerboard) or any custom colour.
- **Download PNG.** Exports the final GPU composite at 679×975, with an optional transparent background.
- **Colour test** (QA). Renders the same glove in White, Red, Blue, Green, Yellow, Orange, Brown, Black, Purple and a custom colour. The colour can be applied to the leather, the shell, the laces or everything. For each tile the tool measures the rendered leather's mean colour, hue difference (Δhue) and saturation and shows PASS or CHECK.
- **Developer panel:**
  - Views: Base, Leather, Binding, Lace, Liner and Branding masks; Lightmap; Shadow (diffuse term); Highlights; Final Leather; Material IDs; Final Composite.
  - Sliders: lighting intensity, shadow intensity, highlight intensity, AO intensity, leather roughness, leather grain and dye saturation.
  - Diagnostics:
    - the selected hex and the linear uniform it produced
    - per-mask pixel coverage
    - lightmap min/max, in sRGB and linear
    - the active shader mode
    - pre-pass and draw timings
  - **Run pipeline check** renders the scene offscreen and checks that the rendered leather hue matches the selected hue. If the output comes back grey, it reports a FAIL.
  - **Log to console** dumps the same information to the console.
- **URL parameters**, useful for QA and sharing:
  - colours: `?leather=C62828&laces=000&binding=141414&swoosh=fff&stitching=c62828&embroidery=fff&liner=b3191f`
  - per-panel overrides: `&BOH=14213D&Web=…`
  - background: `&bg=transparent` or `&bg=FFFFFF`
  - lighting: `&highlight=1.2&roughness=0.3`
  - debug: `&debug=1`, `&grid=1`, `&view=7` (the view number comes from `VIEW` in `composite.glsl.js`)
- **Automation hook.** `window.glove` exposes `{ gr, materials, lighting, debug, grid, exporter, manifest }`. For example, `glove.materials.setColor('leather', '#123B75')`.

## Validation (qa/)

`npm run qa` regenerates everything in `qa/`:

- `leather_{red,blue,green,black,tan,white,navy,yellow}.png`: transparent-background renders with black binding and laces (tan laces on the black glove).
- `combo_navy_white_red.png`: navy leather, white swoosh and embroidery, red stitching and red liner.
- `view_*.png`: every debug view.
- `color_test_grid.png`, `ui_desktop.png`, `ui_desktop_debug.png`, `ui_mobile.png`.
- `report.json`: per-colour pipeline-check results, grid metrics, export checks and console errors.

Results of the last run:
- No console errors.
- All 8 validation colours PASS. The rendered hue is within 4° of the selected hue in every case, for example red 0°→0°, blue 218°→220° and tan 32°→31°.
- The colour test grid scored 10/10.
- Transparent export has corners at `rgba(0,0,0,0)`, and solid export has corners at `#111111`.

## Project structure

```
index.html                  shell + import map (three → vendor/three)
src/main.js                 bootstraps everything, URL config, window.glove
src/styles.css              responsive UI (side panel ≥901px, stacked below)
src/assets/views.json       list of camera views (generated)
src/assets/views/<id>/source/    the supplied PNGs (unmodified copies of Trap 1/, Trap 2/)
src/assets/views/<id>/derived/   Embroidery.png (generated by tools/analyze_assets.py)
src/assets/views/<id>/manifest.json  per-view manifest: masks, levels, exposure, analysis
src/renderer/AssetLoader.js     manifest + texture loading as data
src/renderer/LayerManager.js    one-time GPU pre-passes (packing, lightmap, blur, seam closing)
src/renderer/ViewManager.js     one renderer per camera view, shared uniforms, view switcher, 3D toggle
fabric/                         Fabric.js version: index.html, app.js, FabricStage.js, GloveFilter.js, three-shim.js
vendor/fabric/                  Fabric.js 7.4 ESM bundle
tools/build_fabric_maps.py      bakes per-view lighting/mask packs for the Fabric filter
src/renderer/ModelViewer.js     360° viewer: AI mesh + projected back photo + panel-coloured leather
src/assets/model/               glove.glb (labelled mesh) + model.json (back camera, labels)
research/3d-ai/                 AI reconstruction inputs/outputs + fitted cameras + fit check
tools/build_model.py            builds src/assets/model from research/3d-ai
src/renderer/GloveRenderer.js   per-view renderer, on-demand draw, readback + measurements
src/renderer/ExportManager.js   PNG export
src/materials/MaterialManager.js    colour channels → uniforms, panel overrides, background
src/materials/LightingController.js lighting params → uniforms, manifest exposure
src/materials/presets.js            colour presets, QA colours, default config
src/shaders/                    GLSL: common, prepass, composite
src/components/                 ColorController, ColorPicker, DebugPanel, ColorTestGrid
src/utils/                      colour + DOM helpers
tools/analyze_assets.py         pixel inspection → manifest + derived masks
tools/serve.mjs                 zero-dependency static server
tools/qa_capture.mjs            headless QA capture
```

## Adding another view

1. Copy the view's PNGs into `src/assets/views/<id>/source/`.
2. Add an entry to `VIEWS` in `tools/analyze_assets.py`. The entry needs:
   - a label
   - filename aliases
   - region notes
   - the embroidery parent, ROI and minimum brightness, where the view has embroidery
3. Run `npm run analyze`.

The UI, the switcher and All mode pick the new view up automatically. Masks a view doesn't have are bound to an empty texture.
