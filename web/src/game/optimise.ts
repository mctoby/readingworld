// Load-time optimisations: done once when the models arrive, so every play session starts from cheap copies.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Float copies of the attributes the game draws with (quantized GLB data can't be transformed in place). */
function plainGeometry(src: THREE.BufferGeometry, skinned?: THREE.SkinnedMesh) {
  const pos = src.getAttribute("position");
  const nor = src.getAttribute("normal");
  const uv = src.getAttribute("uv");
  const n = pos.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
  const v = new THREE.Vector3(), nn = new THREE.Vector3();
  const skin = skinned ? skinMatrices(skinned) : null;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    if (skinned) skinned.applyBoneTransform(i, v);
    P.set([v.x, v.y, v.z], i * 3);
    if (nor) {
      nn.fromBufferAttribute(nor, i);
      if (skin) nn.applyMatrix3(skin(i)).normalize();
      N.set([nn.x, nn.y, nn.z], i * 3);
    }
    if (uv) U.set([uv.getX(i), uv.getY(i)], i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
  if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>));
  if (!nor) g.computeVertexNormals();
  return g;
}

/** Per-vertex skinning matrix (as a normal matrix) for a skinned mesh in its current pose. */
function skinMatrices(mesh: THREE.SkinnedMesh) {
  const si = mesh.geometry.getAttribute("skinIndex");
  const sw = mesh.geometry.getAttribute("skinWeight");
  const bones = mesh.skeleton.bones, inv = mesh.skeleton.boneInverses;
  const boneM = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, inv[i]));
  const sum = new THREE.Matrix4(), tmp = new THREE.Matrix4(), out = new THREE.Matrix3();
  return (i: number) => {
    sum.makeScale(0, 0, 0).elements.fill(0);
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w === 0) continue;
      const m = boneM[si.getComponent(i, k)].elements;
      for (let e = 0; e < 16; e++) sum.elements[e] += m[e] * w;
    }
    tmp.multiplyMatrices(mesh.bindMatrixInverse, sum).multiply(mesh.bindMatrix);
    return out.getNormalMatrix(tmp);
  };
}

/**
 * Turns a rigged character into plain meshes frozen in its current pose, one per material. The Unity
 * game never animated the skeleton, so this looks identical but drops hundreds of bones and the per-frame
 * skinning work for every copy of the character.
 */
export function bakeCharacter(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const groups = new Map<THREE.Material, { name: string; geos: THREE.BufferGeometry[] }>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as THREE.SkinnedMesh) : undefined;
    const g = plainGeometry(mesh.geometry, skinned);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld));
    const mat = mesh.material as THREE.Material;
    let entry = groups.get(mat);
    if (!entry) groups.set(mat, (entry = { name: mesh.name, geos: [] }));
    entry.geos.push(g);
  });

  const baked = new THREE.Group();
  baked.name = root.name;
  for (const [mat, { name, geos }] of groups) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)!;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    baked.add(mesh);
  }
  return baked;
}

/**
 * Merges the static scenery into one mesh per material (the Kenney models nearly all share one texture),
 * so it's a handful of draw calls instead of one per object. 'keep' lists objects that must stay separate
 * (e.g. the bending plants, whose shader works per object).
 */
export function mergeStatic(root: THREE.Object3D, keep: (o: THREE.Object3D) => boolean) {
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const merged: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || keep(mesh) || Array.isArray(mesh.material)) return;
    const g = plainGeometry(mesh.geometry);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld));
    const mat = mesh.material as THREE.Material;
    let list = groups.get(mat);
    if (!list) groups.set(mat, (list = []));
    list.push(g);
    merged.push(mesh);
  });
  for (const m of merged) m.removeFromParent();
  for (const [mat, geos] of groups) {
    const g = mergeGeometries(geos, false)!;
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = `merged:${mat.name}`;
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  // Drop the now-empty groups so the scene graph stays small.
  const empty: THREE.Object3D[] = [];
  root.traverse((o) => { if (o !== root && o.children.length === 0 && !(o as THREE.Mesh).isMesh) empty.push(o); });
  for (const o of empty) o.removeFromParent();
  return { objects: merged.length, drawCalls: groups.size };
}
