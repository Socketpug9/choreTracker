// Procedural holographic foil, drawn once on start-up into small canvases:
//  - crinkle: a normal map of tilted facets, like foil that's been pressed flat
//  - film:    how thick the rainbow film is at each spot (cells + fine diffraction lines)
// Every texture tiles seamlessly.

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeFoil(size = 256, cells = 150, seed = 7) {
  const r = rand(seed);
  const pts = Array.from({ length: cells }, () => ({
    x: r() * size, y: r() * size,
    nx: (r() - 0.5) * 0.7, ny: (r() - 0.5) * 0.7, // facet tilt
    f: r(), // film thickness offset
  }));

  const crinkle = document.createElement('canvas');
  const film = document.createElement('canvas');
  for (const c of [crinkle, film]) { c.width = size; c.height = size; }
  const cn = crinkle.getContext('2d').createImageData(size, size);
  const fl = film.getContext('2d').createImageData(size, size);

  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Nearest and second-nearest facet (with wrap-around so it tiles).
      let d1 = Infinity, d2 = Infinity, best = null;
      for (const p of pts) {
        let dx = Math.abs(x - p.x); if (dx > size / 2) dx = size - dx;
        let dy = Math.abs(y - p.y); if (dy > size / 2) dy = size - dy;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
      }
      const edge = Math.min(1, (Math.sqrt(d2) - Math.sqrt(d1)) / 2.2); // 0 on a crease
      const i = (y * size + x) * 4;

      // Normal map: facet tilt, flattened slightly near creases.
      const nx = best.nx * edge, ny = best.ny * edge;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      cn.data[i] = (nx * 0.5 + 0.5) * 255;
      cn.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      cn.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      cn.data[i + 3] = 255;

      // Film thickness: smooth diagonal bands, fine horizontal lines, and a
      // small per-facet nudge so the crinkles catch slightly different colors.
      const u = x / size, v = y / size;
      const wave = Math.sin(TAU * (u + v)) * 0.5 + 0.5;
      const lines = Math.sin(TAU * v * 56) * 0.5 + 0.5; // fine horizontal lines, like a hologram
      const t = (best.f * 0.1 + wave * 0.72 + lines * 0.18) % 1;
      const tv = Math.round(t * 255);
      fl.data[i] = tv; fl.data[i + 1] = tv; fl.data[i + 2] = tv; fl.data[i + 3] = 255;
    }
  }
  crinkle.getContext('2d').putImageData(cn, 0, 0);
  film.getContext('2d').putImageData(fl, 0, 0);
  return { crinkle, film };
}

