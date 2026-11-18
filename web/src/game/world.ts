// Builds the 3D world from the Unity export: scenery, props, lighting (day or night), sky, fog, post effects,
// the sun flare and the plants that bend away from the player.

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import { Lensflare, LensflareElement } from "three/examples/jsm/objects/Lensflare.js";
import { GAME, type LightingData, type WorldData } from "../data";
import { color, quat } from "../unity";
import { bakeCharacter, mergeStatic } from "./optimise";

// Fast BVH raycasts for every mesh (used when scattering the meadow).
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const isMobile = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 1;

/**
 * Graphics quality. Computers get 4x MSAA and ambient occlusion; phones get 2x MSAA and no AO, to keep the
 * frame rate up. Override with ?ao=1 / ?ao=0 and ?aa=0..8 in the address (e.g. to try AO on a phone).
 */
export const Quality = (() => {
  const q = new URLSearchParams(location.search);
  const aa = parseInt(q.get("aa") ?? "", 10);
  return {
    msaa: Number.isFinite(aa) ? Math.max(0, Math.min(8, aa)) : isMobile ? 2 : 4,
    ao: q.has("ao") ? q.get("ao") !== "0" : !isMobile,
  };
})();

// ---------------------------------------------------------------- loading

// Models are meshopt-compressed by scripts/build-assets.mjs.
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

export function loadGlb(path: string) {
  return new Promise<GLTF>((resolve, reject) => gltfLoader.load(GAME + path, resolve, undefined, reject));
}

export async function loadModels(onProgress: (k: number) => void) {
  const files = ["environment", "props", "chip", "colliders"] as const;
  const progress = new Map<string, number>();
  const report = () => onProgress([...progress.values()].reduce((a, b) => a + b, 0) / files.length);
  const load = (name: string) =>
    new Promise<GLTF>((resolve, reject) =>
      gltfLoader.load(`${GAME}models/${name}.glb`, resolve, (e) => {
        if (e.total) { progress.set(name, e.loaded / e.total); report(); }
      }, reject));
  const [environment, props, chip, colliders] = await Promise.all(files.map(load));
  return { environment, props, chip, colliders };
}
export type Models = Awaited<ReturnType<typeof loadModels>>;

/** Finds an exported node by its unique export name (e.g. "Book#16"). */
export function node(root: THREE.Object3D, name: string | null | undefined): THREE.Object3D | undefined {
  if (!name) return undefined;
  // GLTFLoader turns spaces etc. into underscores in names; compare on that form.
  const want = THREE.PropertyBinding.sanitizeNodeName(name);
  let found: THREE.Object3D | undefined;
  root.traverse((o) => { if (!found && (o.name === name || o.name === want)) found = o; });
  return found;
}

// ---------------------------------------------------------------- bending plants (SoftBend.hlsl)

export const bendUniforms = {
  uBendPlayer: { value: new THREE.Vector4(0, -100, 0, 0.8) },   // xyz = player's feet, w = radius
  uBendParams: { value: new THREE.Vector4(0.9, 0.2, 0.06, 1.6) }, // strength, bend height, sway, sway speed
  uBendTime: { value: 0 },
};

export function makeBendy(material: THREE.Material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, bendUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
uniform vec4 uBendPlayer;
uniform vec4 uBendParams;
uniform float uBendTime;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
{
  mat4 bendModel = modelMatrix;
#ifdef USE_INSTANCING
  bendModel = modelMatrix * instanceMatrix;   // the scattered meadow: one bend per instance
#endif
  vec3 originWS = (bendModel * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 posWS = (bendModel * vec4(transformed, 1.0)).xyz;
  float bendHeight = max(uBendParams.y, 1e-3);
  float height = max(posWS.y - originWS.y, 0.0);
  float tip = clamp(height / bendHeight, 0.0, 1.0);
  tip *= tip;
  vec2 away = originWS.xz - uBendPlayer.xz;
  float dist = length(away);
  float push = clamp(1.0 - dist / max(uBendPlayer.w, 1e-3), 0.0, 1.0);
  push = push * push * (3.0 - 2.0 * push);
  push *= clamp(1.0 - abs(uBendPlayer.y - originWS.y) / 1.5, 0.0, 1.0);
  push *= uBendParams.x;
  vec2 dir = dist > 1e-4 ? away / dist : vec2(1.0, 0.0);
  float phase = originWS.x * 1.7 + originWS.z * 1.3;
  vec2 sway = vec2(sin(uBendTime * uBendParams.w + phase), sin(uBendTime * uBendParams.w * 0.8 + phase * 1.3) * 0.6) * uBendParams.z;
  vec3 offsetWS;
  offsetWS.xz = (dir * push + sway) * tip * bendHeight;
  offsetWS.y = -push * tip * height * 0.35;
  transformed += inverse(mat3(bendModel)) * offsetWS;
}`);
  };
  material.customProgramCacheKey = () => "softbend";
}

// ---------------------------------------------------------------- character rim light

/** Colour of the soft light around the characters' edges (set per lighting). */
export const rimUniforms = { uRimColor: { value: new THREE.Color(0, 0, 0) } };

/** Adds a soft fresnel rim to a character's materials, so they stand out from the scenery. */
export function addRim(root: THREE.Object3D) {
  const done = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (done.has(mat) || mat.userData.rim) return;
    done.add(mat);
    mat.userData.rim = true;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, rimUniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uRimColor;")
        .replace("#include <opaque_fragment>", `{
  float rim = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  outgoingLight += uRimColor * pow(rim, 3.0);
}
#include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => "rim";
    mat.needsUpdate = true;
  });
}

// ---------------------------------------------------------------- waving flag

/**
 * Ripples a flag's cloth: points further from the pole (and higher up it) swing more. Works in world space,
 * because the compressed models' local coordinates aren't in metres. 'size' is the flag's world bounds.
 */
function makeFlag(material: THREE.Material, size: THREE.Vector3) {
  const uFlagSize = { value: new THREE.Vector2(Math.max(size.x, size.z), size.y) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBendTime = bendUniforms.uBendTime;
    shader.uniforms.uFlagSize = uFlagSize;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uBendTime;\nuniform vec2 uFlagSize;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
{
  vec3 originWS = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 posWS = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec2 rel = posWS.xz - originWS.xz;
  float d = length(rel);
  float h = posWS.y - originWS.y;
  float cloth = smoothstep(0.12, 0.35, d / uFlagSize.x) * smoothstep(0.35, 0.55, h / uFlagSize.y);
  vec2 dir = d > 1e-4 ? rel / d : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float wave = sin(uBendTime * 4.0 - d / uFlagSize.x * 9.0) * 0.6 + sin(uBendTime * 6.3 - d / uFlagSize.x * 14.0) * 0.4;
  vec3 offsetWS = vec3(perp.x, 0.0, perp.y) * wave * d * 0.16 * cloth;
  transformed += inverse(mat3(modelMatrix)) * offsetWS;
}`);
  };
  material.customProgramCacheKey = () => "flag";
}

/** Runs 'render' with sprites, particles and the lens flare hidden (for depth / normal passes). */
export function withoutTransients(scene: THREE.Scene, render: () => void) {
  const hidden: THREE.Object3D[] = [];
  scene.traverseVisible((o) => {
    if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || o instanceof Lensflare || o.userData.transient) hidden.push(o);
  });
  for (const o of hidden) o.visible = false;
  render();
  for (const o of hidden) o.visible = true;
}

// ---------------------------------------------------------------- the world

export interface World {
  scene: THREE.Scene;
  environment: THREE.Object3D;
  props: THREE.Object3D;
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;         // direction the light travels
  composer: EffectComposer;
  renderPass: RenderPass;
  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera): void;
  /** Depth of field: keep this point sharp and soften the rest (conversations); null turns it off. */
  setFocus(target: THREE.Vector3 | null): void;
  night: boolean;
  render(): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

export function prepareModels(data: WorldData, models: Models) {
  const bend = new Set(data.bendNodes.map((n) => THREE.PropertyBinding.sanitizeNodeName(n)));
  const bendMaterials = new Map<THREE.Material, THREE.Material>();
  const bends = (o: THREE.Object3D) => bend.has(o.name) || bend.has(o.parent?.name ?? "");

  // One-off optimisations (see optimise.ts): freeze the character's pose, merge the static scenery.
  models.chip.scene = bakeCharacter(models.chip.scene);
  const isFlag = (o: THREE.Object3D) => /^flag/i.test(o.name) || /^flag/i.test(o.parent?.name ?? "");
  const merged = mergeStatic(models.environment.scene, (o) => bends(o) || isFlag(o));
  if (import.meta.env.DEV) console.log(`Scenery: ${merged.objects} objects merged into ${merged.drawCalls} draw calls.`);

  for (const root of [models.environment.scene, models.props.scene, models.chip.scene]) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (bends(o)) {
        const src = mesh.material as THREE.Material;
        let m = bendMaterials.get(src);
        if (!m) { m = src.clone(); makeBendy(m); bendMaterials.set(src, m); }
        mesh.material = m;
        mesh.castShadow = false;
        mesh.frustumCulled = false;   // bent vertices can leave the original bounds
      } else if (root === models.environment.scene && isFlag(o)) {
        mesh.material = (mesh.material as THREE.Material).clone();
        makeFlag(mesh.material, new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()));
        mesh.frustumCulled = false;
      }
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const std = mat as THREE.MeshStandardMaterial;
        if (std.map) std.map.anisotropy = 4;
      }
      // Fast raycasts against the scenery (used to scatter the meadow on the grass).
      if (root === models.environment.scene && !mesh.geometry.boundsTree) mesh.geometry.computeBoundsTree();
    });
  }
}

/** 'environment' and 'props' are fresh copies of the loaded models for this play session. */
export async function createWorld(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, environment: THREE.Object3D, props: THREE.Object3D, lighting: LightingData): Promise<World> {
  const scene = new THREE.Scene();
  scene.add(environment, props);

  // ---- sky (Unity's panoramic skybox)
  if (lighting.skybox) {
    const tex = await loadSky(GAME + lighting.skybox);
    scene.background = tex;
    scene.backgroundIntensity = lighting.skyExposure * lighting.skyTint.r * 2;
    scene.backgroundRotation.set(0, THREE.MathUtils.degToRad(-lighting.skyRotation), 0);
  }

  // ---- ambient light: the sky itself lights the world (image-based lighting), so surfaces pick up blue from
  // above and warmer bounce from below, with soft reflections. Night keeps Unity's flat ambient as well.
  const night = /night/i.test(lighting.scene);
  let envMap: THREE.Texture | null = null;
  if (scene.background) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envMap = pmrem.fromEquirectangular(scene.background as THREE.Texture).texture;
    pmrem.dispose();
    scene.environment = envMap;
    scene.environmentRotation.copy(scene.backgroundRotation);
    scene.environmentIntensity = night ? 0.12 : 0.55;   // night stays dark and moody
  }
  rimUniforms.uRimColor.value.set(night ? 0x5577aa : 0xfff0d8).multiplyScalar(night ? 0.55 : 0.35);
  if (lighting.ambientMode === "Skybox" && envMap) {
    // The environment map replaces Unity's skybox ambient; a little hemisphere fill keeps shadows from going flat.
    const [sky, ground] = await skyColors(GAME + lighting.skybox!);
    scene.add(new THREE.HemisphereLight(sky, ground, Math.PI * lighting.ambientIntensity * 0.6));
  } else if (lighting.ambientMode === "Skybox" && scene.background) {
    const [sky, ground] = await skyColors(GAME + lighting.skybox!);
    scene.add(new THREE.HemisphereLight(sky, ground, Math.PI * lighting.ambientIntensity));
  } else if (lighting.ambientMode === "Trilight") {
    scene.add(new THREE.HemisphereLight(color(lighting.ambientSky), color(lighting.ambientGround), Math.PI * lighting.ambientIntensity));
  } else {
    scene.add(new THREE.AmbientLight(color(lighting.ambientSky), Math.PI * lighting.ambientIntensity));
  }

  // ---- sun / moon
  const sun = new THREE.DirectionalLight(color(lighting.lightColor), lighting.lightIntensity * Math.PI * 0.55);
  const sunDir = new THREE.Vector3(0, 0, 1).applyQuaternion(quat(lighting.lightRotation)).normalize();
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(isMobile ? 1024 : 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 0.5; sc.far = 60;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  sun.shadow.intensity = lighting.shadowStrength;
  scene.add(sun, sun.target);

  // ---- fog
  if (lighting.fog) {
    scene.fog = lighting.fogMode === "Linear"
      ? new THREE.Fog(color(lighting.fogColor), lighting.fogStart, lighting.fogEnd)
      : new THREE.FogExp2(color(lighting.fogColor), lighting.fogDensity);
  }

  // ---- lens flare when looking toward the sun
  let flare: Lensflare | null = null;
  if (lighting.flare) {
    flare = makeFlare(color(lighting.lightColor));
    scene.add(flare);
  }

  // ---- post effects (the Global Volume): bloom, colour adjustments, vignette, tonemapping
  const post = parsePost(lighting.post);
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();

  // Anti-aliasing: the canvas's own antialiasing doesn't survive post-processing, so the composer renders
  // into a multisampled (MSAA) target instead.
  const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: Quality.msaa });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Ambient occlusion: soft contact shadows in corners, under trees and where things meet the ground.
  if (Quality.ao) {
    const gtao = new GTAOPass(scene, camera, size.x * pr, size.y * pr);
    gtao.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1, thickness: 1.5, scale: 1.6, samples: isMobile ? 8 : 16 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6 });
    gtao.blendIntensity = 1;
    // Sprites, sparkles and the lens flare would show up as solid shapes in its normal pass: leave them out.
    const render = gtao.render.bind(gtao);
    gtao.render = (...args: Parameters<typeof render>) => withoutTransients(scene, () => render(...args));
    composer.addPass(gtao);
  }

  // Depth of field, only while talking: the background softens so the NPC stands out like a portrait.
  const bokeh = new BokehPass(scene, camera, { focus: 1, aperture: 0, maxblur: 0.01 });
  bokeh.enabled = false;
  const bokehRender = bokeh.render.bind(bokeh);
  bokeh.render = (...args: Parameters<typeof bokehRender>) => withoutTransients(scene, () => bokehRender(...args));
  const bokehU = bokeh.uniforms as unknown as Record<string, { value: number }>;
  composer.addPass(bokeh);
  let focusTarget: THREE.Vector3 | null = null;
  let dof = 0;   // 0..1 fade
  if (post.bloomIntensity > 0) {
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), Math.min(1.6, post.bloomIntensity * 0.12), 0.5, post.bloomThreshold);
    composer.addPass(bloom);
  }
  const grade = new ShaderPass(GradeShader);
  grade.uniforms.saturation.value = 1 + post.saturation / 100;
  grade.uniforms.contrast.value = 1 + post.contrast / 100;
  grade.uniforms.exposure.value = Math.pow(2, post.postExposure);
  grade.uniforms.vignette.value = post.vignette;
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  renderer.toneMapping = post.tonemap === 2 ? THREE.ACESFilmicToneMapping : post.tonemap === 1 ? THREE.NeutralToneMapping : THREE.NoToneMapping;

  let time = 0;
  const camPos = new THREE.Vector3();
  return {
    scene, environment, props, sun, sunDir, composer, renderPass,
    night,
    setFocus(target) { focusTarget = target ? target.clone() : null; },
    update(dt, focus, camera) {
      time += dt;
      // Fade depth of field in and out.
      dof = THREE.MathUtils.clamp(dof + (focusTarget ? dt : -dt) * 2.5, 0, 1);
      bokeh.enabled = dof > 0.001;
      if (bokeh.enabled) {
        camera.getWorldPosition(camPos);
        if (focusTarget) bokehU.focus.value = camPos.distanceTo(focusTarget);
        bokehU.aperture.value = 0.012 * dof * dof;
        bokehU.maxblur.value = 0.01 * dof;
      }
      bendUniforms.uBendTime.value = time;
      // Keep the shadow map centred on the action.
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(sunDir, -25);
      if (flare) {
        camera.getWorldPosition(camPos);
        flare.position.copy(camPos).addScaledVector(sunDir, -400);
      }
    },
    render() { composer.render(); },
    resize(w, h) { composer.setSize(w, h); },
    dispose() {
      scene.remove(environment, props);
      composer.dispose();
      (scene.background as THREE.Texture | null)?.dispose();
      envMap?.dispose();
      scene.getObjectByName("meadow")?.removeFromParent();
      flare?.dispose();
    },
  };
}

// ---------------------------------------------------------------- helpers

async function loadSky(url: string) {
  // glTFast mirrors the world on X, so mirror the panorama too (keeps the sun painted where it was).
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url;
  });
  const c = document.createElement("canvas");
  const maxW = isMobile ? 2048 : 4096;
  const k = Math.min(1, maxW / img.naturalWidth);
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext("2d")!;
  g.translate(c.width, 0); g.scale(-1, 1);
  g.drawImage(img, 0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Average colour of the upper and lower halves of the sky: the ambient light Unity takes from a skybox. */
async function skyColors(url: string): Promise<[THREE.Color, THREE.Color]> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url;
  });
  const c = document.createElement("canvas");
  c.width = 32; c.height = 16;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, 32, 16);
  const avg = (y0: number, y1: number) => {
    const d = g.getImageData(0, y0, 32, y1 - y0).data;
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
  };
  return [avg(0, 8), avg(8, 16)];
}

interface Post { bloomIntensity: number; bloomThreshold: number; saturation: number; contrast: number; postExposure: number; vignette: number; tonemap: number }

function parsePost(post: string[] | null): Post {
  const p: Post = { bloomIntensity: 0, bloomThreshold: 1, saturation: 0, contrast: 0, postExposure: 0, vignette: 0, tonemap: 0 };
  for (const raw of post ?? []) {
    let entry: { type: string; data: { MonoBehaviour: Record<string, { m_OverrideState?: boolean; m_Value?: number }> } };
    try { entry = JSON.parse(raw); } catch { continue; }
    const v = (k: string, d: number) => {
      const f = entry.data.MonoBehaviour[k];
      return f && f.m_OverrideState ? (f.m_Value as number) : d;
    };
    switch (entry.type) {
      case "Bloom": p.bloomIntensity = v("intensity", 0); p.bloomThreshold = v("threshold", 0.9); break;
      case "ColorAdjustments": p.saturation = v("saturation", 0); p.contrast = v("contrast", 0); p.postExposure = v("postExposure", 0); break;
      case "Vignette": p.vignette = v("intensity", 0); break;
      case "Tonemapping": p.tonemap = v("mode", 0); break;
    }
  }
  return p;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1 },
    contrast: { value: 1 },
    exposure: { value: 1 },
    vignette: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation, contrast, exposure, vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * exposure;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.18) * contrast + 0.18;
      vec2 d = vUv - 0.5;
      float v = 1.0 - vignette * smoothstep(0.2, 0.9, dot(d, d) * 2.2);
      gl_FragColor = vec4(max(col, 0.0) * v, c.a);
    }`,
};

function flareTexture(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Procedural flare: a soft glow, a bright core, a streak and a few coloured ghosts along the line to the centre. */
function makeFlare(tint: THREE.Color) {
  const glow = flareTexture((g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, "rgba(255,250,235,1)"); r.addColorStop(0.15, "rgba(255,236,190,0.55)"); r.addColorStop(1, "rgba(255,220,160,0)");
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });
  const streak = flareTexture((g, s) => {
    const r = g.createLinearGradient(0, 0, s, 0);
    r.addColorStop(0, "rgba(255,240,210,0)"); r.addColorStop(0.5, "rgba(255,240,210,0.9)"); r.addColorStop(1, "rgba(255,240,210,0)");
    g.fillStyle = r; g.fillRect(0, s / 2 - 3, s, 6);
  });
  const ghost = flareTexture((g, s) => {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = s / 2 + Math.cos(a) * s * 0.45, y = s / 2 + Math.sin(a) * s * 0.45;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, "rgba(255,255,255,0.18)"); r.addColorStop(0.8, "rgba(255,255,255,0.35)"); r.addColorStop(1, "rgba(255,255,255,0.05)");
    g.fillStyle = r; g.fill();
  }, 128);
  const f = new Lensflare();
  f.addElement(new LensflareElement(glow, 700, 0, tint));
  f.addElement(new LensflareElement(glow, 160, 0, new THREE.Color(1, 1, 1)));
  f.addElement(new LensflareElement(streak, 900, 0, new THREE.Color(1, 0.95, 0.85)));
  f.addElement(new LensflareElement(ghost, 60, 0.35, new THREE.Color(0.6, 0.9, 1)));
  f.addElement(new LensflareElement(ghost, 90, 0.55, new THREE.Color(1, 0.75, 0.5)));
  f.addElement(new LensflareElement(ghost, 50, 0.75, new THREE.Color(0.7, 1, 0.7)));
  f.addElement(new LensflareElement(ghost, 120, 1.0, new THREE.Color(0.8, 0.8, 1)));
  return f;
}
