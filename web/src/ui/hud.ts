// In-game HUD: the quest card (QuestManager's HUD), the Talk button (InteractionPrompt), the "Day complete"
// popup (DayProgress) and the on-screen joystick for phones (TouchControlsCanvas + UIStick).

import { Input } from "../game/input";
import { h, isTouch, juiceButton, popIn, popOut, punch, skin, Sprites, type JuiceButton } from "./kit";

// ---------------------------------------------------------------- quest HUD

export class QuestHud {
  private el: HTMLElement;
  private text: HTMLElement;
  private last = "";
  constructor(parent: HTMLElement) {
    this.el = h("div", "quest-hud", parent);
    skin(this.el, Sprites.card);
    h("div", "hud-title", this.el, "Quest");
    this.text = h("div", "hud-text", this.el);
    this.el.hidden = true;
  }

  set(lines: { text: string; done: boolean }[]) {
    const key = JSON.stringify(lines);
    if (key === this.last) return;
    const changed = this.last !== "" && this.last !== "[]";
    this.last = key;
    this.text.innerHTML = "";
    lines.forEach((l, i) => {
      if (i > 0) this.text.append("\n");
      const s = h("span", l.done ? "done" : "", this.text, l.text);
      void s;
    });
    const show = lines.length > 0;
    if (show && this.el.hidden) popIn(this.el);
    else if (!show && !this.el.hidden) popOut(this.el);
    else if (changed && show) punch(this.el, 0.12);
  }
}

// ---------------------------------------------------------------- talk button

export class TalkButton {
  private btn: JuiceButton;
  private shown = false;
  constructor(parent: HTMLElement, onTalk: () => void) {
    this.btn = juiceButton(parent, "talk-btn blue-btn", "Talk", Sprites.round, "#2680E6F2", 1.99, onTalk);
    this.btn.el.hidden = true;
  }
  set visible(v: boolean) {
    if (v === this.shown) return;
    this.shown = v;
    this.btn.el.hidden = !v;
    if (v) {
      this.btn.el.querySelector(".label")!.textContent = isTouch() && !Input.keyboardUsed ? "Talk" : "Talk  [E]";
      this.btn.intro();
    }
  }
}

// ---------------------------------------------------------------- day complete

export class DayCompletePopup {
  private root: HTMLElement;
  private title: HTMLElement;
  private message: HTMLElement;
  open = false;

  constructor(parent: HTMLElement, onClose: () => void, onMenu: () => void) {
    this.root = h("div", "layer", parent);
    this.root.hidden = true;
    h("div", "popup-dim", this.root);
    const win = h("div", "window day-window interactive", this.root);
    skin(win, Sprites.round, "#FFF7E6FF", 1);
    this.title = h("div", "title", win);
    this.message = h("div", "message", win);
    juiceButton(win, "ok blue-btn", "Hooray!", Sprites.round, "#2680E6F2", 1.99, () => { this.hide(); onClose(); });
    juiceButton(win, "to-menu blue-btn", "Main Menu", Sprites.round, "#2680E6F2", 1.99, () => { this.hide(); onMenu(); });
  }

  show(day: number) {
    this.title.textContent = `Day ${day} complete!`;
    this.message.innerHTML = "Well done! You filled the library's shelves.<br>Come back tomorrow for more stories.";
    this.open = true;
    popIn(this.root, { from: 0.9 });
  }

  hide() {
    this.open = false;
    popOut(this.root);
  }
}

// ---------------------------------------------------------------- touch joystick

export class TouchStick {
  readonly el: HTMLElement;
  private handle: HTMLElement;
  private pointer: number | null = null;

  constructor(parent: HTMLElement) {
    this.el = h("div", "stick", parent);
    skin(this.el, Sprites.stick);
    this.handle = h("div", "handle", this.el);
    skin(this.handle, Sprites.stickHandle);
    this.el.hidden = !isTouch();

    const move = (e: PointerEvent) => {
      const r = this.el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const radius = r.width / 2;
      let x = e.clientX - cx, y = e.clientY - cy;
      const len = Math.hypot(x, y);
      if (len > radius) { x *= radius / len; y *= radius / len; }
      const scale = this.el.offsetWidth / r.width;   // screen px -> canvas units
      this.handle.style.transform = `translate(${x * scale}px, ${y * scale}px)`;
      Input.stick.set(x / radius, -y / radius);
    };
    this.el.addEventListener("pointerdown", (e) => {
      this.pointer = e.pointerId;
      this.el.setPointerCapture(e.pointerId);
      move(e);
    });
    this.el.addEventListener("pointermove", (e) => { if (e.pointerId === this.pointer) move(e); });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.pointer) return;
      this.pointer = null;
      this.release();
    };
    this.el.addEventListener("pointerup", release);
    this.el.addEventListener("pointercancel", release);
  }

  release() {
    this.handle.style.transform = "";
    Input.stick.set(0, 0);
  }

  set visible(v: boolean) {
    const show = v && isTouch();
    if (!show) this.release();
    this.el.hidden = !show;
  }
}
