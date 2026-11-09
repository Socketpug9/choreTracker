// The "light" for every foil surface (anything styled as foil in styles.css).
// One shared light keeps all the foil shimmering together, the way real foil
// catches the same lamp. It sets three CSS variables on the page:
//   --foil-shift  slides the rainbow bands (slow drift, scrolling, tilting)
//   --gx, --gy    where the white glare sits on each surface
// Pressing a foil button moves its glare under your finger.
// Tilting the phone moves everything, if you turn on "Tilt shimmer" (iOS asks permission).

const TILT_KEY = 'stash.tilt';

export function startShine({ reducedMotion = false } = {}) {
  const root = document.documentElement.style;
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  let boost = 0;
  let last = 0;

  function frame(t) {
    requestAnimationFrame(frame);
    if (t - last < 33) return; // about 30 updates a second is plenty for a shimmer
    last = t;
    const time = reducedMotion ? 0 : t / 1000;
    tilt.x += (tilt.tx - tilt.x) * 0.2;
    tilt.y += (tilt.ty - tilt.y) * 0.2;
    boost *= 0.9;
    const shift = time * 9 + scrollY * 0.35 + tilt.x * 160 + boost * 260;
    const gx = 50 + Math.sin(time * 0.35) * 32 + tilt.x * 40;
    const gy = 35 + Math.cos(time * 0.27) * 25 + tilt.y * 35;
    // Wrapped to one band cycle (470px) so the numbers stay small; the pattern repeats there anyway.
    root.setProperty('--foil-shift', `${(((shift % 470) + 470) % 470 - 470).toFixed(1)}px`);
    root.setProperty('--gx', `${gx.toFixed(1)}%`);
    root.setProperty('--gy', `${gy.toFixed(1)}%`);
  }
  requestAnimationFrame(frame);

  // Glare follows your finger on the foil you're pressing.
  const follow = (e) => {
    const el = e.target.closest('.foil-fx');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--gx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    el.style.setProperty('--gy', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  };
  const release = () => {
    document.querySelectorAll('.foil-fx[style]').forEach((el) => {
      el.style.removeProperty('--gx');
      el.style.removeProperty('--gy');
    });
  };
  addEventListener('pointerdown', follow, { passive: true });
  addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') follow(e); }, { passive: true });
  addEventListener('pointerup', release, { passive: true });
  addEventListener('pointercancel', release, { passive: true });

  // Tilt: phone tipped left/right and toward/away from you.
  function onOrient(e) {
    if (e.gamma == null) return;
    tilt.tx = Math.max(-1, Math.min(1, e.gamma / 30));
    tilt.ty = Math.max(-1, Math.min(1, (e.beta - 45) / 30));
  }
  async function enableTilt() {
    const D = window.DeviceOrientationEvent;
    if (!D) return false;
    if (typeof D.requestPermission === 'function') {
      try {
        if ((await D.requestPermission()) !== 'granted') return false;
      } catch (err) {
        return false;
      }
    }
    addEventListener('deviceorientation', onOrient);
    return true;
  }
  function disableTilt() {
    removeEventListener('deviceorientation', onOrient);
    tilt.tx = 0;
    tilt.ty = 0;
  }
  // If it was on before, turn it back on at the first tap (iOS only allows asking after a tap).
  if (localStorage.getItem(TILT_KEY) === 'on') {
    addEventListener('pointerup', () => enableTilt(), { once: true });
  }

  return {
    // A quick sweep of light across the foil, used when money moves.
    flash() { boost = 1; },
    tiltOn: () => localStorage.getItem(TILT_KEY) === 'on',
    async setTilt(on) {
      if (on) {
        const ok = await enableTilt();
        localStorage.setItem(TILT_KEY, ok ? 'on' : 'off');
        return ok;
      }
      disableTilt();
      localStorage.setItem(TILT_KEY, 'off');
      return false;
    },
  };
}
