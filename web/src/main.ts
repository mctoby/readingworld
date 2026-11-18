// Reading World, three.js version. Loads the exported world, then switches between the main menu and
// play sessions (Unity's MainMenu scene and the world scenes).

import "./style.css";
import * as THREE from "three";
import { loadJson, type WorldData } from "./data";
import { DailyContent, GameDay } from "./state";
import { loadModels, prepareModels, isMobile } from "./game/world";
import { Physics } from "./game/physics";
import { Game } from "./game/game";
import { Input } from "./game/input";
import { MainMenu } from "./ui/menu";
import { setupScaling } from "./ui/kit";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui")!;
const loading = document.getElementById("loading")!;
const bar = loading.querySelector<HTMLElement>(".loading-bar > div")!;

setupScaling(uiRoot);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" })   // AA is done in the post chain (world.ts);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

let game: Game | null = null;
let menu: MainMenu | null = null;

async function boot() {
  const data = await loadJson<WorldData>("world.json");
  const content = new DailyContent(data);
  GameDay.content = content;

  const models = await loadModels((k) => (bar.style.width = `${Math.round(k * 100)}%`));
  prepareModels(data, models);
  const physics = new Physics(models.colliders.scene);
  await document.fonts.ready;
  loading.classList.add("done");
  setTimeout(() => loading.remove(), 500);

  const showMenu = () => {
    game?.dispose();
    game = null;
    canvas.style.visibility = "hidden";
    menu = new MainMenu(uiRoot, content, (day) => void play(day));
  };

  const play = async (day: number) => {
    void day;
    menu?.dispose();
    menu = null;
    Input.clear();
    const g = new Game(renderer, data, models, physics, content, uiRoot, showMenu);
    await g.start();
    game = g;
    if (import.meta.env.DEV) (window as unknown as { game: Game }).game = g;   // for testing in the browser console
    canvas.style.visibility = "visible";
  };

  // "?play" skips the menu (handy while testing); "?day=3" picks the day.
  if (new URLSearchParams(location.search).has("play")) void play(GameDay.today);
  else showMenu();
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game) {
    game.update(dt);
    game.render();
  }
  Input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  game?.resize();
});

boot().catch((e) => {
  console.error(e);
  loading.querySelector(".loading-text")!.textContent = "Sorry, the game couldn't load. Please refresh the page.";
});
