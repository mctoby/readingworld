// Builds the files the game loads (public/game) from Unity's raw export (export/), making them small:
//   - models: unused vertex data dropped, the character's very dense mesh simplified, then meshopt-compressed;
//   - sky panoramas: PNG -> JPEG;
//   - music and sounds: re-encoded as mono AAC (.m4a), which every current browser plays (iPhone included);
//   - world.json: file references updated to match.
// Run with `npm run assets` (dev and build run it automatically when the export is newer).
// Audio and image conversion use macOS's built-in afconvert and sips; elsewhere those files are copied as they are.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, simplify, quantize, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../export");
const OUT = path.resolve(here, "../public/game");

const ifStale = process.argv.includes("--if-stale");
if (ifStale && fs.existsSync(path.join(OUT, "world.json"))) {
  const newest = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((t, e) => {
    const p = path.join(dir, e.name);
    return Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }, 0);
  if (newest(SRC) <= fs.statSync(path.join(OUT, "world.json")).mtimeMs) process.exit(0);
}
if (!fs.existsSync(path.join(SRC, "world.json"))) {
  console.error("No export found. In Unity: Tools > Reading World > Export for Web (three.js).");
  process.exit(1);
}

const has = (tool) => { try { execFileSync("/usr/bin/which", [tool], { stdio: "ignore" }); return true; } catch { return false; } };
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
const size = (p) => fs.statSync(p).size;
let before = 0, after = 0;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

function copyDir(rel) {
  const from = path.join(SRC, rel);
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, path.join(OUT, rel), { recursive: true });
}
copyDir("dialogue");
copyDir("fonts");
copyDir("ui");

const world = JSON.parse(fs.readFileSync(path.join(SRC, "world.json"), "utf8"));
const renamed = new Map();   // old relative path -> new relative path

// ---------------------------------------------------------------- audio

const music = new Set(world.lighting.map((l) => l.music).filter(Boolean));
fs.mkdirSync(path.join(OUT, "audio"), { recursive: true });
for (const file of fs.readdirSync(path.join(SRC, "audio"))) {
  const rel = `audio/${file}`;
  const src = path.join(SRC, rel);
  before += size(src);
  if (has("afconvert")) {
    const outRel = `audio/${path.parse(file).name.replace(/\s+/g, "-")}.m4a`;
    const bitrate = music.has(rel) ? 64000 : 56000;   // background ambience can be lighter still, but keep it clean
    // Decode to mono WAV first: afconvert can't downmix and encode to AAC in one step.
    const wav = path.join(OUT, "audio", "_tmp.wav");
    execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16", "-c", "1", "--mix", src, wav]);
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", String(bitrate), wav, path.join(OUT, outRel)]);
    fs.rmSync(wav);
    renamed.set(rel, outRel);
    after += size(path.join(OUT, outRel));
    console.log(`${rel} -> ${outRel}: ${kb(size(src))} -> ${kb(size(path.join(OUT, outRel)))}`);
  } else {
    fs.copyFileSync(src, path.join(OUT, rel));
    after += size(src);
  }
}

// ---------------------------------------------------------------- sky panoramas

fs.mkdirSync(path.join(OUT, "textures"), { recursive: true });
for (const file of fs.readdirSync(path.join(SRC, "textures"))) {
  const rel = `textures/${file}`;
  const src = path.join(SRC, rel);
  before += size(src);
  if (has("sips") && /\.png$/i.test(file)) {
    const outRel = rel.replace(/\.png$/i, ".jpg");
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "82", "-Z", "4096", src, "--out", path.join(OUT, outRel)], { stdio: "ignore" });
    renamed.set(rel, outRel);
    after += size(path.join(OUT, outRel));
    console.log(`${rel} -> ${outRel}: ${kb(size(src))} -> ${kb(size(path.join(OUT, outRel)))}`);
  } else {
    fs.copyFileSync(src, path.join(OUT, rel));
    after += size(src);
  }
}

// ---------------------------------------------------------------- models

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
fs.mkdirSync(path.join(OUT, "models"), { recursive: true });

/** Drops vertex data the web version never uses: tangents (no normal maps) and Unity's lightmap UVs. */
function dropUnused() {
  return (doc) => {
    for (const mesh of doc.getRoot().listMeshes())
      for (const prim of mesh.listPrimitives())
        for (const name of ["TANGENT", "TEXCOORD_1"]) {
          const a = prim.getAttribute(name);
          if (a) prim.setAttribute(name, null);
        }
    for (const mat of doc.getRoot().listMaterials()) mat.setNormalTexture(null);
  };
}

for (const file of fs.readdirSync(path.join(SRC, "models"))) {
  const src = path.join(SRC, "models", file);
  const out = path.join(OUT, "models", file);
  before += size(src);
  const doc = await io.read(src);
  const steps = [dropUnused(), dedup(), weld()];
  // The character is ~74k triangles and drawn five times over (player + NPCs), three passes each.
  // It's a smooth, rounded shape, so a much lighter mesh looks the same at the size it appears.
  if (file === "chip.glb") steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: 0.18, error: 0.0015 }));
  steps.push(prune());
  // Colliders are read on the CPU for physics: keep them full precision. Everything else is quantized.
  if (file !== "colliders.glb") steps.push(quantize());
  steps.push(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  await doc.transform(...steps);
  await io.write(out, doc);
  after += size(out);
  console.log(`models/${file}: ${kb(size(src))} -> ${kb(size(out))}`);
}

// Kenney grass and flowers, scattered over the ground by the game (copied once from the Kenney kit).
const scatterDir = path.join(SRC, "scatter");
if (fs.existsSync(scatterDir)) {
  fs.mkdirSync(path.join(OUT, "models", "scatter"), { recursive: true });
  for (const file of fs.readdirSync(scatterDir).filter((f) => f.endsWith(".glb"))) {
    const src = path.join(scatterDir, file);
    const out = path.join(OUT, "models", "scatter", file);
    const doc = await io.read(src);   // pulls in the external colormap texture, embedded on write
    await doc.transform(dropUnused(), dedup(), weld(), prune(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    await io.write(out, doc);
    console.log(`scatter/${file}: ${kb(size(src))} -> ${kb(size(out))}`);
  }
}

// ---------------------------------------------------------------- world.json

const remap = (p) => (p && renamed.get(p)) || p;
for (const l of world.lighting) { l.music = remap(l.music); l.skybox = remap(l.skybox); }
world.typingSound = remap(world.typingSound);
world.questSound = remap(world.questSound);
world.player.landing = remap(world.player.landing);
world.player.footsteps = (world.player.footsteps ?? []).map(remap);
fs.writeFileSync(path.join(OUT, "world.json"), JSON.stringify(world));

console.log(`\nAudio, sky and models: ${kb(before)} -> ${kb(after)}`);
