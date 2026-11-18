// Things in the world the player interacts with: collectable quest books (Collectable), push crates
// (PushCrate), the library shelves that fill up (LibraryManager), and the sparkle bursts (SparkleBurst).

import * as THREE from "three";
import type { CollectData, CrateData, LibraryData } from "../data";
import { GAME } from "../data";
import { vec } from "../unity";
import { inCubic, outBack, outCubic } from "../ui/kit";
import type { Physics, Solid } from "./physics";

// ---------------------------------------------------------------- sparkles

let sparkleTex: THREE.Texture | null = null;

export class Sparkles {
  private bursts: { points: THREE.Points; vel: Float32Array; t: number }[] = [];
  constructor(private scene: THREE.Scene) {
    if (!sparkleTex) {
      sparkleTex = new THREE.TextureLoader().load(GAME + "ui/SparkleDot.png");
      sparkleTex.colorSpace = THREE.SRGBColorSpace;
    }
  }

  /** A one-shot puff of twinkling dots (the SparkleBurst prefab). */
  burst(at: THREE.Vector3, count = 18) {
    const pos = new Float32Array(count * 3), vel = new Float32Array(count * 3), col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const d = new THREE.Vector3().randomDirection();
      d.y = Math.abs(d.y) * 0.8 + 0.2;
      const speed = 0.6 + Math.random() * 1.4;
      vel.set([d.x * speed, d.y * speed, d.z * speed], i * 3);
      pos.set([at.x, at.y, at.z], i * 3);
      const c = new THREE.Color().setHSL(0.12 + Math.random() * 0.1, 1, 0.75 + Math.random() * 0.2);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.16, map: sparkleTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(g, mat);
    points.frustumCulled = false;
    this.scene.add(points);
    this.bursts.push({ points, vel, t: 0 });
  }

  update(dt: number) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      const life = 0.8;
      const pos = b.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let j = 0; j < pos.count; j++) {
        b.vel[j * 3 + 1] -= 1.5 * dt;
        pos.setXYZ(j, pos.getX(j) + b.vel[j * 3] * dt, pos.getY(j) + b.vel[j * 3 + 1] * dt, pos.getZ(j) + b.vel[j * 3 + 2] * dt);
        b.vel[j * 3] *= 1 - 2 * dt; b.vel[j * 3 + 2] *= 1 - 2 * dt;
      }
      pos.needsUpdate = true;
      const mat = b.points.material as THREE.PointsMaterial;
      mat.opacity = 1 - b.t / life;
      mat.size = 0.16 * (1 - 0.5 * (b.t / life)) * (0.8 + 0.4 * Math.sin(b.t * 30));
      if (b.t >= life) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        mat.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }
}

// ---------------------------------------------------------------- collectables

export class Collectable {
  collected = false;
  private start = new THREE.Vector3();
  private baseScale = new THREE.Vector3();
  private appearT = -1;
  private collectT = -1;
  private time = Math.random() * 10;
  private collectFrom = new THREE.Vector3();

  constructor(public data: CollectData, public object: THREE.Object3D, private sparkles: Sparkles, private onCollect: (itemId: string) => void) {
    this.baseScale.copy(object.scale);
    this.start.copy(object.position);
  }

  get active() { return this.object.visible && !this.collected; }

  /** Pops into existence with a sparkle (when its quest is accepted). */
  show() {
    if (this.collected) return;
    this.object.visible = true;
    this.start.copy(this.object.position);
    this.appearT = 0;
    this.object.updateMatrixWorld();
    this.sparkles.burst(this.object.getWorldPosition(new THREE.Vector3()));
  }

  hide() { this.object.visible = false; }

  update(dt: number, player: THREE.Vector3, playerRadius: number, playerHeight: number) {
    if (!this.object.visible) return;
    const d = this.data;
    this.time += dt;

    if (this.collectT >= 0) {
      // Spin up, swell for a beat, then shoot upward while shrinking away.
      this.collectT += dt;
      const k = this.collectT / d.collectDuration;
      this.object.rotateOnWorldAxis(Y, THREE.MathUtils.degToRad(d.spinSpeed * (4 + 12 * k)) * dt);
      this.object.position.copy(this.collectFrom).addScaledVector(Y, d.collectRise * outCubic(k));
      const swell = k < 0.3 ? 1 + 0.35 * (k / 0.3) : THREE.MathUtils.lerp(1.35, 0, inCubic((k - 0.3) / 0.7));
      this.object.scale.copy(this.baseScale).multiplyScalar(Math.max(0, swell));
      if (k >= 1) this.object.visible = false;
      return;
    }

    this.object.rotateOnWorldAxis(Y, THREE.MathUtils.degToRad(d.spinSpeed) * dt);
    this.object.position.copy(this.start).addScaledVector(Y, Math.sin(this.time * d.bobSpeed) * d.bobHeight);
    if (this.appearT >= 0) {
      this.appearT += dt;
      const k = this.appearT / 0.5;
      this.object.scale.copy(this.baseScale).multiplyScalar(k >= 1 ? 1 : outBack(k));
      if (k >= 1) this.appearT = -1;
    }

    // Trigger: the player walks into the item's box.
    const c = this.object.getWorldPosition(tmp);
    const half = Math.max(d.boxSize.x, d.boxSize.z) * 0.5 * this.baseScale.x;
    const dx = Math.abs(player.x - c.x), dz = Math.abs(player.z - c.z);
    const dy = c.y - player.y;
    if (!this.collected && dx < half + playerRadius && dz < half + playerRadius && dy > -0.6 && dy < playerHeight + 0.4) {
      this.collected = true;
      this.collectFrom.copy(this.object.position);
      this.collectT = 0;
      this.sparkles.burst(c.clone());
      this.onCollect(d.itemId);
    }
  }
}
const Y = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _md = new THREE.Vector3();

// ---------------------------------------------------------------- push crates

/**
 * A crate like the boxes in an old-school box puzzle: lean on a side for a moment and it slides exactly
 * one step along X or Z, unless something solid is in the way (then it just bumps).
 */
export class PushCrate {
  readonly solid: Solid;
  private pushDir = new THREE.Vector3();
  private pushTimer = 0;
  private pushedThisFrame = false;
  private busy = false;
  private anim: ((dt: number) => boolean) | null = null;
  private size: THREE.Vector3;
  private center: THREE.Vector3;

  constructor(public data: CrateData, public object: THREE.Object3D, private physics: Physics) {
    this.size = new THREE.Vector3(data.boxSize.x, data.boxSize.y, data.boxSize.z);
    this.center = vec(data.boxCenter).multiply(object.scale);
    this.solid = { enabled: true, box: new THREE.Box3(), onPush: (n, m) => this.push(n, m) };
    this.syncBox();
    physics.solids.push(this.solid);
  }

  private syncBox() {
    const c = this.object.position.clone().add(this.center);
    this.solid.box!.setFromCenterAndSize(c, this.size);
  }

  /** Called while the player walks into this crate: contact normal (toward the player) and move direction. */
  push(normal: THREE.Vector3, moveDir: THREE.Vector3) {
    if (this.busy) return;
    const dir = _dir.set(0, 0, 0);
    if (Math.abs(normal.x) > 0.8) dir.set(-Math.sign(normal.x), 0, 0);
    else if (Math.abs(normal.z) > 0.8) dir.set(0, 0, -Math.sign(normal.z));
    else return;
    const md = _md.copy(moveDir); md.y = 0;
    if (md.lengthSq() < 1e-6 || md.normalize().dot(dir) < 0.6) return;
    if (!dir.equals(this.pushDir)) { this.pushDir.copy(dir); this.pushTimer = 0; }
    this.pushedThisFrame = true;
  }

  update(dt: number) {
    if (this.anim) {
      if (!this.anim(dt)) this.anim = null;
      this.syncBox();
      return;
    }
    if (!this.pushedThisFrame) { this.pushTimer = 0; return; }
    this.pushedThisFrame = false;
    this.pushTimer += dt;
    if (this.pushTimer < this.data.pushDelay) return;
    this.pushTimer = 0;

    const dir = this.pushDir.clone();
    const from = this.object.position.clone();
    if (this.blocked(dir)) {
      // A tiny nudge forward and back, so it's clear the crate can't go that way.
      this.busy = true;
      let t = 0;
      this.anim = (d) => {
        t += d;
        const k = t / 0.18;
        this.object.position.copy(from).addScaledVector(dir, k >= 1 ? 0 : Math.sin(k * Math.PI) * 0.03);
        if (k >= 1) { this.busy = false; return false; }
        return true;
      };
    } else {
      this.busy = true;
      const to = from.clone().addScaledVector(dir, this.data.stepSize);
      let t = 0;
      this.anim = (d) => {
        t += d;
        const k = t / this.data.slideTime;
        this.object.position.lerpVectors(from, to, outCubic(k));
        if (k >= 1) { this.object.position.copy(to); this.busy = false; return false; }
        return true;
      };
    }
  }

  /** Would the crate hit something solid one step along 'dir'? (Slightly smaller box, so the ground doesn't count.) */
  private blocked(dir: THREE.Vector3) {
    const b = this.solid.box!.clone();
    b.min.addScalar(0.02); b.max.addScalar(-0.02);
    b.translate(dir.clone().multiplyScalar(this.data.stepSize));
    return !this.physics.boxIsClear(b, this.solid);
  }
}

// ---------------------------------------------------------------- library

/**
 * The library's shelves: books start hidden and appear (sliding in, with a sparkle) when quests are
 * completed, while a camera frames the shelves so the reader can watch them arrive.
 */
export class Library {
  private next = 0;
  private bases: { pos: THREE.Vector3; scale: THREE.Vector3; box: THREE.Box3 }[] = [];

  constructor(public data: LibraryData, public root: THREE.Object3D, public books: THREE.Object3D[]) {
    root.updateMatrixWorld(true);
    for (const b of books) {
      this.bases.push({ pos: b.position.clone(), scale: b.scale.clone(), box: new THREE.Box3().setFromObject(b) });
      b.visible = false;
    }
  }

  get remaining() { return this.books.length - this.next; }

  /** Reserves the next 'count' books. Returns their indexes (fewer if the shelves are full). */
  take(count: number) {
    const n = Math.min(count, this.books.length - this.next);
    if (n < count) console.warn(`Library: only ${Math.max(n, 0)} of ${count} books could be added.`);
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(this.next++);
    return out;
  }

  /** Bounds of some books, to frame them. */
  bounds(indexes: number[]) {
    const b = new THREE.Box3();
    for (const i of indexes) b.union(this.bases[i].box);
    return b;
  }

  /** Slides a book in from in front of the shelf; resolves when it lands. */
  slideIn(i: number, towardCamera: THREE.Vector3, sparkles: Sparkles, onFrame: (cb: (dt: number) => boolean) => void) {
    const d = this.data;
    const book = this.books[i];
    const base = this.bases[i];
    // Work in the book's parent space.
    const parentInv = new THREE.Matrix4().copy(book.parent!.matrixWorld).invert();
    const offsetWorld = towardCamera.clone().multiplyScalar(d.slideDistance).add(new THREE.Vector3(0, d.slideDistance * 0.3, 0));
    const endWorld = base.pos.clone().applyMatrix4(book.parent!.matrixWorld);
    const start = endWorld.clone().add(offsetWorld).applyMatrix4(parentInv);
    const end = base.pos.clone();
    book.position.copy(start);
    book.scale.copy(base.scale).multiplyScalar(0.3);
    book.visible = true;
    return new Promise<void>((resolve) => {
      let t = 0;
      onFrame((dt) => {
        t += dt;
        const k = t / d.slideDuration;
        if (k >= 1) {
          book.position.copy(end);
          book.scale.copy(base.scale);
          sparkles.burst(base.box.getCenter(new THREE.Vector3()));
          resolve();
          return false;
        }
        book.position.lerpVectors(start, end, outCubic(k));
        book.scale.copy(base.scale).multiplyScalar(THREE.MathUtils.lerp(0.3, 1, outBack(k)));
        return true;
      });
    });
  }

  /**
   * Places a camera so the whole of 'target' is in view (LibraryManager.PositionCamera).
   * Returns the camera pose and the horizontal direction from the books toward the camera.
   */
  frame(target: THREE.Box3, player: THREE.Vector3, aspect: number) {
    const d = this.data;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()));
    const center = target.getCenter(new THREE.Vector3());
    let side = forward.clone();
    if (d.cameraSide === 2) side.negate();
    else if (d.cameraSide === 0 && player.clone().sub(center).dot(forward) < 0) side.negate();

    const el = THREE.MathUtils.degToRad(d.cameraElevation);
    const dir = side.clone().multiplyScalar(Math.cos(el)).add(new THREE.Vector3(0, Math.sin(el), 0)).normalize();   // books -> camera
    const m = new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    const rot = new THREE.Quaternion().setFromRotationMatrix(m);   // camera looks down -dir

    const halfV = Math.tan(THREE.MathUtils.degToRad(d.lens.fov) / 2);
    const halfH = halfV * aspect;
    const inv = rot.clone().invert();
    const e = target.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    let dist = 0.6;
    for (let i = 0; i < 8; i++) {
      const corner = new THREE.Vector3(i & 1 ? e.x : -e.x, i & 2 ? e.y : -e.y, i & 4 ? e.z : -e.z).applyQuaternion(inv);
      // In camera space the camera looks down -Z, so "away from the camera" is -z.
      dist = Math.max(dist, (Math.abs(corner.x) * d.framingPadding) / halfH + corner.z);
      dist = Math.max(dist, (Math.abs(corner.y) * d.framingPadding) / halfV + corner.z);
    }
    return { position: center.clone().addScaledVector(dir, dist), quaternion: rot, side };
  }
}
