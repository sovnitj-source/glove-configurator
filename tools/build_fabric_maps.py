#!/usr/bin/env python3
"""
Pre-computes the per-view texture packs used by the Fabric.js version (fabric/).

The Three.js renderer derives its lighting maps on the GPU at load time (render-target
passes). Fabric.js filters are single-pass, so the same maps are baked here, once, into
opaque RGB PNGs (opaque => no browser alpha premultiplication can corrupt the data):

  src/assets/views/<id>/derived/fabric/
    light.png   R = shadow photo luminance (raw sRGB), G = small masked blur B1, B = large masked blur B2
                (blurs are of the levelled, linear lightmap; stored sRGB-encoded)
    pack0.png   Base, BOH, Fingers              (mask alpha in R, G, B)
    pack1.png   Palm, Web, Welting
    pack2.png   Binding, Laces, Palm Liner
    pack3.png   Swoosh, Swoosh Stitching, Swoosh Base
    pack4.png   Embroidery, closed coverage (seam fill), mask union

Mirrors src/renderer/LayerManager.js + shaders/prepass.glsl.js exactly (sigma 2.5 / 12, masked
blur, 7-tap morphological closing gated by the photo background).

Usage: python3 tools/build_fabric_maps.py     (needs numpy, pillow, scipy)
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parent.parent
VIEWS = ROOT / "src/assets/views"
PACKS = [
    ("Base", "BOH", "Fingers"),
    ("Palm", "Web", "Welting"),
    ("Binding", "Laces", "Palm Liner"),
    ("Swoosh", "Swoosh Stitching", "Swoosh Base"),
]


def srgb_to_lin(v):
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055)


def u8(a):
    return (np.clip(a, 0, 1) * 255).round().astype(np.uint8)


def build(view):
    vdir = VIEWS / view
    m = json.loads((vdir / "manifest.json").read_text())
    W, H = m["canvas"]["width"], m["canvas"]["height"]
    mask = lambda rel: np.asarray(Image.open(vdir / rel).convert("RGBA"))[..., 3] / 255.0
    masks = {k: mask(p) for k, p in m["masks"].items()}
    zero = np.zeros((H, W))
    get = lambda k: masks.get(k, zero)

    S = np.asarray(Image.open(vdir / m["lightmap"]).convert("RGBA"))[..., 0] / 255.0
    lv = m.get("levels", {"black": 0, "white": 1, "gamma": 1})
    levelled = np.clip((S - lv["black"]) / max(lv["white"] - lv["black"], 1e-4), 0, 1) ** lv["gamma"]
    L = srgb_to_lin(levelled)

    U = np.clip(sum(v for k, v in masks.items() if k != "Embroidery"), 0, 1)

    def masked_blur(sigma):
        num = nd.gaussian_filter(L * U, sigma, truncate=3.0, mode="constant")
        den = nd.gaussian_filter(U, sigma, truncate=3.0, mode="constant")
        return np.where(den > 1e-4, num / np.maximum(den, 1e-4), L)

    B1, B2 = masked_blur(2.5), masked_blur(12.0)

    closed = nd.minimum_filter(nd.maximum_filter(U, size=7), size=7)
    photo_is_glove = 1 - np.clip((S - 0.94) / (0.995 - 0.94), 0, 1) ** 2 * (3 - 2 * np.clip((S - 0.94) / (0.995 - 0.94), 0, 1))
    closed = np.maximum(U, closed * photo_is_glove)

    out = vdir / "derived/fabric"
    out.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.dstack([u8(S), u8(lin_to_srgb(B1)), u8(lin_to_srgb(B2))])).save(out / "light.png")
    for i, keys in enumerate(PACKS):
        Image.fromarray(np.dstack([u8(get(k)) for k in keys])).save(out / f"pack{i}.png")
    Image.fromarray(np.dstack([u8(get("Embroidery")), u8(closed), u8(U)])).save(out / "pack4.png")
    print(f"[{view}] {W}x{H} -> {out.relative_to(ROOT)}  present: {sorted(masks)}")


def main():
    for v in json.loads((ROOT / "src/assets/views.json").read_text())["views"]:
        build(v["id"])


if __name__ == "__main__":
    main()
