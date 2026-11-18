# Reading World (three.js)

The web version of Reading World, built with three.js, TypeScript and Vite. It plays the same days,
conversations, quests and glossary as the Unity project in `../Assets`.

## Run it

```bash
npm install
npm run dev
```

Open the address it prints. Handy while testing:

- `?play` skips the menu, `?day=3` picks the day (e.g. `/?play&day=3` for the night-time Space day).
- In development, `window.game` in the browser console is the running game.

## Build it

```bash
npm run build
```

`dist/` is a static site: upload the whole folder to any web host. Paths are relative, so it works from a sub-folder.

## Where the content comes from

The level, characters and gameplay setup are made in Unity and exported with
**Tools > Reading World > Export for Web (three.js)**. That writes the raw files to `export/`:

| File | What |
| --- | --- |
| `world.json` | NPCs and their dialogue files, quests, locators, crates, books, cameras and trigger zones, day/night lighting, the days list |
| `models/environment.glb` | The scenery (Environment scene) |
| `models/props.glb` | Library, quest books, crates |
| `models/chip.glb` | The character (player and NPCs) |
| `models/colliders.glb` | Every solid collider, used for walking and crate pushing |
| `dialogue/`, `audio/`, `textures/` | Conversations, glossary, music and sounds, sky panoramas |
| `ui/`, `fonts/` | UI art and fonts (copied once from the Unity project) |

`npm run assets` (`scripts/build-assets.mjs`) turns `export/` into the small files the game loads, in
`public/game/` (not committed: it's rebuilt automatically by `npm run dev` and `npm run build` whenever
`export/` is newer):

- models: unused vertex data removed, the character simplified (74k to 20k triangles), meshopt-compressed;
- sky panoramas: PNG to JPEG; music and sounds: mono AAC (`.m4a`, plays on every browser including iPhone).

The audio and image conversion uses macOS's built-in `afconvert` and `sips`; on other systems those files are copied as they are.

At load, the game also freezes the character's pose into plain meshes and merges the static scenery into
one mesh per material (`src/game/optimise.ts`).

## Code map

| Unity | Web |
| --- | --- |
| ThirdPersonController, CharacterController | `src/game/player.ts`, `src/game/physics.ts` |
| Cinemachine cameras, CameraZone triggers | `src/game/cameras.ts` |
| NPCInteractable, NPCPlacer | `src/game/npcs.ts` |
| Collectable, PushCrate, LibraryManager, SparkleBurst | `src/game/props.ts` |
| Lighting scenes, volumes, SoftBend shader, sun flare | `src/game/world.ts` |
| QuestManager, GameDay, DailyContent, ReadingSettings | `src/state.ts` |
| DialogueManager, WordGlossary, HUD, menus | `src/ui/` |
| Juice, PopIn, JuiceButton | `src/ui/kit.ts` |
