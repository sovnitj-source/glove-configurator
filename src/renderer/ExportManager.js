// Exports exactly what the GPU renders, never the source assets.
//   Single view: native resolution of that view.
//   All views:   side by side, each cropped to its glove and scaled to equal glove size.
export class ExportManager {
  constructor(viewManager, materials) {
    this.vm = viewManager;
    this.materials = materials;
  }

  // Render one view with final composite + chosen background, then return its canvas.
  renderFinal(gr, transparent) {
    const u = gr.uniforms;
    this.saved = { mode: u.uBgMode.value, view: u.uView.value, focus: u.uFocusAmt.value };
    u.uFocusAmt.value = 0;
    u.uBgMode.value = transparent ? 0 : 1;
    u.uView.value = 0; // always export the final composite
    gr.render();
    return gr.canvas;
  }

  restore() {
    const u = this.vm.shared;
    u.uBgMode.value = this.saved.mode;
    u.uView.value = this.saved.view;
    u.uFocusAmt.value = this.saved.focus;
    this.vm.renderAll();
  }

  async toBlob({ transparent = false } = {}) {
    if (this.vm.is3D) return this.vm.viewer.toBlob({ transparent });
    let canvas;
    if (this.vm.mode === 'all') {
      // Each view renders transparent, cropped to its glove and scaled to equal glove size.
      canvas = this.vm.composeAll((gr) => this.renderFinal(gr, true), {
        transparent, background: this.materials.config.background,
      });
    } else {
      canvas = this.renderFinal(this.vm.active, transparent);
    }
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    this.restore();
    return blob;
  }

  async download({ transparent = false } = {}) {
    const blob = await this.toBlob({ transparent });
    const c = this.materials.config;
    const view = this.vm.is3D ? '3d' : this.vm.mode === 'all' ? 'all-views' : this.vm.activeId;
    const name = `glove_${view}_${c.leather.slice(1)}_${c.laces.slice(1)}${transparent ? '_transparent' : ''}.png`.toLowerCase();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
