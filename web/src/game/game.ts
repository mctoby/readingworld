// One play session of a day: builds the world with that day's lighting and runs it until the player goes
// back to the main menu. Ties together what the Unity scenes wired up in the inspector.

import * as THREE from "three";
import type { QuestData, WorldData } from "../data";
import { needsOtherQuests, rewardBooks } from "../data";
import { ControlLock, GameDay, QuestManager, type DailyContent } from "../state";
import { playMusic, playSound, stopMusic } from "../audio";
import { Input } from "./input";
import { addRim, createWorld, node, type Models, type World } from "./world";
import { Butterflies, Motes, scatterMeadow } from "./ambience";
import type { Physics } from "./physics";
import { Player } from "./player";
import { CameraBrain, CameraZone, FixedCamera, ScriptedCamera, TrackingCamera } from "./cameras";
import { Npc, bubbleTexture, placeNpcs } from "./npcs";
import { Collectable, Library, PushCrate, Sparkles } from "./props";
import { cameraQuat, vec } from "../unity";
import { DialogueBox } from "../ui/dialogue";
import { Glossary } from "../ui/glossary";
import { DayCompletePopup, QuestHud, TalkButton, TouchStick } from "../ui/hud";
import { h, wait } from "../ui/kit";

export class Game {
  readonly camera: THREE.PerspectiveCamera;
  private world!: World;
  private player!: Player;
  private brain!: CameraBrain;
  private zones: CameraZone[] = [];
  private npcs: Npc[] = [];
  private collectables: Collectable[] = [];
  private crates: PushCrate[] = [];
  private library: Library | null = null;
  private libraryCam = new ScriptedCamera("library", 30);
  private sparkles!: Sparkles;
  private motes: Motes | null = null;
  private butterflies: Butterflies | null = null;
  private quests = new QuestManager();
  private frameJobs = new Set<(dt: number) => boolean>();

  private ui: HTMLElement;
  private hud!: QuestHud;
  private talkButton!: TalkButton;
  private dialogue!: DialogueBox;
  private glossary!: Glossary;
  private dayComplete!: DayCompletePopup;
  private stick!: TouchStick;

  private target: Npc | null = null;
  private camTarget = new THREE.Vector3();
  private talking: Npc | null = null;
  private libraryQueue: number[][] = [];
  private libraryRunning = false;
  private disposed = false;
  private unsubs: (() => void)[] = [];

  constructor(
    private renderer: THREE.WebGLRenderer,
    private data: WorldData,
    private models: Models,
    private physics: Physics,
    private content: DailyContent,
    uiRoot: HTMLElement,
    private onExit: () => void,
  ) {
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
    this.ui = h("div", "game-ui", uiRoot);
  }

  async start() {
    const d = this.data;
    const day = GameDay.today;
    const night = this.content.timeOfDayFor(day) === "Night";
    const lighting = d.lighting.find((l) => l.scene.includes(night ? "Night" : "Day")) ?? d.lighting[0];

    // Fresh copies of the models, so a second visit starts clean.
    const environment = this.models.environment.scene.clone(true);
    const props = this.models.props.scene.clone(true);
    this.world = await createWorld(this.renderer, this.camera, environment, props, lighting);
    const scene = this.world.scene;
    this.sparkles = new Sparkles(scene);
    this.physics.solids.length = 0;

    // ---- player
    this.player = new Player(d.player, this.models.chip.scene.clone(true), this.physics);
    scene.add(this.player.root);

    // ---- NPCs (the exported NPC nodes are just markers; the characters are added here)
    const bubble = bubbleTexture();
    for (const nd of d.npcs) {
      node(props, nd.node)?.removeFromParent();
      const npc = new Npc(nd, this.models.chip.scene, bubble, this.physics, this.content, this.quests);
      scene.add(npc.root);
      this.npcs.push(npc);
    }
    placeNpcs(d, this.npcs, day);

    // ---- ambience: soft rim light on the characters, a meadow on the grass, pollen and butterflies or fireflies
    addRim(this.player.root);
    for (const npc of this.npcs) addRim(npc.root);
    // Keep the meadow off where people stand, the crates' track, and right in front of the fixed cameras.
    const near = (p: THREE.Vector3, r: number) => ({ p, r });
    const keepClear = [
      ...d.locators.map((l) => near(vec(l), 0.35)), ...this.npcs.map((n) => near(n.position.clone(), 0.35)),
      near(this.player.position.clone(), 0.35),
      ...d.crates.map((c) => node(props, c.node)?.getWorldPosition(new THREE.Vector3())).filter((p): p is THREE.Vector3 => !!p).map((p) => near(p, 0.6)),
      ...d.cameras.map((c) => near(vec(c.xform.position), 1.6)),
      ...(d.cameras.flatMap((c) => c.splinePoints ?? []).map((p) => near(vec(p), 1.2))),
    ];
    await scatterMeadow(scene, environment, keepClear);
    this.motes = new Motes(scene, night, this.player.position);
    if (!night) this.butterflies = new Butterflies(scene, this.player.position);
    await Promise.all(this.npcs.map(async (n) => { n.current = await n.loadData(); }));

    // ---- collectables (an NPC's quest objects stay hidden until the quest is accepted)
    const questObjects = new Set(d.npcs.flatMap((n) => n.questObjects));
    for (const c of d.collectables) {
      const o = node(props, c.node);
      if (!o) continue;
      const col = new Collectable(c, o, this.sparkles, (item) => {
        this.quests.addItem(item);
        playSound(d.questSound, 0.5);
      });
      if (questObjects.has(c.node)) col.hide();
      this.collectables.push(col);
    }

    // ---- crates
    for (const c of d.crates) {
      const o = node(props, c.node);
      if (o) this.crates.push(new PushCrate(c, o, this.physics));
    }

    // ---- library
    const libRoot = node(props, d.library.node);
    if (libRoot) {
      const books = d.library.books.map((b) => node(props, b)).filter((b): b is THREE.Object3D => !!b);
      this.library = new Library(d.library, libRoot, books);
    }

    // ---- cameras
    this.brain = new CameraBrain(this.camera, d.blendTime);
    for (const c of d.cameras) {
      const cam = c.tracking ? new TrackingCamera(c) : new FixedCamera(c.name, c.priority, vec(c.xform.position), cameraQuat(c.xform.rotation), c.lens.fov);
      cam.enabled = c.enabled;
      this.brain.add(cam);
      const zone = d.zones.find((z) => z.camera === c.id);
      if (zone) this.zones.push(new CameraZone(zone, cam, this.brain));
    }
    for (const npc of this.npcs) this.brain.add(npc.camera);
    this.libraryCam.enabled = false;
    this.libraryCam.pose.fov = d.library.lens.fov;
    this.brain.add(this.libraryCam);

    // ---- UI
    this.hud = new QuestHud(this.ui);
    this.glossary = new Glossary(this.ui, d.glossary);
    this.dialogue = new DialogueBox(this.ui, this.glossary, d.typingSound);
    this.glossary.isTalking = () => this.dialogue.active;
    this.talkButton = new TalkButton(this.ui, () => this.interact());
    this.stick = new TouchStick(this.ui);
    this.dayComplete = new DayCompletePopup(this.ui, () => ControlLock.unlock(), () => this.exitToMenu());

    this.unsubs.push(
      this.quests.hudChanged.on(() => this.hud.set(this.quests.hudLines())),
      this.quests.completed.on((q) => this.onQuestCompleted(q)),
      ControlLock.changed.on((locked) => {
        this.player.enabled = !locked;
        this.stick.visible = !locked;
        if (locked) Input.stick.set(0, 0);
      }),
    );
    this.player.enabled = !ControlLock.locked;
    this.stick.visible = !ControlLock.locked;

    playMusic(lighting.music, lighting.musicVolume);
    this.resize();
  }

  // ---------------------------------------------------------------- talking

  private async interact() {
    const npc = this.target;
    if (!npc || this.talking || npc.talking) return;
    const data = await npc.loadData();
    if (!data || !npc.isUnlocked(data) || this.talking) return;

    npc.talking = true;
    this.talking = npc;
    this.talkButton.visible = false;
    this.brain.setEnabled(npc.camera, true);
    this.world.setFocus(npc.position.clone().add(new THREE.Vector3(0, 0.12, 0)));
    ControlLock.lock();
    this.player.visible = false;

    const { lines, onFinished, startsQuest } = npc.pickLines(data);
    this.dialogue.start(data.npcName, lines, () => {
      onFinished?.();
      if (startsQuest) for (const id of npc.data.questObjects) this.collectables.find((c) => c.data.node === id)?.show();
      this.brain.setEnabled(npc.camera, false);
      this.world.setFocus(null);
      this.player.visible = true;
      ControlLock.unlock();
      // Swallow the closing press so it can't instantly start the conversation again.
      setTimeout(() => { npc.talking = false; this.talking = null; }, 200);
    });
  }

  // ---------------------------------------------------------------- quests, library, end of day

  private onQuestCompleted(q: QuestData) {
    // Every quest adds books to the library (LibraryManager with no quest filter).
    if (this.library && (!this.data.library.questId || q.id === this.data.library.questId)) {
      const books = this.library.take(rewardBooks(q));
      if (books.length > 0) { this.libraryQueue.push(books); void this.runLibrary(); }
    }
    // Only the host's quest is made of other quests: that's the end of the day.
    if (needsOtherQuests(q)) {
      const day = GameDay.today;
      GameDay.markComplete(day);
      void this.showDayComplete(day);
    }
  }

  private async runLibrary() {
    if (this.libraryRunning || !this.library) return;
    this.libraryRunning = true;
    // Wait for the conversation that completed the quest to close.
    while (this.dialogue.active || this.talking) { await wait(0.1); if (this.disposed) return; }
    ControlLock.lock();
    const lib = this.library;
    const blend = this.data.blendTime + 0.1;
    while (this.libraryQueue.length > 0) {
      const books = this.libraryQueue.shift()!;
      const shot = lib.frame(lib.bounds(books), this.player.position, this.camera.aspect);
      this.libraryCam.pose.position.copy(shot.position);
      this.libraryCam.pose.quaternion.copy(shot.quaternion);
      this.brain.setEnabled(this.libraryCam, true);
      await wait(blend);
      for (const i of books) {
        await lib.slideIn(i, shot.side, this.sparkles, (cb) => this.frameJobs.add(cb));
        await wait(this.data.library.revealInterval);
        if (this.disposed) return;
      }
      await wait(this.data.library.holdTime);
      this.brain.setEnabled(this.libraryCam, false);
    }
    await wait(blend);
    ControlLock.unlock();
    this.libraryRunning = false;
  }

  private async showDayComplete(day: number) {
    await wait(0.6);
    while (this.dialogue.active || this.libraryRunning) { await wait(0.1); if (this.disposed) return; }
    this.dayComplete.show(day);
    ControlLock.lock();
  }

  exitToMenu() {
    GameDay.forget();
    this.onExit();
  }

  // ---------------------------------------------------------------- frame

  update(dt: number) {
    if (!this.world) return;
    this.player.update(dt, this.camera);

    // NPCs and the Talk prompt: the nearest NPC in range gets it.
    let nearest: Npc | null = null, best = Infinity;
    for (const npc of this.npcs) {
      const talkable = !!npc.current && npc.isUnlocked(npc.current);
      const inRange = npc.update(dt, this.player.position, talkable && !this.talking);
      if (inRange) {
        const dist = npc.distanceTo(this.player.position);
        if (dist < best) { best = dist; nearest = npc; }
      }
    }
    this.target = ControlLock.locked ? null : nearest;
    this.talkButton.visible = !!this.target;
    if (this.target && Input.pressed("KeyE") && !this.dialogue.active) void this.interact();

    this.dialogue.update();
    this.glossary.update(Input.pressed("KeyG"));

    for (const c of this.collectables) c.update(dt, this.player.position, this.player.radius, this.player.height);
    for (const c of this.crates) c.update(dt);
    for (const job of [...this.frameJobs]) if (!job(dt)) this.frameJobs.delete(job);
    this.sparkles.update(dt);
    this.motes?.update(dt, this.player.position);
    this.butterflies?.update(dt, this.player.position);

    for (const z of this.zones) z.update(this.player.position, this.player.height);
    const target = this.player.cameraTarget(this.camTarget);
    this.brain.update(dt, target);
    this.world.update(dt, this.player.position, this.camera);
  }

  render() { if (this.world) this.world.render(); }

  resize() {
    const w = innerWidth, hgt = innerHeight;
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
    this.world?.resize(w, hgt);
  }

  dispose() {
    this.disposed = true;
    for (const u of this.unsubs) u();
    stopMusic();
    ControlLock.reset();
    this.motes?.dispose();
    this.butterflies?.dispose();
    this.world?.dispose();
    this.physics.solids.length = 0;
    this.ui.remove();
  }
}
