// Saved progress and game-wide state: the reading level, which day is being played, and quest progress.
// Ports ReadingSettings, GameDay and QuestManager from the Unity project. localStorage replaces PlayerPrefs.

import type { DayInfo, QuestData, WorldData } from "./data";
import { needsOtherQuests } from "./data";

// ---------------------------------------------------------------- tiny event helper

export class Emitter<T extends unknown[] = []> {
  private handlers = new Set<(...args: T) => void>();
  on(h: (...args: T) => void) { this.handlers.add(h); return () => this.handlers.delete(h); }
  emit(...args: T) { for (const h of [...this.handlers]) h(...args); }
}

const store = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* private mode: not saved */ } },
  remove(key: string) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

// ---------------------------------------------------------------- reading level

export enum ReadingLevel { Ages5to8 = 0, Ages8to11 = 1, Ages12to15 = 2 }

export const ReadingSettings = {
  /** 5-8, 9-11 and 12+ (the groups overlap at 8 and 11, so the younger group claims them). */
  levelForAge(age: number): ReadingLevel {
    return age <= 8 ? ReadingLevel.Ages5to8 : age <= 11 ? ReadingLevel.Ages8to11 : ReadingLevel.Ages12to15;
  },
  get level(): ReadingLevel {
    const v = parseInt(store.get("ReadingLevel") ?? "0", 10);
    return Math.min(2, Math.max(0, isNaN(v) ? 0 : v)) as ReadingLevel;
  },
  set level(v: ReadingLevel) { store.set("ReadingLevel", String(v)); },
};

// ---------------------------------------------------------------- days

/** The days list and per-day settings from world.json (Unity's Resources/DailyContent). */
export class DailyContent {
  constructor(public world: WorldData) {}

  get days(): DayInfo[] { return this.world.days; }

  /** Every day that can be played, in order: day 1 (hand-written) and each live generated day. */
  playableDays(): number[] {
    const list = [1];
    for (const d of this.days) if (d.live && d.day >= 2 && !list.includes(d.day)) list.push(d.day);
    return list.sort((a, b) => a - b);
  }

  /** The latest live generated day no later than 'target', or 1. */
  latestDayUpTo(target: number) {
    let best = 1;
    for (const d of this.days) if (d.live && d.day >= 2 && d.day <= target && d.day > best) best = d.day;
    return best;
  }

  topicFor(day: number) { return this.days.find((d) => d.day === day)?.topic ?? null; }

  timeOfDayFor(day: number): "Day" | "Night" {
    let t = this.world.day1TimeOfDay;
    for (const d of this.days) if (d.day === day) t = d.timeOfDay;
    return t;
  }

  /** Today's conversation files for this NPC, or null to use the NPC's own (day 1) files. */
  filesFor(npcId: string, day: number): (string | null)[] | null {
    if (!npcId || day < 2) return null;
    for (const d of this.days) {
      if (d.day !== day || !d.live) continue;
      for (const n of d.npcs) if (n.npcId === npcId) return n.files;
    }
    return null;
  }
}

/** Which day the game is on. Finishing a day (handing in to the host) moves the next session on a day. */
export const GameDay = {
  current: 0,
  content: null as DailyContent | null,
  changed: new Emitter(),

  get completed(): number { return parseInt(store.get("GameDay.Completed") ?? "0", 10) || 0; },

  /** The day being played this session. Fixed when first asked. A "?day=3" URL forces a day (for testing). */
  get today(): number {
    if (this.current > 0) return this.current;
    const forced = parseInt(new URLSearchParams(location.search).get("day") ?? "", 10);
    if (forced > 0) return (this.current = forced);
    const next = this.completed + 1;
    return (this.current = this.content ? this.content.latestDayUpTo(next) : 1);
  },

  choose(day: number) {
    if (day < 1 || day === this.today) return;
    this.current = day;
    this.changed.emit();
  },

  /** Work the day out again from saved progress next time (back at the main menu). */
  forget() { this.current = 0; },

  markComplete(day: number) {
    if (day <= this.completed) return;
    store.set("GameDay.Completed", String(day));
  },

  resetProgress() { store.remove("GameDay.Completed"); this.current = 0; },
};

// ---------------------------------------------------------------- quests

export enum QuestState { NotStarted, Active, Completed }

export class QuestManager {
  readonly completed = new Emitter<[QuestData]>();
  readonly hudChanged = new Emitter();

  private states = new Map<string, QuestState>();
  private active = new Map<string, QuestData>();
  private items = new Map<string, number>();

  state(q: QuestData | string | null | undefined): QuestState {
    const id = typeof q === "string" ? q : q?.id;
    return (id && this.states.get(id)) || QuestState.NotStarted;
  }

  count(itemId: string | undefined) { return (itemId && this.items.get(itemId)) || 0; }

  progress(q: QuestData) {
    if (!needsOtherQuests(q)) return this.count(q.itemId);
    return q.requiredQuests!.filter((id) => this.state(id) === QuestState.Completed).length;
  }

  goal(q: QuestData) { return needsOtherQuests(q) ? q.requiredQuests!.length : q.requiredCount ?? 0; }

  readyToHandIn(q: QuestData) { return this.state(q) === QuestState.Active && this.progress(q) >= this.goal(q); }

  start(q: QuestData) {
    if (this.state(q) !== QuestState.NotStarted) return;
    this.states.set(q.id, QuestState.Active);
    this.active.set(q.id, q);
    this.hudChanged.emit();
  }

  complete(q: QuestData) {
    if (!this.readyToHandIn(q)) return;
    if (!needsOtherQuests(q) && q.itemId) this.items.set(q.itemId, this.count(q.itemId) - (q.requiredCount ?? 0));
    this.finishInternal(q);
  }

  /** Completes a quest with nothing to hand in (a quiz). */
  finish(q: QuestData) {
    if (this.state(q) === QuestState.Completed) return;
    this.finishInternal(q);
  }

  private finishInternal(q: QuestData) {
    this.states.set(q.id, QuestState.Completed);
    this.active.delete(q.id);
    this.hudChanged.emit();
    this.completed.emit(q);
  }

  addItem(itemId: string, amount = 1) {
    this.items.set(itemId, this.count(itemId) + amount);
    this.hudChanged.emit();
  }

  /** Lines for the quest HUD; empty when nothing is active. */
  hudLines(): { text: string; done: boolean }[] {
    const lines: { text: string; done: boolean }[] = [];
    for (const q of this.active.values()) {
      const goal = this.goal(q);
      const have = Math.min(this.progress(q), goal);
      lines.push(have >= goal
        ? { text: `${q.title}: done - go back and tell them!`, done: true }
        : { text: `${q.title}: ${have}/${goal}`, done: false });
    }
    return lines;
  }
}

// ---------------------------------------------------------------- player control lock

/**
 * Freezes the player during cutscene-like moments (conversations, the library books arriving, popups).
 * Counted, so overlapping sequences are safe.
 */
export const ControlLock = {
  count: 0,
  changed: new Emitter<[boolean]>(),
  get locked() { return this.count > 0; },
  lock() { if (this.count++ === 0) this.changed.emit(true); },
  unlock() {
    if (this.count === 0) return;
    if (--this.count === 0) this.changed.emit(false);
  },
  reset() { this.count = 0; this.changed.emit(false); },
};
