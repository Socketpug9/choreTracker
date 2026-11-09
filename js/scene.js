// The 3D layer for the top of the app: the balance as glossy black 3D numbers,
// a spinning chrome coin, and the 3D Add / Spend buttons. Everything reflects a
// small yellow "studio" so it matches the page behind it.
//
// Each 3D object follows a normal HTML element (its "anchor"). The HTML stays in
// charge of layout, tapping, and screen readers; the 3D just draws on top.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Mesh, Group, Color, MeshBasicMaterial, MeshPhysicalMaterial,
  BoxGeometry, PlaneGeometry, LatheGeometry, ExtrudeGeometry, Shape, Vector2, BackSide,
  PMREMGenerator, SRGBColorSpace, ACESFilmicToneMapping, DirectionalLight, MathUtils,
  TextGeometry, Font,
} from '../vendor/three.js';

const BUTTER = 0xF6D33C;

function studio(renderer, { wall, wallScale, lights, blacks, accent }) {
  // A box room with bright softboxes and dark panels. Shiny things look shiny
  // because of what they reflect, so this room is what gives them their look.
  const env = new Scene();
  env.add(new Mesh(new BoxGeometry(10, 10, 10), new MeshBasicMaterial({ color: new Color(wall).multiplyScalar(wallScale), side: BackSide })));
  const panel = (color, power, [w, h], [x, y, z], [rx, ry]) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(power), side: 2 }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    env.add(m);
  };
  for (const l of lights) panel(0xffffff, ...l);
  for (const b of blacks) panel(0x000000, 1, ...b);
  if (accent) panel(accent.color, accent.power, ...accent.at);
  const pmrem = new PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

function environments(renderer) {
  const lights = [
    [7, [7, 1.1], [0, 4.7, 0], [Math.PI / 2, 0]], // overhead strip
    [4, [1.4, 5], [-4.7, 0.6, 0.6], [0, Math.PI / 2]], // left softbox
    [2.4, [1.0, 3.6], [4.7, -0.4, -1.4], [0, -Math.PI / 2]], // right softbox
    [1.8, [3.2, 0.5], [0, -1.6, 4.7], [0, Math.PI]], // front kicker
  ];
  // Butter studio for the chrome button: mostly yellow, so its face stays even and readable.
  const butter = studio(renderer, {
    wall: BUTTER, wallScale: 0.95, lights,
    blacks: [[[10, 3.4], [0, -4.9, 0], [-Math.PI / 2, 0]]],
  });
  // High-contrast studio for the coin: yellow walls broken up by big black panels.
  const coin = studio(renderer, {
    wall: BUTTER, wallScale: 0.9, lights,
    blacks: [
      [[10, 4], [0, -4.9, 0], [-Math.PI / 2, 0]],
      [[3.6, 4], [2.2, 0.8, -4.9], [0, 0]],
      [[3, 5], [-4.9, -1.4, -1.5], [0, Math.PI / 2]],
      [[2.2, 2.6], [-1.8, 1.2, 4.9], [0, Math.PI]],
      [[1.6, 3], [2.4, -1.4, 4.9], [0, Math.PI]],
      [[3.4, 1.8], [0, -0.6, 4.9], [0, Math.PI]],
    ],
  });
  // Dark studio for black lacquer: black walls, white softboxes, a hint of butter.
  const dark = studio(renderer, {
    wall: 0x000000, wallScale: 1, lights, blacks: [],
    accent: { color: BUTTER, power: 1.2, at: [[4, 2], [0, -4.7, 0], [-Math.PI / 2, 0]] },
  });
  return { butter, coin, dark };
}

let ENV = null;
const lacquer = () => new MeshPhysicalMaterial({
  color: 0x020202, metalness: 0, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03,
  envMap: ENV.dark, envMapIntensity: 1.3,
});
const chrome = (env = ENV.butter) => new MeshPhysicalMaterial({
  color: 0xffffff, metalness: 1, roughness: 0.06, iridescence: 0.85, iridescenceIOR: 1.6,
  iridescenceThicknessMinimum: 220, iridescenceThicknessMaximum: 640, envMap: env, envMapIntensity: 1.1,
});

function coinGeometry(radius, thickness) {
  // Profile of a coin with a raised rim, spun around its axis.
  const t = thickness / 2;
  const r = radius;
  const pts = [
    [0, t * 0.62], [r * 0.80, t * 0.62], [r * 0.84, t * 0.98], [r * 0.93, t],
    [r * 0.985, t * 0.85], [r, t * 0.5], [r, -t * 0.5], [r * 0.985, -t * 0.85],
    [r * 0.93, -t], [r * 0.84, -t * 0.98], [r * 0.80, -t * 0.62], [0, -t * 0.62],
  ].map(([x, y]) => new Vector2(x, y));
  const g = new LatheGeometry(pts, 96);
  g.rotateX(Math.PI / 2); // face the camera
  return g;
}

function pillGeometry(w, h, depth) {
  const r = h / 2;
  const x = -w / 2 + r;
  const s = new Shape();
  s.moveTo(x, -r);
  s.lineTo(-x, -r);
  s.absarc(-x, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(x, r);
  s.absarc(x, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  const bevel = Math.min(8, h * 0.14);
  const g = new ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.85, bevelSegments: 8, curveSegments: 40,
  });
  g.translate(0, 0, -depth - bevel);
  return g;
}

export async function startScene(canvas, host, anchors, { fontUrl, reducedMotion = false } = {}) {
  const fontData = await (await fetch(fontUrl)).json();
  const font = new Font(fontData);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  ENV = environments(renderer);
  const sun = new DirectionalLight(0xffffff, 0.6);
  sun.position.set(-1, 2, 3);
  scene.add(sun);

  // Camera set up so 1 unit = 1 CSS pixel at z = 0, with a little real perspective.
  const camera = new PerspectiveCamera(24, 1, 1, 6000);
  let W = 1, H = 1;
  function resize() {
    const r = host.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.position.set(0, 0, H / 2 / Math.tan(MathUtils.degToRad(camera.fov / 2)));
    camera.updateProjectionMatrix();
    layout();
  }
  // Where an HTML element sits, in scene units.
  function place(el) {
    const h = host.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - h.left + r.width / 2 - W / 2, y: H / 2 - (r.top - h.top + r.height / 2), w: r.width, h: r.height };
  }

  /* ---------- Balance text ---------- */
  const balance = new Group();
  scene.add(balance);
  const textMat = lacquer();
  let textMesh = null;
  let textValue = '';
  let flip = 0;
  function setBalance(str) {
    if (str === textValue) return;
    const first = !textValue;
    textValue = str;
    if (textMesh) { textMesh.geometry.dispose(); balance.remove(textMesh); }
    const size = 100;
    const g = new TextGeometry(str, {
      font, size, depth: 22, curveSegments: 10, bevelEnabled: true, bevelThickness: 5, bevelSize: 1.5, bevelSegments: 5,
    });
    g.computeBoundingBox();
    const b = g.boundingBox;
    g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.max.z);
    textMesh = new Mesh(g, textMat);
    balance.add(textMesh);
    layout();
    if (!first && !reducedMotion) flip = 1;
  }

  /* ---------- Coin ---------- */
  const coin = new Group();
  const chromeMat = chrome(ENV.coin);
  const coinBody = new Mesh(coinGeometry(50, 15), chromeMat);
  coin.add(coinBody);
  const dollar = new TextGeometry('$', { font, size: 52, depth: 3, curveSegments: 12, bevelEnabled: true, bevelThickness: 1.6, bevelSize: 1.2, bevelSegments: 3 });
  dollar.computeBoundingBox();
  const db = dollar.boundingBox;
  dollar.translate(-(db.min.x + db.max.x) / 2, -(db.min.y + db.max.y) / 2, 0);
  const front = new Mesh(dollar, chromeMat);
  front.position.z = 15 * 0.31 - 1;
  const back = front.clone();
  back.rotation.y = Math.PI;
  back.position.z = -front.position.z;
  coin.add(front, back);
  scene.add(coin);
  let coinSpin = 0;
  let spinDir = 1;
  let coinY = 0;

  /* ---------- Buttons ---------- */
  const buttons = anchors.buttons.map(({ el, look }) => {
    const mesh = new Mesh(new PlaneGeometry(1, 1), look === 'chrome' ? chrome() : lacquer());
    scene.add(mesh);
    const state = { el, mesh, w: 0, h: 0, press: 0, target: 0 };
    el.addEventListener('pointerdown', () => { state.target = 1; });
    const up = () => { state.target = 0; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('pointercancel', up);
    return state;
  });

  function layout() {
    if (textMesh) {
      const p = place(anchors.balance);
      textMesh.geometry.computeBoundingBox();
      const b = textMesh.geometry.boundingBox;
      const bw = b.max.x - b.min.x;
      const s = Math.min(p.w / bw, (p.h * 0.86) / (b.max.y - b.min.y));
      // Line the 3D number up with the left edge of the text it replaces.
      balance.position.set(p.x - p.w / 2 + (bw * s) / 2, p.y, 0);
      balance.scale.setScalar(s);
    }
    const c = place(anchors.coin);
    coinY = c.y;
    coin.position.set(c.x, c.y, 0);
    coin.scale.setScalar(Math.min(c.w, c.h) / 100);
    for (const b of buttons) {
      const p = place(b.el);
      if (Math.abs(p.w - b.w) > 0.5 || Math.abs(p.h - b.h) > 0.5) {
        b.mesh.geometry.dispose();
        b.mesh.geometry = pillGeometry(p.w, p.h, 10);
        b.w = p.w; b.h = p.h;
      }
      b.mesh.position.set(p.x, p.y, 0);
    }
  }

  /* ---------- Motion ---------- */
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => {
    tilt.ty = ((e.clientX / window.innerWidth) - 0.5) * 0.5;
    tilt.tx = ((e.clientY / window.innerHeight) - 0.5) * 0.3;
  }, { passive: true });

  let visible = true;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(host);
  new ResizeObserver(resize).observe(host);
  if (document.fonts) document.fonts.ready.then(layout);

  let last = performance.now();
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min((t - last) / 1000, 0.05);
    last = t;
    if (!visible) return;
    const time = t / 1000;
    const k = 1 - Math.exp(-dt * 6);

    tilt.x += (tilt.tx - tilt.x) * k;
    tilt.y += (tilt.ty - tilt.y) * k;
    const sway = reducedMotion ? 0 : Math.sin(time * 0.6) * 0.12;
    balance.rotation.set(tilt.x * 0.5 + (reducedMotion ? 0 : Math.sin(time * 0.45) * 0.05), sway + tilt.y, 0);
    if (flip > 0) {
      flip = Math.max(0, flip - dt * 2.4);
      const e = flip * flip;
      balance.rotation.x -= e * 1.3;
    }

    if (!reducedMotion) coin.rotation.y += dt * (0.7 + coinSpin * coinSpin * 16 * spinDir);
    coinSpin = Math.max(0, coinSpin - dt * 0.9);
    coin.rotation.x = -0.25 + tilt.x * 0.6;
    coin.position.y = coinY + (reducedMotion ? 0 : Math.sin(time * 1.3) * 4);

    for (const b of buttons) {
      b.press += (b.target - b.press) * (1 - Math.exp(-dt * 22));
      b.mesh.position.z = -b.press * 9;
      b.mesh.scale.setScalar(1 - b.press * 0.035);
      b.mesh.rotation.set(tilt.x * 0.35, tilt.y * 0.35 + sway * 0.6, 0);
    }
    renderer.render(scene, camera);
  }

  resize();
  requestAnimationFrame(frame);

  return {
    setBalance,
    layout,
    spin(direction = 1) { coinSpin = 1; spinDir = direction < 0 ? -1 : 1; },
  };
}
