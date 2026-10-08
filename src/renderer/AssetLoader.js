import * as THREE from 'three';

const ASSET_ROOT = new URL('../assets/', import.meta.url);

// Loads views.json, then per view the manifest produced by tools/analyze_assets.py and every
// PNG it references. All textures are uploaded as DATA: no colour-space conversion, no
// premultiplication, no mipmaps, so mask alpha and lightmap RGB arrive in the shader bit-exact.
export class AssetLoader {
  constructor() {
    this.loader = new THREE.TextureLoader();
  }

  async json(rel) {
    const res = await fetch(new URL(rel, ASSET_ROOT));
    if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}. Run tools/analyze_assets.py`);
    return res.json();
  }

  async listViews() {
    return (await this.json('views.json')).views;
  }

  loadTexture(url) {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.NoColorSpace;
          tex.premultiplyAlpha = false;
          tex.generateMipmaps = false;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.needsUpdate = true;
          resolve(tex);
        },
        undefined,
        () => reject(new Error(`Failed to load ${url}`)),
      );
    });
  }

  async loadView(id) {
    const base = `views/${id}/`;
    const manifest = await this.json(base + 'manifest.json');
    const { width, height } = manifest.canvas;
    const url = (rel) => new URL(base + rel.split('/').map(encodeURIComponent).join('/'), ASSET_ROOT).href;
    const check = (tex, rel) => {
      if (tex.image.width !== width || tex.image.height !== height) {
        throw new Error(`${id}/${rel} is ${tex.image.width}x${tex.image.height}, expected ${width}x${height}`);
      }
      return tex;
    };
    const masks = {};
    const [shadow] = await Promise.all([
      this.loadTexture(url(manifest.lightmap)).then((t) => check(t, manifest.lightmap)),
      ...Object.entries(manifest.masks).map(async ([key, rel]) => {
        masks[key] = check(await this.loadTexture(url(rel)), rel);
      }),
    ]);
    return { manifest, masks, shadow };
  }
}
