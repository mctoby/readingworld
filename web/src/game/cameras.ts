// A small Cinemachine: virtual cameras with priorities, the "brain" that films through the live one and
// blends (ease in/out) when it changes, and the camera behaviours the Unity scene uses:
//   - fixed cameras (trigger zones switch them on while the player is inside),
//   - a camera that stays put but turns to follow the player and zooms to keep them framed,
//   - a dolly camera that slides along a spline to stay near the player,
//   - one-off shots (talking to an NPC, the library filling up).

import * as THREE from "three";
import type { CamData, ZoneData } from "../data";
import { cameraQuat, matrixOf, vec } from "../unity";

export interface Pose { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number }

export abstract class VirtualCamera {
  enabled = true;
  activatedAt = 0;
  readonly pose: Pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 60 };
  constructor(public name: string, public priority: number) {}
  /** Moves the pose for this frame. 'live' is false while it's only on standby. */
  abstract update(dt: number, target: THREE.Vector3, live: boolean): void;
  /** Called when the camera goes live, to skip damping (Cinemachine's "Center On Activate"). */
  snap(target: THREE.Vector3) { this.update(1, target, true); }
}

/** Never moves: a fixed shot. */
export class FixedCamera extends VirtualCamera {
  constructor(name: string, priority: number, position: THREE.Vector3, quaternion: THREE.Quaternion, fov: number) {
    super(name, priority);
    this.pose.position.copy(position);
    this.pose.quaternion.copy(quaternion);
    this.pose.fov = fov;
  }
  update() {}
}

const m = new THREE.Matrix4();
const up = new THREE.Vector3(0, 1, 0);
const look = new THREE.Quaternion();
const _aimAt = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _flat = new THREE.Vector3();
const _right = new THREE.Vector3();
const _p = new THREE.Vector3();

/** RotationComposer (+ optional FollowZoom and SplineDolly) from the Unity scene. */
export class TrackingCamera extends VirtualCamera {
  private aim = new THREE.Vector3();
  private aimInit = false;
  private spline: THREE.CatmullRomCurve3 | null = null;
  private splineU = 0;
  private offset: THREE.Vector3;

  constructor(private data: CamData) {
    super(data.name, data.priority);
    this.pose.position.copy(vec(data.xform.position));
    this.pose.quaternion.copy(cameraQuat(data.xform.rotation));
    this.pose.fov = data.lens.fov;
    this.offset = vec(data.composerOffset);
    if (data.dolly && data.splinePoints && data.splinePoints.length > 1) {
      this.spline = new THREE.CatmullRomCurve3(data.splinePoints.map(vec), data.splineClosed, "centripetal");
      this.splineU = data.dollyPosition;
    }
  }

  update(dt: number, target: THREE.Vector3, _live: boolean) {
    const d = this.data;
    const aimAt = _aimAt.copy(target).add(this.offset);

    // Dolly: the nearest point on the track to the player, plus the offset in the track's own frame.
    if (this.spline) {
      this.splineU = nearestU(this.spline, target, 120);
      const p = this.spline.getPointAt(this.splineU, _p);
      const t = this.spline.getTangentAt(this.splineU, _tan);
      const flat = _flat.set(t.x, 0, t.z).normalize();
      const right = _right.crossVectors(up, flat).normalize();   // three.js space mirrors Unity's right
      const o = d.dollyOffset;
      this.pose.position.copy(p).addScaledVector(right, -o.x).addScaledVector(up, o.y).addScaledVector(flat, o.z);
    }

    // Composer: turn toward the target, damped (Cinemachine damping is roughly a time constant).
    if (!this.aimInit) { this.aim.copy(aimAt); this.aimInit = true; }
    const damp = Math.max(d.composerDamping.x, d.composerDamping.y);
    const k = damp > 0 ? 1 - Math.exp(-dt * (3 / damp)) : 1;
    this.aim.lerp(aimAt, k);
    m.lookAt(this.pose.position, this.aim, up);
    look.setFromRotationMatrix(m);
    this.pose.quaternion.copy(look);

    // Follow zoom: keep a shot about 'zoomWidth' metres across at the target's distance.
    if (d.followZoom) {
      const dist = this.pose.position.distanceTo(aimAt);
      const want = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(d.zoomWidth / (2 * Math.max(0.01, dist)))), d.zoomFovRange.x, d.zoomFovRange.y);
      const kz = d.zoomDamping > 0 ? 1 - Math.exp(-dt * (3 / d.zoomDamping)) : 1;
      this.pose.fov = THREE.MathUtils.lerp(this.pose.fov, want, kz);
    }
  }

  snap(target: THREE.Vector3) {
    this.aimInit = false;
    const saveFov = this.data.zoomDamping;
    this.data.zoomDamping = 0;
    this.update(1, target, true);
    this.data.zoomDamping = saveFov;
  }
}

function nearestU(curve: THREE.CatmullRomCurve3, p: THREE.Vector3, samples: number) {
  let best = 0, bestD = Infinity;
  const tmp = new THREE.Vector3();
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const d = curve.getPointAt(u, tmp).distanceToSquared(p);
    if (d < bestD) { bestD = d; best = u; }
  }
  // Refine around the best sample.
  let lo = Math.max(0, best - 1 / samples), hi = Math.min(1, best + 1 / samples);
  for (let it = 0; it < 12; it++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (curve.getPointAt(a, tmp).distanceToSquared(p) < curve.getPointAt(b, tmp).distanceToSquared(p)) hi = b; else lo = a;
  }
  return (lo + hi) / 2;
}

/** A shot whose pose is set from outside (dialogue and library cameras). */
export class ScriptedCamera extends VirtualCamera {
  update() {}
}

// ---------------------------------------------------------------- the brain

export class CameraBrain {
  readonly cameras: VirtualCamera[] = [];
  private live: VirtualCamera | null = null;
  private blendFrom: Pose | null = null;
  private blendT = 1;
  private clock = 0;
  private lastOut: Pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 60 };

  constructor(public camera: THREE.PerspectiveCamera, public blendTime: number) {}

  add<T extends VirtualCamera>(cam: T) { this.cameras.push(cam); return cam; }

  setEnabled(cam: VirtualCamera, on: boolean) {
    if (cam.enabled === on) return;
    cam.enabled = on;
    if (on) cam.activatedAt = ++this.clock;
  }

  /** The camera that should be live: highest priority, then the most recently enabled. */
  private pick() {
    let best: VirtualCamera | null = null;
    for (const c of this.cameras) {
      if (!c.enabled) continue;
      if (!best || c.priority > best.priority || (c.priority === best.priority && c.activatedAt > best.activatedAt)) best = c;
    }
    return best;
  }

  get blending() { return this.blendT < 1; }

  update(dt: number, target: THREE.Vector3) {
    const next = this.pick();
    if (next !== this.live) {
      if (this.live) {
        this.blendFrom = { position: this.lastOut.position.clone(), quaternion: this.lastOut.quaternion.clone(), fov: this.lastOut.fov };
        this.blendT = 0;
      }
      next?.snap(target);
      this.live = next;
    }
    for (const c of this.cameras) if (c.enabled) c.update(dt, target, c === this.live);
    if (!this.live) return;

    const p = this.live.pose;
    const out = this.lastOut;
    if (this.blendFrom && this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / Math.max(0.01, this.blendTime));
      const k = easeInOut(this.blendT);
      out.position.lerpVectors(this.blendFrom.position, p.position, k);
      out.quaternion.slerpQuaternions(this.blendFrom.quaternion, p.quaternion, k);
      out.fov = THREE.MathUtils.lerp(this.blendFrom.fov, p.fov, k);
    } else {
      out.position.copy(p.position);
      out.quaternion.copy(p.quaternion);
      out.fov = p.fov;
    }
    this.camera.position.copy(out.position);
    this.camera.quaternion.copy(out.quaternion);
    if (Math.abs(this.camera.fov - out.fov) > 1e-3) { this.camera.fov = out.fov; this.camera.updateProjectionMatrix(); }
  }
}

const easeInOut = (t: number) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------- trigger zones

/** A box that turns a camera on while the player is inside (CameraZone + BoxTriggerDetection). */
const _zp = new THREE.Vector3();

export class CameraZone {
  private inverse: THREE.Matrix4;
  private inside: boolean | null = null;
  constructor(data: ZoneData, private cam: VirtualCamera, private brain: CameraBrain) {
    const world = matrixOf(data.xform).multiply(new THREE.Matrix4().compose(vec(data.center), new THREE.Quaternion(), new THREE.Vector3(data.size.x, data.size.y, data.size.z)));
    this.inverse = world.invert();
  }

  update(player: THREE.Vector3, height: number) {
    const p = _zp.copy(player); p.y += height * 0.5; p.applyMatrix4(this.inverse);
    const inside = Math.abs(p.x) <= 0.5 && Math.abs(p.y) <= 0.5 + height && Math.abs(p.z) <= 0.5;
    if (inside === this.inside) return;
    // Like Unity, a player already inside at the start counts as entering.
    if (inside) this.brain.setEnabled(this.cam, true);
    else if (this.inside !== null) this.brain.setEnabled(this.cam, false);
    this.inside = inside;
  }
}
