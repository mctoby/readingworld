import * as THREE from "three";
import type { Q4, RGBA, V3, Xform } from "./data";

// Unity is left-handed (+Z forward), glTF/three.js is right-handed. The GLB files were written by glTFast,
// which mirrors the X axis, so world.json values (still in Unity space) are converted the same way here.

export const vec = (u: V3) => new THREE.Vector3(-u.x, u.y, u.z);
export const quat = (u: Q4) => new THREE.Quaternion(u.x, -u.y, -u.z, u.w);

/** A Unity direction (e.g. a stored offset) in three.js space. */
export const dir = (x: number, y: number, z: number) => new THREE.Vector3(-x, y, z);

/** Unity cameras look down +Z, three.js cameras down -Z. */
const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
export const cameraQuat = (u: Q4) => quat(u).multiply(turn);

/** Unity colours are sRGB values. */
export const color = (c: RGBA) => new THREE.Color().setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);

export function applyXform(o: THREE.Object3D, x: Xform) {
  o.position.copy(vec(x.position));
  o.quaternion.copy(quat(x.rotation));
  o.scale.set(x.scale.x, x.scale.y, x.scale.z);
}

export function matrixOf(x: Xform) {
  return new THREE.Matrix4().compose(vec(x.position), quat(x.rotation), new THREE.Vector3(x.scale.x, x.scale.y, x.scale.z));
}

/** Rotation that makes an object's +Z (the characters' forward) face 'd' on the ground plane. */
export function yawTowards(d: THREE.Vector3) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(d.x, d.z));
}

/**
 * Port of .NET's System.Random (the seeded generator Unity's C# uses), so NPCs stand on the same
 * locators as in the Unity build for any given day.
 */
export class DotNetRandom {
  private seedArray = new Int32Array(56);
  private inext = 0;
  private inextp = 21;

  constructor(seed: number) {
    const MSEED = 161803398;
    const subtraction = seed === -2147483648 ? 2147483647 : Math.abs(seed | 0);
    let mj = (MSEED - subtraction) | 0;
    this.seedArray[55] = mj;
    let mk = 1;
    for (let i = 1; i < 55; i++) {
      const ii = (21 * i) % 55;
      this.seedArray[ii] = mk;
      mk = (mj - mk) | 0;
      if (mk < 0) mk = (mk + 2147483647) | 0;
      mj = this.seedArray[ii];
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        let v = (this.seedArray[i] - this.seedArray[1 + ((i + 30) % 55)]) | 0;
        if (v < 0) v = (v + 2147483647) | 0;
        this.seedArray[i] = v;
      }
    }
  }

  private internalSample() {
    let locINext = this.inext + 1;
    let locINextp = this.inextp + 1;
    if (locINext >= 56) locINext = 1;
    if (locINextp >= 56) locINextp = 1;
    let ret = (this.seedArray[locINext] - this.seedArray[locINextp]) | 0;
    if (ret === 2147483647) ret--;
    if (ret < 0) ret = (ret + 2147483647) | 0;
    this.seedArray[locINext] = ret;
    this.inext = locINext;
    this.inextp = locINextp;
    return ret;
  }

  /** Random integer in [0, max). */
  next(max: number) {
    return Math.floor(this.internalSample() * (1.0 / 2147483647) * max);
  }
}
