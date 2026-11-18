// Life in the world: a meadow of Kenney grass and flowers scattered over the grassy ground (bending away
// from the player like the hand-placed plants), drifting pollen and butterflies by day, fireflies at night.

import * as THREE from "three";
import { GAME } from "../data";
import { isMobile, loadGlb, makeBendy } from "./world";

const SCATTER = [
  { file: "grass", weight: 0.84, scale: [0.3, 0.525] },
  { file: "flowers", weight: 0.11, scale: [0.25, 0.4] },        // Kenney's flowers are blue and purple: a sprinkle
  { file: "flowers-tall", weight: 0.05, scale: [0.225, 0.35] },
] as const;

let scatterModels: Promise<THREE.Mesh[]> | null = null;
function loadScatter() {
  scatterModels ??= Promise.all(SCATTER.map(async (s) => {
    const gltf = await loadGlb(`models/scatter/${s.file}.glb`);
    let mesh: THREE.Mesh | null = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
    const m = mesh! as THREE.Mesh;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    mat.metalness = 0.11;   // same surface as the hand-placed Kenney plants in the scene
    mat.roughness = 0.4;
    makeBendy(mat);
    return new THREE.Mesh(g, mat);
  }));
  return scatterModels;
}

/** Average linear colour of a model's texture where its UVs point (Kenney models use a palette). */
function averageTexel(mesh: THREE.Mesh) {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  const read = paletteReader(mat.map);
  const uv = mesh.geometry.getAttribute("uv");
  if (!read || !uv) return null;
  const sum = new THREE.Color(0, 0, 0), c = new THREE.Color(), v = new THREE.Vector2();
  for (let i = 0; i < uv.count; i++) {
    const [r, g, b] = read(v.set(uv.getX(i), uv.getY(i)));
    sum.add(c.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace));
  }
  return sum.multiplyScalar(1 / uv.count);
}

/** Reads the colour of the scenery's palette texture at a UV (Kenney models colour by UV into a palette). */
function paletteReader(texture: THREE.Texture | null) {
  const img = texture?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!img || !img.width) return null;
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  return (uv: THREE.Vector2) => {
    const x = Math.min(c.width - 1, Math.max(0, Math.floor((uv.x % 1) * c.width)));
    const y = Math.min(c.height - 1, Math.max(0, Math.floor((texture!.flipY ? 1 - (uv.y % 1) : uv.y % 1) * c.height)));
    const i = (y * c.width + x) * 4;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };
}

/**
 * Scatters grass and flowers over every flat, green patch of ground (found by dropping rays onto the
 * scenery and checking the palette colour where they land), as a few instanced meshes.
 */
export async function scatterMeadow(scene: THREE.Scene, environment: THREE.Object3D, avoid: { p: THREE.Vector3; r: number }[]) {
  const models = await loadScatter();
  environment.updateMatrixWorld(true);
  const targets: THREE.Mesh[] = [];
  const palettes = new Map<THREE.Texture, ReturnType<typeof paletteReader>>();
  environment.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
    targets.push(m);
    const map = (m.material as THREE.MeshStandardMaterial).map;
    if (map && !palettes.has(map)) palettes.set(map, paletteReader(map));
  });
  // Surface colour where a ray landed: the material colour times its palette texture (if it has one), in 0..255 sRGB.
  const tmpC = new THREE.Color();
  const surfaceColor = (hit: THREE.Intersection) => {
    const mat = (hit.object as THREE.Mesh).material as THREE.MeshStandardMaterial;
    tmpC.copy(mat.color).convertLinearToSRGB();
    let r = tmpC.r * 255, g = tmpC.g * 255, b = tmpC.b * 255;
    const read = mat.map ? palettes.get(mat.map) : null;
    if (read && hit.uv) { const t = read(hit.uv); r *= t[0] / 255; g *= t[1] / 255; b *= t[2] / 255; }
    return [r, g, b];
  };

  const bounds = new THREE.Box3().setFromObject(environment);
  bounds.min.x += 1; bounds.max.x -= 1; bounds.min.z += 1; bounds.max.z -= 1;
  const want = isMobile ? 570 : 1350;
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const down = new THREE.Vector3(0, -1, 0);
  const placed: THREE.Matrix4[][] = models.map(() => []);
  const tints: THREE.Color[][] = models.map(() => []);
  // Kenney's grass is blue in its palette. Tint each tuft so it matches the ground it grows from instead.
  const grassTexel = averageTexel(models[0]);
  const n = new THREE.Vector3();
  const probe = new THREE.Vector3();
  let accepted = 0;

  for (let tries = 0; tries < want * 10 && accepted < want; tries++) {
    const x = THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, Math.random());
    const z = THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, Math.random());
    ray.set(new THREE.Vector3(x, bounds.max.y + 1, z), down);
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit || !hit.face) continue;
    n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (n.y < 0.95) continue;                                  // flat ground only (no slopes)
    const [r, g, b] = surfaceColor(hit);
    if (!(g > r * 1.15 && g > b * 1.05 && g > 70)) continue;   // grassy green, not paths, sand or wood
    // Broad ground, not the top of something narrow (tree tiers, posts): the ground around must be level too.
    let level = true;
    for (const [ox, oz] of [[0.18, 0], [-0.18, 0], [0, 0.18], [0, -0.18]]) {
      ray.set(probe.set(x + ox, bounds.max.y + 1, z + oz), down);
      const h2 = ray.intersectObjects(targets, false)[0];
      if (!h2 || Math.abs(h2.point.y - hit.point.y) > 0.04) { level = false; break; }
    }
    if (!level) continue;
    if (avoid.some((a) => a.p.distanceToSquared(hit.point) < a.r * a.r)) continue;

    // Pick a model by weight, then a random turn and size.
    let k = Math.random(), i = 0;
    while (i < SCATTER.length - 1 && k > SCATTER[i].weight) { k -= SCATTER[i].weight; i++; }
    const [s0, s1] = SCATTER[i].scale;
    const s = THREE.MathUtils.lerp(s0, s1, Math.random());
    const k2 = THREE.MathUtils.lerp(0.72, 1.05, Math.random());
    if (i === 0 && grassTexel) {
      const ground = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);   // linear
      tints[i].push(new THREE.Color(ground.r / grassTexel.r * k2, ground.g / grassTexel.g * k2, ground.b / grassTexel.b * k2));
    } else {
      tints[i].push(new THREE.Color(k2 + 0.15, k2 + 0.15, k2 + 0.15));
    }
    placed[i].push(new THREE.Matrix4().compose(hit.point.clone().add(new THREE.Vector3(0, -0.005, 0)),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2),
      new THREE.Vector3(s, s * THREE.MathUtils.lerp(0.85, 1.2, Math.random()), s)));
    accepted++;
  }

  const group = new THREE.Group();
  group.name = "meadow";
  models.forEach((m, i) => {
    if (placed[i].length === 0) return;
    const inst = new THREE.InstancedMesh(m.geometry, m.material, placed[i].length);
    placed[i].forEach((mat, j) => {
      inst.setMatrixAt(j, mat);
      inst.setColorAt(j, tints[i][j]);   // lighter and darker tufts, so the meadow reads against the ground
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.receiveShadow = true;
    inst.castShadow = false;
    inst.frustumCulled = false;
    group.add(inst);
  });
  scene.add(group);
  return group;
}

// ---------------------------------------------------------------- floating motes (pollen / fireflies)

let dotTex: THREE.Texture | null = null;
function dot() {
  if (!dotTex) { dotTex = new THREE.TextureLoader().load(GAME + "ui/SparkleDot.png"); dotTex.colorSpace = THREE.SRGBColorSpace; }
  return dotTex;
}

/** Pollen drifting in the sunlight by day; fireflies blinking at night. Always around the player. */
export class Motes {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private seed: Float32Array;
  private time = 0;
  private readonly count: number;
  private readonly radius = 5.5;

  constructor(scene: THREE.Scene, private night: boolean, center: THREE.Vector3) {
    this.count = night ? (isMobile ? 45 : 80) : (isMobile ? 70 : 140);
    this.pos = new Float32Array(this.count * 3);
    this.col = new Float32Array(this.count * 3);
    this.seed = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      this.seed[i] = Math.random() * 100;
      this.pos[i * 3] = center.x + (Math.random() * 2 - 1) * this.radius;
      this.pos[i * 3 + 1] = center.y + 0.1 + Math.random() * (night ? 1.2 : 0.9);
      this.pos[i * 3 + 2] = center.z + (Math.random() * 2 - 1) * this.radius;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: night ? 0.11 : 0.045, map: dot(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: !night,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt: number, center: THREE.Vector3) {
    this.time += dt;
    const t = this.time, r = this.radius;
    for (let i = 0; i < this.count; i++) {
      const s = this.seed[i];
      const ix = i * 3;
      // Lazy wandering drift.
      this.pos[ix] += (Math.sin(t * 0.35 + s) * 0.12 + (this.night ? 0 : 0.05)) * dt;
      this.pos[ix + 1] += Math.sin(t * 0.6 + s * 1.7) * (this.night ? 0.12 : 0.05) * dt;
      this.pos[ix + 2] += Math.cos(t * 0.3 + s * 1.3) * 0.12 * dt;
      // Keep them in a box around the player (wrap around the edges).
      for (const [axis, half] of [[0, r], [2, r]] as const) {
        const d = this.pos[ix + axis] - (axis === 0 ? center.x : center.z);
        if (d > half) this.pos[ix + axis] -= half * 2;
        else if (d < -half) this.pos[ix + axis] += half * 2;
      }
      const top = this.night ? 1.4 : 1.0;   // pollen stays low, or it reads as stars against the sky
      if (this.pos[ix + 1] < center.y + 0.05) this.pos[ix + 1] = center.y + top;
      if (this.pos[ix + 1] > center.y + top) this.pos[ix + 1] = center.y + 0.05;

      if (this.night) {
        // Fireflies: slow glow on and off, yellow-green.
        const glow = Math.max(0, Math.sin(t * (0.8 + (s % 1) * 0.9) + s)) ** 3;
        this.col[ix] = 0.75 * glow; this.col[ix + 1] = 1.0 * glow; this.col[ix + 2] = 0.35 * glow;
      } else {
        // Pollen: soft warm specks that twinkle a little in the light.
        const tw = 0.35 + 0.3 * Math.sin(t * 2 + s * 3);
        this.col[ix] = 1.0 * tw; this.col[ix + 1] = 0.92 * tw; this.col[ix + 2] = 0.6 * tw;
      }
    }
    const g = this.points.geometry;
    (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------- butterflies

function wingTexture(hue: number) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const col = new THREE.Color().setHSL(hue, 0.85, 0.6);
  const edge = new THREE.Color().setHSL(hue, 0.9, 0.3);
  g.fillStyle = `#${edge.getHexString()}`;
  g.beginPath(); g.ellipse(26, 22, 26, 20, -0.4, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(22, 46, 18, 14, 0.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = `#${col.getHexString()}`;
  g.beginPath(); g.ellipse(26, 22, 21, 15, -0.4, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(22, 46, 13, 10, 0.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.beginPath(); g.arc(30, 18, 4, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Butterfly { root: THREE.Group; left: THREE.Mesh; right: THREE.Mesh; target: THREE.Vector3; speed: number; phase: number; rest: number }

/** A few butterflies flitting between spots near the player (daytime only). */
export class Butterflies {
  private flies: Butterfly[] = [];
  private time = 0;

  constructor(scene: THREE.Scene, center: THREE.Vector3, count = isMobile ? 5 : 9) {
    const wing = new THREE.PlaneGeometry(0.09, 0.09).rotateX(-Math.PI / 2).translate(0.045, 0, 0);   // flat, hinged at the body
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({ map: wingTexture(Math.random()), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.8 });
      const left = new THREE.Mesh(wing, mat);
      const right = new THREE.Mesh(wing, mat);
      right.scale.x = -1;
      const root = new THREE.Group();
      root.add(left, right);
      root.userData.transient = true;   // not in depth / AO passes
      root.position.copy(this.randomSpot(center));
      scene.add(root);
      this.flies.push({ root, left, right, target: this.randomSpot(center), speed: 0.5 + Math.random() * 0.4, phase: Math.random() * 10, rest: 0 });
    }
  }

  private randomSpot(center: THREE.Vector3) {
    const a = Math.random() * Math.PI * 2, d = 1 + Math.random() * 4;
    return new THREE.Vector3(center.x + Math.cos(a) * d, center.y + 0.15 + Math.random() * 0.7, center.z + Math.sin(a) * d);
  }

  update(dt: number, center: THREE.Vector3) {
    this.time += dt;
    for (const f of this.flies) {
      const to = f.target.clone().sub(f.root.position);
      const dist = to.length();
      if (f.rest > 0) {
        f.rest -= dt;   // resting: wings open and close slowly
      } else if (dist < 0.08) {
        f.rest = Math.random() < 0.35 ? 0.8 + Math.random() * 1.5 : 0;
        f.target.copy(this.randomSpot(center));
      } else {
        // Fluttery path: head to the target with a wobble.
        to.normalize();
        to.x += Math.sin(this.time * 7 + f.phase) * 0.6;
        to.y += Math.sin(this.time * 9 + f.phase * 2) * 0.8;
        to.z += Math.cos(this.time * 6 + f.phase) * 0.6;
        f.root.position.addScaledVector(to.normalize(), f.speed * dt);
        f.root.rotation.y = Math.atan2(to.x, to.z);
      }
      // Too far from the player (they walked away): fly back near them.
      if (f.root.position.distanceToSquared(center) > 49) f.root.position.copy(this.randomSpot(center));
      const flap = f.rest > 0 ? 0.6 + Math.sin(this.time * 3 + f.phase) * 0.5 : Math.sin(this.time * 28 + f.phase) * 1.1;
      f.left.rotation.z = flap;
      f.right.rotation.z = -flap;
    }
  }

  dispose() {
    for (const f of this.flies) {
      f.root.removeFromParent();
      const m = f.left.material as THREE.MeshStandardMaterial;
      m.map?.dispose(); m.dispose();
    }
    this.flies = [];
  }
}
