// Music and sound effects. Browsers only allow sound after the first tap or key press, so everything is
// started on demand and quietly does nothing until then.

import { GAME } from "./data";

let unlocked = false;
const waiting: (() => void)[] = [];
function unlock() {
  if (unlocked) return;
  unlocked = true;
  for (const w of waiting.splice(0)) w();
}
for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, unlock, { once: false, capture: true });

function whenUnlocked(f: () => void) { if (unlocked) f(); else waiting.push(f); }

let music: HTMLAudioElement | null = null;

/** Loops a music / ambience track (each lighting scene has its own). */
export function playMusic(path: string | null, volume: number) {
  stopMusic();
  if (!path) return;
  const a = new Audio(GAME + path);
  a.loop = true;
  a.volume = Math.min(1, Math.max(0, volume));
  music = a;
  whenUnlocked(() => { if (music === a) void a.play().catch(() => {}); });
}

export function stopMusic() {
  if (music) { music.pause(); music.src = ""; music = null; }
}

const pool = new Map<string, HTMLAudioElement>();

/** A one-shot sound. */
export function playSound(path: string | null, volume = 1) {
  if (!path || !unlocked) return;
  const a = new Audio(GAME + path);
  a.volume = volume;
  void a.play().catch(() => {});
}

/** A sound that plays while something lasts (the dialogue "voice" while text is being written). */
export function loopSound(path: string | null, volume = 1) {
  if (!path) return { stop() {} };
  let a = pool.get(path);
  if (!a) { a = new Audio(GAME + path); a.loop = true; pool.set(path, a); }
  const audio = a;
  audio.volume = volume;
  if (unlocked) {
    audio.currentTime = Math.random() * Math.max(0, (audio.duration || 4) - 2);
    void audio.play().catch(() => {});
  }
  return { stop() { audio.pause(); } };
}
