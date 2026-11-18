// Keyboard and touch input, in the shape of Starter Assets' StarterAssetsInputs (move, jump, sprint)
// plus the game's own keys (E to talk / continue, G for the glossary, 1-9 for answers).

import * as THREE from "three";

const held = new Set<string>();
const pressedThisFrame = new Set<string>();

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.code;
  held.add(k);
  pressedThisFrame.add(k);
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k)) e.preventDefault();
});
window.addEventListener("keyup", (e) => held.delete(e.code));
window.addEventListener("blur", () => held.clear());

export const Input = {
  /** Touch stick value, -1..1 on both axes (y = forward). Set by the on-screen stick. */
  stick: new THREE.Vector2(),
  /** True once a keyboard has been used (changes "Tap" prompts to "[E] / click"). */
  keyboardUsed: false,

  isDown(code: string) { return held.has(code); },
  /** True only in the frame the key went down. */
  pressed(code: string) { return pressedThisFrame.has(code); },

  move(out = new THREE.Vector2()) {
    out.set(0, 0);
    if (held.has("KeyW") || held.has("ArrowUp")) out.y += 1;
    if (held.has("KeyS") || held.has("ArrowDown")) out.y -= 1;
    if (held.has("KeyD") || held.has("ArrowRight")) out.x += 1;
    if (held.has("KeyA") || held.has("ArrowLeft")) out.x -= 1;
    if (out.lengthSq() > 1) out.normalize();
    if (out.lengthSq() === 0) out.copy(this.stick);
    return out;
  },
  get sprint() { return held.has("ShiftLeft") || held.has("ShiftRight"); },
  get jump() { return pressedThisFrame.has("Space"); },

  /** Call once at the end of every frame. */
  endFrame() {
    if (pressedThisFrame.size > 0) this.keyboardUsed = true;
    pressedThisFrame.clear();
  },
  clear() { held.clear(); pressedThisFrame.clear(); this.stick.set(0, 0); },
};
