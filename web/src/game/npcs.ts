// NPCs: placement (NPCPlacer), the talk bubble, the "hello" hop, facing the player while talking, and which
// conversation to use for the day, reading level and quest progress (NPCInteractable).

import * as THREE from "three";
import type { DialogueData, DialogueLine, NpcData, WorldData } from "../data";
import { hasQuest, isQuiz, loadJson } from "../data";
import { applyXform, cameraQuat, color, matrixOf, vec, DotNetRandom } from "../unity";
import { GameDay, QuestState, ReadingSettings, type DailyContent, type QuestManager } from "../state";
import type { Physics, Solid } from "./physics";
import { ScriptedCamera } from "./cameras";

// Scratch objects reused every frame.
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

export class Npc {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly bubble: THREE.Sprite;
  readonly camera: ScriptedCamera;
  readonly solid: Solid;
  talking = false;
  /** Today's conversation at the current reading level (loaded when the session starts). */
  current: DialogueData | null = null;
  private unlocked = false;
  private cache = new Map<string, DialogueData | null>();
  private baseScale: THREE.Vector3;
  private hopT = -1;
  private camLocal: THREE.Matrix4 | null = null;
  private wasInRange = false;
  private bubbleT = Math.random() * 10;

  constructor(public data: NpcData, chip: THREE.Object3D, bubbleTex: THREE.Texture, physics: Physics, private content: DailyContent, private quests: QuestManager) {
    applyXform(this.root, data.xform);
    this.baseScale = this.root.scale.clone();

    this.model = chip.clone(true);
    applyXform(this.model, data.model);
    this.root.add(this.model);
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true; mesh.receiveShadow = true;
      // Each NPC's body has its own colour (a different material in Unity).
      if (data.bodyColor && (o.name.startsWith("Chip_Retopo") || o.parent?.name.startsWith("Chip_Retopo"))) {
        const m = (mesh.material as THREE.MeshStandardMaterial).clone();
        m.color.copy(color(data.bodyColor));
        mesh.material = m;
      }
    });

    // Talk bubble, floating above the head (in world units, so undo the NPC's scale).
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex, depthWrite: false, transparent: true }));
    this.bubble.scale.set(0.28 / this.baseScale.x, 0.24 / this.baseScale.y, 1);
    this.bubble.position.set(0, 0.62 / this.baseScale.y, 0);
    this.bubble.visible = false;
    this.root.add(this.bubble);

    // The dialogue camera is a child of the NPC in Unity: keep its pose relative to the NPC.
    if (data.dialogueCamera) {
      const camWorld = new THREE.Matrix4().compose(vec(data.dialogueCamera.position), cameraQuat(data.dialogueCamera.rotation), new THREE.Vector3(1, 1, 1));
      this.camLocal = matrixOf(data.xform).invert().multiply(camWorld);
    }
    this.camera = new ScriptedCamera(`${data.id} dialogue`, 20);
    this.camera.enabled = false;
    this.camera.pose.fov = data.dialogueLens.fov;

    this.solid = {
      enabled: true,
      cylinder: { center: new THREE.Vector3(), radius: Math.max(0.1, data.capsuleRadius), height: Math.max(0.3, data.capsuleHeight) },
    };
    physics.solids.push(this.solid);
    this.syncSolid();
  }

  get id() { return this.data.id; }
  get position() { return this.root.position; }

  /** Moves the NPC (NPCPlacer). */
  placeAt(p: THREE.Vector3, yaw?: number) {
    this.root.position.copy(p);
    if (yaw !== undefined) this.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.syncSolid();
  }

  private syncSolid() {
    const c = this.solid.cylinder!;
    c.center.set(this.root.position.x, this.root.position.y - c.height / 2, this.root.position.z);
  }

  // ---------------------------------------------------------------- conversation choice

  /** The conversation for today and the current reading level (the nearest level that has a file). */
  async loadData(): Promise<DialogueData | null> {
    const level = ReadingSettings.level;
    const day = GameDay.today;
    const key = `${day}:${level}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const files = this.content.filesFor(this.data.npcId, day) ?? this.data.dialogue;
    let result: DialogueData | null = null;
    outer: for (let d = 0; d < 3; d++) {
      for (const i of [level - d, level + d]) {
        if (i < 0 || i > 2 || !files[i]) continue;
        try { result = await loadJson<DialogueData>(files[i]!); } catch (e) { console.warn(e); continue; }
        break outer;
      }
    }
    this.cache.set(key, result);
    return result;
  }

  /** Forget the old day's conversation and lock state (another day was chosen). */
  resetForDay() { this.cache.clear(); this.unlocked = false; }

  /** False until the gate quest (e.g. the Librarian's) has been started. Once unlocked, stays unlocked. */
  isUnlocked(data: DialogueData | null) {
    if (!this.unlocked) {
      const gate = data?.unlockedByQuest || this.data.unlockedByQuest;
      this.unlocked = !gate || this.quests.state(gate) !== QuestState.NotStarted;
    }
    return this.unlocked;
  }

  /** What the NPC says given quest progress, and what happens when it ends. */
  pickLines(data: DialogueData): { lines: DialogueLine[]; onFinished?: () => void; startsQuest: boolean } {
    const q = data.quest;
    const or = (l?: DialogueLine[]) => (l && l.length > 0 ? l : data.lines);
    if (!hasQuest(q)) return { lines: data.lines, startsQuest: false };
    const qm = this.quests;

    if (isQuiz(q)) {
      if (qm.state(q) === QuestState.Completed) return { lines: or(data.afterLines), startsQuest: false };
      return { lines: data.lines, onFinished: () => qm.finish(q), startsQuest: false };
    }
    switch (qm.state(q)) {
      case QuestState.NotStarted:
        return { lines: data.lines, onFinished: () => qm.start(q), startsQuest: true };
      case QuestState.Active:
        if (qm.readyToHandIn(q)) return { lines: or(data.completeLines), onFinished: () => qm.complete(q), startsQuest: false };
        return { lines: or(data.inProgressLines), startsQuest: false };
      default:
        return { lines: or(data.afterLines), startsQuest: false };
    }
  }

  // ---------------------------------------------------------------- per frame

  /** Returns whether the player could talk to this NPC right now. */
  update(dt: number, player: THREE.Vector3, talkable: boolean) {
    // Turn to face the player while talking.
    if (this.talking) {
      const d = _d.copy(player).sub(this.root.position); d.y = 0;
      if (d.lengthSq() > 0.0001) this.root.quaternion.slerp(_q.setFromAxisAngle(_up, Math.atan2(d.x, d.z)), 1 - Math.exp(-8 * dt));
    }

    // Talk bubble: shown once this NPC is unlocked; bobs gently.
    this.bubble.visible = talkable && !this.talking;
    this.bubbleT += dt;
    this.bubble.position.y = (0.62 + Math.sin(this.bubbleT * 2.5) * 0.02) / this.baseScale.y;

    const inRange = !this.talking && talkable && this.distanceTo(player) <= this.data.interactRange;
    if (inRange && !this.wasInRange) this.hopT = 0;   // a little "hello!" bounce
    this.wasInRange = inRange;

    if (this.hopT >= 0) {
      this.hopT += dt;
      const k = this.hopT / 0.45;
      if (k >= 1) { this.hopT = -1; this.root.scale.copy(this.baseScale); }
      else {
        const wave = Math.sin(k * Math.PI * 2) * (1 - k);
        this.root.scale.set(this.baseScale.x * (1 - 0.08 * wave), this.baseScale.y * (1 + 0.12 * wave), this.baseScale.z * (1 - 0.08 * wave));
      }
    }

    // Idle breathing.
    const s = 1 + Math.sin(this.bubbleT * 1.7) * 0.015;
    this.model.scale.setScalar(this.data.model.scale.x).multiply(_d.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s)));

    if (this.camLocal) {
      this.root.updateMatrixWorld();
      _m.multiplyMatrices(this.root.matrixWorld, this.camLocal).decompose(this.camera.pose.position, this.camera.pose.quaternion, _d);
    }
    return inRange;
  }

  distanceTo(p: THREE.Vector3) { return this.root.position.distanceTo(p); }
}

/** NPCPlacer: shuffles the locators with the day as the seed, so everyone sees the same layout each day. */
export function placeNpcs(world: WorldData, npcs: Npc[], day: number) {
  const spots = world.locators.map(vec);
  const rng = new DotNetRandom(day * 7919 + world.placerSalt);
  for (let i = spots.length - 1; i > 0; i--) {
    const j = rng.next(i + 1);
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  world.placerNpcs.forEach((id, i) => {
    const npc = npcs.find((n) => n.id === id);
    if (!npc || i >= spots.length) return;
    npc.placeAt(spots[i].clone().add(new THREE.Vector3(0, world.placerHeight, 0)));
  });
}

/** A cartoon speech bubble with three dots, drawn once. */
export function bubbleTexture() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 112;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.strokeStyle = "#26264c";
  g.lineWidth = 7;
  g.beginPath();
  g.roundRect(8, 8, 112, 72, 30);
  g.moveTo(44, 78); g.lineTo(40, 104); g.lineTo(70, 78);
  g.fill(); g.stroke();
  g.fillStyle = "#ffffff";
  g.fillRect(42, 70, 30, 12);
  g.fillStyle = "#26264c";
  for (const x of [40, 64, 88]) { g.beginPath(); g.arc(x, 44, 8, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
