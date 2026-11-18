// The word glossary (WordGlossary): highlighted (red) words met in conversations are collected, a "New word"
// popup appears for each, and the Words button opens a list of them with what they mean.

import { loadJson } from "../data";
import { ControlLock } from "../state";
import { h, juiceButton, popIn, popOut, skin, stripTags, Sprites, wait, type JuiceButton } from "./kit";

interface Entry { word: string; sentence: string; speaker: string | null }

export class Glossary {
  private entries = new Map<string, Entry>();
  private definitions = new Map<string, string>();
  private queue: string[] = [];
  private showing = false;
  private open = false;

  private button: JuiceButton;
  private popup: HTMLElement;
  private panel: HTMLElement;
  private list: HTMLElement;
  private count: HTMLElement;
  /** True while a conversation is on screen (the button is disabled then). */
  isTalking: () => boolean = () => false;

  constructor(parent: HTMLElement, definitionsFile: string) {
    const root = h("div", "glossary", parent);
    this.button = juiceButton(root, "words-btn blue-btn", "Words: 0", Sprites.round, "#2680E6F2", 1.99, () => this.show());
    this.button.el.hidden = true;
    const label = this.button.el.querySelector<HTMLElement>(".label")!;
    label.style.fontSize = "50px";

    this.popup = h("div", "new-word", root);
    skin(this.popup, Sprites.round, "#FFF7E6FF", 1.99);
    this.popup.hidden = true;

    this.panel = h("div", "layer", root);
    this.panel.hidden = true;
    h("div", "popup-dim", this.panel).addEventListener("click", () => this.hide());
    const win = h("div", "window interactive", this.panel);
    win.style.width = "1300px"; win.style.height = "860px";
    skin(win, Sprites.round, "#FFF7E6FF", 1);
    h("div", "title", win, "My Words");
    this.count = h("div", "count", win, "0 words collected");
    const close = juiceButton(win, "close", "X", Sprites.round, "#D93025FF", 1.99, () => this.hide());
    void close;
    this.list = h("div", "list", win);

    void loadJson<{ definitions: { word: string; definition: string }[] }>(definitionsFile).then((d) => {
      for (const e of d.definitions ?? [])
        if (e.word && e.definition) this.definitions.set(e.word.trim().toLowerCase(), e.definition.trim());
    }).catch((e) => console.warn("Glossary definitions:", e));
  }

  get isOpen() { return this.open; }
  get size() { return this.entries.size; }

  /** Adds every highlighted word in 'rich' that hasn't been collected yet. */
  collectFrom(rich: string, speaker: string | null) {
    let added = false;
    for (const m of rich.matchAll(/<color=red>(.+?)<\/color>/gi)) {
      const word = stripTags(m[1]).trim();
      if (!/\p{L}/u.test(word)) continue;          // e.g. the "_____" gap in a missing-word question
      const key = word.toLowerCase();
      if (this.entries.has(key)) continue;
      const shown = key[0].toUpperCase() + key.slice(1);
      this.entries.set(key, { word: shown, sentence: stripTags(rich).trim(), speaker });
      if (!this.definitions.has(key)) console.warn(`Glossary: no definition for "${key}".`);
      this.queue.push(shown);
      added = true;
    }
    if (!added) return;
    this.refreshButton(true);
    if (this.open) this.rebuild();
    if (!this.showing) void this.showPopups();
  }

  update(toggle: boolean) {
    this.button.interactable = !this.isTalking();
    if (!toggle) return;
    if (this.open) this.hide();
    else if (!this.isTalking() && this.size > 0) this.show();
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.rebuild();
    popIn(this.panel, { from: 0.9 });
    ControlLock.lock();
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    popOut(this.panel);
    ControlLock.unlock();
  }

  /** Clears everything (a new play session). */
  reset() {
    if (this.open) this.hide();
    this.entries.clear();
    this.queue = [];
    this.refreshButton(false);
  }

  private rebuild() {
    const sorted = [...this.entries.values()].sort((a, b) => a.word.localeCompare(b.word));
    this.list.innerHTML = "";
    for (const e of sorted) {
      const row = h("div", "entry", this.list);
      skin(row, Sprites.square, "#FFFFFFD9", 1.6);
      h("div", "word", row, e.word);
      const def = this.definitions.get(e.word.toLowerCase());
      h("div", "def", row, def ?? (e.speaker ? `${e.speaker}: "${e.sentence}"` : e.sentence));
    }
    this.count.textContent = `${this.size} words collected`;
  }

  private refreshButton(bump: boolean) {
    this.button.el.querySelector(".label")!.textContent = `Words: ${this.size}`;
    const wasShown = !this.button.el.hidden;
    this.button.el.hidden = this.size === 0;
    if (!wasShown && this.size > 0) this.button.intro();
    else if (bump && wasShown) this.button.punch(10);
  }

  private async showPopups() {
    this.showing = true;
    while (this.queue.length > 0) {
      const word = this.queue.shift()!;
      this.popup.innerHTML = "";
      skin(this.popup, Sprites.round, "#FFF7E6FF", 1.99);
      const t = h("span", "", this.popup);
      t.append("New word: ");
      h("b", "", t, word);
      popIn(this.popup);
      await wait(2);
      popOut(this.popup);
      await wait(0.25);
    }
    this.showing = false;
  }
}
