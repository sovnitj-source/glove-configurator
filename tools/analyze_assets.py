#!/usr/bin/env python3
"""
Asset analysis for the glove configurator (multi-view).

For each view in VIEWS it inspects every PNG in src/assets/views/<view>/source
pixel-by-pixel, classifies it from its actual content (not its filename), and writes:

  src/assets/views/<view>/manifest.json           manifest consumed by the runtime
  src/assets/views/<view>/derived/Embroidery.png  mask of the "VAPOR Elite" embroidery
                                                  baked into the shadow photo
  src/assets/views.json                           list of views for the UI

Optional (--lightmaps): reference GLOVE_*_LIGHTMAP PNGs per view (not needed at runtime).

Usage:  python3 tools/analyze_assets.py [view ...] [--lightmaps]
Needs:  numpy, pillow, scipy
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "src/assets"

# Semantic mask keys used by the renderer, and the colour channel each one drives.
CHANNELS = {
    "Base": "leather",
    "BOH": "leather",
    "Fingers": "leather",
    "Palm": "leather",
    "Web": "leather",
    "Welting": "leather",
    "Binding": "binding",
    "Laces": "laces",
    "Palm Liner": "liner",
    "Swoosh": "swoosh",
    "Swoosh Stitching": "stitching",
    "Swoosh Base": "swooshBase",
    "Embroidery": "embroidery",
}

# Per-view configuration. Region notes were determined by viewing each mask against
# the shadow photo (see the "Material IDs" debug view).
VIEWS = {
    "back": {
        "label": "Back",
        "aliases": {},
        "regions": {
            "Base": "wrist back panel (carries the VAPOR Elite embroidery)",
            "BOH": "back-of-hand / finger-stall shells",
            "Fingers": "recessed finger inlay panels",
            "Palm": "thumb-side palm panel",
            "Web": "web / thumb back panel",
            "Welting": "welting strips between panels",
            "Binding": "wrist opening + hem binding",
            "Laces": "all lacing incl. knots and tails",
            "Palm Liner": "visible interior through wrist opening",
            "Swoosh": "white swoosh seen edge-on at the wrist",
            "Swoosh Stitching": "stitched border around the swoosh",
        },
        "embroideryRoi": None,  # dominant high-pass cluster on Base
    },
    "side": {
        "label": "Side",
        "aliases": {"Boh": "BOH"},
        "regions": {
            "Base": "main shell: thumb side, heel and wrist (carries '…R Elite')",
            "BOH": "back-of-hand strip at the top edge",
            "Fingers": "finger-stall strip at the top edge",
            "Palm": "thumb/palm panel behind the lacing",
            "Web": "trap web pocket piece",
            "Welting": "welting strips",
            "Binding": "heel binding + finger-hole binding",
            "Laces": "all lacing incl. knots and tails",
            "Palm Liner": "interior seen through the finger hole",
            "Swoosh": "white swoosh outline / piping",
            "Swoosh Stitching": "stitched border around the swoosh",
            "Swoosh Base": "swoosh fill (black leather in the photo)",
        },
        "embroideryRoi": [40, 225, 200, 320],  # x0, y0, x1, y1 around '…R Elite'
    },
    "palm": {
        "label": "Palm",
        "aliases": {},
        "regions": {
            "Palm": "palm / pocket face (carries the VAPOR Elite embroidery + debossed swoosh)",
            "Base": "thumb edge",
            "BOH": "pinky-side edge strip",
            "Fingers": "finger-gap strips",
            "Web": "trap web",
            "Welting": "welting strips",
            "Binding": "heel binding",
            "Laces": "all lacing incl. knots and tails",
        },
        "embroideryParent": "Palm",
        "embroideryMinLum": 195,  # thread is ~230+, palm wrinkle highlights reach ~180
        "embroideryRoi": [410, 515, 615, 605],
    },
}


def srgb_to_lin(v):
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def describe(name, px):
    rgb, a = px[..., :3], px[..., 3]
    vis = a > 0
    vrgb = rgb[vis]
    chroma = float((vrgb.max(1) - vrgb.min(1)).max()) if vis.any() else 0.0
    lum = vrgb.mean(1) if vis.any() else np.zeros(1)
    rgb_constant = float(lum.std()) < 0.5
    ys, xs = np.where(vis)
    info = {
        "file": "source/" + name,
        "width": px.shape[1],
        "height": px.shape[0],
        "channels": "RGBA",
        "alphaCoverage": round(float(vis.mean()), 4),
        "alphaOpaquePx": int((a == 255).sum()),
        "alphaPartialPx": int(((a > 0) & (a < 255)).sum()),
        "hasTransparentPx": bool((a == 0).any()),
        "rgbGrayscale": chroma == 0,
        "rgbConstant": rgb_constant,
        "rgbMeanLum": round(float(lum.mean()), 1),
        "rgbLumRange": [int(lum.min()), int(lum.max())],
        "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if vis.any() else None,
    }
    if rgb_constant and info["hasTransparentPx"]:
        # Constant (white) RGB carries no information -> alpha is geometry.
        info.update(type="material_mask", useChannel="alpha", colorizable=True, containsShading=False)
    elif info["rgbGrayscale"] and not rgb_constant and info["alphaCoverage"] > 0.99:
        info.update(type="lightmap_source", useChannel="rgb.r (sRGB luminance of a photographed glove)",
                    colorizable=False, containsShading=True)
    else:
        info["type"] = "unknown"
    return info


def analyze_view(view_id, want_lightmaps):
    cfg = VIEWS[view_id]
    vdir = ASSETS / "views" / view_id
    src, derived = vdir / "source", vdir / "derived"
    derived.mkdir(parents=True, exist_ok=True)

    files = sorted(p.name for p in src.glob("*.png"))
    px = {f: np.asarray(Image.open(src / f).convert("RGBA")).astype(np.float64) for f in files}
    sizes = {px[f].shape[:2] for f in files}
    assert len(sizes) == 1, f"[{view_id}] assets are not on a shared canvas: {sizes}"
    H, W = sizes.pop()

    manifest = {"id": view_id, "label": cfg["label"], "canvas": {"width": W, "height": H},
                "assets": {}, "masks": {}, "lighting": {}, "derived": {}}
    for f in files:
        manifest["assets"][Path(f).stem] = describe(f, px[f])

    light = [k for k, v in manifest["assets"].items() if v["type"] == "lightmap_source"]
    assert len(light) == 1, f"[{view_id}] expected exactly one lightmap source, got {light}"
    light = light[0]
    manifest["lightmap"] = manifest["assets"][light]["file"]
    S = px[light + ".png"][..., 0] / 255.0
    A = px[light + ".png"][..., 3] / 255.0

    masks = {}
    for stem, info in manifest["assets"].items():
        if info["type"] != "material_mask":
            continue
        key = cfg["aliases"].get(stem, stem)
        assert key in CHANNELS, f"[{view_id}] unknown mask '{stem}' — add it to CHANNELS/aliases"
        masks[key] = px[info["file"][7:]][..., 3] / 255.0
        info.update(semanticKey=key, channel=CHANNELS[key], region=cfg["regions"].get(key, ""))
        manifest["masks"][key] = info["file"]

    total = sum(masks.values())
    union = np.clip(total, 0, 1)
    # Tight bounds of the glove itself (used to crop/scale views so gloves display at equal size).
    gy, gx = np.where(union > 0.02)
    manifest["gloveBBox"] = [int(gx.min()), int(gy.min()), int(gx.max()) + 1, int(gy.max()) + 1]
    inside = union > 0.5
    leather_sel = sum(masks[k] for k in masks if CHANNELS[k] == "leather") > 0.8

    # ---- layer analysis ----
    names = list(masks)
    overlaps = []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            n = int((np.minimum(masks[a], masks[b]) > 0.9).sum())
            if n:
                overlaps.append({"a": a, "b": b, "px": n})
    manifest["layerAnalysis"] = {
        "solidOverlapPx": int(sum(o["px"] for o in overlaps)),
        "overlaps": overlaps,
        "alphaSumPercentiles_1_50_99": [round(float(v), 3) for v in np.percentile(total[total > 0], [1, 50, 99])],
        "conclusion": "Masks partition the glove; overlaps are anti-aliased edges only. Rendered with a "
                      "coverage-weighted blend (sum m_i*c_i / sum m_i).",
    }

    # ---- lightmap levels ----
    # The photo may be of a light OR dark glove. Levels (white point + gamma) map the leather's
    # tonal range onto the same range the white-glove photo has, so one material model works for
    # every view: leather median -> TARGET_MEDIAN, leather p99.5 -> 1.
    TARGET_MEDIAN = 0.745  # leather median of the white-glove (back) photo, sRGB
    white = float(np.clip(np.percentile(S[leather_sel], 99.5), 0.05, 1.0))
    med = float(np.percentile(S[leather_sel], 50)) / white
    gamma = float(np.clip(np.log(TARGET_MEDIAN) / np.log(max(med, 1e-3)), 0.15, 1.0))
    if abs(gamma - 1) < 0.05 and white > 0.97:
        white, gamma = 1.0, 1.0
    manifest["levels"] = {"black": 0.0, "white": round(white, 4), "gamma": round(gamma, 4)}
    Sl = np.clip(S / white, 0, 1) ** gamma

    manifest["lighting"] = {
        "source": light,
        "rgbEqualsLuminance": bool(np.all(px[light + ".png"][..., 0] == px[light + ".png"][..., 1])),
        "alphaCorrelatesWithLuminance": round(float(np.corrcoef(S[inside], A[inside])[0, 1]), 3),
        "rgbRangeInsideGlove": [int(S[inside].min() * 255), int(S[inside].max() * 255)],
        "leatherMedianRaw": round(float(np.percentile(S[leather_sel], 50)) * 255, 1),
        "photographedGlove": "light" if np.percentile(S[leather_sel], 50) > 0.5 else "dark",
        "perMaskLuminancePercentiles_5_50_95": {
            k: [int(v * 255) for v in np.percentile(S[m > 0.5], [5, 50, 95])] for k, m in masks.items() if (m > 0.5).any()
        },
        "conclusion": "RGB is a full-range luminance photo used as the lightmap after levels "
                      "(white/gamma above) and sRGB->linear decoding on the GPU. Alpha is ignored.",
    }

    # ---- per-channel exposure on the levelled lightmap ----
    Slin = srgb_to_lin(Sl)
    wp_leather = float(np.percentile(Slin[leather_sel], 97))

    def exposure_for(key, damp):
        if key not in masks or not (masks[key] > 0.8).any():
            return 1.0
        wp = float(np.percentile(Slin[masks[key] > 0.8], 95))
        return round(float(np.clip((wp_leather / max(wp, 1e-4)) ** damp, 1.0, 8.0)), 3)

    manifest["exposure"] = {
        "whitePointLinear": round(wp_leather, 4),
        "leather": 1.0,
        "stitching": exposure_for("Swoosh Stitching", 0.5),
        "liner": exposure_for("Palm Liner", 0.55),
        "swooshBase": exposure_for("Swoosh Base", 0.5),
    }

    # ---- derived: embroidery mask (bright thread on the Base panel) ----
    # Detected on the RAW photo: levels would compress white thread against a dark glove.
    parent = cfg.get("embroideryParent", "Base")
    base = masks[parent]
    Sb = S * 255
    med_f = nd.median_filter(Sb, size=21)
    hp = Sb - med_f
    min_lum = cfg.get("embroideryMinLum", 150)
    cand = (hp > 35) & (base > 0.5) & (Sb > min_lum)
    roi = cfg["embroideryRoi"]
    if roi:
        box = np.zeros_like(cand)
        box[roi[1]:roi[3], roi[0]:roi[2]] = True
        cand &= box
    clusters, n = nd.label(nd.binary_dilation(cand, iterations=12))
    emb = np.zeros_like(S)
    if n:
        areas = nd.sum(cand, clusters, range(1, n + 1))
        keep = clusters == (int(np.argmax(areas)) + 1)
        region = nd.binary_dilation(keep & cand, iterations=3)
        soft = np.clip((hp - 12) / 28, 0, 1) * np.clip((Sb - min_lum) / 65, 0, 1)
        emb = soft * region * base
        # Drop tiny isolated fragments (leather sparkle), keep letter strokes.
        lab, nl = nd.label(nd.binary_dilation(emb > 0.25, iterations=1))
        if nl:
            sizes = nd.sum(emb > 0.25, lab, range(1, nl + 1))
            small = np.isin(lab, np.where(sizes < 10)[0] + 1)
            emb = np.where(small | (lab == 0), 0, emb)
        emb = nd.gaussian_filter(emb, 0.35)
    emb_a = (np.clip(emb, 0, 1) * 255).round().astype(np.uint8)
    Image.fromarray(np.dstack([np.full_like(emb_a, 255)] * 3 + [emb_a])).save(derived / "Embroidery.png")
    ys, xs = np.where(emb_a > 0)
    manifest["derived"]["Embroidery"] = {
        "file": "derived/Embroidery.png", "type": "material_mask", "channel": "embroidery", "parent": parent,
        "generatedFrom": f"{light}.png high-pass within {parent} alpha" + (f", ROI {roi}" if roi else ""),
        "alphaCoverage": round(float((emb_a > 0).mean()), 5),
        "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None,
    }
    manifest["masks"]["Embroidery"] = "derived/Embroidery.png"

    if want_lightmaps:
        save = lambda arr, name: Image.fromarray(np.clip(arr * 255, 0, 255).round().astype(np.uint8)).save(derived / name)
        save(Sl, f"GLOVE_MASTER_LIGHTMAP_{W}x{H}.png")
        groups = {"LEATHER": ["leather", "binding"], "LACES": ["laces"], "LINER": ["liner"],
                  "BRANDING": ["swoosh", "stitching", "swooshBase"]}
        for g, chans in groups.items():
            m = np.clip(sum((masks[k] for k in masks if CHANNELS[k] in chans), np.zeros_like(S)), 0, 1)
            save(Sl * m, f"GLOVE_{g}_LIGHTMAP_{W}x{H}.png")

    (vdir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"\n[{view_id}] canvas {W}x{H}, lightmap '{light}' ({manifest['lighting']['photographedGlove']} glove)")
    for k, v in manifest["assets"].items():
        print(f"  {k:18s} {v['type']:16s} cov={v['alphaCoverage']*100:5.1f}%  -> {v.get('semanticKey', '-')}"
              f" / {v.get('channel', '-')}")
    print("  levels:", manifest["levels"], " exposure:", manifest["exposure"])
    print("  embroidery:", manifest["derived"]["Embroidery"]["bbox"], manifest["derived"]["Embroidery"]["alphaCoverage"])
    print("  solid overlaps:", manifest["layerAnalysis"]["solidOverlapPx"], "px", " glove bbox:", manifest["gloveBBox"])
    return {"id": view_id, "label": cfg["label"], "width": W, "height": H}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ids = args or list(VIEWS)
    for v in ids:
        analyze_view(v, "--lightmaps" in sys.argv)
    # views.json always lists every configured view that has a manifest
    listed = []
    for v, cfg in VIEWS.items():
        mf = ASSETS / "views" / v / "manifest.json"
        if mf.exists():
            m = json.loads(mf.read_text())
            listed.append({"id": v, "label": cfg["label"], "width": m["canvas"]["width"], "height": m["canvas"]["height"]})
    (ASSETS / "views.json").write_text(json.dumps({"views": listed}, indent=2))


if __name__ == "__main__":
    main()
