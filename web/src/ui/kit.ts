// UI building blocks matching the Unity uGUI look: a 1920x1080 reference canvas scaled like Unity's
// CanvasScaler (match 0.5), tinted 9-sliced sprites from the Cozy UI pack, and the "juice" animations
// (PopIn panels, JuiceButton buttons) from Assets/Scripts/Juice.

import { GAME } from "../data";

// ---------------------------------------------------------------- easing (Juice.cs)

export const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
export function outBack(k: number) {
  k = clamp01(k);
  const c1 = 1.70158, c3 = c1 + 1, x = k - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}
export function outCubic(k: number) { k = 1 - clamp01(k); return 1 - k * k * k; }
export function inCubic(k: number) { k = clamp01(k); return k * k * k; }
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------- frame ticker for UI animations

type Tick = (dt: number) => boolean | void;   // return false to stop
const ticks = new Set<Tick>();
let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const t of [...ticks]) if (t(dt) === false) ticks.delete(t);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
export const onTick = (t: Tick) => { ticks.add(t); return () => ticks.delete(t); };
export const wait = (seconds: number) => new Promise<void>((r) => setTimeout(r, seconds * 1000));

// ---------------------------------------------------------------- canvas scaling

/** Size of one Unity canvas unit in CSS pixels (CanvasScaler: 1920x1080, match width/height 0.5). */
export let uiScale = 1;

export function setupScaling(root: HTMLElement) {
  const apply = () => {
    const w = window.innerWidth, h = window.innerHeight;
    uiScale = Math.pow(2, (Math.log2(w / 1920) + Math.log2(h / 1080)) / 2);
    root.style.setProperty("--s", String(uiScale));
    root.style.width = `${w / uiScale}px`;
    root.style.height = `${h / uiScale}px`;
    root.style.transform = `scale(${uiScale})`;
  };
  window.addEventListener("resize", apply);
  apply();
}

/** True on phones and tablets (touch controls, "Tap" wording). */
export const isTouch = () => matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;

// ---------------------------------------------------------------- sprites

export interface Sprite { file: string; w: number; h: number; border: [number, number, number, number] }   // border: left, bottom, right, top (Unity order)

export const Sprites = {
  round: { file: "RoundButton2_white.png", w: 362, h: 161, border: [116, 86, 125, 67] } as Sprite,
  square: { file: "SquareButton2_white.png", w: 377, h: 160, border: [91, 53, 51, 38] } as Sprite,
  wood: { file: "WoodenContainer1.png", w: 1511, h: 384, border: [328, 175, 282, 126] } as Sprite,
  card: { file: "CardRegular1_red.png", w: 281, h: 342, border: [0, 0, 0, 0] } as Sprite,
  stick: { file: "RoundButton1_white.png", w: 145, h: 165, border: [0, 0, 0, 0] } as Sprite,
  stickHandle: { file: "RoundButton1_wood.png", w: 146, h: 165, border: [0, 0, 0, 0] } as Sprite,
};

const images = new Map<string, Promise<HTMLImageElement>>();
function image(file: string) {
  let p = images.get(file);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = GAME + "ui/" + file;
    });
    images.set(file, p);
  }
  return p;
}

const tints = new Map<string, Promise<string>>();
/** The sprite multiplied by a colour, like a uGUI Image's colour (alpha handled separately). */
export function tinted(sprite: Sprite, rgb: string): Promise<string> {
  const key = sprite.file + rgb;
  let p = tints.get(key);
  if (!p) {
    p = image(sprite.file).then((img) => {
      if (rgb.toLowerCase() === "#ffffff") return img.src;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = "multiply";
      g.fillStyle = rgb;
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(img, 0, 0);
      return c.toDataURL();
    });
    tints.set(key, p);
  }
  return p;
}

/** Splits "#RRGGBBAA" into "#RRGGBB" and an alpha 0..1. */
export function splitColor(hex: string): [string, number] {
  const h = hex.replace("#", "");
  return ["#" + h.slice(0, 6), h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
}

/**
 * Gives 'el' a sprite background: a 9-sliced (or stretched) image behind its content, tinted 'color'
 * ("#RRGGBBAA"). ppum is uGUI's Pixels Per Unit Multiplier (bigger = thinner borders).
 */
export function skin(el: HTMLElement, sprite: Sprite, color = "#FFFFFFFF", ppum = 1) {
  let bg = el.querySelector<HTMLCanvasElement>(":scope > canvas.bg");
  const isNew = !bg;
  if (!bg) {
    bg = document.createElement("canvas");
    bg.className = "bg";
    el.prepend(bg);
  }
  el.classList.add("skinned");
  const [rgb, alpha] = splitColor(color);
  bg.style.opacity = String(alpha);
  const state = { sprite, ppum, image: null as HTMLImageElement | null };
  (el as SkinnedElement).__skin = { sprite, color, ppum };
  const canvas = bg;
  void tinted(sprite, rgb).then((url) => loadImage(url)).then((img) => {
    if ((el as SkinnedElement).__skin?.color !== color) return;   // re-skinned meanwhile
    state.image = img;
    drawSlices(canvas, el, state.sprite, state.ppum, img);
    redraws.set(canvas, () => drawSlices(canvas, el, state.sprite, state.ppum, img));
  });
  if (isNew) resizeObserver.observe(el);
}
type SkinnedElement = HTMLElement & { __skin?: { sprite: Sprite; color: string; ppum: number } };

const loaded = new Map<string, Promise<HTMLImageElement>>();
function loadImage(url: string) {
  let p = loaded.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    loaded.set(url, p);
  }
  return p;
}

// Panels are drawn into a canvas at their exact on-screen size, so 9-slice edges never show seams.
const redraws = new Map<HTMLCanvasElement, () => void>();
const resizeObserver = new ResizeObserver((entries) => {
  for (const e of entries) {
    const c = (e.target as HTMLElement).querySelector<HTMLCanvasElement>(":scope > canvas.bg");
    if (c) redraws.get(c)?.();
  }
});
window.addEventListener("resize", () => {
  for (const [c, f] of redraws) { if (c.isConnected) f(); else redraws.delete(c); }
});

function drawSlices(canvas: HTMLCanvasElement, el: HTMLElement, sprite: Sprite, ppum: number, img: HTMLImageElement) {
  const w = el.offsetWidth, hgt = el.offsetHeight;
  if (w === 0 || hgt === 0) return;
  const ps = uiScale * Math.min(2, window.devicePixelRatio || 1);   // canvas pixels per UI unit
  const W = Math.max(1, Math.round(w * ps)), H = Math.max(1, Math.round(hgt * ps));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, W, H);
  g.imageSmoothingQuality = "high";
  const [l, b, r, t] = sprite.border;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (l + b + r + t === 0) { g.drawImage(img, 0, 0, W, H); return; }

  // Destination border sizes, shrunk together if the element is smaller than its borders.
  let dl = (l / ppum) * ps, dr = (r / ppum) * ps, dt = (t / ppum) * ps, db = (b / ppum) * ps;
  const kx = Math.min(1, W / (dl + dr)), ky = Math.min(1, H / (dt + db));
  dl = Math.round(dl * kx); dr = Math.round(dr * kx); dt = Math.round(dt * ky); db = Math.round(db * ky);
  const sx = [0, l, iw - r, iw], sy = [0, t, ih - b, ih];
  const dx = [0, dl, W - dr, W], dy = [0, dt, H - db, H];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) {
      const sw = sx[col + 1] - sx[col], sh = sy[row + 1] - sy[row];
      const dw = dx[col + 1] - dx[col], dh = dy[row + 1] - dy[row];
      if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
      // Overlap the next slice by a pixel so no hairline shows between them.
      g.drawImage(img, sx[col], sy[row], sw, sh, dx[col], dy[row], dw + (col < 2 ? 1 : 0), dh + (row < 2 ? 1 : 0));
    }
}

// ---------------------------------------------------------------- element helpers

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

/** TMP rich text as HTML. Only the tags the game uses are kept (colour); everything else is shown as text. */
export function richText(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let out = "";
  let open = 0;
  const re = /<color=(#[0-9a-fA-F]{3,8}|[a-z]+)>|<\/color>|<sketchy>|<\/sketchy>/g;
  let i = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
    out += esc(text.slice(i, m.index));
    if (m[1]) { out += `<span class="tmp-color" style="color:${namedColor(m[1])}">`; open++; }
    else if (m[0] === "</color>" && open > 0) { out += "</span>"; open--; }
    i = re.lastIndex;
  }
  out += esc(text.slice(i));
  while (open-- > 0) out += "</span>";
  return out.replace(/\n/g, "<br>");
}
const named: Record<string, string> = { red: "#ff2a1f", green: "#00ff00", blue: "#0000ff", yellow: "#ffff00", white: "#ffffff", black: "#000000", orange: "#ff8000", purple: "#a020f0" };
const namedColor = (c: string) => named[c.toLowerCase()] ?? c;

/** Removes every tag (for the glossary's "found in" sentence). */
export const stripTags = (s: string) => s.replace(/<[^>]+>/g, "");

// ---------------------------------------------------------------- "sketchy" text (TMPEffects)

/** Letters that redraw themselves a few times a second, like a hand-drawn title. */
export function sketchy(el: HTMLElement, text: string) {
  el.innerHTML = "";
  const letters: HTMLElement[] = [];
  for (const ch of text) {
    const s = h("span", "sk", el, ch === " " ? " " : ch);
    letters.push(s);
  }
  let t = 0;
  const stop = onTick((dt) => {
    if (!el.isConnected) return false;
    t += dt;
    if (t < 0.12) return;
    t = 0;
    for (const s of letters)
      s.style.transform = `translate(${(Math.random() - 0.5) * 3}px, ${(Math.random() - 0.5) * 3}px) rotate(${(Math.random() - 0.5) * 5}deg)`;
  });
  return stop;
}

// ---------------------------------------------------------------- PopIn (panels)

interface PopState { routine?: () => void; punchP: number; punchV: number; scale: number; stopSpring?: () => void }
const pops = new WeakMap<HTMLElement, PopState>();
const popState = (el: HTMLElement) => { let s = pops.get(el); if (!s) pops.set(el, (s = { punchP: 0, punchV: 0, scale: 1 })); return s; };

function setPop(el: HTMLElement, scale: number, alpha: number) {
  el.style.transform = `scale(${scale})`;
  el.style.opacity = String(alpha);
}

/** Shows a panel with a pop (scale with overshoot + fade in). */
export function popIn(el: HTMLElement, opts: { from?: number; duration?: number; delay?: number } = {}) {
  const from = opts.from ?? 0.8, duration = opts.duration ?? 0.35, delay = opts.delay ?? 0;
  const s = popState(el);
  s.routine?.();
  el.hidden = false;
  setPop(el, from, 0);
  let t = -delay;
  s.routine = onTick((dt) => {
    t += dt;
    if (t < 0) return;
    const k = t / duration;
    if (k >= 1) { setPop(el, 1, 1); s.routine = undefined; return false; }
    setPop(el, lerp(from, 1, outBack(k)), clamp01(k * 3));
  });
}

/** Pops a panel out, then hides it. */
export function popOut(el: HTMLElement, hideScale = 0.9) {
  const s = popState(el);
  s.routine?.();
  if (el.hidden) return;
  let t = 0;
  s.routine = onTick((dt) => {
    t += dt;
    const k = inCubic(t / 0.15);
    if (t >= 0.15) { el.hidden = true; setPop(el, 1, 1); s.routine = undefined; return false; }
    setPop(el, lerp(1, hideScale, k), 1 - k);
  });
}

/** A springy bump in scale. 0.05 is subtle, 0.2 is bold. */
export function punch(el: HTMLElement, amount = 0.1) {
  const s = popState(el);
  s.punchV = amount * 17;
  if (s.stopSpring) return;
  s.stopSpring = onTick((dt) => {
    if (s.routine) return;
    s.punchV += (-300 * s.punchP - 14 * s.punchV) * dt;
    s.punchP += s.punchV * dt;
    el.style.transform = `scale(${1 + s.punchP})`;
    if (Math.abs(s.punchP) < 0.0005 && Math.abs(s.punchV) < 0.01) {
      s.punchP = s.punchV = 0;
      el.style.transform = "";
      s.stopSpring = undefined;
      return false;
    }
  });
}

// ---------------------------------------------------------------- JuiceButton

export interface JuiceButton {
  el: HTMLButtonElement;
  intro(delay?: number): void;
  punch(impulse?: number): void;
  shake(amplitude?: number): void;
  flash(color: string): void;
  set interactable(v: boolean);
  get interactable(): boolean;
}

/**
 * A button that pops in when shown, grows on hover, squashes when pressed and bumps when clicked
 * (JuiceButton.cs). 'color' tints its sprite.
 */
export function juiceButton(parent: HTMLElement, cls: string, label: string, sprite: Sprite, color: string, ppum = 1, onClick?: () => void): JuiceButton {
  const el = h("button", "jb " + cls, parent);
  el.type = "button";
  skin(el, sprite, color, ppum);
  const lab = h("span", "label", el);
  lab.innerHTML = label;

  let hovered = false, pressed = false, enabled = true;
  let hover = 1, punchP = 0, punchV = 0;
  let introT = -1, introDelay = 0;
  let shakeT = -1, shakeAmp = 0;
  let flashT = -1, flashColor = "", flashStep = -1;

  el.addEventListener("pointerenter", () => (hovered = true));
  el.addEventListener("pointerleave", () => { hovered = false; pressed = false; });
  el.addEventListener("pointerdown", () => (pressed = true));
  el.addEventListener("pointerup", () => (pressed = false));
  el.addEventListener("click", () => {
    if (!enabled) return;
    punchV = 4;
    onClick?.();
  });

  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    onTick((dt) => {
      if (!el.isConnected) { running = false; return false; }
      const goal = !enabled ? 1 : pressed ? 0.92 : hovered ? 1.08 : 1;
      hover = lerp(hover, goal, 1 - Math.exp(-20 * dt));
      punchV += (-300 * punchP - 14 * punchV) * dt;
      punchP += punchV * dt;

      let intro = 1;
      if (introT >= 0) {
        introT += dt;
        const k = (introT - introDelay) / 0.4;
        intro = k < 0 ? 0 : outBack(k);
        if (k >= 1) introT = -1;
      }
      let x = 0;
      if (shakeT >= 0) {
        shakeT += dt;
        const k = shakeT / 0.4;
        x = k >= 1 ? 0 : Math.sin(k * 40) * shakeAmp * (1 - k);
        if (k >= 1) shakeT = -1;
      }
      if (flashT >= 0) {
        flashT += dt;
        const k = clamp01(flashT / 0.5);
        const step = Math.round(k * 6);
        if (step !== flashStep) {
          flashStep = step;
          skin(el, sprite, k >= 1 ? color : mix(flashColor, color, step / 6), ppum);
        }
        if (k >= 1) flashT = -1;
      }
      el.style.transform = `translateX(${x}px) scale(${(hover + punchP) * intro})`;
      const idle = Math.abs(hover - goal) < 0.001 && Math.abs(punchP) < 0.0005 && Math.abs(punchV) < 0.01 && introT < 0 && shakeT < 0 && flashT < 0;
      if (idle && !hovered && !pressed) { el.style.transform = ""; running = false; return false; }
    });
  };
  el.addEventListener("pointerenter", run);
  el.addEventListener("pointerdown", run);
  el.addEventListener("click", run);

  return {
    el,
    intro(delay = 0) { introDelay = delay; introT = 0; el.style.transform = "scale(0)"; run(); },
    punch(impulse = 6) { punchV = impulse; run(); },
    shake(amplitude = 14) { shakeT = 0; shakeAmp = amplitude; run(); },
    flash(c: string) { flashColor = c; flashT = 0; flashStep = -1; run(); },
    set interactable(v: boolean) { enabled = v; el.disabled = !v; el.classList.toggle("off", !v); },
    get interactable() { return enabled; },
  };
}

/** Mixes two "#RRGGBB(AA)" colours. */
function mix(a: string, b: string, t: number) {
  const pa = parse(a), pb = parse(b);
  const c = pa.map((v, i) => Math.round(lerp(v, pb[i], t)));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function parse(hex: string) {
  const s = hex.replace("#", "");
  const full = s.length === 6 ? s + "FF" : s;
  return [0, 2, 4, 6].map((i) => parseInt(full.slice(i, i + 2), 16));
}
