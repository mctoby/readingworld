// The conversation box (DialogueManager): one line at a time, written out letter by letter with a murmuring
// voice, multiple-choice questions that only move on after the right answer, and highlighted words that go
// into the glossary. Continue with E / Space / Enter or a tap; answer with a tap or 1-9.

import type { DialogueLine } from "../data";
import { isQuestion } from "../data";
import { Input } from "../game/input";
import { loopSound } from "../audio";
import { h, isTouch, juiceButton, popIn, popOut, punch, richText, skin, sketchy, Sprites, onTick, type JuiceButton } from "./kit";
import type { Glossary } from "./glossary";

const CORRECT = "#80FF8CFF";
const INCORRECT = "#FF6659FF";
const CHARS_PER_SECOND = 45;

export class DialogueBox {
  readonly el: HTMLElement;
  private speaker: HTMLElement;
  private body: HTMLElement;
  private choiceBox: HTMLElement;
  private hint: HTMLElement;
  private choices: JuiceButton[] = [];

  private lines: DialogueLine[] = [];
  private npcName = "";
  private index = 0;
  private onEnd: (() => void) | null = null;
  private wrong = new Set<number>();
  private praise: string | null = null;
  private openedAt = 0;
  private writing: { chars: HTMLElement[]; shown: number; acc: number; voice: { stop(): void } } | null = null;
  private stopSketchy: (() => void) | null = null;

  constructor(parent: HTMLElement, private glossary: Glossary, private voice: string | null) {
    this.el = h("div", "dialogue interactive", parent);
    this.el.hidden = true;
    skin(this.el, Sprites.wood, "#FFFFFFD9", 1);
    this.speaker = h("div", "speaker", this.el);
    this.body = h("div", "body", this.el);
    this.choiceBox = h("div", "choices", this.el);
    for (let i = 0; i < 4; i++) {
      const b = juiceButton(this.choiceBox, "choice", "", Sprites.square, "#FFFFFFFF", 1.6, () => this.pick(i));
      this.choices.push(b);
    }
    this.hint = h("div", "hint", this.el);
    this.el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".choice")) return;
      this.advance();
    });
    onTick((dt) => this.tick(dt));
  }

  get active() { return this.lines.length > 0; }

  start(npcName: string, lines: DialogueLine[], onEnd: () => void) {
    if (!lines || lines.length === 0) return;
    this.npcName = npcName;
    this.lines = lines;
    this.index = 0;
    this.onEnd = onEnd;
    this.wrong.clear();
    this.praise = null;
    this.openedAt = performance.now();
    popIn(this.el);
    this.refresh(true);
  }

  private get line() { return this.lines[this.index]; }
  private get showingQuestion() { return this.praise === null && isQuestion(this.line); }

  /** Called every frame by the game for keyboard input. */
  update() {
    if (!this.active || performance.now() - this.openedAt < 120) return;   // ignore the press that opened it
    if (this.showingQuestion && !this.writing) {
      const n = Math.min(9, this.line.choices!.length);
      for (let i = 0; i < n; i++) if (Input.pressed(`Digit${i + 1}`) || Input.pressed(`Numpad${i + 1}`)) this.pick(i);
    } else if (Input.pressed("KeyE") || Input.pressed("Space") || Input.pressed("Enter")) {
      this.advance();
    }
  }

  /** Continue: finish writing the line first, then move on. */
  private advance() {
    if (!this.active) return;
    if (this.writing) { this.finishWriting(); return; }
    if (!this.showingQuestion) this.next();
  }

  private pick(choice: number) {
    if (!this.active || !this.showingQuestion || this.wrong.has(choice)) return;
    if (this.writing) this.finishWriting();
    const line = this.line;
    const btn = this.choices[choice];
    if (choice === (line.correctIndex ?? 0)) {
      btn.flash(CORRECT); btn.punch(10);
      punch(this.el, 0.04);
      this.wrong.clear();
      if (line.correctText) { this.praise = line.correctText; this.refresh(true); }
      else this.next();
    } else {
      btn.flash(INCORRECT); btn.shake();
      this.wrong.add(choice);
      this.refresh(false);
    }
  }

  private next() {
    this.praise = null;
    this.wrong.clear();
    this.index++;
    if (this.index >= this.lines.length) {
      this.stopWriting();
      this.lines = [];
      popOut(this.el);
      this.stopSketchy?.();
      const cb = this.onEnd;
      this.onEnd = null;
      cb?.();
      return;
    }
    this.refresh(true);
  }

  private refresh(newLine: boolean) {
    const line = this.line;
    const question = this.showingQuestion;
    const speakerName = line.speaker || this.npcName;
    if (newLine || this.speaker.dataset.name !== speakerName) {
      this.stopSketchy?.();
      this.speaker.dataset.name = speakerName;
      this.stopSketchy = sketchy(this.speaker, speakerName);
    }

    const text = this.praise ?? line.text;
    if (newLine) {
      this.glossary.collectFrom(text, speakerName);
      this.write(text);
    }

    this.choiceBox.hidden = !question;
    if (question) {
      this.choices.forEach((b, i) => {
        const used = i < line.choices!.length;
        b.el.hidden = !used;
        if (!used) return;
        b.interactable = !this.wrong.has(i);
        b.el.querySelector(".label")!.textContent = `${i + 1}.  ${line.choices![i]}`;
        if (newLine) b.intro(0.15 + i * 0.07);
      });
      const wrong = this.wrong.size > 0;
      this.hint.classList.toggle("wrong", wrong);
      this.hint.textContent = wrong ? line.hint || "Not quite. Try again!" : "Pick the answer you think is right";
    } else {
      const last = this.praise === null && this.index >= this.lines.length - 1;
      const touch = isTouch() && !Input.keyboardUsed;
      this.hint.classList.remove("wrong");
      this.hint.textContent = `${touch ? "Tap" : "[E] / click"} to ${last ? "close" : "continue"}`;
    }
  }

  // ---- typewriter (TMPWriter)

  private write(text: string) {
    this.stopWriting();
    this.body.innerHTML = wrapChars(richText(text));
    const chars = [...this.body.querySelectorAll<HTMLElement>(".ch")];
    if (chars.length === 0) return;
    this.writing = { chars, shown: 0, acc: 0, voice: loopSound(this.voice, 0.35) };
  }

  private tick(dt: number) {
    const w = this.writing;
    if (!w) return;
    w.acc += dt * CHARS_PER_SECOND;
    while (w.acc >= 1 && w.shown < w.chars.length) {
      w.chars[w.shown++].classList.remove("hidden-char");
      w.acc -= 1;
    }
    if (w.shown >= w.chars.length) this.stopWriting();
  }

  private finishWriting() {
    const w = this.writing;
    if (!w) return;
    for (const c of w.chars) c.classList.remove("hidden-char");
    this.stopWriting();
  }

  private stopWriting() {
    this.writing?.voice.stop();
    this.writing = null;
  }
}

/** Wraps each visible character of some HTML in a hidden span, so they can be revealed one at a time. */
function wrapChars(html: string) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walk = (n: Node) => {
    for (const child of [...n.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const ch of child.textContent ?? "") {
          const s = document.createElement("span");
          s.className = "ch hidden-char";
          s.textContent = ch;
          frag.appendChild(s);
        }
        child.replaceWith(frag);
      } else walk(child);
    }
  };
  walk(tpl.content);
  const div = document.createElement("div");
  div.appendChild(tpl.content);
  return div.innerHTML;
}
