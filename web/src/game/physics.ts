// Collision for the web version: the static scenery (every solid Unity collider, exported to colliders.glb)
// becomes one BVH-accelerated mesh, and moving things (crates, NPCs) are simple boxes and cylinders.
// The player is a capsule, moved like Unity's CharacterController (slides along walls, stands on ground).

import * as THREE from "three";
import { MeshBVH, type ExtendedTriangle } from "three-mesh-bvh";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface Solid {
  /** World-space box (crates) or vertical cylinder (NPCs, box ignored). */
  box?: THREE.Box3;
  cylinder?: { center: THREE.Vector3; radius: number; height: number };
  /** Called when the player walks into this solid: contact normal (pointing at the player) and the player's move direction. */
  onPush?: (normal: THREE.Vector3, moveDir: THREE.Vector3) => void;
  enabled: boolean;
}

export class Physics {
  readonly bvh: MeshBVH;
  readonly solids: Solid[] = [];

  constructor(colliders: THREE.Object3D) {
    colliders.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    colliders.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = new THREE.BufferGeometry();
      const src = mesh.geometry.getAttribute("position");
      const pos = new Float32Array(src.count * 3);
      for (let i = 0; i < src.count; i++) { pos[i * 3] = src.getX(i); pos[i * 3 + 1] = src.getY(i); pos[i * 3 + 2] = src.getZ(i); }
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      if (mesh.geometry.index) g.setIndex(mesh.geometry.index.clone());
      g.applyMatrix4(mesh.matrixWorld);
      parts.push(g);
    });
    const merged = mergeGeometries(parts.map((g) => (g.index ? g : indexed(g))), false)!;
    this.bvh = new MeshBVH(merged);
  }

  /** Is a world-space box clear of the scenery and of every solid except 'ignore'? */
  boxIsClear(box: THREE.Box3, ignore?: Solid) {
    if (this.bvh.intersectsBox(box, identity)) return false;
    for (const s of this.solids) {
      if (s === ignore || !s.enabled) continue;
      if (s.box && s.box.intersectsBox(box)) return false;
      if (s.cylinder) {
        const c = s.cylinder;
        const cb = tmpBox.set(c.center.clone().add(new THREE.Vector3(-c.radius, 0, -c.radius)), c.center.clone().add(new THREE.Vector3(c.radius, c.height, c.radius)));
        if (cb.intersectsBox(box)) return false;
      }
    }
    return true;
  }

  /** Nearest hit straight down from 'from' within 'max', or null. */
  groundBelow(from: THREE.Vector3, max: number) {
    ray.set(from, down);
    const hit = this.bvh.raycastFirst(ray, THREE.DoubleSide, 0, max);
    let best = hit ? hit.distance : Infinity;
    for (const s of this.solids) {
      if (!s.enabled || !s.box) continue;
      const b = s.box;
      if (from.x < b.min.x || from.x > b.max.x || from.z < b.min.z || from.z > b.max.z) continue;
      const d = from.y - b.max.y;
      if (d >= -0.05 && d < best) best = Math.max(0, d);
    }
    return best <= max ? best : null;
  }

  /** Line of sight test (camera collision etc.). */
  raycast(origin: THREE.Vector3, direction: THREE.Vector3, far: number) {
    ray.set(origin, direction);
    return this.bvh.raycastFirst(ray, THREE.DoubleSide, 0, far);
  }
}

const identity = new THREE.Matrix4();
const tmpBox = new THREE.Box3();
const ray = new THREE.Ray();
const down = new THREE.Vector3(0, -1, 0);

function indexed(g: THREE.BufferGeometry) {
  const n = g.getAttribute("position").count;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// ---------------------------------------------------------------- capsule character

const segment = new THREE.Line3();
const box = new THREE.Box3();
const triPoint = new THREE.Vector3();
const capPoint = new THREE.Vector3();
const push = new THREE.Vector3();
const normal = new THREE.Vector3();
const _start = new THREE.Vector3();
const _target = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _before = new THREE.Vector3();
const _contact = new THREE.Vector3();

export class CapsuleMover {
  grounded = false;
  constructor(public physics: Physics, public radius: number, public bottom: number, public top: number, public stepOffset: number) {}

  /**
   * Moves the feet position by 'delta', sliding along anything solid. Returns the corrected position.
   * moveDir is the horizontal direction the player is trying to go (for pushing crates).
   */
  move(feet: THREE.Vector3, delta: THREE.Vector3, moveDir: THREE.Vector3) {
    const start = _start.copy(feet);
    const target = _target.copy(feet).add(delta);
    const r = this.radius;

    // Substeps keep fast falls and sprints from tunnelling through thin walls.
    const steps = Math.max(1, Math.ceil(delta.length() / (r * 0.5)));
    const pos = _pos.copy(start);
    let pushedUp = false;
    for (let i = 1; i <= steps; i++) {
      pos.lerpVectors(start, target, i / steps);
      if (this.resolve(pos, moveDir)) pushedUp = true;
    }

    // Grounded: pushed up by the floor, or the floor is just below the feet (walking down slopes and steps).
    this.grounded = pushedUp;
    if (!this.grounded && delta.y <= 0) {
      const probe = _probe.copy(pos); probe.y += 0.05;
      const d = this.physics.groundBelow(probe, 0.05 + Math.max(0.04, this.stepOffset * 0.5));
      if (d !== null) { pos.y = probe.y - d; this.grounded = true; }
    }
    feet.copy(pos);
    return feet;
  }

  /** Pushes the capsule at 'feet' out of everything it overlaps. True if the floor pushed it up. */
  private resolve(feet: THREE.Vector3, moveDir: THREE.Vector3) {
    const r = this.radius;
    segment.start.set(feet.x, feet.y + this.bottom + r, feet.z);
    segment.end.set(feet.x, feet.y + this.top - r, feet.z);
    const before = _before.copy(segment.start);

    box.makeEmpty();
    box.expandByPoint(segment.start).expandByPoint(segment.end);
    box.min.addScalar(-r); box.max.addScalar(r);

    this.physics.bvh.shapecast({
      intersectsBounds: (b) => b.intersectsBox(box),
      intersectsTriangle: (tri: ExtendedTriangle) => {
        const distance = tri.closestPointToSegment(segment, triPoint, capPoint);
        if (distance < r) {
          const depth = r - distance;
          push.subVectors(capPoint, triPoint).normalize();
          // Treat walkable slopes as floor: push straight up so the player doesn't slide down them.
          if (push.y > 0.7) push.set(0, 1 / push.y, 0);
          segment.start.addScaledVector(push, depth);
          segment.end.addScaledVector(push, depth);
        }
      },
    });

    // Moving solids: boxes (crates) and cylinders (NPCs), resolved on the ground plane.
    for (const s of this.physics.solids) {
      if (!s.enabled) continue;
      if (s.box) {
        const b = s.box;
        const yBottom = segment.start.y - r, yTop = segment.end.y + r;
        if (yTop <= b.min.y || yBottom >= b.max.y - 0.02) {
          continue;
        }
        const cx = THREE.MathUtils.clamp(segment.start.x, b.min.x, b.max.x);
        const cz = THREE.MathUtils.clamp(segment.start.z, b.min.z, b.max.z);
        let dx = segment.start.x - cx, dz = segment.start.z - cz;
        const d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d < 1e-5) {
          // Centre inside the box: push out the nearest side.
          const opts = [
            [segment.start.x - b.min.x, -1, 0], [b.max.x - segment.start.x, 1, 0],
            [segment.start.z - b.min.z, 0, -1], [b.max.z - segment.start.z, 0, 1],
          ].sort((a, c) => a[0] - c[0])[0];
          dx = opts[1]; dz = opts[2];
          const depth = opts[0] + r;
          segment.start.x += dx * depth; segment.end.x += dx * depth;
          segment.start.z += dz * depth; segment.end.z += dz * depth;
          normal.set(dx, 0, dz);
        } else {
          const depth = r - d;
          dx /= d; dz /= d;
          segment.start.x += dx * depth; segment.end.x += dx * depth;
          segment.start.z += dz * depth; segment.end.z += dz * depth;
          normal.set(dx, 0, dz);
        }
        s.onPush?.(_contact.copy(normal), moveDir);
      } else if (s.cylinder) {
        const c = s.cylinder;
        if (segment.end.y + r < c.center.y || segment.start.y - r > c.center.y + c.height) continue;
        let dx = segment.start.x - c.center.x, dz = segment.start.z - c.center.z;
        const d = Math.hypot(dx, dz);
        const min = r + c.radius;
        if (d >= min) continue;
        if (d < 1e-5) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
        const depth = min - d;
        segment.start.x += dx * depth; segment.end.x += dx * depth;
        segment.start.z += dz * depth; segment.end.z += dz * depth;
      }
    }

    const movedY = segment.start.y - before.y;
    feet.x += segment.start.x - before.x;
    feet.y += movedY;
    feet.z += segment.start.z - before.z;
    return movedY > 1e-5;
  }
}
