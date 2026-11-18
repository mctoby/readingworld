// The player: a port of Starter Assets' ThirdPersonController (camera-relative movement, smoothed turning,
// sprint, jump and gravity) using the capsule mover. The model is Chip, with a little procedural bounce
// and lean as it walks (the Unity player had no walk animation set up).

import * as THREE from "three";
import type { PlayerData } from "../data";
import { applyXform, vec, quat } from "../unity";
import { CapsuleMover, type Physics } from "./physics";
import { Input } from "./input";
import { bendUniforms } from "./world";

const UP = new THREE.Vector3(0, 1, 0);
// Scratch objects reused every frame (no per-frame garbage, which causes stutters on phones).
const _input = new THREE.Vector2();
const _moveDir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _facing = new THREE.Vector3();
const _delta = new THREE.Vector3();

export class Player {
  readonly root = new THREE.Group();          // at the feet, turned to face the way the player walks
  readonly model: THREE.Object3D;
  readonly mover: CapsuleMover;
  readonly radius: number;
  readonly height: number;

  enabled = true;
  private speed = 0;
  private yaw: number;                        // radians, three.js space
  private turn = { yawVelocity: 0 };
  private vertical = 0;
  private jumpTimeout: number;
  private fallTimeout: number;
  private bendPos = new THREE.Vector3();
  private bendVel = new THREE.Vector3();
  private bob = 0;
  private landSquash = 0;
  private wasGrounded = true;

  constructor(private data: PlayerData, chip: THREE.Object3D, physics: Physics) {
    const scale = data.xform.scale.x;
    this.root.position.copy(vec(data.xform.position));
    this.root.quaternion.copy(quat(data.xform.rotation));
    this.yaw = new THREE.Euler().setFromQuaternion(this.root.quaternion, "YXZ").y;

    // The CharacterController's size scales with the player object.
    this.radius = data.radius * scale;
    this.height = data.height * scale;
    const centerY = data.center.y * scale;
    this.mover = new CapsuleMover(physics, this.radius, centerY - this.height / 2, centerY + this.height / 2, data.stepOffset * scale);

    this.model = new THREE.Group();
    const inner = chip;
    applyXform(inner, data.model);
    inner.scale.multiplyScalar(scale);
    this.model.add(inner);
    this.root.add(this.model);

    this.jumpTimeout = data.jumpTimeout;
    this.fallTimeout = data.fallTimeout;
    this.bendPos.copy(this.root.position);
  }

  get position() { return this.root.position; }

  /** Where the cameras aim (Unity's PlayerCameraRoot, about chest height). */
  cameraTarget(out = new THREE.Vector3()) {
    return out.copy(this.root.position).addScaledVector(UP, this.height * 0.75);
  }

  set visible(v: boolean) { this.model.visible = v; }

  update(dt: number, camera: THREE.Camera) {
    const d = this.data;
    const input = this.enabled ? Input.move(_input) : _input.set(0, 0);
    const sprint = this.enabled && Input.sprint;
    const jump = this.enabled && Input.jump;

    // ---- jump and gravity (ThirdPersonController.JumpAndGravity)
    const grounded = this.mover.grounded;
    if (grounded) {
      this.fallTimeout = d.fallTimeout;
      if (this.vertical < 0) this.vertical = -2;
      if (jump && this.jumpTimeout <= 0) this.vertical = Math.sqrt(d.jumpHeight * -2 * d.gravity);
      if (this.jumpTimeout >= 0) this.jumpTimeout -= dt;
    } else {
      this.jumpTimeout = d.jumpTimeout;
      if (this.fallTimeout >= 0) this.fallTimeout -= dt;
    }
    if (this.vertical > -53) this.vertical += d.gravity * dt;

    // ---- horizontal movement (ThirdPersonController.Move)
    const mag = Math.min(1, input.length());
    const targetSpeed = mag > 0 ? (sprint ? d.sprintSpeed : d.moveSpeed) : 0;
    const offset = 0.1;
    if (this.speed < targetSpeed * mag - offset || this.speed > targetSpeed * mag + offset) {
      this.speed = THREE.MathUtils.lerp(this.speed, targetSpeed * mag, Math.min(1, dt * d.speedChangeRate));
    } else {
      this.speed = targetSpeed * mag;
    }

    const moveDir = _moveDir.set(0, 0, 0);
    if (mag > 0) {
      // Camera-relative: up on the stick walks away from the camera.
      const fwd = _fwd;
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = _right.crossVectors(fwd, UP).normalize();
      moveDir.copy(fwd).multiplyScalar(input.y).addScaledVector(right, input.x).normalize();
      const targetYaw = Math.atan2(moveDir.x, moveDir.z);
      this.yaw = smoothDampAngle(this.yaw, targetYaw, this.turn, d.rotationSmoothTime, dt);
    }
    const facing = _facing.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const delta = mag > 0 ? _delta.copy(facing).multiplyScalar(this.speed * dt) : _delta.set(0, 0, 0);
    if (mag === 0 && this.speed > 0) delta.copy(facing).multiplyScalar(this.speed * dt);
    delta.y = this.vertical * dt;

    this.mover.move(this.root.position, delta, mag > 0 ? facing : moveDir);
    if (this.mover.grounded && this.vertical < 0) this.vertical = -2;
    this.root.quaternion.setFromAxisAngle(UP, this.yaw);

    // Fell out of the world: back to the start.
    if (this.root.position.y < -20) { this.root.position.copy(vec(d.xform.position)); this.vertical = 0; }

    this.animate(dt);
    this.updateBend(dt);
  }

  // Bounce, squash and lean, so Chip looks like it's walking.
  private animate(dt: number) {
    const grounded = this.mover.grounded;
    if (grounded && !this.wasGrounded) this.landSquash = 1;
    this.wasGrounded = grounded;
    this.landSquash = Math.max(0, this.landSquash - dt * 5);

    const run = THREE.MathUtils.clamp(this.speed / this.data.sprintSpeed, 0, 1);
    this.bob += dt * (6 + 10 * run) * (this.speed > 0.05 ? 1 : 0.3);
    const step = Math.abs(Math.sin(this.bob));
    const hop = grounded ? step * 0.05 * Math.min(1, this.speed / this.data.moveSpeed) : 0;
    const breathe = Math.sin(this.bob * 0.5) * 0.015 * (1 - Math.min(1, this.speed));
    const squash = 1 - this.landSquash * 0.18 + breathe;
    this.model.position.y = hop * this.height;
    this.model.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    this.model.rotation.x = THREE.MathUtils.lerp(this.model.rotation.x, run * 0.18 + (this.speed > 0.05 ? 0.05 : 0), 1 - Math.exp(-10 * dt));
    this.model.rotation.z = Math.sin(this.bob) * 0.06 * Math.min(1, this.speed / this.data.moveSpeed);
  }

  // SoftBendPlayer: plants lean away from where the player was a moment ago (smoothed).
  private updateBend(dt: number) {
    const d = this.data;
    smoothDampVec(this.bendPos, this.root.position, this.bendVel, d.bendSmoothing, dt);
    bendUniforms.uBendPlayer.value.set(this.bendPos.x, this.bendPos.y, this.bendPos.z, d.bendRadius);
    bendUniforms.uBendParams.value.set(d.bendStrength, d.bendHeight, d.bendSway, d.bendSwaySpeed);
  }
}

// ---------------------------------------------------------------- Unity's SmoothDamp, ported

function smoothDamp(current: number, target: number, state: { v: number }, smoothTime: number, dt: number) {
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (state.v + omega * change) * dt;
  state.v = (state.v - omega * temp) * exp;
  let out = target + (change + temp) * exp;
  if (target - current > 0 === out > target) { out = target; state.v = (out - target) / dt; }
  return out;
}

function smoothDampAngle(current: number, target: number, owner: { yawVelocity: number }, smoothTime: number, dt: number) {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  const s = { v: owner.yawVelocity };
  const out = smoothDamp(current, current + delta, s, smoothTime, dt);
  owner.yawVelocity = s.v;
  return out;
}

const sdState = [{ v: 0 }, { v: 0 }, { v: 0 }];
function smoothDampVec(cur: THREE.Vector3, target: THREE.Vector3, vel: THREE.Vector3, smoothTime: number, dt: number) {
  if (smoothTime <= 0) { cur.copy(target); return; }
  sdState[0].v = vel.x; sdState[1].v = vel.y; sdState[2].v = vel.z;
  cur.x = smoothDamp(cur.x, target.x, sdState[0], smoothTime, dt);
  cur.y = smoothDamp(cur.y, target.y, sdState[1], smoothTime, dt);
  cur.z = smoothDamp(cur.z, target.z, sdState[2], smoothTime, dt);
  vel.set(sdState[0].v, sdState[1].v, sdState[2].v);
}
