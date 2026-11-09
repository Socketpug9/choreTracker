// A small "stable fluids" simulation (velocity, pressure, swirl) drawn as crisp
// two-tone ink: deep marigold liquid moving on butter yellow. Runs on the GPU via three.js.
// A slow, ever-changing current keeps it moving, and three drifting pour points keep
// adding liquid as the old shapes fade, so the background never stops or empties out.
import {
  WebGLRenderer, WebGLRenderTarget, Scene, OrthographicCamera, Mesh, PlaneGeometry,
  ShaderMaterial, HalfFloatType, LinearFilter, NearestFilter, RGBAFormat, Vector2, Vector3,
} from '../vendor/three.js';

const SIM_RES = 128;
const DYE_RES = 1024;
const PRESSURE_ITERATIONS = 18;
const CURL = 6;
const VELOCITY_DISSIPATION = 0.35;
const DYE_DISSIPATION = 0.3;
const SPLAT_FORCE = 5200;

const baseVert = /* glsl */`
  uniform vec2 texelSize;
  varying vec2 vUv, vL, vR, vT, vB;
  void main() {
    vUv = uv;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const shaders = {
  // Pulls the velocity toward a slowly changing, swirling current (curl of a moving wave field).
  current: `
    uniform sampler2D uVelocity; uniform float time, aspect, strength, rate; varying vec2 vUv;
    float psi(vec2 p) {
      return sin(p.x * 3.1 + time * 0.13) * cos(p.y * 2.4 - time * 0.09)
        + 0.55 * sin(p.y * 4.3 + p.x * 1.7 + time * 0.07 + 1.3)
        + 0.35 * cos(p.x * 5.2 - p.y * 3.1 - time * 0.11 + 2.1);
    }
    void main() {
      vec2 p = vec2(vUv.x * aspect, vUv.y) * 2.0;
      float e = 0.01;
      vec2 flow = vec2(psi(p + vec2(0.0, e)) - psi(p - vec2(0.0, e)), psi(p - vec2(e, 0.0)) - psi(p + vec2(e, 0.0))) / (2.0 * e);
      vec2 v = texture2D(uVelocity, vUv).xy;
      v += (flow * strength - v) * rate;
      gl_FragColor = vec4(v, 0.0, 1.0);
    }`,
  // Adds liquid at the three drifting pour points.
  emit: `
    uniform sampler2D uTarget; uniform vec2 e0, e1, e2; uniform float aspect, radius, amount; varying vec2 vUv;
    float g(vec2 c) { vec2 d = vUv - c; d.x *= aspect; return exp(-dot(d, d) / radius); }
    void main() {
      float a = (g(e0) + g(e1) * 0.85 + g(e2) * 0.7) * amount;
      gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + a, 1.0);
    }`,
  splat: `
    uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color; uniform vec2 point; uniform float radius;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv - point; p.x *= aspectRatio;
      vec3 s = exp(-dot(p, p) / radius) * color;
      gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + s, 1.0);
    }`,
  advection: `
    uniform sampler2D uVelocity, uSource; uniform vec2 simTexel; uniform float dt, dissipation;
    varying vec2 vUv;
    void main() {
      vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * simTexel;
      gl_FragColor = texture2D(uSource, coord) / (1.0 + dissipation * dt);
    }`,
  curl: `
    uniform sampler2D uVelocity; varying vec2 vUv, vL, vR, vT, vB;
    void main() {
      float L = texture2D(uVelocity, vL).y, R = texture2D(uVelocity, vR).y;
      float T = texture2D(uVelocity, vT).x, B = texture2D(uVelocity, vB).x;
      gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
    }`,
  vorticity: `
    uniform sampler2D uVelocity, uCurl; uniform float curl, dt; varying vec2 vUv, vL, vR, vT, vB;
    void main() {
      float L = texture2D(uCurl, vL).x, R = texture2D(uCurl, vR).x;
      float T = texture2D(uCurl, vT).x, B = texture2D(uCurl, vB).x, C = texture2D(uCurl, vUv).x;
      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001;
      force *= curl * C; force.y *= -1.0;
      vec2 v = texture2D(uVelocity, vUv).xy + force * dt;
      gl_FragColor = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
    }`,
  divergence: `
    uniform sampler2D uVelocity; varying vec2 vUv, vL, vR, vT, vB;
    void main() {
      float L = texture2D(uVelocity, vL).x, R = texture2D(uVelocity, vR).x;
      float T = texture2D(uVelocity, vT).y, B = texture2D(uVelocity, vB).y;
      vec2 C = texture2D(uVelocity, vUv).xy;
      if (vL.x < 0.0) L = -C.x; if (vR.x > 1.0) R = -C.x;
      if (vT.y > 1.0) T = -C.y; if (vB.y < 0.0) B = -C.y;
      gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
    }`,
  scale: `
    uniform sampler2D uTexture; uniform float value; varying vec2 vUv;
    void main() { gl_FragColor = value * texture2D(uTexture, vUv); }`,
  pressure: `
    uniform sampler2D uPressure, uDivergence; varying vec2 vUv, vL, vR, vT, vB;
    void main() {
      float L = texture2D(uPressure, vL).x, R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x, B = texture2D(uPressure, vB).x;
      float d = texture2D(uDivergence, vUv).x;
      gl_FragColor = vec4((L + R + B + T - d) * 0.25, 0.0, 0.0, 1.0);
    }`,
  gradient: `
    uniform sampler2D uPressure, uVelocity; varying vec2 vUv, vL, vR, vT, vB;
    void main() {
      float L = texture2D(uPressure, vL).x, R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x, B = texture2D(uPressure, vB).x;
      vec2 v = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
      gl_FragColor = vec4(v, 0.0, 1.0);
    }`,
  // Crisp ink: a lightly blurred read of the dye, cut at a threshold with a soft
  // anti-aliased edge, so the liquid reads as clean poured shapes.
  display: `
    uniform sampler2D uDye; uniform vec2 texelSize; uniform vec3 paper, ink, rim; varying vec2 vUv;
    float dye(vec2 o) { return texture2D(uDye, vUv + o * texelSize).r; }
    void main() {
      float d = dye(vec2(0.0)) * 0.36
        + (dye(vec2(2.5, 0.0)) + dye(vec2(-2.5, 0.0)) + dye(vec2(0.0, 2.5)) + dye(vec2(0.0, -2.5))) * 0.12
        + (dye(vec2(1.8, 1.8)) + dye(vec2(-1.8, 1.8)) + dye(vec2(1.8, -1.8)) + dye(vec2(-1.8, -1.8))) * 0.04;
      float w = clamp(fwidth(d) * 1.2, 0.006, 0.05);
      float body = smoothstep(0.32 - w, 0.32 + w, d);
      float edge = body * (1.0 - smoothstep(0.32, 0.40, d));
      vec3 c = mix(paper, ink, body);
      c = mix(c, rim, edge * 0.18);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

const hex = (h) => new Vector3(...[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255));

export function startFluid(canvas, { paper = '#F6D33C', ink = '#E8A90E', rim = '#C98A00', reducedMotion = false } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.autoClear = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2));
  scene.add(quad);

  const simTexel = new Vector2();
  const dyeTexel = new Vector2();
  const mats = {};
  for (const [name, frag] of Object.entries(shaders)) {
    mats[name] = new ShaderMaterial({
      vertexShader: baseVert,
      fragmentShader: frag,
      uniforms: { texelSize: { value: simTexel } },
      depthTest: false,
      depthWrite: false,
    });
  }
  mats.display.uniforms.texelSize = { value: dyeTexel };
  mats.display.uniforms.paper = { value: hex(paper) };
  mats.display.uniforms.ink = { value: hex(ink) };
  mats.display.uniforms.rim = { value: hex(rim) };

  const target = (w, h, filter) => new WebGLRenderTarget(w, h, {
    type: HalfFloatType, format: RGBAFormat, minFilter: filter, magFilter: filter, depthBuffer: false,
  });
  const pair = (w, h, filter) => {
    const p = { read: target(w, h, filter), write: target(w, h, filter) };
    p.swap = () => { [p.read, p.write] = [p.write, p.read]; };
    return p;
  };

  let velocity, dye, pressure, divergence, curl;
  let aspect = 1;

  function size() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    aspect = w / h;
    const res = (base) => (aspect < 1 ? [base, Math.round(base / aspect)] : [Math.round(base * aspect), base]);
    const [sw, sh] = res(SIM_RES);
    const [dw, dh] = res(DYE_RES);
    simTexel.set(1 / sw, 1 / sh);
    dyeTexel.set(1 / dw, 1 / dh);
    const old = dye;
    [velocity, pressure, dye].forEach((p) => p && (p.read.dispose(), p.write.dispose()));
    [divergence, curl].forEach((t) => t && t.dispose());
    velocity = pair(sw, sh, LinearFilter);
    pressure = pair(sw, sh, NearestFilter);
    dye = pair(dw, dh, LinearFilter);
    divergence = target(sw, sh, NearestFilter);
    curl = target(sw, sh, NearestFilter);
    return !!old;
  }

  function pass(mat, uniforms, out) {
    for (const [k, v] of Object.entries(uniforms)) {
      if (!mat.uniforms[k]) mat.uniforms[k] = { value: v };
      else mat.uniforms[k].value = v;
    }
    quad.material = mat;
    renderer.setRenderTarget(out);
    renderer.render(scene, camera);
  }

  function splat(x, y, dx, dy, amount, radius = 0.0028) {
    // x, y in 0..1 with y up.
    pass(mats.splat, { uTarget: velocity.read.texture, aspectRatio: aspect, point: new Vector2(x, y), color: new Vector3(dx, dy, 0), radius }, velocity.write);
    velocity.swap();
    pass(mats.splat, { uTarget: dye.read.texture, aspectRatio: aspect, point: new Vector2(x, y), color: new Vector3(amount, amount, amount), radius: radius * 1.6 }, dye.write);
    dye.swap();
  }

  // Slow paths for the pour points (Lissajous curves, so they never repeat exactly).
  const emitters = [new Vector2(), new Vector2(), new Vector2()];
  function moveEmitters(t) {
    // Each one wanders around its own part of the screen (top left, middle right, bottom left).
    emitters[0].set(0.30 + 0.22 * Math.sin(t * 0.051 + 0.4), 0.78 + 0.14 * Math.sin(t * 0.033 + 1.9));
    emitters[1].set(0.72 + 0.20 * Math.sin(t * 0.042 + 2.8), 0.50 + 0.16 * Math.sin(t * 0.047 + 4.1));
    emitters[2].set(0.32 + 0.22 * Math.sin(t * 0.037 + 5.1), 0.20 + 0.14 * Math.sin(t * 0.029 + 0.7));
  }

  function step(dt, t) {
    pass(mats.current, { uVelocity: velocity.read.texture, time: t, aspect, strength: 0.6, rate: 1 - Math.exp(-dt * 0.6) }, velocity.write);
    velocity.swap();
    moveEmitters(t);
    pass(mats.emit, { uTarget: dye.read.texture, e0: emitters[0], e1: emitters[1], e2: emitters[2], aspect, radius: 0.005, amount: 0.68 * dt }, dye.write);
    dye.swap();
    pass(mats.curl, { uVelocity: velocity.read.texture }, curl);
    pass(mats.vorticity, { uVelocity: velocity.read.texture, uCurl: curl.texture, curl: CURL, dt }, velocity.write);
    velocity.swap();
    pass(mats.divergence, { uVelocity: velocity.read.texture }, divergence);
    pass(mats.scale, { uTexture: pressure.read.texture, value: 0.8 }, pressure.write);
    pressure.swap();
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      pass(mats.pressure, { uPressure: pressure.read.texture, uDivergence: divergence.texture }, pressure.write);
      pressure.swap();
    }
    pass(mats.gradient, { uPressure: pressure.read.texture, uVelocity: velocity.read.texture }, velocity.write);
    velocity.swap();
    pass(mats.advection, { uVelocity: velocity.read.texture, uSource: velocity.read.texture, simTexel, dt, dissipation: VELOCITY_DISSIPATION }, velocity.write);
    velocity.swap();
    pass(mats.advection, { uVelocity: velocity.read.texture, uSource: dye.read.texture, simTexel, dt, dissipation: DYE_DISSIPATION }, dye.write);
    dye.swap();
  }

  function draw() {
    pass(mats.display, { uDye: dye.read.texture }, null);
  }

  // Finger / mouse drags push the liquid around.
  const pointers = new Map();
  window.addEventListener('pointerdown', (e) => pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }), { passive: true });
  window.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId) || (e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY, hover: true } : null);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (e.pointerType === 'mouse' && !p.hover) pointers.set(e.pointerId, p);
    if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
    queue.push([p.x / window.innerWidth, 1 - p.y / window.innerHeight, (dx / window.innerWidth) * SPLAT_FORCE, (-dy / window.innerHeight) * SPLAT_FORCE, p.hover ? 0.22 : 0.42]);
  }, { passive: true });
  const end = (e) => pointers.delete(e.pointerId);
  window.addEventListener('pointerup', end, { passive: true });
  window.addEventListener('pointercancel', end, { passive: true });

  const queue = [];
  // A pour of liquid from a point on screen (used when money moves).
  function burst(clientX, clientY, up = true) {
    const x = clientX / window.innerWidth;
    const y = 1 - clientY / window.innerHeight;
    for (let i = 0; i < 5; i++) {
      const a = (up ? Math.PI / 2 : -Math.PI / 2) + (i - 2) * 0.45;
      const f = 900 + Math.random() * 500;
      queue.push([x, y, Math.cos(a) * f, Math.sin(a) * f, 0.7, 0.004]);
    }
  }

  size();
  // Start where the pour points are, with shapes already formed, so it never opens blank.
  // The clock starts at a random spot so the layout is different each time you open it.
  const t0 = Math.random() * 1000;
  moveEmitters(t0);
  for (const e of emitters) queue.push([e.x, e.y, (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300, 1.3, 0.014 + Math.random() * 0.008]);

  let last = performance.now();
  let raf = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((t - last) / 1000, 1 / 30);
    last = t;
    while (queue.length) splat(...queue.shift());
    step(reducedMotion ? dt * 0.3 : dt, t0 + (t / 1000) * (reducedMotion ? 0.3 : 1));
    draw();
  }
  raf = requestAnimationFrame(frame);

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      size();
      queue.push([0.5, 0.5, 0, 0, 1.1, 0.02]);
    }, 150);
  });

  return { burst, stop: () => cancelAnimationFrame(raf) };
}
