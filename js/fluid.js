// A small "stable fluids" simulation (velocity, pressure, swirl) drawn as crisp
// two-tone ink: deep marigold liquid moving on butter yellow. Runs on the GPU via three.js.
import {
  WebGLRenderer, WebGLRenderTarget, Scene, OrthographicCamera, Mesh, PlaneGeometry,
  ShaderMaterial, HalfFloatType, LinearFilter, NearestFilter, RGBAFormat, Vector2, Vector3,
} from '../vendor/three.js';

const SIM_RES = 128;
const DYE_RES = 512;
const PRESSURE_ITERATIONS = 18;
const CURL = 22;
const VELOCITY_DISSIPATION = 0.35;
const DYE_DISSIPATION = 0.32;
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

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

  function step(dt) {
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
  let ambientAt = 0;
  function ambient(t) {
    if (reducedMotion || t < ambientAt) return;
    ambientAt = t + 2600 + Math.random() * 2400;
    const x = 0.1 + Math.random() * 0.8;
    const y = 0.08 + Math.random() * 0.84;
    const a = Math.random() * Math.PI * 2;
    const f = 380 + Math.random() * 380;
    queue.push([x, y, Math.cos(a) * f, Math.sin(a) * f, 0.9, 0.006 + Math.random() * 0.006]);
  }

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
  // Start with a few shapes already on screen so it never opens blank.
  for (let i = 0; i < (reducedMotion ? 3 : 5); i++) {
    queue.push([0.15 + Math.random() * 0.7, 0.15 + Math.random() * 0.7, (Math.random() - 0.5) * 600, (Math.random() - 0.5) * 600, 1.2, 0.012 + Math.random() * 0.01]);
  }

  let last = performance.now();
  let raf = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((t - last) / 1000, 1 / 30);
    last = t;
    ambient(t);
    while (queue.length) splat(...queue.shift());
    step(reducedMotion ? dt * 0.4 : dt);
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
