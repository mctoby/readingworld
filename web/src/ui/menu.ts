// The main menu: "How old are you?" (AgeMenu), then the day picker (DayStartPopup), plus the full screen
// button for phones (FullscreenButton). Play loads the world for the chosen day.

import { GameDay, ReadingSettings, type DailyContent } from "../state";
import { h, juiceButton, popIn, popOut, punch, skin, sketchy, Sprites, wait, isTouch, onTick, type JuiceButton } from "./kit";

export class MainMenu {
  readonly root: HTMLElement;
  private agePanel: HTMLElement;
  private dayPopup: HTMLElement;
  private dayTitle!: HTMLElement;
  private dayTopic!: HTMLElement;
  private prev!: JuiceButton;
  private next!: JuiceButton;
  private days: number[] = [];
  private index = 0;
  private chosen = false;
  private stops: (() => void)[] = [];

  constructor(parent: HTMLElement, private content: DailyContent, private onPlay: (day: number) => void) {
    this.root = h("div", "menu", parent);
    h("div", "menu-title", this.root, "Reading World");

    // ---- age menu
    this.agePanel = h("div", "layer", this.root);
    h("div", "popup-dim", this.agePanel).style.background = "rgba(26,31,64,0.92)";
    const agency = h("div", "agency", this.agePanel);
    this.stops.push(sketchy(agency, "The Reading Agency"));
    const box = h("div", "window age-box interactive", this.agePanel);
    skin(box, Sprites.round, "#FFF7E6FF", 1);
    h("div", "title", box, "How old are you?");
    h("div", "subtitle", box, "Tap your age to start");
    const grid = h("div", "age-grid", box);
    const buttons: JuiceButton[] = [];
    for (let age = 5; age <= 15; age++) {
      const b = juiceButton(grid, "age", String(age), Sprites.square, "#4C99F2FF", 1, () => void this.chooseAge(age, b, buttons));
      b.el.style.width = b.el.style.height = "150px";
      buttons.push(b);
    }
    popIn(box);
    buttons.forEach((b, i) => b.intro(0.35 + i * 0.05));

    // ---- day picker
    this.dayPopup = this.buildDayPopup();

    // ---- full screen (phones and tablets)
    buildFullscreen(this.root, this.stops);
  }

  dispose() {
    for (const s of this.stops) s();
    this.root.remove();
  }

  private async chooseAge(age: number, picked: JuiceButton, all: JuiceButton[]) {
    if (this.chosen) return;
    this.chosen = true;
    ReadingSettings.level = ReadingSettings.levelForAge(age);
    console.log(`Age ${age} chosen: reading level ${ReadingSettings.level}`);
    for (const b of all) if (b !== picked) b.interactable = false;
    picked.flash("#FFFFFFFF");
    picked.punch(12);
    await wait(0.35);
    popOut(this.agePanel);
    await wait(0.2);
    this.showDays();
  }

  private buildDayPopup() {
    const root = h("div", "layer", this.root);
    root.hidden = true;
    h("div", "popup-dim", root);
    const win = h("div", "window day-window interactive", root);
    skin(win, Sprites.round, "#FFF7E6FF", 1);
    this.dayTitle = h("div", "title", win);
    this.dayTitle.style.left = "180px"; this.dayTitle.style.right = "180px";
    this.dayTopic = h("div", "message", win);
    this.dayTopic.style.left = "180px"; this.dayTopic.style.right = "180px";
    juiceButton(win, "play blue-btn", "Play!", Sprites.round, "#2680E6F2", 1.99, () => this.play());
    this.prev = juiceButton(win, "prev blue-btn", "&lt;", Sprites.round, "#2680E6F2", 1.99, () => this.step(-1));
    this.next = juiceButton(win, "next blue-btn", "&gt;", Sprites.round, "#2680E6F2", 1.99, () => this.step(1));
    return root;
  }

  private showDays() {
    this.days = this.content.playableDays();
    const today = GameDay.today;
    if (!this.days.includes(today)) { this.days.push(today); this.days.sort((a, b) => a - b); }
    this.index = this.days.indexOf(today);
    this.refresh();
    popIn(this.dayPopup, { from: 0.9 });
  }

  private step(dir: number) {
    this.index = Math.min(this.days.length - 1, Math.max(0, this.index + dir));
    this.refresh();
    punch(this.dayPopup.querySelector(".window")!, 0.05);
  }

  private refresh() {
    const day = this.days[this.index];
    this.dayTitle.textContent = `Day ${day}`;
    const topic = day === 1 ? "The Library" : this.content.topicFor(day);
    this.dayTopic.textContent = topic ? `Today's topic: ${topic}` : "";
    const many = this.days.length > 1;
    this.prev.el.hidden = !many; this.next.el.hidden = !many;
    this.prev.interactable = this.index > 0;
    this.next.interactable = this.index < this.days.length - 1;
  }

  private play() {
    const day = this.days[this.index];
    GameDay.choose(day);
    this.onPlay(day);
  }
}

// ---------------------------------------------------------------- full screen

/**
 * Android Chrome and iPad Safari can go full screen (from inside a tap). iPhone Safari can't, so the button
 * shows a tip instead: add the game to the Home Screen, which opens it without the browser bars.
 */
function buildFullscreen(parent: HTMLElement, stops: (() => void)[]) {
  if (!isTouch() || isFullscreen()) return;
  const btn = juiceButton(parent, "fullscreen-btn blue-btn", "Full screen", Sprites.round, "#2680E6F2", 1.99);
  const tip = h("div", "iphone-tip", parent, "To play full screen on iPhone, tap Share, then Add to Home Screen.");
  tip.hidden = true;
  let tipUntil = 0;
  btn.el.addEventListener("click", () => {
    const d = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (d.requestFullscreen || d.webkitRequestFullscreen) {
      const p = d.requestFullscreen ? d.requestFullscreen({ navigationUI: "hide" }) : (d.webkitRequestFullscreen!(), Promise.resolve());
      void Promise.resolve(p).then(() => {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        return o?.lock?.("landscape");
      }).catch(() => {});
    } else {
      tip.hidden = false;
      tipUntil = performance.now() + 5000;
    }
  });
  let acc = 0;
  stops.push(onTick((dt) => {
    acc += dt;
    if (acc < 0.5) return;
    acc = 0;
    btn.el.hidden = isFullscreen();
    if (!tip.hidden && performance.now() > tipUntil) tip.hidden = true;
  }));
}

export function isFullscreen() {
  const d = document as Document & { webkitFullscreenElement?: Element };
  if (d.fullscreenElement || d.webkitFullscreenElement) return true;
  if ((navigator as Navigator & { standalone?: boolean }).standalone) return true;
  return matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches;
}
