// The 3D piece at the top of the app: one holographic foil card floating behind
// the balance, like a chrome object behind big type. The card is a beveled frame
// with an inset face. The face is icy blue foil with fine lines and a white glare,
// and turns pink, orange, and violet toward the edges as it tilts.
//
// It follows an HTML element (its "anchor") for size and position, and sits
// behind the page's text.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Mesh, Group, Color, MeshBasicMaterial, MeshPhysicalMaterial,
  BoxGeometry, PlaneGeometry, ExtrudeGeometry, Shape, Vector2, BackSide,
  PMREMGenerator, SRGBColorSpace, NoToneMapping, DirectionalLight, MathUtils,
  CanvasTexture, RepeatWrapping, NoColorSpace,
} from '../vendor/three.js';

const BUTTER = 0xF6D33C;

// A box room with softboxes and colored panels. Shiny things look the way they
// do because of what they reflect, so this room is most of the foil's look.
function studio(renderer) {
  const env = new Scene();
  env.add(new Mesh(new BoxGeometry(10, 10, 10), new MeshBasicMaterial({ color: new Color(BUTTER).multiplyScalar(0.55), side: BackSide })));
  const panel = (color, power, [w, h], [x, y, z], [rx, ry]) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(power), side: 2 }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    env.add(m);
  };
  panel(0xffffff, 9, [3.2, 2.2], [-2.2, 2.4, 4.6], [0, Math.PI]); // the big glare, top left in front
  panel(0xffffff, 5, [7, 1.1], [0, 4.7, 0], [Math.PI / 2, 0]); // overhead strip
  panel(0xffffff, 3, [1.4, 5], [-4.7, 0.6, 0.6], [0, Math.PI / 2]); // left softbox
  panel(0x7FD8FF, 2.2, [3, 4], [4.7, 0.2, 0.8], [0, -Math.PI / 2]); // cyan wall
  panel(0xFF8FC8, 2, [3, 2.4], [-4.7, -1.8, -1.6], [0, Math.PI / 2]); // pink wall
  panel(0x000000, 1, [10, 4], [0, -4.9, 0], [-Math.PI / 2, 0]); // dark floor
  const pmrem = new PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

// Recolors the reflections through a holographic palette chosen by how much a
// surface faces you, plus bands from the foil pattern: cyan head-on, then blue,
// violet, pink, orange toward grazing angles. Only the brightest spots go white,
// like the glare on real foil.
const holoTime = { value: 0 };
function holo(material, { lift = 0, strength = 0.9, base = 0.5, bands = 0.5, glare = 0 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHoloTime = holoTime;
    shader.uniforms.uFilm = { value: material.iridescenceThicknessMap };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uHoloTime;
        uniform sampler2D uFilm;
        vec3 holoPalette(float k) {
          vec3 c = mix(vec3(0.42, 0.86, 1.00), vec3(0.22, 0.62, 1.00), smoothstep(0.00, 0.22, k));
          c = mix(c, vec3(0.26, 0.40, 1.00), smoothstep(0.22, 0.42, k));
          c = mix(c, vec3(0.70, 0.46, 0.98), smoothstep(0.42, 0.60, k));
          c = mix(c, vec3(1.00, 0.50, 0.74), smoothstep(0.60, 0.76, k));
          c = mix(c, vec3(1.00, 0.64, 0.30), smoothstep(0.76, 0.90, k));
          return mix(c, vec3(1.00, 0.86, 0.48), smoothstep(0.90, 1.00, k));
        }`)
      .replace('#include <opaque_fragment>', `
        {
          float film = texture2D(uFilm, vNormalMapUv).g;
          float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float k = clamp((1.0 - facing) * 1.5 + (film - 0.35) * ${bands.toFixed(2)} + ${lift.toFixed(2)} + sin(uHoloTime * 0.35) * 0.05, 0.0, 1.0);
          float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
          // Brightness is capped so the colors stay saturated instead of clipping to white.
          vec3 col = holoPalette(k) * min(${base.toFixed(2)} + lum * 0.85, 1.05);
          // A soft white glare spot that slides across the surface as it tilts.
          vec3 refl = reflect(-normalize(vViewPosition), normal);
          vec2 spot = vNormalMapUv - (vec2(-0.22, 0.2) + refl.xy * vec2(-1.1, -1.1));
          float g = exp(-dot(spot, spot) / 0.035);
          col = mix(col, vec3(1.0), clamp(g * ${glare.toFixed(2)}, 0.0, 0.85));
          outgoingLight = mix(outgoingLight, col, ${strength.toFixed(2)});
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `holo-${lift}-${strength}-${base}-${bands}-${glare}`;
  return material;
}

function roundedRect(w, h, r) {
  const s = new Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export async function startScene(canvas, host, anchors, { foil, reducedMotion = false } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
  renderer.outputColorSpace = SRGBColorSpace;
  // No film-style tone mapping: it washes the foil's colors toward white.
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const envMap = studio(renderer);
  const sun = new DirectionalLight(0xffffff, 0.5);
  sun.position.set(-1, 2, 3);
  scene.add(sun);

  const tex = (canvasEl, repeat) => {
    const t = new CanvasTexture(canvasEl);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = NoColorSpace;
    t.anisotropy = 8;
    t.repeat.set(repeat, repeat);
    return t;
  };

  // Geometry is built at 200 units wide and scaled to fit the anchor.
  const W = 200, H = 168, R = 30;
  const card = new Group();
  const frameMat = holo(new MeshPhysicalMaterial({
    color: 0xffffff, metalness: 1, roughness: 0.2,
    normalMap: tex(foil.crinkle, 1 / 70), normalScale: new Vector2(0.06, 0.06),
    iridescenceThicknessMap: tex(foil.film, 1 / 200),
    envMap, envMapIntensity: 1.1,
  }), { lift: 0.6, strength: 0.9, base: 0.06, bands: 0.18, glare: 0 });
  const faceMat = holo(new MeshPhysicalMaterial({
    color: 0xffffff, metalness: 1, roughness: 0.1,
    normalMap: tex(foil.crinkle, 1 / 160), normalScale: new Vector2(0.03, 0.03),
    iridescenceThicknessMap: tex(foil.film, 1 / 170),
    clearcoat: 1, clearcoatRoughness: 0.05,
    envMap, envMapIntensity: 1.2,
  }), { lift: 0, strength: 0.94, base: 0.5, bands: 0.75, glare: 1.2 });

  const frame = new Mesh(new ExtrudeGeometry(roundedRect(W, H, R), {
    depth: 18, bevelEnabled: true, bevelThickness: 9, bevelSize: 8, bevelSegments: 10, curveSegments: 24,
  }), frameMat);
  frame.geometry.translate(0, 0, -27);
  const face = new Mesh(new ExtrudeGeometry(roundedRect(W - 44, H - 44, R - 14), {
    depth: 2, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 4, curveSegments: 24,
  }), faceMat);
  face.geometry.translate(0, 0, -1);
  card.add(frame, face);
  scene.add(card);

  // Camera set up so 1 unit = 1 CSS pixel at z = 0, with a little real perspective.
  const camera = new PerspectiveCamera(26, 1, 1, 6000);
  let CW = 1, CH = 1;
  let base = { x: 0, y: 0 };
  function layout() {
    const h = host.getBoundingClientRect();
    const r = anchors.object.getBoundingClientRect();
    base = { x: r.left - h.left + r.width / 2 - CW / 2, y: CH / 2 - (r.top - h.top + r.height / 2) };
    card.scale.setScalar(r.width / W);
  }
  function resize() {
    const r = host.getBoundingClientRect();
    CW = Math.max(1, r.width);
    CH = Math.max(1, r.height);
    renderer.setSize(CW, CH, false);
    camera.aspect = CW / CH;
    camera.position.set(0, 0, CH / 2 / Math.tan(MathUtils.degToRad(camera.fov / 2)));
    camera.updateProjectionMatrix();
    layout();
  }

  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => {
    tilt.ty = ((e.clientX / window.innerWidth) - 0.5) * 0.6;
    tilt.tx = ((e.clientY / window.innerHeight) - 0.5) * 0.4;
  }, { passive: true });

  let visible = true;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(host);
  new ResizeObserver(resize).observe(host);

  let flip = 0, flipDir = 1;
  let last = performance.now();
  function frameLoop(t) {
    requestAnimationFrame(frameLoop);
    const dt = Math.min((t - last) / 1000, 0.05);
    last = t;
    if (!visible) return;
    const time = reducedMotion ? 0 : t / 1000;
    holoTime.value = time;
    const k = 1 - Math.exp(-dt * 4);
    tilt.x += (tilt.tx - tilt.x) * k;
    tilt.y += (tilt.ty - tilt.y) * k;

    // A slow drift, so the foil keeps catching the light.
    let ry = -0.42 + Math.sin(time * 0.32) * 0.38 + tilt.y;
    const rx = 0.18 + Math.sin(time * 0.23 + 1) * 0.14 + tilt.x;
    if (flip > 0) {
      flip = Math.max(0, flip - dt * 1.1);
      const e = 1 - flip;
      ry += flipDir * Math.PI * 2 * (e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2);
    }
    card.rotation.set(rx, ry, -0.08 + Math.sin(time * 0.27) * 0.04);
    card.position.set(base.x, base.y + Math.sin(time * 0.9) * 5, 0);
    renderer.render(scene, camera);
  }

  resize();
  requestAnimationFrame(frameLoop);

  return {
    layout,
    // A full turn when money moves (backwards for spending).
    spin(direction = 1) { if (!reducedMotion) { flip = 1; flipDir = direction < 0 ? -1 : 1; } },
  };
}
