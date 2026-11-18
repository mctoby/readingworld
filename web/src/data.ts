// Shapes of the files written by Unity's Tools > Reading World > Export for Web (public/game/world.json)
// and of the dialogue JSON files (the same format the Unity game reads).

export interface V3 { x: number; y: number; z: number }
export interface V2 { x: number; y: number }
export interface Q4 { x: number; y: number; z: number; w: number }
export interface RGBA { r: number; g: number; b: number; a: number }
export interface Xform { position: V3; rotation: Q4; scale: V3 }
export interface Lens { fov: number; near: number; far: number }

export interface PlayerData {
  xform: Xform; model: Xform;
  moveSpeed: number; sprintSpeed: number; rotationSmoothTime: number; speedChangeRate: number;
  jumpHeight: number; gravity: number; jumpTimeout: number; fallTimeout: number;
  height: number; radius: number; stepOffset: number; slopeLimit: number; center: V3;
  footsteps: string[]; landing: string; footstepVolume: number;
  bendRadius: number; bendStrength: number; bendHeight: number; bendSway: number; bendSwaySpeed: number; bendSmoothing: number;
}

export interface NpcData {
  id: string; node: string; npcId: string; name: string;
  xform: Xform;
  dialogue: (string | null)[];
  unlockedByQuest: string;
  questObjects: string[];
  interactRange: number;
  model: Xform;
  dialogueCamera: Xform | null;
  dialogueLens: Lens;
  chatIcon: string | null;
  capsuleRadius: number; capsuleHeight: number; capsuleCenter: V3;
  bodyColor?: RGBA;
}

export interface CollectData { node: string; itemId: string; spinSpeed: number; bobHeight: number; bobSpeed: number; collectDuration: number; collectRise: number; boxCenter: V3; boxSize: V3 }
export interface CrateData { node: string; stepSize: number; pushDelay: number; slideTime: number; boxCenter: V3; boxSize: V3 }

export interface LibraryData {
  node: string; xform: Xform; books: string[]; questId: string;
  cameraSide: number; framingPadding: number; cameraElevation: number;
  revealInterval: number; slideDistance: number; slideDuration: number; holdTime: number;
  lens: Lens;
}

export interface CamData {
  id: string; name: string; xform: Xform; priority: number; enabled: boolean; lens: Lens; tracking: string | null;
  composer: boolean; composerOffset: V3; composerDamping: V2;
  followZoom: boolean; zoomWidth: number; zoomDamping: number; zoomFovRange: V2;
  dolly: boolean; splinePoints: V3[] | null; splineClosed: boolean; dollyOffset: V3; dollyPosition: number;
  follow: boolean; followOffset: V3;
}

export interface ZoneData { name: string; xform: Xform; center: V3; size: V3; camera: string }

export interface LightingData {
  scene: string;
  lightColor: RGBA; lightIntensity: number; lightRotation: Q4; shadowStrength: number; flare: boolean;
  ambientMode: string; ambientSky: RGBA; ambientEquator: RGBA; ambientGround: RGBA; ambientIntensity: number;
  fog: boolean; fogMode: string; fogColor: RGBA; fogDensity: number; fogStart: number; fogEnd: number;
  skybox: string | null; skyTint: RGBA; skyExposure: number; skyRotation: number;
  shadowColor: RGBA;
  music: string | null; musicVolume: number;
  post: string[] | null;
}

export interface DayFiles { npcId: string; files: (string | null)[] }
export interface DayInfo { day: number; topic: string; live: boolean; timeOfDay: "Day" | "Night"; npcs: DayFiles[] }

export interface WorldData {
  exportedAt: string;
  player: PlayerData;
  npcs: NpcData[];
  placerNpcs: string[]; locators: V3[]; placerHeight: number; placerSalt: number; placerUseRotation: boolean;
  collectables: CollectData[];
  crates: CrateData[];
  library: LibraryData;
  cameras: CamData[];
  zones: ZoneData[];
  blendTime: number;
  lighting: LightingData[];
  day1TimeOfDay: "Day" | "Night";
  days: DayInfo[];
  bendNodes: string[];
  colliderNodes: string[];
  glossary: string;
  typingSound: string | null;
  questSound: string | null;
}

// ---- Dialogue files (same format as Assets/Dialogue/*.json)

export interface DialogueLine {
  speaker?: string;
  text: string;
  choices?: string[];
  correctIndex?: number;
  hint?: string;
  correctText?: string;
}

export interface QuestData {
  id: string;
  title: string;
  itemId?: string;
  requiredCount?: number;
  type?: string;              // "collect" (default) or "quiz"
  rewardBooks?: number;
  requiredQuests?: string[];
}

export interface DialogueData {
  npcName: string;
  quest?: QuestData | null;
  unlockedByQuest?: string;
  lines: DialogueLine[];
  inProgressLines?: DialogueLine[];
  completeLines?: DialogueLine[];
  afterLines?: DialogueLine[];
}

export const isQuestion = (l: DialogueLine) => !!l.choices && l.choices.length > 0;
export const isQuiz = (q: QuestData) => q.type === "quiz";
export const needsOtherQuests = (q: QuestData) => !!q.requiredQuests && q.requiredQuests.length > 0;
export const rewardBooks = (q: QuestData) => (q.rewardBooks && q.rewardBooks > 0 ? q.rewardBooks : q.requiredCount ?? 0);

/** A quest from JSON as Unity's JsonUtility reads it: a missing quest becomes an empty one. */
export const hasQuest = (q: QuestData | null | undefined): q is QuestData => !!q && !!q.id;

export const GAME = "game/";

export async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(GAME + path);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return (await res.json()) as T;
}
