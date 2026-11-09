// Procedural holographic foil, drawn once on start-up into small canvases:
//  - crinkle: a normal map of tilted facets, like foil that's been pressed flat
//  - film:    how thick the rainbow film is at each spot (cells + fine diffraction lines)
//  - rim:     a colored version, used for the foil edges on the black cards
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
    b: 0.82 + r() * 0.18, // brightness for the colored version
  }));

  const crinkle = document.createElement('canvas');
  const film = document.createElement('canvas');
  const rim = document.createElement('canvas');
  for (const c of [crinkle, film, rim]) { c.width = size; c.height = size; }
  const cn = crinkle.getContext('2d').createImageData(size, size);
  const fl = film.getContext('2d').createImageData(size, size);
  const rm = rim.getContext('2d').createImageData(size, size);

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

      // Film thickness: smooth diagonal rainbow bands, fine diffraction lines, and a
      // small per-facet nudge so the crinkles catch slightly different colors.
      const u = x / size, v = y / size;
      const wave = Math.sin(TAU * (u + v)) * 0.5 + 0.5;
      const lines = Math.sin(TAU * (u * 3 - v * 2) * 12) * 0.5 + 0.5;
      const t = (best.f * 0.1 + wave * 0.72 + lines * 0.18) % 1;
      const tv = Math.round(t * 255);
      fl.data[i] = tv; fl.data[i + 1] = tv; fl.data[i + 2] = tv; fl.data[i + 3] = 255;

      // Colored foil: pastel rainbow (cyan, lilac, pink, peach, mint) from the film value.
      const h = (t * 360 + 180) % 360;
      const [cr, cg, cb] = hsl(h, 0.85, 0.74 * best.b + (1 - edge) * 0.1);
      rm.data[i] = cr; rm.data[i + 1] = cg; rm.data[i + 2] = cb; rm.data[i + 3] = 255;
    }
  }
  crinkle.getContext('2d').putImageData(cn, 0, 0);
  film.getContext('2d').putImageData(fl, 0, 0);
  rim.getContext('2d').putImageData(rm, 0, 0);
  return { crinkle, film, rim };
}

function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
