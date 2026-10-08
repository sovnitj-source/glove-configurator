# Making the glove viewable in true 3D

## Status

The 3D toggle now shows the AI reconstruction: the back side is exact and the other sides are approximate. This was the approximate option chosen by the user. See "Experiment" below. The 2.5D relief prototype was removed.

## Background: what the earlier prototype was

The current toggle is a **2.5D relief**. Each of the three photos is pushed forward by an *estimated* depth map, and the viewer crossfades between photos as you rotate. It looks three-dimensional within about ±35° of each photo, but its geometry is guessed rather than measured. Angles that were never photographed, such as the pinky side, the top or the underside, have no data at all.

**Three 2D photos cannot produce an accurate 3D glove.** An accurate result needs real geometry from one of the three routes below.

## Option 1: scan the real glove (most accurate to *this* glove)

- **How it works:** Photograph the glove from 60 to 150 overlapping angles under even, diffuse light, or use a phone scanning app with LiDAR (Polycam, RealityScan, Luma). Photogrammetry then reconstructs the real mesh and texture.
- **Then:**
  1. Clean the mesh and retopologise it in Blender.
  2. Split the mesh into panels that match our channels: shell, BOH, fingers, palm, web, welting, binding, laces, liner, swoosh, stitching and embroidery.
  3. UV-unwrap each panel.
  4. Bake a neutral lighting/AO map, which plays the same role as our Shadow Layer.
- **Gotchas:**
  - Black, shiny leather scans badly. Scan a light-coloured glove, or dull the surface with scanning spray.
  - The laces and the open trap web need many close-up shots.
- **Effort:** about 1 day to capture, plus 2–4 days of 3D cleanup and panel splitting.

## Option 2: an artist-modelled or purchased glTF model (industry standard)

This is how commercial glove configurators are built (Rawlings, Wilson, and the Three.js glove configurators by HexaCoder and Flatbill). An artist models the glove with one mesh per panel, with UVs and baked AO. The web app loads a `.glb` file and sets each panel material's colour, exactly the way our `MaterialManager` already works.

- **Ready-made starting points:**
  - the customizable baseball glove model on [CGTrader](https://www.cgtrader.com/3d-models/sports/equipment/customizable-baseball-glove)
  - the baseball glove asset in [Adobe Substance 3D](https://substance3d.adobe.com/assets/collections/3d900e9d342a75a1cb9faa23adcafc1693d9f9bd/asset/5bdf8cb1ad50611d28081a193e65c8be5c3ea736)

  These would need adapting to the Vapor Elite pattern and trap web.
- **Effort:** about 1–2 weeks for a custom model of this exact glove, or 1–3 days to adapt a purchased one.

## Option 3: AI image-to-3D (fast, but not exact)

- **Tools:** [Hunyuan3D-2 multi-view](https://triposr.org/blog/free-image-to-3d) (which accepts front, side and back views) and TRELLIS can produce a textured mesh from our three photos.
- **Requirements:** a 16–29 GB GPU (not available on this machine), or a hosted service.
- **Limits:** the geometry is approximate. Laces, the trap web and panel seams usually come out melted or merged, and the result still needs manual panel splitting in Blender.
- **Verdict:** good for a quick visual prototype, but not for an accurate product configurator.

## What changes in the code once there is a model

The colour system carries over unchanged:

- `MaterialManager`, the presets, undo/redo, the panel UI and export stay as they are.
- A new `ModelViewer` loads `glove.glb` with `GLTFLoader` and finds each panel mesh by name (for example, `Base`, `BOH`, `Laces`).
- Each panel gets a `MeshPhysicalMaterial`, with the baked AO map, a leather normal map and sheen, and roughness of about 0.6. Its `color` is driven by the same shared colour uniforms.
- Lighting uses an HDRI environment with OrbitControls, giving full 360° viewing.
- The 3D toggle switches to `ModelViewer` instead of the relief viewer.

Estimated integration time once a panel-split `.glb` exists: **about 1 day**.

## Experiment: AI reconstruction from our three photos (done)

I ran the experiment on 7 Oct 2026. The files are in `research/3d-ai/`.

- **Inputs:**
  - the three shadow photos, background-removed with our masks and scaled to the same glove height
  - the side photo rotated so the fingers point up
- **Model:** Hunyuan3D-2mv (`/shape_generation`) on the public Hugging Face Space. The `/generation_all` endpoint (shape + texture) fails on the Space with a `PyMeshLabException`.
- **First run, side photo passed as "right":** the glove came out **mirrored** (thumb on the wrong side).
- **Second run, side photo passed as "left":** handedness was correct. The mesh has about 970k faces and was simplified to about 195k (`hunyuan3d-2mv_glove.glb`).
- **Camera fitting:** each photo's camera was fitted by matching the projected mesh silhouette to our masks (`fitted_cameras.json`).

| Photo | Silhouette IoU | Visual check (`fit_check_photo_vs_mesh.png`) |
|---|---|---|
| Back | 0.90 | **Matches:** back of hand, wrist opening, web on the right, laces |
| Side | 0.82 | **Does not match:** no thumb-side profile and no swoosh area |
| Palm | 0.88 | **Does not match:** different pocket shape and opening angle |

**Conclusion.** The AI mesh is accurate only for the view it treats as "front". It invents the side and palm geometry, so projecting our photos onto it would misplace the swoosh, the embroidery and the laces. Three photos are not enough for an accurate result, even with AI.

## Recommendation

- **For accuracy to this exact glove:** Option 1, a scan, or Option 2, a commissioned model.
- **For speed:** Option 2 with a purchased glove model, adapted.

Until one of these exists, the 3D toggle can't be made accurate. It should either be hidden or clearly labelled as a "preview".
