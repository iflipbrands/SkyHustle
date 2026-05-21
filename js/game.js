import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { clone as cloneSkinnedHierarchy } from "three/addons/utils/SkeletonUtils.js";
import * as CANNON from "cannon-es";

/** Three lane centers on each rooftop (`laneIndex` 0 | 1 | 2). ← / → step one lane. */
const LANES = [-1.82, 0, 1.82];
/** Auto-run forward speed (m/s) — always on while playing; no key to hold. */
const FORWARD_SPEED = 15;
/** Legacy — only used if locomotion is explicitly slowed. */
const WALK_SPEED = 4.75;
const LANE_SMOOTH = 22;
const PLAYER_HALF = new CANNON.Vec3(0.28, 0.88, 0.24);
/** Top Y of runway collider — must match ground tile `body.position.y` + box half Y in `buildGroundTiles` / `recycleGroundTiles`. */
const RUNWAY_SURFACE_Y = 0.14 + 0.14;
/** While Space jump clip plays: slow it slightly so limb motion reads softer in the air. */
const JUMP_IN_AIR_TIME_SCALE = 0.48;
/** Space + JumpOverObstacles clip — upward velocity (world gravity Y ≈ −32). */
const SPACE_JUMP_VY = 13.5;
const SPACE_JUMP_GROUND_EPS = 0.14;
const SPACE_JUMP_MAX_UPWARD_VY = 0.5;
/** When true, crossing {@link FINISH_RIBBON_Z} triggers level-end overlay → main menu. */
const ENABLE_LEVEL_AUTO_END = false;
/** Distance (m) for optional level finish — only used if {@link ENABLE_LEVEL_AUTO_END}. */
const FINISH_RIBBON_Z = 500;
/** Recycled ground tile center at this Z is the story gap (one TILE_Z wide). */
const LEVEL1_GAP_TILE_CENTER_Z = 590;
/** Grounded past this Z on the landing rooftop counts as finishing the level. */
const LEVEL1_LAND_COMPLETE_MIN_Z = 680;
/** In-air window after {@link FINISH_RIBBON_Z} — start end video + overlay while jumping the gap. */
const LEVEL1_END_VIDEO_AIR_MIN_Z = 505;
const LEVEL1_END_VIDEO_AIR_MAX_Z = 675;
/** Root-relative media layout: `ui/`, `audio/`, `environment/`, `characters/`, `animations/`, `assets/`. */
const DIR_UI = "./ui/";
const DIR_AUDIO = "./audio/";
const DIR_ENV = "./environment/";
const DIR_CHAR = "./characters/";
const DIR_ANIM = "./animations/";
const DIR_ASSETS = "./assets/";
const DIR_PLACEHOLDERS = `${DIR_ASSETS}placeholders/`;

/**
 * Procedural rooftop world — tune here (hard-refresh after edits).
 * | What | Constants / functions |
 * |------|------------------------|
 * | Roof + gap rhythm | `BUILDING_DEPTH`, `BUILDING_GAP`, `BUILDING_CYCLE`, `isRooftopGap` |
 * | Run strip width | `BUILDING_WIDTH`, `LANES` (three lanes) |
 * | Façade / gravel look | `BUILDING_FACADE_*`, `BUILDING_MORTAR`, `ROOFTOP_SURFACE_COLOR` |
 * | Skyline depth | `buildSkylineBuilding`, `buildSkylinePool` |
 */

const LEVEL1_END_VIDEO_SRC = `${DIR_ANIM}level1-end.mp4`;
/** Set true to play the level-complete video again; false = stats overlay only (faster iteration). */
const LEVEL1_END_VIDEO_ENABLED = false;
/** When {@link LEVEL1_END_VIDEO_ENABLED} is false, time on end overlay before return to menu (ms). */
const LEVEL1_END_OVERLAY_MIN_MS_NO_VIDEO = 4000;
/** Rooftop surface color (dark gravel). */
const ROOFTOP_SURFACE_COLOR = 0x3a3c3e;
/** Building facade brick color A. */
const BUILDING_FACADE_A = 0x8a6a58;
/** Building facade brick color B. */
const BUILDING_FACADE_B = 0x9a7a66;
/** Building facade mortar / dark lines. */
const BUILDING_MORTAR = 0x5a4a42;
/** Sky horizon color at dusk. */
const RUN_SCENE_BACKGROUND = 0xff7a4a;
/** Sunset gradient stops (bottom to top). */
const SUNSET_SKY_HORIZON = 0xff7a4a;
const SUNSET_SKY_LOW = 0xff5a6e;
const SUNSET_SKY_MID = 0xc94d8a;
const SUNSET_SKY_HIGH = 0x6b4a9e;
const SUNSET_SKY_ZENITH = 0x2a3a72;
/** Minimum time the level-end overlay stays up, ms. */
const LEVEL1_END_MIN_DURATION_MS = 12000;
/** Player spawn +Z at level run start. */
const RUN_START_Z = 210;
/** How deep (Z) each rooftop building platform is. */
const BUILDING_DEPTH = 28;
/** Gap between buildings the player must clear by jumping. */
const BUILDING_GAP = 5.0;
/** One tile cycle = one rooftop + one gap. */
const BUILDING_CYCLE = BUILDING_DEPTH + BUILDING_GAP;
/** Rooftop width — three run lanes with side ledges. */
const BUILDING_WIDTH = 11;
/** Height of building facades visible below the rooftop edge. */
const BUILDING_FACADE_HEIGHT = 24;
/** How many building platforms to keep in the recycling pool. */
const BUILDING_POOL = 14;
/** Legacy — keep so physics tile references still compile. */
const NEIGHBOURHOOD_RUN_WIDTH = BUILDING_WIDTH;

/** Looping run music (respects Music on/off in settings). */
const GAME_MUSIC_SRC = `${DIR_AUDIO}ceezandray_gamemusic.mp3`;
/** Legacy constant — kept to avoid any residual reference errors. */
const TILE_Z = BUILDING_CYCLE;
const ENABLE_GAPS = true;
const SPAWN_Z_AHEAD_MIN = 28;
const SPAWN_Z_AHEAD_MAX = 72;
/** Spawn at most one obstacle row every this many ground-tile advances (~{@link TILE_Z} m each). */
const OBSTACLE_BUILDING_INTERVAL = 3;
const DUMPSTER_FBX_CANDIDATES = [`${DIR_ENV}dumpster.fbx`];
/** Procedural corrugated trash can (atlas UVs) — diffuse / bump / spec in `assets/trashcan/`. */
const TRASHCAN_DIFFUSE = `${DIR_ASSETS}trashcan/diffuse.jpg`;
const TRASHCAN_BUMP = `${DIR_ASSETS}trashcan/bump.jpg`;
const TRASHCAN_SPEC = `${DIR_ASSETS}trashcan/spec.jpg`;
/** Seamless asphalt texture for the visible runway under the player. */
const RUNWAY_ASPHALT_MAP = `${DIR_ASSETS}asphalt_road.png`;
/** Brick running-bond facade for walls / buildings. */
const NEIGHBOURHOOD_BRICK_MAP = `${DIR_ASSETS}brick_wall.png`;
/** Reference skyline photo (game + menu). Fallback: {@link SKY_BACKGROUND_MAP}. */
const RUN_CITY_PHOTO_MAP = `${DIR_ASSETS}run-city-sunset-bg.png`;
/** Painted sunset sky (fallback if photo missing). */
const SKY_BACKGROUND_MAP = `${DIR_ASSETS}sky_sunset.png`;
const INVINCIBLE_MS = 2200;
const ACTION_COOLDOWN_MS = 220;
const COINS_ENABLED = true;
/** Dumpster / trashcan rows on rooftops when variants load in bootstrap. */
const OBSTACLES_ENABLED = true;

const RAY_BASE_X = 0.35;
const RAY_BASE_Y = 1.35;
/** When false, Ray GLTF is not drawn (kept in scene for seed spawn origin). */
const RAY_VISIBLE = false;
/** When true, skip Ceez/Ray model loads — one grey capsule + invisible Ray spawn anchor. */
const PLAYER_USE_GREY_PROXY = false;

/** Camera: behind Ceez/Ray along −movement, look ahead along +movement (XZ). */
const CAMERA_DIST_BACK = 4.35;
const CAMERA_HEIGHT = 2.12;
const CAMERA_LOOK_AHEAD = 8.8;
const CAMERA_LOOK_HEIGHT_OFFSET = 0.64;
/** Chase cam eases behind heading after hard turns (0–1 per frame; higher = snappier). */
const CAMERA_BEHIND_SMOOTH = 0.2;
const KB_FACING_FROM_VEL_RATE = 11;
/** KB: when nearly stopped, ease facing back toward run corridor (1/s). */
const KB_FACING_SNAP_BACK_RATE = 5.5;

const CEEZ_OBJ_DIR = `${DIR_CHAR}Ceez/`;
const CEEZ_OBJ_FILE = "ceez.obj";
const CEEZ_OBJ_FALLBACK_TEX = `${CEEZ_OBJ_DIR}new/ceez_fbx_basecolor.png`;
const CEEZ_HOODIE_PATTERN_TEX = `${CEEZ_OBJ_DIR}new/redcotton_hoodie.png`;
const CEEZ_OBJ_CANDIDATES = [{ dir: CEEZ_OBJ_DIR, obj: CEEZ_OBJ_FILE, mtl: null }];
/** Try these first — GLTF/FBX can carry run animations (OBJ cannot). */
const CEEZ_GLTF_CANDIDATES = [
  `${CEEZ_OBJ_DIR}ceez.glb`,
  `${CEEZ_OBJ_DIR}Ceez.glb`,
  `${CEEZ_OBJ_DIR}ceez.gltf`,
];
/** Tripo / embedded-mesh FBX (try before GLTF and other FBX). */
const CEEZ_TRIPO_FBX = `${CEEZ_OBJ_DIR}new/tripo_convert_66ed1f4e-9533-48ac-b540-39e1883a9540.fbx`;
/** Split-file rig setup: base mesh + separate action FBX clips. */
const CEEZ_BASE_FBX = `${CEEZ_OBJ_DIR}new/c1.fbx`;
/** Primary loop locomotion — `animations/RunFast.fbx` (continuous run while playing). */
const CEEZ_RUN_ACTION_FBX = `${DIR_ANIM}RunFast.fbx`;
const CEEZ_THROW_ACTION_FBX = `${CEEZ_OBJ_DIR}new/RunAndThrow.fbx`;
/** Optional one-shot on Space — same rig as split / Meshy + FastRun. */
const CEEZ_JUMP_OVER_OBSTACLES_FBX = `${DIR_ANIM}JumpOverObstacles.fbx`;
/** Walk cycle — `animations/Walking` (extensionless) or `Walking.fbx`; same rig as FastRun. */
const CEEZ_WALKING_FBX = `${DIR_ANIM}Walking`;
const CEEZ_WALKING_FBX_URLS = [CEEZ_WALKING_FBX, `${DIR_ANIM}Walking.fbx`];
/** Skinned mesh only (Meshy materials preserved). */
const CEEZ_MESHY_CHARACTER_FBX = `${DIR_CHAR}Ceez_Meshy.fbx`;
/** Same rig as meshy / split — external run clip (see {@link CEEZ_RUN_ACTION_FBX}). */
const CEEZ_MESHY_RUNFAST_ANIM_FBX = CEEZ_RUN_ACTION_FBX;
const CEEZ_FBX_CANDIDATES = [
  CEEZ_RUN_ACTION_FBX,
  `${CEEZ_OBJ_DIR}ceez.fbx`,
  `${CEEZ_OBJ_DIR}Ceez.fbx`,
  `${CEEZ_OBJ_DIR}tripo_convert_935ed2cf-d1ba-4c07-858a-862181fc5832.fbx`,
  `${CEEZ_OBJ_DIR}tripo_convert_8a5c6eb9-656e-4d95-9628-a6cfdce16950.fbx`,
  `${CEEZ_OBJ_DIR}tripo_convert_faf643c1-7141-4331-9230-fd9ef2cd66fc.fbx`,
];
/** Target height (m) for Ceez mesh after load — tuned to match prior placeholder scale. */
const CEEZ_TARGET_HEIGHT = 1.75;
/** Bump when changing orientation/UV so the cached Ceez template reloads. */
const CEEZ_LOADER_REV = 16;
/**
 * OBJ/GLTF “forward” is often +X or −Z while run direction is +Z.
 * If Ceez still faces sideways, try 0, ±Math.PI/2, or Math.PI.
 */
const CEEZ_RUN_HEADING_Y_OFFSET = Math.PI / 2;
/**
 * Local Y on the Ceez model only. π flips him to run forward into the lane so the chase cam (behind)
 * shows his back, not his chest. Ray is a separate child — do not move this to playerRoot.rotation.
 */
const CEEZ_MESH_RELATIVE_YAW = Math.PI;
/** Extra local Y for `Ceez_Meshy.fbx` only: 90° counter-clockwise when viewed from above (+Y). */
const CEEZ_MESHY_CHARACTER_EXTRA_YAW = Math.PI / 2;
/**
 * Diffuse atlas UV tweak: repeat below 1 stretches the texture slightly on the mesh (helps seams).
 * Adjust offset/repeat until B.P.F / clothing line up with the OBJ UVs.
 */
const CEEZ_DIFFUSE_REPEAT_U = 1;
const CEEZ_DIFFUSE_REPEAT_V = 1;
const CEEZ_DIFFUSE_OFFSET_U = 0;
const CEEZ_DIFFUSE_OFFSET_V = 0;
const CEEZ_DIFFUSE_ROTATION = 0;
const CEEZ_SATURATION_BOOST = 100;
/** Multiply material saturation / punch vs prior tuning (1.2 ≈ 20% bolder). */
const CEEZ_COLOR_PUNCH = 1.2;
const CEEZ_ENABLE_VERTEX_HOODIE_TINT = false;
/** Back-side tint direction in local mesh space (flip to 1 if needed). */
const CEEZ_BACK_TINT_SIGN = -1;

let lastBananaAt = 0;
let lastSeedsAt = 0;

/** @type {THREE.Object3D | null} */
let bananaTemplate = null;
/** @type {{ mesh: THREE.Object3D; vz: number; vy: number; kind: "banana" | "seed" }[]} */
const projectiles = [];
const _rayWorld = new THREE.Vector3();
const SEED_BURST_COUNT = 7;

const canvas = document.getElementById("game-canvas");
/** So keyboard reaches the game instead of staying on a hidden input or menu control. */
if (canvas) {
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", "Sky Hustle");
}
const hud = document.getElementById("hud");
const hudCoins = document.getElementById("hud-coins");
const hudScore = document.getElementById("hud-score");
const hudDistance = document.getElementById("hud-distance");
const hudHearts = document.getElementById("hud-hearts");
const touchLayer = document.getElementById("touch-layer");
const screenMenu = document.getElementById("screen-menu");
const screenPreLevel = document.getElementById("screen-prelevel");
const btnStart = document.getElementById("btn-start");
const btnEnterLevel1 = document.getElementById("btn-enter-level1");
const btnPrelevelHighScore = document.getElementById("btn-prelevel-highscore");
const btnPrelevelSettings = document.getElementById("btn-prelevel-settings");
const prelevelSettingsModal = document.getElementById("prelevel-settings-modal");
const prelevelSettingsBackdrop = document.getElementById("prelevel-settings-backdrop");
const btnPrelevelSettingsClose = document.getElementById("btn-prelevel-settings-close");
const settingMode1h = document.getElementById("setting-mode-1h");
const settingMode2h = document.getElementById("setting-mode-2h");
const settingModeKb = document.getElementById("setting-mode-kb");
const settingSoundOn = document.getElementById("setting-sound-on");
const settingSoundOff = document.getElementById("setting-sound-off");
const settingMusicOn = document.getElementById("setting-music-on");
const settingMusicOff = document.getElementById("setting-music-off");
const playerNameInput = document.getElementById("player-name-input");
const prelevelBestLine = document.getElementById("prelevel-best-line");
const prelevelSettingsLine = document.getElementById("prelevel-settings-line");
const prelevelMeta = document.getElementById("prelevel-meta");
const highScoreLine = document.getElementById("high-score-line");
const btnGameSettings = document.getElementById("btn-game-settings");
const gamePauseOverlay = document.getElementById("game-pause-overlay");
const gamePauseBackdrop = document.getElementById("game-pause-backdrop");
const btnGamePauseResume = document.getElementById("game-pause-resume");
const btnGamePauseTryAgain = document.getElementById("game-pause-try-again");
const gamePauseSoundOn = document.getElementById("game-pause-sound-on");
const gamePauseSoundOff = document.getElementById("game-pause-sound-off");
const gamePauseMusicOn = document.getElementById("game-pause-music-on");
const gamePauseMusicOff = document.getElementById("game-pause-music-off");
const gamePauseMode1h = document.getElementById("game-pause-mode-1h");
const gamePauseMode2h = document.getElementById("game-pause-mode-2h");
const gamePauseModeKb = document.getElementById("game-pause-mode-kb");
const level1EndOverlay = document.getElementById("level1-end-overlay");
const level1EndVideo = document.getElementById("level1-end-video");
const level1EndMessage = document.getElementById("level1-end-message");
const level1EndStatsEl = document.getElementById("level1-end-stats");
const level1EndStatTime = document.getElementById("level1-end-stat-time");
const level1EndStatDist = document.getElementById("level1-end-stat-dist");
const level1EndStatScore = document.getElementById("level1-end-stat-score");
const level1EndRowTime = document.getElementById("level1-end-row-time");
const level1EndRowDist = document.getElementById("level1-end-row-dist");
const level1EndRowScore = document.getElementById("level1-end-row-score");
const gameOverOverlay = document.getElementById("game-over-overlay");
const gameOverScoreLine = document.getElementById("game-over-score-line");
const btnGameOverMenu = document.getElementById("btn-game-over-menu");
const PLAYER_NAME_KEY = "sky_hustle_player_name";
const SOUND_ON_KEY = "sky_hustle_sound_on";
const MUSIC_ON_KEY = "sky_hustle_music_on";

/** @type {'menu' | 'staging' | 'playing' | 'gameOver'} */
let state = "menu";
/** Score shown on game-over screen and passed to main menu / high score. */
let lastGameOverScore = 0;
/** When true during `playing`, physics/step loop is frozen and the pause overlay is shown. */
let runPaused = false;

let scene, camera, renderer;
let world;
/** @type {CANNON.Body} */
let playerBody;
/** @type {THREE.Group} */
let playerRoot;
/** @type {THREE.Object3D | null} */
let rayMesh = null;
/** Smoothed world forward (+Z default) for camera + character yaw when velocity is tiny. */
const lastRunForward = new THREE.Vector3(0, 0, 1);
const _camBehind = new THREE.Vector3();
const _camLook = new THREE.Vector3();
/** Camera-only smoothed run forward — eases behind the character when heading snaps 90°. */
const cameraSmoothedForward = new THREE.Vector3(0, 0, 1);
/** World Y rotation of the run (radians). 0 = forward +world Z; +π/2 = forward +world X. Derived from committed + steer. */
let worldRunYaw = 0;
/** Cardinal heading; arrow-hold in KB mode integrates here for a continuous curve. */
let committedRunYaw = 0;
/** Extra yaw offset (used by non-KB turns); KB arrow mode keeps this at 0. */
let yawSteer = 0;
/** XZ origin for lane offsets: lateral = dot(P − runOrigin, runRight). Updated on 90° turns. */
const runOrigin = new THREE.Vector3(0, 0, 0);
const _runForward = new THREE.Vector3(0, 0, 1);
const _runRight = new THREE.Vector3(1, 0, 0);
/** Forward axis before a corner (for re-anchoring runOrigin). */
const _tmpFold = new THREE.Vector3();
/** KB: smoothed horizontal facing for mesh + camera (blends toward velocity). */
const _kbFacingSm = new THREE.Vector3(0, 0, 1);
const _kbFacingHint = new THREE.Vector3();
/** @type {THREE.AnimationMixer | null} */
let ceezAnimMixer = null;
/** @type {THREE.AnimationAction | null} */
let ceezRunAction = null;
/** @type {THREE.AnimationAction | null} */
let ceezWalkAction = null;
/** @type {THREE.AnimationAction | null} */
let ceezThrowAction = null;
/** @type {THREE.AnimationAction | null} */
let ceezJumpOverObstaclesAction = null;
let runStartAtMs = 0;
/** Forward distance accumulated this run (m) — HUD + gap logic use this so 90° turns do not stall progress. */
let runDistanceTraveledM = 0;
/** Set when level-1 victory sequence starts (for overlay time). */
let level1FinishedAtMs = 0;
let passedFinishRibbon = false;
/** True after landing on the second building — freezes forward run. */
let level1VictoryFreeze = false;
/** End video + overlay started (typically while airborne over the gap). */
let level1EndCinematicStarted = false;
/** When the end overlay reveal began (for minimum duration). */
let level1EndRevealStartedAtMs = 0;
/** Timeout id for deferred return to menu after level end. */
let level1EndFinishTimer = 0;
/** Cancel token + rAF for level-end stat count-up animation. */
let level1EndStatAnimToken = 0;
let level1EndStatRaf = 0;
/** Snapshot at level-1 win landing (totals + high score after end video). */
let level1WinDist = 0;
let level1WinScore = 0;
/** @type {"rooftop"} */
let runSegment = "rooftop";
/** Grey deck under the lanes — physics tiles have no mesh; this is what you “run on”. */
let skyBackgroundImageTex = null;
let skyBackgroundFallbackTex = null;
let runFacadeLight = null;
let runFillLight = null;
/** Recycled rooftop building platforms (mesh + physics body pairs). */
let rooftopBuildings = [];
/** Pool of background skyline meshes (decorative, no physics). */
let skylineBuildings = [];
/** @type {HTMLAudioElement | null} */
let gameMusicEl = null;

const loader = new GLTFLoader();
loader.crossOrigin = "anonymous";
const gltfCache = new Map();
const fbxLoader = new FBXLoader();
const fbxCache = new Map();
const objLoader = new OBJLoader();
const mtlLoader = new MTLLoader();
/** Successfully loaded Ceez root (normalized); clone for each build. */
let ceezObjTemplate = null;
/** @type {Promise<THREE.Texture | null> | null} */
let ceezObjFallbackTexPromise = null;
/** @type {Promise<THREE.Texture | null> | null} */
let ceezHoodiePatternTexPromise = null;

let laneIndex = 1;
/** Prevents double-start when both click + pointer fire on “Enter Level 1”. */
let tryEnterLevelFromPrelevelInFlight = false;
/** Legacy: Z could sprint on KB; keyboard now always runs at full speed — kept for blur reset only. */
let kbKeyZHeld = false;
let coins = 0;
let lives = 3;
let invincibleUntil = 0;

const obstacles = [];
const coinObjects = [];
const groundTiles = [];

/** Cached obstacle roots for `clone(true)`; each entry has Cannon box `half` extents. */
let obstacleVariantSpecs = [];
let coinTemplate;
let coinSpriteMaterial = null;
let groundPhysicsMaterial;

let nextSpawnZ = 10;
let obstacleSpawnIndex = 0;
let rng = mulberry32(0xcea3);

const clock = new THREE.Clock();

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadGltf(url) {
  if (gltfCache.has(url)) return gltfCache.get(url);
  const p = new Promise((resolve, reject) => {
    loader.load(
      url,
      (g) => resolve(g),
      undefined,
      (e) => reject(e)
    );
  });
  gltfCache.set(url, p);
  return p;
}

function loadFbx(url) {
  if (fbxCache.has(url)) return fbxCache.get(url);
  const p = new Promise((resolve, reject) => {
    fbxLoader.load(
      url,
      (obj) => resolve(obj),
      undefined,
      (e) => reject(e)
    );
  });
  fbxCache.set(url, p);
  return p;
}

function alignCeezDiffuseTexture(map) {
  if (!map) return;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.flipY = false;
  map.center.set(0.5, 0.5);
  map.rotation = CEEZ_DIFFUSE_ROTATION;
  map.repeat.set(CEEZ_DIFFUSE_REPEAT_U, CEEZ_DIFFUSE_REPEAT_V);
  map.offset.set(CEEZ_DIFFUSE_OFFSET_U, CEEZ_DIFFUSE_OFFSET_V);
  if (renderer?.capabilities) {
    map.anisotropy = Math.min(14, renderer.capabilities.getMaxAnisotropy());
  }
  map.needsUpdate = true;
}

function boostMaterialSaturation(material, saturation = 1.35 * CEEZ_COLOR_PUNCH) {
  if (!material?.color) return;

  const hsl = {};
  material.color.getHSL(hsl);

  hsl.s = Math.min(1, hsl.s * saturation);

  material.color.setHSL(hsl.h, hsl.s, hsl.l);
}

function fixCeezMaterials(root) {
  const fallback = new THREE.MeshStandardMaterial({
    color: 0x5c4a3d,
    roughness: 0.88,
    metalness: 0.05,
    name: "ceez-fallback-fur",
  });
  root.traverse((o) => {
    if (!o.isMesh) return;
    const hasVertexColors = Boolean(o.geometry?.attributes?.color);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const next = mats.map((m) => {
      if (!m) return fallback.clone();
      if (m.isMeshPhongMaterial || m.isMeshLambertMaterial) {
        const std = new THREE.MeshStandardMaterial({
          // If vertex colors exist, do not multiply by a diffuse map (can turn areas black).
          map: hasVertexColors ? undefined : m.map || undefined,
          color: hasVertexColors ? 0xffffff : (m.color || new THREE.Color(0xffffff)),
          vertexColors: hasVertexColors,
          roughness: 0.74,
          metalness: 0.08,
          envMapIntensity: 0.55,
        });
        if (std.map) {
          std.map.colorSpace = THREE.SRGBColorSpace;
          alignCeezDiffuseTexture(std.map);
        } else if (!hasVertexColors) {
          std.color.copy(m.color || new THREE.Color(0x5c4a3d));
        }
        boostMaterialSaturation(std, 1.58 * CEEZ_COLOR_PUNCH);
        m.dispose?.();
        return std;
      }
      if (m.isMeshStandardMaterial) {
        if ("vertexColors" in m) m.vertexColors = hasVertexColors;
        if (hasVertexColors) {
          // Vertex color should be the albedo driver.
          m.map = null;
        }
        if (m.map) {
          m.map.colorSpace = THREE.SRGBColorSpace;
          alignCeezDiffuseTexture(m.map);
          m.color.setHex(0xffffff);
          m.roughness = 0.74;
          m.metalness = 0.08;
          m.envMapIntensity = 0.55;
        } else if (!hasVertexColors && m.map == null && m.color?.getHex?.() === 0xffffff) {
          m.color.setHex(0x5c4a3d);
        } else if (hasVertexColors && m.color?.setHex) {
          // Vertex color should drive final albedo; keep multiplier neutral.
          m.color.setHex(0xffffff);
        }
        boostMaterialSaturation(m, 1.58 * CEEZ_COLOR_PUNCH);
        return m;
      }
      if (m.map) {
        m.map.colorSpace = THREE.SRGBColorSpace;
        alignCeezDiffuseTexture(m.map);
        if ("color" in m) m.color.setHex(0xffffff);
      }
      if ("vertexColors" in m) m.vertexColors = hasVertexColors;
      return m;
    });
    o.material = next.length === 1 ? next[0] : next;
  });
}

/** Center XZ, feet at y=0, scale to target height. */
function normalizeCeezMesh(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const h = size.y > 1e-6 ? size.y : 1;
  const s = CEEZ_TARGET_HEIGHT / h;
  root.scale.setScalar(s);
  root.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(root);
  const cx = (b2.min.x + b2.max.x) * 0.5;
  const cz = (b2.min.z + b2.max.z) * 0.5;
  root.position.x -= cx;
  root.position.z -= cz;
  root.position.y -= b2.min.y;
}

function disposeCeezAnimRuntime() {
  if (ceezWalkAction) {
    ceezWalkAction.stop();
    ceezWalkAction = null;
  }
  if (ceezRunAction) {
    ceezRunAction.stop();
    ceezRunAction = null;
  }
  if (ceezThrowAction) {
    ceezThrowAction.stop();
    ceezThrowAction = null;
  }
  if (ceezJumpOverObstaclesAction) {
    ceezJumpOverObstaclesAction.stop();
    ceezJumpOverObstaclesAction = null;
  }
  if (ceezAnimMixer) {
    ceezAnimMixer.stopAllAction();
    ceezAnimMixer = null;
  }
}

/** Throw / toss clips must never become the looping locomotion action ("run" matches inside "RunAndThrow"). */
function clipNameExcludedFromRunCycle(name) {
  const n = String(name || "").toLowerCase();
  return (
    /throw|toss|pitch|hurl/.test(n) ||
    /run\s*and\s*throw|runandthrow/.test(n)
  );
}

/** Prefer clips named run / jog / sprint / walk; else first clip. */
function pickRunAnimationClip(clips) {
  if (!clips?.length) return null;
  const ok = (c) =>
    !clipNameExcludedFromRunCycle(c.name) && !clipNameExcludedFromLocomotion(c.name);
  // Never allow climb/jump-like clips to become the default locomotion action.
  const fastRun = clips.find(
    (c) => ok(c) && /fast\s*run|fastrun|run\s*fast|runfast|sprint/i.test(c.name || "")
  );
  if (fastRun) return fastRun;
  return (
    clips.find(
      (c) =>
        ok(c) &&
        (/\brun\b/i.test(c.name || "") || /jog|locomotion/i.test(c.name || ""))
    ) ||
    clips.find(
      (c) =>
        ok(c) &&
        /walk/i.test(c.name || "") &&
        !/climb|jump|hop|leap/i.test(String(c.name || ""))
    ) ||
    null
  );
}

/** Never use these as the looping run (Mixamo "Take 001" etc. are fine; jump/idle is not). */
function clipNameExcludedFromLocomotion(name) {
  const n = String(name || "").toLowerCase();
  if (clipNameExcludedFromRunCycle(name)) return true;
  // `\bjump\b` misses "jump_with_arms_open" — `_` is a word char in JS — use /jump/.
  return (
    /jump|jumping|hop|leap|hang|climb|idle|death|knock|injured|hurt|fall\b|land\b|vault|bounce|mid\s*air|in\s*air|obstacle|arms\s*open/.test(
      n
    )
  );
}

/**
 * Last path segment after `|`, `::`, or `/` so FBX stacks like `mixamo.com|RunFast` still match `runfast`.
 * @param {string} [name]
 */
function locomotionKeyFromClipName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const tail = raw.split(/[|\\/:：]+/).pop() || raw;
  return tail.toLowerCase().replace(/[\s_\-]+/g, "");
}

/** "Fast Run" / "fastrun" → same bucket as RunFast. */
function canonicalLocomotionKeyFromClip(c) {
  let k = locomotionKeyFromClipName(c?.name);
  if (k === "fastrun") k = "runfast";
  return k;
}

/** Ground-loop names we trust (merged packs, Mixamo, etc.). Never pick jump/climb via “longest clip”. */
const LOCOMOTION_CYCLE_KEYS = [
  "running",
  "runfast",
  "walking",
  "walk",
  "jogging",
  "jog",
  "sprint",
  "locomotion",
];

/**
 * Run cycle: whitelist run/walk/jog names first; semantic run heuristics; no “longest clip” fallback
 * (that was picking unnamed / Take001 stacks that were actually jump or climb in merged FBXs).
 * @param {THREE.AnimationClip[]} clips
 */
function pickLocomotionClip(clips) {
  if (!clips?.length) return null;
  const okLoco = (c) => !clipNameExcludedFromLocomotion(c?.name);
  const key = (c) => canonicalLocomotionKeyFromClip(c);

  for (const token of LOCOMOTION_CYCLE_KEYS) {
    const hit =
      clips.find((c) => okLoco(c) && key(c) === token) ||
      clips.find((c) => okLoco(c) && new RegExp(`(^|[^a-z])${token}([^a-z]|$)`, "i").test(String(c?.name || ""))) ||
      null;
    if (hit) return hit;
  }

  const semantic = pickRunAnimationClip(clips);
  if (semantic) return semantic;

  /** Single non-excluded clip (e.g. FastRun.fbx with only `Take 001` / `Layer0`). */
  const safeOnly = clips.filter(okLoco);
  if (safeOnly.length === 1) return safeOnly[0];

  return null;
}

/** Banana / seed toss — RunAndThrow pack or generic throw names. */
function pickThrowAnimationClip(clips) {
  if (!clips?.length) return null;
  return (
    clips.find((c) => /run\s*and\s*throw|runandthrow/i.test(c.name || "")) ||
    clips.find((c) => /throw|toss|pitch|hurl/i.test(c.name || "")) ||
    null
  );
}

/** Space bar — {@link CEEZ_JUMP_OVER_OBSTACLES_FBX} or best jump-titled clip in that file. */
function pickJumpOverObstaclesClip(clips) {
  if (!clips?.length) return null;
  const name = (c) => String(c?.name || "");
  return (
    clips.find((c) => /jump.*over.*obstacle|jumpover|over.*obstacle/i.test(name(c))) ||
    clips.find((c) => /\bjump\b/i.test(name(c))) ||
    clips[0]
  );
}

/**
 * Load JumpOverObstacles.fbx onto the existing locomotion mixer (same root as run).
 * @returns {Promise<THREE.AnimationAction | null>}
 */
async function tryBindJumpOverObstaclesAction(mixer, runAction) {
  if (!mixer || !runAction) return null;
  try {
    const src = await loadFbx(CEEZ_JUMP_OVER_OBSTACLES_FBX);
    const clips = collectAnimationClips(src, src.animations || []);
    const raw = pickJumpOverObstaclesClip(clips);
    if (!raw) {
      console.warn(`[Ceez Jump] No clip in ${CEEZ_JUMP_OVER_OBSTACLES_FBX}`);
      return null;
    }
    const clip = animationClipWithoutRootPositionTracks(raw);
    const jumpAction = mixer.clipAction(clip);
    jumpAction.timeScale = JUMP_IN_AIR_TIME_SCALE;
    bindOneShotReturnsToRun(mixer, runAction, jumpAction);
    console.info(`[Ceez Jump] bound "${raw.name || "(unnamed)"}" from JumpOverObstacles.fbx`);
    return jumpAction;
  } catch (err) {
    console.warn("[Ceez Jump] JumpOverObstacles.fbx failed (missing path or rig mismatch).", err);
    return null;
  }
}

/** Loop {@link animations/RunFast.fbx} continuously; jump/throw one-shots fade run to 0 briefly. */
function syncCeezWalkRunLocomotionWeights() {
  if (!ceezRunAction) return;
  if (ceezWalkAction) {
    ceezWalkAction.setEffectiveWeight(0);
    ceezWalkAction.enabled = false;
  }
  const suppressRunForJump = isJumpOverObstaclesPoseActive();
  const playRun = !suppressRunForJump && isForwardLocomotionActive() && isRunSprintActive();
  ceezRunAction.enabled = true;
  ceezRunAction.setEffectiveWeight(playRun ? 1 : 0);
  if (playRun) {
    ceezRunAction.paused = false;
    if (!ceezRunAction.isRunning()) {
      ceezRunAction.reset().fadeIn(0.06).play();
    }
    ceezRunAction.timeScale = 1;
  }
}

/**
 * Load {@link CEEZ_WALKING_FBX} onto the same mixer as FastRun (Mixamo-style tracks on same rig).
 * @returns {Promise<THREE.AnimationAction | null>}
 */
async function tryBindWalkingLocomotion(mixer) {
  if (!mixer) return null;
  for (const url of CEEZ_WALKING_FBX_URLS) {
    try {
      const src = await loadFbx(url);
      const clips = collectAnimationClips(src, src.animations || []);
      const raw = pickWalkingClip(clips);
      if (!raw) {
        console.warn(`[Ceez Walk] No clip in ${url}`);
        continue;
      }
      const clip = animationClipWithoutRootPositionTracks(raw);
      const walkAction = mixer.clipAction(clip);
      walkAction.setLoop(THREE.LoopRepeat, Infinity);
      walkAction.clampWhenFinished = false;
      walkAction.enabled = true;
      walkAction.setEffectiveWeight(0);
      walkAction.play();
      console.info(`[Ceez Walk] bound "${raw.name || "(unnamed)"}" from ${url}`);
      return walkAction;
    } catch {
      // try next URL
    }
  }
  console.warn("[Ceez Walk] No Walking FBX could be loaded from:", CEEZ_WALKING_FBX_URLS.join(", "));
  return null;
}

function pickWalkingClip(clips) {
  if (!clips?.length) return null;
  const ok = (c) => !clipNameExcludedFromLocomotion(c.name);
  return (
    clips.find((c) => ok(c) && /walk/i.test(String(c.name || ""))) ||
    clips.find((c) => ok(c)) ||
    clips[0]
  );
}

/**
 * One-shot clip: disabled until played; on finish, restore looping run.
 * @param {THREE.AnimationMixer} mixer
 * @param {THREE.AnimationAction} runAction
 * @param {THREE.AnimationAction} oneShot
 */
function bindOneShotReturnsToRun(mixer, runAction, oneShot) {
  oneShot.setLoop(THREE.LoopOnce, 1);
  oneShot.clampWhenFinished = true;
  oneShot.enabled = false;
  oneShot.setEffectiveWeight(0);
  mixer.addEventListener("finished", (e) => {
    if (e.action !== oneShot) return;
    oneShot.timeScale = 1;
    oneShot.stop();
    oneShot.enabled = false;
    oneShot.setEffectiveWeight(0);
    syncCeezWalkRunLocomotionWeights();
  });
}

/**
 * FBX files sometimes store clips on nested nodes instead of root.animations.
 * Collect unique clips by name+duration from root and descendants.
 * @param {THREE.Object3D} root
 * @param {THREE.AnimationClip[]} base
 * @returns {THREE.AnimationClip[]}
 */
function collectAnimationClips(root, base = []) {
  const out = [];
  const seen = new Set();
  const pushClip = (clip) => {
    if (!clip) return;
    const key = `${clip.name || "unnamed"}:${Number(clip.duration || 0).toFixed(5)}:${clip.tracks?.length || 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clip);
  };
  base.forEach(pushClip);
  root.traverse((o) => {
    const clips = o?.animations;
    if (Array.isArray(clips)) clips.forEach(pushClip);
  });
  return out;
}

/**
 * Drop root-style `.position` tracks (Armature / Hips / pelvis) so gameplay position stays on the
 * physics body — Meshy runs often carry XY translation that reads as “climbing” or strafe drift.
 * @param {THREE.AnimationClip} clip
 * @returns {THREE.AnimationClip}
 */
function animationClipWithoutRootPositionTracks(clip) {
  if (!clip?.tracks?.length) return clip;
  const bonePathForPositionTrack = (trackName) => {
    const n = trackName || "";
    if (!n.endsWith(".position")) return null;
    return n.slice(0, n.length - ".position".length).toLowerCase();
  };
  const shouldDropRootPosition = (bonePath) => {
    if (!bonePath) return false;
    if (bonePath === "armature" || bonePath.endsWith(".armature")) return true;
    if (/\bhips\b/.test(bonePath) || /\bpelvis\b/.test(bonePath)) return true;
    return false;
  };
  const keep = clip.tracks.filter((tr) => {
    const bonePath = bonePathForPositionTrack(tr.name);
    return !shouldDropRootPosition(bonePath);
  });
  if (keep.length === clip.tracks.length) return clip;
  const blendMode = typeof clip.blendMode === "number" ? clip.blendMode : 2500;
  return new THREE.AnimationClip(clip.name, -1, keep, blendMode);
}

function finishCeezVisualRoot(root, opts = {}) {
  const { tuneMaterials = true } = opts;
  if (tuneMaterials) {
    fixCeezMaterials(root);
  }
  if (CEEZ_ENABLE_VERTEX_HOODIE_TINT) {
    tintHoodieVertexColors(root);
  }
  normalizeCeezMesh(root);
  root.rotation.order = "YXZ";
  root.rotation.y = CEEZ_MESH_RELATIVE_YAW;
  root.updateMatrixWorld(true);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0 || 1e-6)));
  return t * t * (3 - 2 * t);
}

/**
 * Restore hoodie redness by tinting upper-body vertex colors while keeping
 * jeans/shoes (lower vertices) largely untouched.
 */
function tintHoodieVertexColors(root) {
  const targetRed = new THREE.Color(0xb0161b);
  const targetArmDark = new THREE.Color(0x131012);
  const tmp = new THREE.Color();
  let touchedMeshes = 0;
  let tintedVertices = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry?.attributes?.position;
    const col = o.geometry?.attributes?.color;
    if (!pos || !col) return;
    touchedMeshes += 1;

    const box = new THREE.Box3().setFromBufferAttribute(pos);
    const minY = box.min.y;
    const maxY = box.max.y;
    const cx = (box.min.x + box.max.x) * 0.5;
    const cz = (box.min.z + box.max.z) * 0.5;
    const halfX = Math.max(1e-6, (box.max.x - box.min.x) * 0.5);
    const halfZ = Math.max(1e-6, (box.max.z - box.min.z) * 0.5);

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const yN = (y - minY) / Math.max(1e-6, maxY - minY);
      const torsoBand = smoothstep(0.34, 0.50, yN) * (1 - smoothstep(0.90, 0.98, yN));
      const xN = Math.abs((x - cx) / halfX);
      const zN = Math.abs((z - cz) / halfZ);
      const torsoCore = 1 - smoothstep(0.82, 1.18, Math.max(xN, zN));
      // Cover full hoodie (front/back/sides), but keep edges softly rolled off.
      let blend = Math.min(1, torsoBand * torsoCore * 0.96);
      if (blend <= 0.001) continue;

      tmp.fromBufferAttribute(col, i);

      // Sleeveless: darken the upper-arm regions (high |x| in upper Y band),
      // so the hoodie doesn't look like it has red sleeves.
      const upperBand = smoothstep(0.45, 0.57, yN) * (1 - smoothstep(0.86, 0.95, yN));
      const armMask = smoothstep(0.66, 0.86, xN) * (1 - smoothstep(1.02, 1.18, xN));
      const armBlend = Math.min(1, upperBand * armMask * 0.98);
      if (armBlend > 0.001) {
        tmp.lerp(targetArmDark, armBlend);
        // prevent sleeve darkening from being immediately re-overwritten by red
        blend *= 1 - armBlend * 0.92;
      }

      tmp.lerp(targetRed, blend);
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
      tintedVertices += 1;
    }
    col.needsUpdate = true;
  });
  if (touchedMeshes === 0) {
    console.warn("[Ceez Color] No vertex-color meshes found for hoodie tint.");
  } else {
    console.info(
      `[Ceez Color] hoodie tint touched ${touchedMeshes} mesh(es), ${tintedVertices} vertices.`
    );
  }
}

async function tuneEmbeddedFbxMaterials(root) {
  const fallbackTex = await getObjFallbackTexture();
  const hoodieTex = await getHoodiePatternTexture();
  let hoodieMapped = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const meshName = o.name || "";
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      const matName = m.name || "";
      const hoodieLike = isHoodieName(meshName, matName);
      if (fallbackTex && o.geometry?.attributes?.uv) {
        // Always apply known-good basecolor atlas so character never renders gray.
        m.map = fallbackTex;
        if (m.color?.setHex) m.color.setHex(0xffffff);
        m.needsUpdate = true;
      } else if (m.map) {
        m.map.colorSpace = THREE.SRGBColorSpace;
        m.map.needsUpdate = true;
      }
      if (hoodieLike && hoodieTex && o.geometry?.attributes?.uv) {
        m.map = hoodieTex;
        if ("vertexColors" in m) m.vertexColors = false;
        // Punch through ACES tone-map wash: strong red albedo multiply + emissive fill.
        if (m.color?.setRGB) m.color.setRGB(1.48 * CEEZ_COLOR_PUNCH, 0.24 * CEEZ_COLOR_PUNCH, 0.26 * CEEZ_COLOR_PUNCH);
        if ("roughness" in m && typeof m.roughness === "number") m.roughness = 0.35;
        if ("metalness" in m && typeof m.metalness === "number") m.metalness = 0.0;
        if ("envMapIntensity" in m && typeof m.envMapIntensity === "number") m.envMapIntensity = 0.085;
        if ("emissive" in m && m.emissive?.setHex) m.emissive.setHex(0xff1424);
        if ("emissiveIntensity" in m && typeof m.emissiveIntensity === "number") {
          m.emissiveIntensity = 0.62 * CEEZ_COLOR_PUNCH;
        }
        /** Slight red-tinted specular so key light punches the hoodie vs flat gray bounce. */
        if ("specularIntensity" in m && typeof m.specularIntensity === "number") {
          m.specularIntensity = 0.28;
        }
        if ("specularColor" in m && m.specularColor?.setHex) {
          m.specularColor.setHex(0xff5c55);
        }
        hoodieMapped += 1;
      }
      if (!hoodieLike && m.color?.isColor) {
        const hsl = {};
        m.color.getHSL(hsl);
        m.color.setHSL(hsl.h, Math.min(1, hsl.s * CEEZ_SATURATION_BOOST), hsl.l);
      }
      if (!hoodieLike && "roughness" in m && typeof m.roughness === "number") {
        m.roughness = Math.min(0.92, Math.max(0.55, m.roughness));
      }
      if (!hoodieLike && "metalness" in m && typeof m.metalness === "number") {
        m.metalness = Math.min(0.22, Math.max(0.0, m.metalness));
      }
      if ("side" in m) m.side = THREE.DoubleSide;
      if (m.color?.isColor) {
        boostMaterialSaturation(m, (hoodieLike ? 1.38 : 1.58) * CEEZ_COLOR_PUNCH);
      }
      m.needsUpdate = true;
    }
  });
  if (hoodieMapped > 0) {
    console.info(`[Ceez Hoodie] applied red cotton pattern on ${hoodieMapped} material(s).`);
  } else {
    console.warn("[Ceez Hoodie] no hoodie-specific materials matched; hoodie pattern not applied.");
  }
}

function hasRenderableMesh(root) {
  let hasMesh = false;
  root.traverse((o) => {
    if (hasMesh || !o?.isMesh) return;
    const g = o.geometry;
    const pos = g?.attributes?.position;
    if (pos && pos.count > 0) hasMesh = true;
  });
  return hasMesh;
}

function getObjFallbackTexture() {
  if (!ceezObjFallbackTexPromise) {
    ceezObjFallbackTexPromise = new THREE.TextureLoader()
      .loadAsync(CEEZ_OBJ_FALLBACK_TEX)
      .then((tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        return tex;
      })
      .catch((err) => {
        console.warn(`[Ceez OBJ] fallback texture failed: ${CEEZ_OBJ_FALLBACK_TEX}`, err);
        return null;
      });
  }
  return ceezObjFallbackTexPromise;
}

function getHoodiePatternTexture() {
  if (!ceezHoodiePatternTexPromise) {
    ceezHoodiePatternTexPromise = new THREE.TextureLoader()
      .loadAsync(CEEZ_HOODIE_PATTERN_TEX)
      .then((tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(1.45, 1.45);
        tex.needsUpdate = true;
        return tex;
      })
      .catch((err) => {
        console.warn(`[Ceez Hoodie] texture failed: ${CEEZ_HOODIE_PATTERN_TEX}`, err);
        return null;
      });
  }
  return ceezHoodiePatternTexPromise;
}

function isHoodieName(meshName, matName) {
  // Intentionally strict so we never spill hoodie red onto pants/shoes/hat.
  return /hood|hoodie|sweatshirt|sweater|jacket|vest/i.test(
    `${meshName || ""} ${matName || ""}`
  );
}

async function applyObjFallbackTexture(root) {
  const tex = await getObjFallbackTexture();
  if (!tex) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (!m.map && o.geometry?.attributes?.uv) {
        m.map = tex;
      }
      if ("vertexColors" in m) m.vertexColors = false;
      if (m.color?.setHex) m.color.setHex(0xffffff);
      m.needsUpdate = true;
    }
  });
}

/**
 * @returns {{ root: THREE.Object3D; mixer: THREE.AnimationMixer; runAction: THREE.AnimationAction; throwAction: THREE.AnimationAction | null } | null}
 */
function attachRunAnimation(root, clips) {
  const raw = pickLocomotionClip(clips);
  if (!raw) return null;
  const clip = animationClipWithoutRootPositionTracks(raw);
  const mixer = new THREE.AnimationMixer(root);
  mixer.stopAllAction();
  const runAction = mixer.clipAction(clip);
  runAction.setLoop(THREE.LoopRepeat, Infinity);
  runAction.clampWhenFinished = false;
  runAction.enabled = true;
  runAction.setEffectiveWeight(1);
  runAction.play();

  console.info(
    `[Ceez Anim] locomotion: "${clip.name || "(unnamed)"}" (${clips.length} clip(s) on source)`
  );

  const throwClip = pickThrowAnimationClip(clips);
  const throwAction = throwClip ? mixer.clipAction(throwClip) : null;
  if (throwAction) bindOneShotReturnsToRun(mixer, runAction, throwAction);
  return { root, mixer, runAction, throwAction };
}

/**
 * Build actions from split clip sources (run FBX + optional throw FBX clips).
 * @param {THREE.Object3D} root
 * @param {THREE.AnimationClip[]} runClips
 * @param {THREE.AnimationClip[]} [throwClips]
 * @returns {{ root: THREE.Object3D; mixer: THREE.AnimationMixer; runAction: THREE.AnimationAction; throwAction: THREE.AnimationAction | null } | null}
 */
function attachSplitActions(root, runClips, throwClips = []) {
  const rawRun = pickLocomotionClip(runClips);
  if (!rawRun) return null;
  const runClip = animationClipWithoutRootPositionTracks(rawRun);
  const mixer = new THREE.AnimationMixer(root);
  mixer.stopAllAction();
  const runAction = mixer.clipAction(runClip);
  runAction.setLoop(THREE.LoopRepeat, Infinity);
  runAction.clampWhenFinished = false;
  runAction.enabled = true;
  runAction.setEffectiveWeight(1);
  runAction.play();

  console.info(
    `[Ceez Anim] split locomotion: "${runClip.name || "(unnamed)"}" (${runClips.length} clip(s) from run FBX)`
  );

  const throwClip = pickThrowAnimationClip(throwClips);
  const throwAction = throwClip ? mixer.clipAction(throwClip) : null;
  if (throwAction) bindOneShotReturnsToRun(mixer, runAction, throwAction);

  return { root, mixer, runAction, throwAction };
}

/**
 * Use FastRun.fbx (+ optional RunAndThrow.fbx) clips on an already-loaded skinned root
 * (e.g. Tripo mesh with no embedded locomotion).
 * @param {THREE.Object3D} root
 * @returns {Promise<{ root: THREE.Object3D; mixer: THREE.AnimationMixer; runAction: THREE.AnimationAction; throwAction: THREE.AnimationAction | null } | null>}
 */
async function tryBindFastRunAnimationsToRoot(root) {
  try {
    const runSrc = await loadFbx(CEEZ_RUN_ACTION_FBX);
    const runClips = collectAnimationClips(runSrc, runSrc.animations || []);
    if (!runClips.length) return null;
    let throwClips = [];
    try {
      const throwSrc = await loadFbx(CEEZ_THROW_ACTION_FBX);
      throwClips = collectAnimationClips(throwSrc, throwSrc.animations || []);
    } catch {
      // RunAndThrow.fbx optional
    }
    const anim = attachSplitActions(root, runClips, throwClips);
    if (!anim) return null;
    console.info("[Ceez] bound RunFast.fbx locomotion to existing skinned mesh.");
    return anim;
  } catch (err) {
    console.warn("[Ceez] tryBindFastRunAnimationsToRoot failed", err);
    return null;
  }
}

/**
 * Split pipeline: `animations/RunFast.fbx` (+ RunAndThrow.fbx, optional c1.fbx mesh).
 * @returns {Promise<{ root: THREE.Object3D; mixer: THREE.AnimationMixer; runAction: THREE.AnimationAction; throwAction: THREE.AnimationAction | null } | null>}
 */
async function tryLoadCeezFromSplitFiles() {
  try {
    // Use animations/RunFast.fbx as the primary animated rig so tracks always match the mesh.
    const runSrc = await loadFbx(CEEZ_RUN_ACTION_FBX);
    const runClips = collectAnimationClips(runSrc, runSrc.animations || []);
    let throwClips = [];
    try {
      const throwSrc = await loadFbx(CEEZ_THROW_ACTION_FBX);
      throwClips = collectAnimationClips(throwSrc, throwSrc.animations || []);
    } catch {
      // RunAndThrow.fbx optional
    }
    const root = cloneSkinnedHierarchy(runSrc);
    root.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    await tuneEmbeddedFbxMaterials(root);
    finishCeezVisualRoot(root, { tuneMaterials: false });
    if (!hasRenderableMesh(root)) {
      // Fallback: use c1 base mesh if FastRun rig is animation-only.
      const baseSrc = await loadFbx(CEEZ_BASE_FBX);
      const baseRoot = cloneSkinnedHierarchy(baseSrc);
      baseRoot.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      await tuneEmbeddedFbxMaterials(baseRoot);
      finishCeezVisualRoot(baseRoot, { tuneMaterials: false });
      if (!hasRenderableMesh(baseRoot)) {
        console.warn(
          `[Ceez Split] neither FastRun nor c1 has renderable geometry (${CEEZ_RUN_ACTION_FBX}, ${CEEZ_BASE_FBX})`
        );
        return null;
      }
      console.info("[Ceez Split] using c1 base mesh with FastRun clips.");
      const anim = attachSplitActions(baseRoot, runClips, throwClips);
      if (!anim) return null;
      return anim;
    }

    console.info(
      `[Ceez Split] run clips: ${runClips.map((c) => c.name || "(unnamed)").join(", ")}`
    );
    console.info(
      `[Ceez Split] throw clips: ${throwClips.map((c) => c.name || "(unnamed)").join(", ") || "(none)"}`
    );

    const anim = attachSplitActions(root, runClips, throwClips);
    if (!anim) {
      console.warn("[Ceez Split] unable to bind run clip from RunFast.fbx");
      return null;
    }
    if (!pickRunAnimationClip(runClips) && runClips.length > 0) {
      console.warn(
        `[Ceez Split] no run-like name found; using first FastRun clip: ${
          runClips[0].name || "(unnamed)"
        }`
      );
    }
    console.info(
      `[Ceez Split] selected run: ${anim.runAction.getClip()?.name || "(unnamed)"} ; throw: ${
        anim.throwAction?.getClip?.()?.name || "(none)"
      }`
    );
    return anim;
  } catch (err) {
    console.warn("[Ceez Split] failed to load split mesh/actions", err);
    return null;
  }
}

/**
 * Load one Ceez FBX: animations if present, else static embedded mesh.
 * @returns {Promise<{ root: THREE.Object3D; mixer: THREE.AnimationMixer | null; runAction: THREE.AnimationAction | null } | null>}
 */
async function tryLoadCeezFromFbx(url) {
  try {
    const src = await loadFbx(url);
    const clips = collectAnimationClips(src, src.animations || []);
    const root = cloneSkinnedHierarchy(src);
    root.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    await tuneEmbeddedFbxMaterials(root);
    finishCeezVisualRoot(root, { tuneMaterials: false });
    if (!hasRenderableMesh(root)) {
      console.warn(`[Ceez FBX] ${url} loaded but has no renderable mesh; trying fallback source.`);
      return null;
    }
    if (clips.length > 0) {
      console.info(
        `[Ceez FBX] ${url} clips: ${clips.map((c) => c.name || "(unnamed)").join(", ")}`
      );
    } else {
      console.info(`[Ceez FBX] ${url} has no animation clips.`);
    }
    if (clips.length > 0) {
      const anim = attachRunAnimation(root, clips);
      if (anim) {
        console.info(`[Ceez FBX] selected run clip: ${anim.runAction.getClip()?.name || "(unnamed)"}`);
        return anim;
      }
      console.warn(
        `[Ceez FBX] no run-like clip found in ${url}. Clip names: ${clips
          .map((c) => c.name || "(unnamed)")
          .join(", ")}`
      );
    }
    return { root, mixer: null, runAction: null, throwAction: null };
  } catch (err) {
    console.warn(`[Ceez FBX] failed to load ${url}`, err);
    return null;
  }
}

/**
 * `Ceez_Meshy.fbx` mesh + {@link CEEZ_MESHY_RUNFAST_ANIM_FBX} run.
 * No mesh-embedded clips for locomotion. Applies {@link CEEZ_MESHY_CHARACTER_EXTRA_YAW}; keeps Meshy materials.
 */
async function tryLoadCeezFromMeshySingleFbx() {
  try {
    const charSrc = await loadFbx(CEEZ_MESHY_CHARACTER_FBX);
    const root = cloneSkinnedHierarchy(charSrc);
    root.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    finishCeezVisualRoot(root, { tuneMaterials: false });
    root.rotation.y += CEEZ_MESHY_CHARACTER_EXTRA_YAW;
    root.updateMatrixWorld(true);
    if (!hasRenderableMesh(root)) {
      console.warn(`[Ceez_Meshy] No drawable mesh in ${CEEZ_MESHY_CHARACTER_FBX}.`);
      return null;
    }

    const animSrc = await loadFbx(CEEZ_MESHY_RUNFAST_ANIM_FBX);
    const runClips = collectAnimationClips(animSrc, animSrc.animations || []);
    if (!runClips.length) {
      console.error(`[Ceez_Meshy] No clips in ${CEEZ_MESHY_RUNFAST_ANIM_FBX}.`);
      return null;
    }
    const allNames = runClips.map((c) => c.name || "(unnamed)").join(", ");
    const runClip =
      runClips.find((c) => /runfast|fast\s*run|run\s*fast/i.test(String(c?.name || ""))) ||
      runClips.find((c) => (c.tracks?.length || 0) > 0) ||
      runClips[0];
    const runOne = [animationClipWithoutRootPositionTracks(runClip)];

    const anim = attachSplitActions(root, runOne, []);
    if (!anim) return null;
    console.info(
      `[Ceez_Meshy] Mesh: ${CEEZ_MESHY_CHARACTER_FBX} | Run: ${CEEZ_MESHY_RUNFAST_ANIM_FBX} "${runClip.name || "(unnamed)"}" (clips: ${allNames})`
    );
    return anim;
  } catch (err) {
    console.warn("[Ceez_Meshy] Mesh + RunFast load failed (missing path or parse error).", err?.message || err);
    return null;
  }
}

async function tryLoadCeezAnimated() {
  const meshySingle = await tryLoadCeezFromMeshySingleFbx();
  if (meshySingle) return meshySingle;

  const split = await tryLoadCeezFromSplitFiles();
  if (split) return split;

  // Full character in one file: mesh + FastRun clip (when split pipeline is skipped).
  const fastRunStandalone = await tryLoadCeezFromFbx(CEEZ_RUN_ACTION_FBX);
  if (fastRunStandalone?.mixer && fastRunStandalone?.runAction) {
    console.info("[Ceez] using standalone RunFast.fbx for mesh + run cycle.");
    return fastRunStandalone;
  }

  const trip = await tryLoadCeezFromFbx(CEEZ_TRIPO_FBX);
  if (trip?.root) {
    if (trip.mixer && trip.runAction) return trip;
    const rebound = await tryBindFastRunAnimationsToRoot(trip.root);
    if (rebound) return rebound;
    return trip;
  }

  for (const url of CEEZ_GLTF_CANDIDATES) {
    try {
      const gltf = await loadGltf(url);
      const clips = gltf.animations || [];
      if (!gltf.scene || clips.length === 0) continue;
      const root = cloneSkinnedHierarchy(gltf.scene);
      root.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      finishCeezVisualRoot(root);
      const anim = attachRunAnimation(root, clips);
      if (anim) return anim;
    } catch {
      // File missing or parse error — try next candidate.
    }
  }
  for (const url of CEEZ_FBX_CANDIDATES) {
    const r = await tryLoadCeezFromFbx(url);
    if (r) return r;
  }
  return null;
}

/**
 * Loads Ceez from OBJ+MTL (no skeletal animation). Cached clone.
 * @returns {Promise<THREE.Object3D>}
 */
async function loadCeezFromObj() {
  if (ceezObjTemplate?.userData?.loaderRev === CEEZ_LOADER_REV) {
    return ceezObjTemplate.clone(true);
  }
  ceezObjTemplate = null;
  for (const src of CEEZ_OBJ_CANDIDATES) {
    try {
      if (src.mtl) {
        mtlLoader.setPath(src.dir);
        const materials = await mtlLoader.loadAsync(src.mtl);
        materials.preload();
        objLoader.setMaterials(materials);
      } else {
        objLoader.setMaterials(null);
      }
      objLoader.setPath(src.dir);
      const obj = await objLoader.loadAsync(src.obj);
      let root = obj;
      if (!(obj instanceof THREE.Group)) {
        root = new THREE.Group();
        root.add(obj);
      }
      if (!src.mtl) {
        await applyObjFallbackTexture(root);
      }
      finishCeezVisualRoot(root);
      root.userData.loaderRev = CEEZ_LOADER_REV;
      ceezObjTemplate = root;
      console.info(`[Ceez OBJ] loaded ${src.dir}${src.obj}`);
      return ceezObjTemplate.clone(true);
    } catch {
      // Try next OBJ source.
    }
  }
  throw new Error(
    `Ceez OBJ unavailable. Tried: ${CEEZ_OBJ_CANDIDATES.map((s) => `${s.dir}${s.obj}`).join(", ")}`
  );
}

function readHighScore() {
  const next = Number(localStorage.getItem("sky_hustle_hi") || 0) || 0;
  const legacy = Number(localStorage.getItem("ceez_ray_hi") || 0) || 0;
  return Math.max(next, legacy);
}

function writeHighScore(v) {
  localStorage.setItem("sky_hustle_hi", String(Math.floor(v)));
}

const CONTROL_MODE_KEY = "sky_hustle_touch_layout";

function getControlMode() {
  const saved = localStorage.getItem(CONTROL_MODE_KEY);
  if (saved === "1h" || saved === "2h" || saved === "kb") return saved;
  return "kb";
}

/**
 * Forward locomotion clip(s) should play whenever possible (never idle bind pose on the run).
 * Jump one-shot still clears this inside {@link syncCeezWalkRunLocomotionWeights} via
 * {@link isJumpOverObstaclesPoseActive}. Level-end cinematic stops motion pose here.
 */
function isForwardLocomotionActive() {
  if (level1EndCinematicStarted) return false;
  return true;
}

/** Full-speed run clip ({@link CEEZ_RUN_ACTION_FBX}) whenever the level run is active. */
function isRunSprintActive() {
  if (level1VictoryFreeze || level1EndCinematicStarted) return false;
  if (state !== "playing" || runPaused) return false;
  return true;
}

function setControlMode(mode) {
  const next = mode === "2h" || mode === "kb" ? mode : "1h";
  localStorage.setItem(CONTROL_MODE_KEY, next);
  syncMenuControlButtons();
  applyTouchLayout();
}

function readPlayerName() {
  return (localStorage.getItem(PLAYER_NAME_KEY) || "").trim();
}

function writePlayerName(name) {
  const clean = String(name || "").trim().slice(0, 18);
  if (!clean) {
    localStorage.removeItem(PLAYER_NAME_KEY);
    return "";
  }
  localStorage.setItem(PLAYER_NAME_KEY, clean);
  return clean;
}

function readBooleanPref(key, defaultValue = true) {
  const raw = localStorage.getItem(key);
  if (raw == null) return defaultValue;
  return raw === "1";
}

function writeBooleanPref(key, value) {
  localStorage.setItem(key, value ? "1" : "0");
}

function isSoundOn() {
  return readBooleanPref(SOUND_ON_KEY, true);
}

function setSoundOn(value) {
  writeBooleanPref(SOUND_ON_KEY, value);
}

function isMusicOn() {
  return readBooleanPref(MUSIC_ON_KEY, true);
}

function ensureGameMusicElement() {
  if (gameMusicEl) return gameMusicEl;
  const a = new Audio(GAME_MUSIC_SRC);
  a.loop = true;
  a.preload = "auto";
  gameMusicEl = a;
  return gameMusicEl;
}

function stopGameMusic() {
  if (!gameMusicEl) return;
  gameMusicEl.pause();
  gameMusicEl.currentTime = 0;
}

/** Start/stop loop music from game state + Music setting (muted during level-end cinematic). */
function syncGameMusicWithSettings() {
  const a = ensureGameMusicElement();
  const shouldPlay =
    state === "playing" &&
    !runPaused &&
    !level1EndCinematicStarted &&
    isMusicOn();
  if (!shouldPlay) {
    a.pause();
    return;
  }
  a.play().catch((err) => {
    console.warn("[Music] playback failed (missing file or autoplay policy)", err);
  });
}

function setMusicOn(value) {
  writeBooleanPref(MUSIC_ON_KEY, value);
  syncGameMusicWithSettings();
}

function setToggleButtonState(onButton, offButton, isOn) {
  const active = "border-[#f0c14d]/70 bg-[#f0c14d]/20 text-[#f7d882]";
  const inactive = "border-white/18 bg-white/5 text-white/70";
  const allStateClasses = [...active.split(" "), ...inactive.split(" ")];
  if (onButton) {
    onButton.classList.remove(...allStateClasses);
    onButton.classList.add(...(isOn ? active : inactive).split(" "));
    onButton.setAttribute("aria-pressed", isOn ? "true" : "false");
  }
  if (offButton) {
    offButton.classList.remove(...allStateClasses);
    offButton.classList.add(...(!isOn ? active : inactive).split(" "));
    offButton.setAttribute("aria-pressed", !isOn ? "true" : "false");
  }
}

function syncPrelevelSettingsUi() {
  const controlMode = getControlMode();
  if (settingMode1h) {
    settingMode1h.classList.remove(
      "border-[#f0c14d]/70",
      "bg-[#f0c14d]/20",
      "text-[#f7d882]",
      "border-white/18",
      "bg-white/5",
      "text-white/70"
    );
    settingMode1h.classList.add(
      ...(controlMode === "1h"
        ? ["border-[#f0c14d]/70", "bg-[#f0c14d]/20", "text-[#f7d882]"]
        : ["border-white/18", "bg-white/5", "text-white/70"])
    );
    settingMode1h.setAttribute("aria-pressed", controlMode === "1h" ? "true" : "false");
  }
  if (settingMode2h) {
    settingMode2h.classList.remove(
      "border-[#f0c14d]/70",
      "bg-[#f0c14d]/20",
      "text-[#f7d882]",
      "border-white/18",
      "bg-white/5",
      "text-white/70"
    );
    settingMode2h.classList.add(
      ...(controlMode === "2h"
        ? ["border-[#f0c14d]/70", "bg-[#f0c14d]/20", "text-[#f7d882]"]
        : ["border-white/18", "bg-white/5", "text-white/70"])
    );
    settingMode2h.setAttribute("aria-pressed", controlMode === "2h" ? "true" : "false");
  }
  if (settingModeKb) {
    settingModeKb.classList.remove(
      "border-[#f0c14d]/70",
      "bg-[#f0c14d]/20",
      "text-[#f7d882]",
      "border-white/18",
      "bg-white/5",
      "text-white/70"
    );
    settingModeKb.classList.add(
      ...(controlMode === "kb"
        ? ["border-[#f0c14d]/70", "bg-[#f0c14d]/20", "text-[#f7d882]"]
        : ["border-white/18", "bg-white/5", "text-white/70"])
    );
    settingModeKb.setAttribute("aria-pressed", controlMode === "kb" ? "true" : "false");
  }
  setToggleButtonState(settingSoundOn, settingSoundOff, isSoundOn());
  setToggleButtonState(settingMusicOn, settingMusicOff, isMusicOn());
}

function updatePrelevelSummary() {
  const mode = getControlMode();
  const modeLabel = mode === "2h" ? "2 Hand" : mode === "kb" ? "Keyboard" : "1 Hand";
  const soundLabel = isSoundOn() ? "On" : "Off";
  const musicLabel = isMusicOn() ? "On" : "Off";
  if (prelevelBestLine) {
    prelevelBestLine.textContent = `Best High Score: ${readHighScore()}`;
  }
  if (prelevelSettingsLine) {
    prelevelSettingsLine.textContent = `Controller: ${modeLabel} · Sound: ${soundLabel} · Music: ${musicLabel}`;
  }
}

function setPrelevelMeta(message) {
  if (!prelevelMeta) return;
  prelevelMeta.textContent = message || "";
}

function getWorldLoadingOverlayEl() {
  return document.getElementById("world-loading-overlay");
}

function showWorldLoadingOverlay() {
  const el = getWorldLoadingOverlayEl();
  if (!el) return;
  el.classList.remove("hidden");
  el.classList.add("flex");
  el.setAttribute("aria-busy", "true");
}

function hideWorldLoadingOverlay() {
  const el = getWorldLoadingOverlayEl();
  if (!el) return;
  el.classList.add("hidden");
  el.classList.remove("flex");
  el.setAttribute("aria-busy", "false");
}

function getPrelevelNameTrimmed() {
  return String(playerNameInput?.value || "").trim();
}

function syncEnterLevel1Button() {
  if (!btnEnterLevel1) return;
  // Never block start behind validation; we'll fill a fallback name in tryEnterLevelFromPrelevel.
  btnEnterLevel1.disabled = false;
  btnEnterLevel1.setAttribute("aria-disabled", "false");
}

async function tryEnterLevelFromPrelevel() {
  if (tryEnterLevelFromPrelevelInFlight) return;
  tryEnterLevelFromPrelevelInFlight = true;
  const typed = getPrelevelNameTrimmed();
  const saved = readPlayerName();
  const name = typed || saved || "Player";
  writePlayerName(name);
  if (playerNameInput && !typed) playerNameInput.value = name;
  showWorldLoadingOverlay();
  try {
    await ensureNeighbourhoodWorldLoaded();
    setPrelevelMeta("");
    await startGame();
  } catch (err) {
    console.error("[Sky Hustle] startGame failed from prelevel", err);
    setPrelevelMeta(`Start failed: ${err?.message || err}`);
  } finally {
    hideWorldLoadingOverlay();
    tryEnterLevelFromPrelevelInFlight = false;
  }
}

function showPreLevel() {
  if (!screenPreLevel) {
    startGame();
    return;
  }
  state = "staging";
  screenMenu?.classList.add("hidden");
  screenMenu?.classList.remove("flex");
  screenPreLevel.classList.remove("hidden");
  screenPreLevel.classList.add("flex");
  hud?.classList.add("hidden");
  touchLayer?.classList.add("hidden");

  const savedName = readPlayerName();
  if (playerNameInput) {
    playerNameInput.value = savedName;
    if (typeof playerNameInput.focus === "function") playerNameInput.focus();
  }
  syncEnterLevel1Button();

  prelevelSettingsModal?.classList.add("hidden");
  prelevelSettingsModal?.classList.remove("flex");
  updatePrelevelSummary();
  setPrelevelMeta("");
  syncPrelevelSettingsUi();
}

function syncMenuControlButtons() {
  const mode = getControlMode();
  const b1 = document.getElementById("control-mode-1h");
  const b2 = document.getElementById("control-mode-2h");
  if (!b1 || !b2) return;
  const base =
    "touch-btn rounded-lg px-3 py-1 text-xs font-semibold transition";
  b1.className = `${base} ${
    mode === "1h"
      ? "bg-dusk-accent text-white shadow-lg"
      : "text-white/55 hover:text-white/90"
  }`;
  b2.className = `${base} ${
    mode === "2h"
      ? "bg-dusk-accent text-white shadow-lg"
      : "text-white/55 hover:text-white/90"
  }`;
  b1.setAttribute("aria-pressed", mode === "1h" ? "true" : "false");
  b2.setAttribute("aria-pressed", mode === "2h" ? "true" : "false");
}

function applyTouchLayout() {
  const mode = getControlMode();
  const p1 = document.getElementById("touch-panel-1h");
  const p2 = document.getElementById("touch-panel-2h");
  if (!p1 || !p2) return;
  if (mode === "kb") {
    p1.classList.add("hidden");
    p2.classList.add("hidden");
    return;
  }
  if (mode === "1h") {
    p1.classList.remove("hidden");
    p2.classList.add("hidden");
  } else {
    p1.classList.add("hidden");
    p2.classList.remove("hidden");
  }
}

function syncGamePausePanelUi() {
  setToggleButtonState(gamePauseSoundOn, gamePauseSoundOff, isSoundOn());
  setToggleButtonState(gamePauseMusicOn, gamePauseMusicOff, isMusicOn());
  const mode = getControlMode();
  const base =
    "touch-btn rounded-lg px-1.5 py-2 text-[10px] font-semibold uppercase tracking-[0.06em] transition";
  const active = "border-[#f0c14d]/70 bg-[#f0c14d]/20 text-[#f7d882]";
  const inactive = "border-white/18 bg-white/5 text-white/70";
  const applyModeBtn = (el, m) => {
    if (!el) return;
    const on = m === "kb" ? mode === "kb" : m === "2h" ? mode === "2h" : mode === "1h";
    el.className = `${base} ${on ? active : inactive}`;
    el.setAttribute("aria-pressed", on ? "true" : "false");
  };
  applyModeBtn(gamePauseMode1h, "1h");
  applyModeBtn(gamePauseMode2h, "2h");
  applyModeBtn(gamePauseModeKb, "kb");
}

function openGamePausePanel() {
  if (state !== "playing") return;
  if (level1VictoryFreeze || level1EndCinematicStarted) return;
  runPaused = true;
  resetKbSteeringState();
  playerBody.velocity.x = 0;
  playerBody.velocity.z = 0;
  gamePauseOverlay?.classList.remove("hidden");
  gamePauseOverlay?.setAttribute("aria-hidden", "false");
  syncGamePausePanelUi();
  syncGameMusicWithSettings();
}

function closeGamePausePanel() {
  runPaused = false;
  gamePauseOverlay?.classList.add("hidden");
  gamePauseOverlay?.setAttribute("aria-hidden", "true");
  if (state === "playing") canvas?.focus({ preventScroll: true });
  syncGameMusicWithSettings();
}

/** Restart the current run from the pause sheet (same as a fresh level 1 start, without leaving play). */
function tryAgainFromPause() {
  closeGamePausePanel();
  if (state !== "playing") return;
  resetRun();
  syncGameMusicWithSettings();
}

function updateHeartsDom() {
  if (!hudHearts) return;
  hudHearts.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const span = document.createElement("span");
    span.className = "text-lg";
    span.textContent = i < lives ? "♥" : "♡";
    span.style.color = i < lives ? "#e85d4c" : "rgba(255,255,255,0.25)";
    hudHearts.appendChild(span);
  }
}

function updateCamera() {
  if (!playerRoot) return;
  cameraSmoothedForward.lerp(lastRunForward, CAMERA_BEHIND_SMOOTH);
  if (cameraSmoothedForward.lengthSq() < 1e-8) {
    cameraSmoothedForward.copy(lastRunForward);
  } else {
    cameraSmoothedForward.normalize();
  }
  const p = playerRoot.position;
  const distBack = CAMERA_DIST_BACK;
  const camH = CAMERA_HEIGHT;
  const lookAhead = CAMERA_LOOK_AHEAD;
  const lookYOffset = CAMERA_LOOK_HEIGHT_OFFSET;
  _camBehind.copy(cameraSmoothedForward).multiplyScalar(-distBack);
  camera.position.set(p.x + _camBehind.x, p.y + camH, p.z + _camBehind.z);
  _camLook.copy(p).addScaledVector(cameraSmoothedForward, lookAhead);
  _camLook.y += lookYOffset;
  camera.lookAt(_camLook);
  syncRunEnvironmentLights();
}

function getSkyBackgroundFallbackTexture() {
  if (skyBackgroundFallbackTex) return skyBackgroundFallbackTex;
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#2a3a72");
  grad.addColorStop(0.28, "#6b4a9e");
  grad.addColorStop(0.5, "#c94d8a");
  grad.addColorStop(0.72, "#ff5a6e");
  grad.addColorStop(1, "#ff7a4a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  skyBackgroundFallbackTex = new THREE.CanvasTexture(canvas);
  skyBackgroundFallbackTex.colorSpace = THREE.SRGBColorSpace;
  skyBackgroundFallbackTex.needsUpdate = true;
  return skyBackgroundFallbackTex;
}

function getSunsetSkyBackgroundTexture() {
  return skyBackgroundImageTex || getSkyBackgroundFallbackTexture();
}

async function tryLoadSkyBackgroundOnce() {
  if (skyBackgroundImageTex) return;
  const loader = new THREE.TextureLoader();
  for (const url of [RUN_CITY_PHOTO_MAP, SKY_BACKGROUND_MAP]) {
    try {
      const t = await loader.loadAsync(url);
      t.colorSpace = THREE.SRGBColorSpace;
      t.mapping = THREE.UVMapping;
      skyBackgroundImageTex = t;
      applyRunSceneBackdrop();
      return;
    } catch (err) {
      console.warn("[Sky] Background image failed:", url, err);
    }
  }
}

/** Move run lights with the player so brick / street materials stay lit. */
function syncRunEnvironmentLights() {
  if (!playerRoot) return;
  const p = playerRoot.position;
  const F = cameraSmoothedForward.lengthSq() > 1e-8 ? cameraSmoothedForward : _runForward;
  if (runFacadeLight) {
    runFacadeLight.position.set(p.x - F.x * 10 + 8, p.y + 22, p.z - F.z * 10 + 14);
    runFacadeLight.target.position.set(p.x + F.x * 48, p.y + 6, p.z + F.z * 48);
    runFacadeLight.target.updateMatrixWorld();
  }
  if (runFillLight) {
    runFillLight.position.set(p.x + F.x * 6, p.y + 10, p.z + F.z * 6 - 16);
    runFillLight.target.position.set(p.x, p.y + 2, p.z);
    runFillLight.target.updateMatrixWorld();
  }
}

function initThree() {
  scene = new THREE.Scene();
  scene.background = getSunsetSkyBackgroundTexture();
  scene.fog = null;

  camera = new THREE.PerspectiveCamera(70, 1, 0.35, 20000);
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    logarithmicDepthBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(RUN_SCENE_BACKGROUND, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  /** Lower = less highlight wash on character albedo (was 1.42). */
  renderer.toneMappingExposure = 1.12;

  const hemi = new THREE.HemisphereLight(0xffd0b8, 0x5a5068, 0.72);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd0a8, 1.05);
  sun.position.set(-14, 18, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  sun.shadow.camera.left = -220;
  sun.shadow.camera.right = 220;
  sun.shadow.camera.top = 220;
  sun.shadow.camera.bottom = -220;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xfff0e0, 0.28);
  fill.position.set(10, 14, -7);
  scene.add(fill);

  const ambient = new THREE.AmbientLight(0xffe8f0, 0.3);
  scene.add(ambient);

  runFacadeLight = new THREE.DirectionalLight(0xfff4e8, 0.5);
  runFacadeLight.castShadow = false;
  scene.add(runFacadeLight);
  scene.add(runFacadeLight.target);

  runFillLight = new THREE.DirectionalLight(0xffc8a0, 0.22);
  runFillLight.castShadow = false;
  scene.add(runFillLight);
  scene.add(runFillLight.target);

  // Visible runway deck added in {@link ensureVisibleRunwayPlane}; physics tiles stay invisible.

  onResize();
  window.addEventListener("resize", onResize);
  const frame = document.getElementById("game-9-16");
  if (frame && typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => onResize()).observe(frame);
  }
  applyRunSceneBackdrop();
}

function onResize() {
  const frame = document.getElementById("game-9-16");
  let w = frame?.clientWidth ?? 0;
  let h = frame?.clientHeight ?? 0;
  if ((!w || !h) && frame) {
    const r = frame.getBoundingClientRect();
    w = r.width || window.innerWidth;
    h = r.height || window.innerHeight;
  }
  if (!w || !h) {
    w = window.innerWidth;
    h = window.innerHeight;
  }
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function initPhysics() {
  world = new CANNON.World();
  world.gravity.set(0, -32, 0);
  world.defaultContactMaterial.friction = 0.02;
  world.defaultContactMaterial.restitution = 0;

  const groundMat = new CANNON.Material("ground");
  groundPhysicsMaterial = groundMat;
  const playerMat = new CANNON.Material("player");
  const groundPlayer = new CANNON.ContactMaterial(groundMat, playerMat, {
    friction: 0.01,
    restitution: 0,
  });
  world.addContactMaterial(groundPlayer);

  const shape = new CANNON.Box(PLAYER_HALF.clone());
  playerBody = new CANNON.Body({
    mass: 78,
    shape,
    material: playerMat,
    linearDamping: 0.035,
    angularDamping: 1,
  });
  playerBody.fixedRotation = true;
  playerBody.position.set(LANES[laneIndex], RUNWAY_SURFACE_Y + PLAYER_HALF.y, 0);
  playerBody.userData = { type: "player" };
  world.addBody(playerBody);

  world.addEventListener("beginContact", onBeginContact);
}

function isGapSegment(baseZ) {
  // Delegated to rooftop gap system
  return isRooftopGap(baseZ);
}

function onBeginContact(event) {
  if (state !== "playing") return;
  if (passedFinishRibbon) return;
  const a = event.bodyA;
  const b = event.bodyB;
  const types = [a.userData?.type, b.userData?.type];
  if (!types.includes("player") || !types.includes("obstacle")) return;
  if (performance.now() < invincibleUntil) return;

  lives -= 1;
  updateHeartsDom();
  if (lives <= 0) {
    const score = Math.max(0, Math.floor(runDistanceTraveledM)) + coins * 100;
    showGameOverScreen(score);
    return;
  }
  invincibleUntil = performance.now() + INVINCIBLE_MS;
}

/** Run-and-throw clip when firing banana or seeds (layers briefly over run). */
function playCeezThrowAnim() {
  if (state !== "playing" || runPaused) return;
  if (!ceezThrowAction) return;
  if (ceezRunAction) {
    ceezRunAction.enabled = true;
    ceezRunAction.setEffectiveWeight(1);
    if (!ceezRunAction.isRunning()) ceezRunAction.play();
  }
  ceezThrowAction.reset();
  ceezThrowAction.enabled = true;
  ceezThrowAction.setEffectiveWeight(1);
  ceezThrowAction.play();
}

/** True while the Space jump one-shot is actively playing — run stays off so legs/arms use the jump clip only. */
function isJumpOverObstaclesPoseActive() {
  const a = ceezJumpOverObstaclesAction;
  return Boolean(a?.enabled && a.isRunning());
}

function isPlayerGroundedForSpaceJump() {
  if (!playerBody) return false;
  const feetY = playerBody.position.y - PLAYER_HALF.y;
  const surf = getActiveRunSurfaceY();
  return (
    feetY <= surf + SPACE_JUMP_GROUND_EPS &&
    playerBody.velocity.y <= SPACE_JUMP_MAX_UPWARD_VY
  );
}

/** JumpOverObstacles.fbx + vertical hop on Space (grounded only; one-shot, then run resumes). */
function playJumpOverObstaclesAnim() {
  if (state !== "playing" || runPaused) return;
  if (level1VictoryFreeze || level1EndCinematicStarted) return;
  if (!playerBody || !isPlayerGroundedForSpaceJump()) return;
  if (!ceezJumpOverObstaclesAction) {
    playerBody.velocity.y = Math.max(playerBody.velocity.y, SPACE_JUMP_VY);
    return;
  }

  if (ceezRunAction) {
    ceezRunAction.enabled = true;
    ceezRunAction.setEffectiveWeight(0);
    if (!ceezRunAction.isRunning()) ceezRunAction.play();
  }
  if (ceezWalkAction) {
    ceezWalkAction.setEffectiveWeight(0);
  }

  ceezJumpOverObstaclesAction.reset();
  ceezJumpOverObstaclesAction.enabled = true;
  ceezJumpOverObstaclesAction.timeScale = JUMP_IN_AIR_TIME_SCALE;
  ceezJumpOverObstaclesAction.setEffectiveWeight(1);
  ceezJumpOverObstaclesAction.play();

  playerBody.velocity.y = Math.max(playerBody.velocity.y, SPACE_JUMP_VY);
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function stopLevel1EndStatAnim() {
  level1EndStatAnimToken += 1;
  if (level1EndStatRaf) {
    cancelAnimationFrame(level1EndStatRaf);
    level1EndStatRaf = 0;
  }
  for (const row of [level1EndRowTime, level1EndRowDist, level1EndRowScore]) {
    row?.classList.remove("level1-end-stat-row--tick");
  }
}

function resetLevel1EndStatsDom() {
  stopLevel1EndStatAnim();
  if (level1EndMessage) {
    level1EndMessage.textContent = "Finishing run…";
    level1EndMessage.classList.remove("hidden");
  }
  if (level1EndStatsEl) {
    level1EndStatsEl.classList.add("hidden");
  }
  if (level1EndStatTime) level1EndStatTime.textContent = "0.00 s";
  if (level1EndStatDist) level1EndStatDist.textContent = "0 m";
  if (level1EndStatScore) level1EndStatScore.textContent = "0";
}

function refreshLevel1EndTotalsText() {
  if (!level1EndStatTime || !level1EndStatDist || !level1EndStatScore) return;
  const timeSec = Math.max(0, (level1FinishedAtMs - runStartAtMs) / 1000);
  const dist = level1WinDist;
  const score = level1WinScore;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  stopLevel1EndStatAnim();
  const animToken = level1EndStatAnimToken;

  if (level1EndMessage) level1EndMessage.classList.add("hidden");
  if (level1EndStatsEl) level1EndStatsEl.classList.remove("hidden");

  if (reduced) {
    level1EndStatTime.textContent = `${timeSec.toFixed(2)} s`;
    level1EndStatDist.textContent = `${dist} m`;
    level1EndStatScore.textContent = String(score);
    return;
  }

  const DURATION_MS = 920;
  const stagger = [0, 240, 480];
  const start = performance.now();

  function tick(now) {
    if (animToken !== level1EndStatAnimToken) return;
    const elapsed = now - start;

    const tProg = Math.min(1, Math.max(0, (elapsed - stagger[0]) / DURATION_MS));
    const tEase = easeOutCubic(tProg);
    const timeShow = timeSec * tEase;
    level1EndStatTime.textContent = `${timeShow.toFixed(2)} s`;
    if (tProg >= 1 && level1EndRowTime && !level1EndRowTime.classList.contains("level1-end-stat-row--tick")) {
      level1EndRowTime.classList.add("level1-end-stat-row--tick");
    }

    const dProg = Math.min(1, Math.max(0, (elapsed - stagger[1]) / DURATION_MS));
    const dEase = easeOutCubic(dProg);
    level1EndStatDist.textContent = `${Math.round(dist * dEase)} m`;
    if (dProg >= 1 && level1EndRowDist && !level1EndRowDist.classList.contains("level1-end-stat-row--tick")) {
      level1EndRowDist.classList.add("level1-end-stat-row--tick");
    }

    const sProg = Math.min(1, Math.max(0, (elapsed - stagger[2]) / DURATION_MS));
    const sEase = easeOutCubic(sProg);
    level1EndStatScore.textContent = String(Math.round(score * sEase));
    if (sProg >= 1 && level1EndRowScore && !level1EndRowScore.classList.contains("level1-end-stat-row--tick")) {
      level1EndRowScore.classList.add("level1-end-stat-row--tick");
    }

    const done = elapsed >= DURATION_MS + stagger[2] + 40;
    if (done) {
      level1EndStatTime.textContent = `${timeSec.toFixed(2)} s`;
      level1EndStatDist.textContent = `${dist} m`;
      level1EndStatScore.textContent = String(score);
      level1EndStatRaf = 0;
      return;
    }
    level1EndStatRaf = requestAnimationFrame(tick);
  }

  level1EndStatTime.textContent = "0.00 s";
  level1EndStatDist.textContent = "0 m";
  level1EndStatScore.textContent = "0";
  level1EndStatRaf = requestAnimationFrame(tick);
}

function hideLevel1EndOverlay() {
  if (level1EndFinishTimer) {
    clearTimeout(level1EndFinishTimer);
    level1EndFinishTimer = 0;
  }
  resetLevel1EndStatsDom();
  if (!level1EndOverlay) return;
  level1EndOverlay.classList.remove("level1-end--revealed");
  level1EndOverlay.classList.add("hidden");
  level1EndOverlay.setAttribute("aria-hidden", "true");
  level1EndCinematicStarted = false;
  if (level1EndVideo) {
    level1EndVideo.pause();
    level1EndVideo.currentTime = 0;
    level1EndVideo.onended = null;
    level1EndVideo.classList.remove("hidden");
  }
}

/** After video ends (or no video), wait until minimum overlay time from reveal, then menu. */
function scheduleLevel1EndReturnToMenu() {
  if (level1EndFinishTimer) {
    clearTimeout(level1EndFinishTimer);
    level1EndFinishTimer = 0;
  }
  const elapsed = performance.now() - level1EndRevealStartedAtMs;
  const minDur = LEVEL1_END_VIDEO_ENABLED ? LEVEL1_END_MIN_DURATION_MS : LEVEL1_END_OVERLAY_MIN_MS_NO_VIDEO;
  const wait = Math.max(0, minDur - elapsed);
  level1EndFinishTimer = window.setTimeout(() => {
    level1EndFinishTimer = 0;
    hideLevel1EndOverlay();
    finishLevel1WinAfterVideo();
  }, wait);
}

/** Fullscreen end video (muted) + animated tint; call while airborne before final landing. */
function showLevel1EndOverlayBeginning() {
  if (!level1EndOverlay) return;
  if (!level1EndMessage || !level1EndStatsEl) return;
  if (level1EndFinishTimer) {
    clearTimeout(level1EndFinishTimer);
    level1EndFinishTimer = 0;
  }
  level1EndRevealStartedAtMs = performance.now();
  resetLevel1EndStatsDom();

  level1EndOverlay.classList.remove("hidden", "level1-end--revealed");
  level1EndOverlay.setAttribute("aria-hidden", "false");
  touchLayer?.classList.add("hidden");
  hud?.classList.add("hidden");
  void level1EndOverlay.offsetWidth;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      level1EndOverlay.classList.add("level1-end--revealed");
    });
  });

  if (LEVEL1_END_VIDEO_ENABLED && level1EndVideo) {
    level1EndVideo.classList.remove("hidden");
    level1EndVideo.muted = true;
    level1EndVideo.defaultMuted = true;
    level1EndVideo.volume = 0;
    level1EndVideo.src = LEVEL1_END_VIDEO_SRC;
    level1EndVideo.playsInline = true;
    level1EndVideo.setAttribute("playsinline", "");
    level1EndVideo.onended = () => {
      scheduleLevel1EndReturnToMenu();
    };
    level1EndVideo.play().catch((err) => {
      console.warn("[Level1] end video play failed", err);
      scheduleLevel1EndReturnToMenu();
    });
  } else {
    if (level1EndVideo) {
      level1EndVideo.pause();
      level1EndVideo.removeAttribute("src");
      level1EndVideo.load?.();
      level1EndVideo.classList.add("hidden");
    }
    scheduleLevel1EndReturnToMenu();
  }
}

function tryStartLevel1EndInAir() {
  if (!ENABLE_LEVEL_AUTO_END) return;
  if (level1EndCinematicStarted || level1VictoryFreeze) return;
  if (!passedFinishRibbon || !playerBody) return;
  const pz = playerBody.position.z;
  if (pz < LEVEL1_END_VIDEO_AIR_MIN_Z || pz > LEVEL1_END_VIDEO_AIR_MAX_Z) return;
  if (isPlayerGroundedForSpaceJump()) return;
  level1EndCinematicStarted = true;
  syncGameMusicWithSettings();
  showLevel1EndOverlayBeginning();
}

function beginLevel1VictoryFreezeAfterLand() {
  if (level1VictoryFreeze) return;
  level1VictoryFreeze = true;
  if (playerBody) {
    playerBody.velocity.x = 0;
    playerBody.velocity.z = 0;
  }
  closeGamePausePanel();
}

function passFinishRibbonIfNeeded() {
  if (!ENABLE_LEVEL_AUTO_END) return;
  if (passedFinishRibbon) return;
  if (runDistanceTraveledM >= FINISH_RIBBON_Z) passedFinishRibbon = true;
}

function tryCompleteLevel1AfterLanding() {
  if (!ENABLE_LEVEL_AUTO_END) return;
  if (level1VictoryFreeze) return;
  if (!passedFinishRibbon || !playerBody) return;
  if (playerBody.position.z < LEVEL1_LAND_COMPLETE_MIN_Z && runDistanceTraveledM < LEVEL1_LAND_COMPLETE_MIN_Z) return;
  if (!isPlayerGroundedForSpaceJump()) return;
  if (!level1EndCinematicStarted) {
    level1EndCinematicStarted = true;
    syncGameMusicWithSettings();
    showLevel1EndOverlayBeginning();
  }
  level1FinishedAtMs = performance.now();
  level1WinDist = Math.max(0, Math.floor(runDistanceTraveledM));
  level1WinScore = level1WinDist;
  refreshLevel1EndTotalsText();
  beginLevel1VictoryFreezeAfterLand();
}

function disposeProjectileResources(pr) {
  if (pr.kind === "seed") {
    pr.mesh.geometry?.dispose();
    const m = pr.mesh.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m?.dispose();
    return;
  }
  pr.mesh.traverse((c) => {
    if (c.isMesh) {
      c.geometry?.dispose();
      const m = c.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    }
  });
}

function clearProjectiles() {
  for (const pr of projectiles) {
    scene.remove(pr.mesh);
    disposeProjectileResources(pr);
  }
  projectiles.length = 0;
}

function throwBanana() {
  if (state !== "playing") return;
  const now = performance.now();
  if (now - lastBananaAt < ACTION_COOLDOWN_MS) return;
  if (!bananaTemplate) return;
  lastBananaAt = now;

  const mesh = bananaTemplate.clone(true);
  mesh.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = false;
    }
  });
  mesh.scale.setScalar(0.9);
  const p = playerBody.position;
  mesh.position.set(p.x + 0.22, p.y + 0.42, p.z + 0.9);
  mesh.rotation.set(0.25, 0.2, -0.15);
  scene.add(mesh);
  projectiles.push({
    mesh,
    vz: FORWARD_SPEED + 16,
    vy: 3.2,
    kind: "banana",
  });
  playCeezThrowAnim();
}

function fireSeeds() {
  if (state !== "playing") return;
  const now = performance.now();
  if (now - lastSeedsAt < ACTION_COOLDOWN_MS) return;
  if (!rayMesh || !playerRoot) return;
  lastSeedsAt = now;

  playerRoot.position.copy(playerBody.position);
  rayMesh.getWorldPosition(_rayWorld);

  for (let i = 0; i < SEED_BURST_COUNT; i++) {
    const seedGeo = new THREE.SphereGeometry(0.045, 6, 5);
    const seedMat = new THREE.MeshStandardMaterial({
      color: 0xd4b896,
      roughness: 0.88,
      metalness: 0.02,
    });
    const mesh = new THREE.Mesh(seedGeo, seedMat);
    mesh.castShadow = true;
    mesh.position.copy(_rayWorld);
    mesh.position.x += (rng() - 0.5) * 0.14;
    mesh.position.y += (rng() - 0.5) * 0.1;
    mesh.position.z += (rng() - 0.5) * 0.12;
    scene.add(mesh);
    projectiles.push({
      mesh,
      vz: FORWARD_SPEED + 9 + rng() * 10,
      vy: -0.8 + rng() * 2.2,
      kind: "seed",
    });
  }
  playCeezThrowAnim();
}

function updateProjectiles(dt) {
  const pz = playerBody.position.z;
  const g = 26;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.mesh.position.z += pr.vz * dt;
    pr.mesh.position.y += pr.vy * dt;
    pr.vy -= g * dt;
    pr.mesh.rotation.z += dt * (pr.kind === "banana" ? 7 : 12);
    pr.mesh.rotation.x += dt * (pr.kind === "banana" ? 5 : 3);
    const z = pr.mesh.position.z;
    const y = pr.mesh.position.y;

    // Check if projectile hit an obstacle — knock it flying off the rooftop
    let hitObstacle = false;
    for (let j = obstacles.length - 1; j >= 0; j--) {
      const obs = obstacles[j];
      const op = obs.body.position;
      const half = obs.body.shapes[0]?.halfExtents;
      if (!half) continue;
      const dx = Math.abs(pr.mesh.position.x - op.x);
      const dy = Math.abs(pr.mesh.position.y - op.y);
      const dz = Math.abs(pr.mesh.position.z - op.z);
      const hr = pr.kind === "banana" ? 0.6 : 0.4;
      if (dx < half.x + hr && dy < half.y + hr && dz < half.z + hr) {
        obs.body.type = CANNON.Body.DYNAMIC;
        obs.body.mass = 5;
        obs.body.updateMassProperties();
        obs.body.velocity.set((Math.random() - 0.5) * 4, 9 + Math.random() * 4, 14 + Math.random() * 6);
        obs.body.angularVelocity.set((Math.random()-0.5)*9, (Math.random()-0.5)*9, (Math.random()-0.5)*9);
        const dead = obstacles.splice(j, 1)[0];
        setTimeout(() => { scene.remove(dead.mesh); world.removeBody(dead.body); }, 900);
        hitObstacle = true;
        break;
      }
    }

    if (hitObstacle || z > pz + 95 || z < pz - 25 || y < RUNWAY_SURFACE_Y - 2) {
      scene.remove(pr.mesh);
      disposeProjectileResources(pr);
      projectiles.splice(i, 1);
    }
  }
}

/** Move one rooftop column toward on-screen **left** (A / ← / HUD left). */
function laneLeft() {
  laneIndex = Math.min(LANES.length - 1, laneIndex + 1);
}

/** Move one rooftop column toward on-screen **right** (D / → / HUD right). */
function laneRight() {
  laneIndex = Math.max(0, laneIndex - 1);
}

function syncWorldRunYawFromParts() {
  worldRunYaw = committedRunYaw + yawSteer;
}

function wrapAnglePi(ang) {
  const twoPi = Math.PI * 2;
  return ((((ang + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}

function resetKbSteeringState() {
  kbKeyZHeld = false;
}

function updateRunBasisVectors() {
  _runForward.set(Math.sin(worldRunYaw), 0, Math.cos(worldRunYaw));
  _runRight.set(Math.cos(worldRunYaw), 0, -Math.sin(worldRunYaw));
}

/**
 * After a 90° turn, pick runOrigin so the current lane offset still matches {@link LANES}[laneIndex]
 * without teleporting the player (uses forward before the yaw step).
 */
function reanchorRunOriginAfterTurn(prevForward) {
  const F = _runForward;
  const R = _runRight;
  const p = playerBody.position;
  const t = (p.x - runOrigin.x) * prevForward.x + (p.z - runOrigin.z) * prevForward.z;
  const L = LANES[laneIndex];
  runOrigin.set(p.x - F.x * t - R.x * L, 0, p.z - F.z * t - R.z * L);
}

/** Lane step only (HUD / non-KB). No 90° corner. */
function tryNavigateLaneOrTurnLeft() {
  laneLeft();
}

function tryNavigateLaneOrTurnRight() {
  laneRight();
}

/** Simple stand-in when `PLAYER_USE_GREY_PROXY`: grey capsule, feet at y=0, ~`CEEZ_TARGET_HEIGHT` tall. */
function buildGreyPlayerVisual() {
  const radius = 0.26;
  const cylLen = Math.max(0.05, CEEZ_TARGET_HEIGHT - 2 * radius);
  const geo = new THREE.CapsuleGeometry(radius, cylLen, 6, 12);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8c8c8c,
    roughness: 0.84,
    metalness: 0.08,
    envMapIntensity: 0.35,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.y = cylLen / 2 + radius;
  const root = new THREE.Group();
  root.add(mesh);
  return root;
}

async function buildPlayer() {
  disposeCeezAnimRuntime();

  playerRoot = new THREE.Group();
  let ceez;

  if (PLAYER_USE_GREY_PROXY) {
    ceez = buildGreyPlayerVisual();
    rayMesh = new THREE.Object3D();
    rayMesh.position.set(RAY_BASE_X, RAY_BASE_Y, 0);
  } else {
    let usePlaceholder = false;
    const animated = await tryLoadCeezAnimated();
    if (animated) {
      ceez = animated.root;
      ceezAnimMixer = animated.mixer;
      ceezRunAction = animated.runAction;
      ceezThrowAction = animated.throwAction || null;
      ceezJumpOverObstaclesAction = null;
      if (ceezAnimMixer && ceezRunAction) {
        ceezJumpOverObstaclesAction = await tryBindJumpOverObstaclesAction(ceezAnimMixer, ceezRunAction);
        ceezWalkAction = null;
        syncCeezWalkRunLocomotionWeights();
      }
    } else {
      try {
        ceez = await loadCeezFromObj();
        const rebound = await tryBindFastRunAnimationsToRoot(ceez);
        if (rebound) {
          ceezAnimMixer = rebound.mixer;
          ceezRunAction = rebound.runAction;
          ceezThrowAction = rebound.throwAction || null;
          if (ceezAnimMixer && ceezRunAction) {
            ceezJumpOverObstaclesAction = await tryBindJumpOverObstaclesAction(
              ceezAnimMixer,
              ceezRunAction
            );
          }
        }
      } catch (err) {
        console.warn("Ceez OBJ/MTL failed, trying placeholder GLTF.", err);
        usePlaceholder = true;
        try {
          const ceezGltf = await loadGltf(`${DIR_PLACEHOLDERS}ceez_placeholder.gltf`);
          ceez = ceezGltf.scene.clone(true);
        } catch (placeholderErr) {
          console.warn("Ceez placeholder GLTF failed; using grey proxy fallback.", placeholderErr);
          ceez = buildGreyPlayerVisual();
        }
      }
      if (!ceezRunAction && !usePlaceholder) {
        console.warn(
          `Ceez: no run clip — ensure ${CEEZ_RUN_ACTION_FBX} matches the rig (Meshy / split / GLTF).`
        );
      }
    }

    try {
      const rayGltf = await loadGltf(`${DIR_PLACEHOLDERS}ray_placeholder.gltf`);
      rayMesh = rayGltf.scene.clone(true);
      rayMesh.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
        }
      });
    } catch (err) {
      console.warn("Ray placeholder GLTF failed; using empty spawn anchor.", err);
      rayMesh = new THREE.Object3D();
    }
    if (usePlaceholder) {
      ceez.rotation.order = "YXZ";
      ceez.rotation.y = CEEZ_MESH_RELATIVE_YAW;
    }
    rayMesh.position.set(RAY_BASE_X, RAY_BASE_Y, 0);
    rayMesh.visible = RAY_VISIBLE;
  }

  ceez.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  playerRoot.add(ceez);
  playerRoot.add(rayMesh);

  scene.add(playerRoot);
}

/** Replaced by buildRooftopBuildingPool — kept as no-op for call-site compatibility. */
async function buildGroundTiles() {
  buildRooftopBuildingPool();
  buildSkylinePool();
}

/** No-op shim — rooftop buildings handle their own physics. */
function ensureNeighbourhoodWideGroundPhysics() {}

/** No-op shim — rooftop deck is built into each platform group. */
function ensureVisibleRunwayPlane() {}

/** No-op shim. */
function syncVisibleRunwayPlane() {}

/** Delegate to rooftop recycle system. */
function recycleGroundTiles() {
  recycleRooftopBuildings();
}



// ═══════════════════════════════════════════════════════════════════
//  ROOFTOP BUILDING SYSTEM — procedural, no external GLB required
// ═══════════════════════════════════════════════════════════════════

/** Dark gravel material for the rooftop surface the player runs on. */
function makeRooftopSurfaceMaterial() {
  return new THREE.MeshStandardMaterial({
    color: ROOFTOP_SURFACE_COLOR,
    roughness: 0.94,
    metalness: 0.04,
  });
}

/** Brick facade material — tall building sides. */
function makeFacadeMaterial(seed = 0) {
  const col = seed % 2 === 0 ? BUILDING_FACADE_A : BUILDING_FACADE_B;
  return new THREE.MeshStandardMaterial({
    color: col,
    roughness: 0.88,
    metalness: 0.05,
  });
}

/** Dark window strip material. */
function makeWindowMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x1a2a3a,
    roughness: 0.3,
    metalness: 0.6,
  });
}

/**
 * Build one rooftop building platform and return { group, body }.
 *  - A flat gravel rooftop (visual + physics collider exactly at RUNWAY_SURFACE_Y)
 *  - Tall brick facade below (visual only)
 *  - Window strips on the facade
 *  - Small rooftop ledge walls on left/right edges
 */
function buildRooftopPlatform(seed = 0) {
  const group = new THREE.Group();
  const W = BUILDING_WIDTH;
  const D = BUILDING_DEPTH;
  const fH = BUILDING_FACADE_HEIGHT;
  const roofThick = 0.28;

  // --- Gravel rooftop deck (visual) ---
  const roofGeo = new THREE.BoxGeometry(W, roofThick, D);
  const roofMat = makeRooftopSurfaceMaterial();
  const roofMesh = new THREE.Mesh(roofGeo, roofMat);
  // Top surface sits exactly at RUNWAY_SURFACE_Y
  roofMesh.position.y = RUNWAY_SURFACE_Y - roofThick * 0.5;
  roofMesh.receiveShadow = true;
  group.add(roofMesh);

  // --- Facade (tall box below the deck) ---
  const facadeGeo = new THREE.BoxGeometry(W, fH, D);
  const facadeMat = makeFacadeMaterial(seed);
  const facadeMesh = new THREE.Mesh(facadeGeo, facadeMat);
  facadeMesh.position.y = RUNWAY_SURFACE_Y - roofThick - fH * 0.5;
  facadeMesh.receiveShadow = true;
  facadeMesh.castShadow = true;
  group.add(facadeMesh);

  // --- Window strips (front + back faces) ---
  const winW = W * 0.72;
  const winH = fH * 0.28;
  const winD = 0.22;
  const winMat = makeWindowMaterial();
  const numWinRows = 3;
  for (let row = 0; row < numWinRows; row++) {
    const yOff = RUNWAY_SURFACE_Y - roofThick - fH * 0.18 - row * (fH * 0.26);
    const winGeo = new THREE.BoxGeometry(winW, winH, winD);
    // Front face
    const winFront = new THREE.Mesh(winGeo, winMat);
    winFront.position.set(0, yOff, D * 0.5 + 0.01);
    group.add(winFront);
    // Back face
    const winBack = new THREE.Mesh(winGeo.clone(), winMat);
    winBack.position.set(0, yOff, -D * 0.5 - 0.01);
    group.add(winBack);
  }

  // --- Low ledge walls on left and right edges (visual) ---
  const ledgeH = 0.45;
  const ledgeW = 0.22;
  const ledgeMat = new THREE.MeshStandardMaterial({ color: 0x555860, roughness: 0.9, metalness: 0.1 });
  for (const side of [-1, 1]) {
    const ledgeGeo = new THREE.BoxGeometry(ledgeW, ledgeH, D);
    const ledge = new THREE.Mesh(ledgeGeo, ledgeMat);
    ledge.position.set(side * (W * 0.5 + ledgeW * 0.5), RUNWAY_SURFACE_Y + ledgeH * 0.5, 0);
    ledge.castShadow = true;
    group.add(ledge);
  }

  // --- Physics body: one flat slab at the rooftop surface ---
  const body = new CANNON.Body({ mass: 0, material: groundPhysicsMaterial });
  body.addShape(new CANNON.Box(new CANNON.Vec3(W * 0.5, roofThick * 0.5, D * 0.5)));
  body.position.set(0, RUNWAY_SURFACE_Y - roofThick * 0.5, 0);
  body.userData = { type: "groundTile" };
  world.addBody(body);

  return { group, body };
}

/**
 * Build a decorative background skyline building (no physics, just visual depth).
 * Heights/widths are randomised per seed.
 */
function buildSkylineBuilding(seed) {
  const rng2 = mulberry32(seed * 7919 + 13);
  const W = 6 + rng2() * 10;
  const H = 28 + rng2() * 36;
  const D = 8 + rng2() * 12;
  const col = [0x4a3830, 0x3a4450, 0x504840, 0x384858][seed % 4];
  const geo = new THREE.BoxGeometry(W, H, D);
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.9, metalness: 0.08 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/** Place/replace the rooftop building pool in the scene. Called once on init. */
function buildRooftopBuildingPool() {
  // Clear any existing
  rooftopBuildings.forEach(({ group, body }) => {
    scene.remove(group);
    world.removeBody(body);
  });
  rooftopBuildings = [];

  for (let i = 0; i < BUILDING_POOL; i++) {
    const { group, body } = buildRooftopPlatform(i);
    scene.add(group);
    rooftopBuildings.push({ group, body, index: i });
  }
}

/** Place/replace the decorative skyline. Called once on init. */
function buildSkylinePool() {
  skylineBuildings.forEach(m => scene.remove(m));
  skylineBuildings = [];
  const count = 32;
  for (let i = 0; i < count; i++) {
    const mesh = buildSkylineBuilding(i);
    scene.add(mesh);
    skylineBuildings.push(mesh);
  }
}

/**
 * Recycle rooftop platforms around the player every frame.
 * Each platform covers BUILDING_DEPTH m, gap is BUILDING_GAP m.
 */
function recycleRooftopBuildings() {
  if (!playerBody || rooftopBuildings.length === 0) return;
  const pz = playerBody.position.z;

  // Spread buildings starting some tiles behind the player
  const firstTileZ = Math.floor((pz - BUILDING_CYCLE * 2) / BUILDING_CYCLE) * BUILDING_CYCLE;

  rooftopBuildings.forEach(({ group, body }, i) => {
    const centerZ = firstTileZ + i * BUILDING_CYCLE + BUILDING_DEPTH * 0.5;

    const roofThick = 0.28;
    group.position.set(0, 0, centerZ);
    body.position.set(0, RUNWAY_SURFACE_Y - roofThick * 0.5, centerZ);
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.wakeUp();
  });

  // Reposition skyline buildings in two parallel rows behind the run
  skylineBuildings.forEach((mesh, i) => {
    const half = Math.floor(skylineBuildings.length / 2);
    const side = i < half ? -1 : 1;
    const idx = i < half ? i : i - half;
    const zBase = Math.floor((pz - BUILDING_CYCLE * 3) / BUILDING_CYCLE) * BUILDING_CYCLE;
    const z = zBase + idx * BUILDING_CYCLE;
    const xOff = side * (BUILDING_WIDTH * 0.5 + SKYLINE_DEPTH * 0.5 + (Math.abs(Math.sin(i * 2.3)) * 8));
    const hOff = 8 + Math.abs(Math.sin(i * 1.7)) * 18;
    mesh.position.set(xOff, RUNWAY_SURFACE_Y - mesh.geometry.parameters.height * 0.5 + hOff, z);
  });
}

/**
 * Returns true if the world Z sits inside a building gap (no floor).
 * The gap is the BUILDING_GAP metres immediately after each platform.
 */
function isRooftopGap(worldZ) {
  if (!ENABLE_GAPS) return false;
  // Scripted level-1 end gap always wins
  const distFromLevelGap = Math.abs(worldZ - LEVEL1_GAP_TILE_CENTER_Z);
  if (distFromLevelGap < BUILDING_GAP * 0.5) return true;
  // Don't put procedural gaps past the finish ribbon
  if (worldZ >= FINISH_RIBBON_Z - BUILDING_CYCLE) return false;
  const posInCycle = ((worldZ % BUILDING_CYCLE) + BUILDING_CYCLE) % BUILDING_CYCLE;
  return posInCycle >= BUILDING_DEPTH;
}

function applyRunSceneBackdrop() {
  if (!scene || !renderer) return;
  scene.background = getSunsetSkyBackgroundTexture();
  scene.backgroundIntensity = 1.12;
  scene.fog = null;
  renderer.setClearColor(SUNSET_SKY_HORIZON, 1);
}

function restoreRooftopPresentation() {
  runSegment = "rooftop";
  if (world) world.gravity.set(0, -32, 0);
  applyRunSceneBackdrop();
}

function applyNeighbourhoodRunStartState() {
  runSegment = "rooftop";
  if (world) world.gravity.set(0, -32, 0);
  applyRunSceneBackdrop();
}

function getActiveRunSurfaceY() {
  return RUNWAY_SURFACE_Y;
}

async function buildNeighbourhoodWorld() {
  // Replaced by rooftop building pool — nothing async needed
}

async function ensureNeighbourhoodWorldLoaded() {
  // No-op: rooftop world is built synchronously in bootstrap
}

async function tryLoadNeighbourhoodSurfaceTexturesOnce() {
  await tryLoadSkyBackgroundOnce();
}


/** Gray shell with `tex` on +Z / −Z (along the track). */
function makeTexturedEndsBox(tex, w, h, d, sideColor = 0x8c9096) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, h / 2, 0);
  const side = new THREE.MeshStandardMaterial({
    color: sideColor,
    roughness: 0.91,
    metalness: 0.06,
  });
  const end = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.88,
    metalness: 0.05,
    color: 0xffffff,
  });
  const materials = [side, side, side, side, end.clone(), end.clone()];
  const root = new THREE.Mesh(geo, materials);
  root.castShadow = true;
  root.receiveShadow = true;
  return root;
}

function makeObstacleAcUnitTemplate(acMap, w = 1.18, h = 1.48, d = 1.08) {
  return makeTexturedEndsBox(acMap, w, h, d, 0x8c9096);
}

function pushObstacleVariant(template, w, h, d, opts = {}) {
  obstacleVariantSpecs.push({
    template,
    half: new CANNON.Vec3(w / 2, h / 2, d / 2),
    /** When set, obstacle is fixed at this world X (e.g. spans two lanes). */
    worldX: opts.worldX,
  });
}

/** Obstacle mesh origin Y in local runway strip space (tile group uses y=0). */
function getObstacleSurfaceY() {
  return 0;
}

async function loadTrashCanAtlasTextures() {
  const tl = new THREE.TextureLoader();
  const [map, bump, spec] = await Promise.all([
    tl.loadAsync(TRASHCAN_DIFFUSE),
    tl.loadAsync(TRASHCAN_BUMP),
    tl.loadAsync(TRASHCAN_SPEC),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.anisotropy = 4;
  bump.colorSpace = THREE.NoColorSpace;
  bump.wrapS = bump.wrapT = THREE.ClampToEdgeWrapping;
  bump.minFilter = THREE.LinearMipmapLinearFilter;
  spec.colorSpace = THREE.NoColorSpace;
  spec.wrapS = spec.wrapT = THREE.ClampToEdgeWrapping;
  spec.minFilter = THREE.LinearMipmapLinearFilter;
  return { map, bump, spec };
}

function remapCylinderSideUVsForAtlas(geometry, u0, u1, v0, v1) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(i, u0 + (u1 - u0) * u, v0 + (v1 - v0) * v);
  }
  uv.needsUpdate = true;
}

/** `CircleGeometry` in XY plane before mesh rotation; maps disk into atlas UV disk. */
function remapCirclePlaneUVs(geometry, centerU, centerV, uvRadius, modelRadius) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const invR = modelRadius > 1e-6 ? 1 / modelRadius : 1;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uv.setXY(i, centerU + x * invR * uvRadius, centerV + y * invR * uvRadius);
  }
  uv.needsUpdate = true;
}

/**
 * Corrugated body = upper atlas band; bottom-left / bottom-right circles = base + lid.
 * Origin: bottom center on ground (`y=0` rooftop or alley surface in world).
 */
function buildTrashCanGroup(atlas, scale = 1) {
  const R = 0.46 * scale;
  const H = 1.08 * scale;
  const uvDiskR = 0.11;
  /** Cool silver multiply on grayscale atlas — reads as galvanized steel. */
  const silverTint = new THREE.Color(0xc9d6e2);
  const mat = new THREE.MeshStandardMaterial({
    map: atlas.map,
    color: silverTint,
    bumpMap: atlas.bump,
    bumpScale: 0.065 * Math.sqrt(scale),
    roughnessMap: atlas.spec,
    roughness: 0.38,
    metalness: 0.78,
    envMapIntensity: 1.05,
    side: THREE.FrontSide,
  });
  const bodyGeo = new THREE.CylinderGeometry(R, R * 0.97, H, 36, 1, true);
  remapCylinderSideUVsForAtlas(bodyGeo, 0.03, 0.97, 0.52, 0.995);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = H * 0.5;

  const matCap = mat.clone();
  matCap.side = THREE.DoubleSide;
  const botGeo = new THREE.CircleGeometry(R * 0.98, 36);
  remapCirclePlaneUVs(botGeo, 0.22, 0.18, uvDiskR, R * 0.98);
  const bot = new THREE.Mesh(botGeo, matCap);
  bot.rotation.x = Math.PI / 2;
  bot.position.y = 0.004 * scale;

  const topGeo = new THREE.CircleGeometry(R * 0.96, 36);
  remapCirclePlaneUVs(topGeo, 0.78, 0.18, uvDiskR, R * 0.96);
  const top = new THREE.Mesh(topGeo, matCap.clone());
  top.rotation.x = -Math.PI / 2;
  top.position.y = H - 0.004 * scale;

  const g = new THREE.Group();
  g.name = "trashCanObstacle";
  g.add(body, bot, top);
  return g;
}

function appendTrashCanObstacleVariants(atlas) {
  for (const sc of [1, 0.86]) {
    const g = buildTrashCanGroup(atlas, sc);
    g.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    g.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(g);
    const center = bb.getCenter(new THREE.Vector3());
    g.position.sub(center);
    g.position.y -= bb.min.y;
    g.updateMatrixWorld(true);
    const bb2 = new THREE.Box3().setFromObject(g);
    const sz = bb2.getSize(new THREE.Vector3());
    const pad = 0.93;
    pushObstacleVariant(
      g,
      Math.max(0.8, sz.x * pad),
      Math.max(0.76, sz.y * pad),
      Math.max(0.8, sz.z * pad)
    );
  }
}

/** Append dumpster variant from loaded FBX (does not clear {@link obstacleVariantSpecs}). */
function appendDumpsterObstacleVariantSpecs(dumpsterSource) {
  if (!dumpsterSource) return;

  const template = dumpsterSource.clone(true);
  template.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  template.updateMatrixWorld(true);

  const rawBounds = new THREE.Box3().setFromObject(template);
  const rawSize = rawBounds.getSize(new THREE.Vector3());
  const sx = rawSize.x > 0 ? rawSize.x : 1;
  const sy = rawSize.y > 0 ? rawSize.y : 1;
  const sz = rawSize.z > 0 ? rawSize.z : 1;

  const targetW = 2.8;
  const targetH = 1.75;
  const targetD = 2.4;
  const scale = Math.min(targetW / sx, targetH / sy, targetD / sz);
  template.scale.setScalar(scale);
  template.updateMatrixWorld(true);

  const fitted = new THREE.Box3().setFromObject(template);
  const center = fitted.getCenter(new THREE.Vector3());
  template.position.x -= center.x;
  template.position.z -= center.z;
  template.position.y -= fitted.min.y;
  template.rotation.y = Math.PI;
  template.updateMatrixWorld(true);

  const finalBounds = new THREE.Box3().setFromObject(template);
  const finalSize = finalBounds.getSize(new THREE.Vector3());
  const minX = Math.max(1.1, finalSize.x * 0.9);
  const minY = Math.max(0.72, finalSize.y * 0.52);
  const minZ = Math.max(1.0, finalSize.z * 0.9);
  pushObstacleVariant(template, minX, minY, minZ);
}

function spawnObstacleAt(worldX, z) {
  if (obstacleVariantSpecs.length === 0) return;
  const spec = obstacleVariantSpecs[Math.floor(rng() * obstacleVariantSpecs.length)];
  const mesh = spec.template.clone(true);
  mesh.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  const resolvedX = spec.worldX !== undefined && spec.worldX !== null ? spec.worldX : worldX;
  const gy = getObstacleSurfaceY();
  mesh.position.set(resolvedX, gy, z);
  scene.add(mesh);

  const half = spec.half;
  const body = new CANNON.Body({ mass: 0 });
  body.addShape(new CANNON.Box(new CANNON.Vec3(half.x, half.y, half.z)));
  body.position.set(resolvedX, gy + half.y, z);
  body.userData = { type: "obstacle", mesh };
  world.addBody(body);

  obstacles.push({ mesh, body, z });
}

/** One obstacle centered in a single lane (small jitter stays inside lane width). */
function spawnObstacle(z, laneIdx) {
  const jitter = (rng() - 0.5) * 0.24;
  spawnObstacleAt(LANES[laneIdx] + jitter, z);
}

function spawnCoinTrail(startZ, laneIdx, count, opts = {}) {
  const spacing = opts.spacing ?? 3.3;
  const minY = opts.minY ?? 0.75;
  const maxY = opts.maxY ?? 1.1;
  const sparkleBoost = opts.sparkleBoost ?? 1;
  for (let i = 0; i < count; i++) {
    const z = startZ + i * spacing;
    let coin;
    const wave = Math.sin(i * 0.45) * 0.18;
    const mid = (minY + maxY) * 0.5;
    const amp = (maxY - minY) * 0.5;
    const baseY = mid + wave * (amp > 0 ? amp / 0.18 : 0);
    const sparklePhase = Math.random() * Math.PI * 2;
    const pulseRate = 2.4 + Math.random() * 1.8;
    const baseScale = 0.72 + Math.random() * 0.1;
    if (coinSpriteMaterial) {
      coin = new THREE.Sprite(coinSpriteMaterial);
      coin.scale.set(baseScale, baseScale, 1);
    } else {
      coin = coinTemplate.clone(true);
      coin.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
        }
      });
    }
    coin.position.set(LANES[laneIdx], baseY, z);
    scene.add(coin);
    coinObjects.push({
      mesh: coin,
      lane: laneIdx,
      z,
      baseY,
      sparklePhase,
      pulseRate: pulseRate * sparkleBoost,
      baseScale,
    });
  }
}

function updateCoinsVisual() {
  const t = performance.now() * 0.001;
  for (const c of coinObjects) {
    const twinkle = Math.sin(t * c.pulseRate + c.sparklePhase);
    c.mesh.position.y = c.baseY + twinkle * 0.06;
    if (c.mesh.isSprite) {
      const scale = c.baseScale * (1 + twinkle * 0.08);
      c.mesh.scale.set(scale, scale, 1);
    } else {
      c.mesh.rotation.y += 0.028;
      c.mesh.scale.setScalar(c.baseScale * (1 + twinkle * 0.06));
    }
  }
}

function spawnContentAhead() {
  const pz = playerBody.position.z;
  while (nextSpawnZ < pz + SPAWN_Z_AHEAD_MAX) {
    const laneIdx = Math.floor(rng() * LANES.length);
    if (
      OBSTACLES_ENABLED &&
      obstacleVariantSpecs.length > 0 &&
      obstacleSpawnIndex % OBSTACLE_BUILDING_INTERVAL === 0
    ) {
      spawnObstacle(nextSpawnZ, laneIdx);
    }
    if (COINS_ENABLED) {
      const groundTrail = 4 + Math.floor(rng() * 4);
      const groundLane = Math.floor(rng() * LANES.length);
      spawnCoinTrail(nextSpawnZ - 5 - groundTrail * 1.5, groundLane, groundTrail, {
        spacing: 3.1,
        minY: 0.78,
        maxY: 1.08,
        sparkleBoost: 0.9,
      });

      const airTrail = 3 + Math.floor(rng() * 3);
      const airLane = Math.floor(rng() * LANES.length);
      spawnCoinTrail(nextSpawnZ - 2.5 - airTrail * 1.35, airLane, airTrail, {
        spacing: 2.9,
        minY: 2.0,
        maxY: 2.55,
        sparkleBoost: 1.2,
      });
    }
    nextSpawnZ += BUILDING_CYCLE;
    obstacleSpawnIndex += 1;
  }
}

function cullBehind() {
  const pz = playerBody.position.z;
  const cullZ = pz - 22;
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    if (o.body.position.z < cullZ) {
      scene.remove(o.mesh);
      world.removeBody(o.body);
      obstacles.splice(i, 1);
    }
  }
  for (let i = coinObjects.length - 1; i >= 0; i--) {
    const c = coinObjects[i];
    if (c.mesh.position.z < cullZ) {
      scene.remove(c.mesh);
      coinObjects.splice(i, 1);
    }
  }
}

function checkCoinCollection() {
  const px = playerBody.position.x;
  const py = playerBody.position.y;
  const pz = playerBody.position.z;
  for (let i = coinObjects.length - 1; i >= 0; i--) {
    const c = coinObjects[i];
    const m = c.mesh.position;
    const dx = px - m.x;
    const dy = py - m.y;
    const dz = pz - m.z;
    if (dx * dx + dy * dy + dz * dz < 1.1) {
      scene.remove(c.mesh);
      coinObjects.splice(i, 1);
      coins += 1;
      hudCoins.textContent = String(coins);
    }
  }
}

function syncPlayerFacingFromVelocity(dt) {
  if (!playerRoot || !playerBody) return;
  const dti = typeof dt === "number" && dt > 0 ? Math.min(dt, 0.05) : 0.016;
  const kb = getControlMode() === "kb";
  if (kb && state === "playing" && !runPaused) {
    const vx = playerBody.velocity.x;
    const vz = playerBody.velocity.z;
    const sp2 = vx * vx + vz * vz;
    if (sp2 > 0.08 && isForwardLocomotionActive()) {
      _kbFacingHint.set(vx, 0, vz);
      _kbFacingHint.normalize();
      const u = 1 - Math.exp(-dti * KB_FACING_FROM_VEL_RATE);
      _kbFacingSm.lerp(_kbFacingHint, u);
    } else {
      const u = 1 - Math.exp(-dti * KB_FACING_SNAP_BACK_RATE);
      _kbFacingSm.lerp(_runForward, u);
    }
    _kbFacingSm.y = 0;
    if (_kbFacingSm.lengthSq() < 1e-6) _kbFacingSm.copy(_runForward);
    else _kbFacingSm.normalize();
    lastRunForward.copy(_kbFacingSm);
  } else {
    lastRunForward.copy(_runForward);
  }
  playerRoot.rotation.y =
    Math.atan2(lastRunForward.x, lastRunForward.z) + CEEZ_RUN_HEADING_Y_OFFSET;
}

function syncPlayerMesh(dt) {
  playerRoot.position.copy(playerBody.position);

  syncPlayerFacingFromVelocity(dt);

  const inActiveRun = state === "playing" && !runPaused;
  if (ceezAnimMixer && inActiveRun) {
    ceezAnimMixer.update(dt);
  }
  if (ceezAnimMixer && inActiveRun) {
    syncCeezWalkRunLocomotionWeights();
  }
  if (rayMesh) {
    rayMesh.position.x = RAY_BASE_X;
    rayMesh.position.z = 0;
    rayMesh.position.y = RAY_BASE_Y + Math.sin(performance.now() * 0.008) * 0.04;
  }
  const blink = performance.now() < invincibleUntil && Math.floor(performance.now() / 100) % 2 === 0;
  playerRoot.traverse((o) => {
    if (o.isMesh) o.visible = !blink;
  });
}

function resetRun() {
  rng = mulberry32((Math.random() * 0xffffffff) >>> 0);
  applyNeighbourhoodRunStartState();
  laneIndex = 1;
  committedRunYaw = 0;
  yawSteer = 0;
  resetKbSteeringState();
  syncWorldRunYawFromParts();
  runOrigin.set(0, 0, 0);
  updateRunBasisVectors();
  lastRunForward.copy(_runForward);
  _kbFacingSm.copy(_runForward);
  cameraSmoothedForward.copy(_runForward);
  runDistanceTraveledM = 0;
  coins = 0;
  lives = 3;
  invincibleUntil = 0;
  passedFinishRibbon = false;
  level1VictoryFreeze = false;
  level1FinishedAtMs = 0;
  hideLevel1EndOverlay();
  stopGameMusic();
  runStartAtMs = performance.now();

  obstacles.forEach((o) => {
    scene.remove(o.mesh);
    world.removeBody(o.body);
  });
  obstacles.length = 0;
  coinObjects.forEach((c) => scene.remove(c.mesh));
  coinObjects.length = 0;
  clearProjectiles();

  playerBody.velocity.set(0, 0, 0);
  playerBody.position.set(LANES[laneIndex], RUNWAY_SURFACE_Y + PLAYER_HALF.y, RUN_START_Z);
  nextSpawnZ = Math.floor((RUN_START_Z + SPAWN_Z_AHEAD_MIN) / BUILDING_CYCLE) * BUILDING_CYCLE;
  obstacleSpawnIndex = Math.max(0, Math.floor(nextSpawnZ / BUILDING_CYCLE) % OBSTACLE_BUILDING_INTERVAL);
  if (OBSTACLES_ENABLED && obstacleVariantSpecs.length > 0) {
    spawnObstacle(RUN_START_Z + 20, 1);
    obstacleSpawnIndex += 1;
  }
  hudCoins.textContent = "0";
  updateHeartsDom();
  if (rayMesh) {
    rayMesh.position.set(RAY_BASE_X, RAY_BASE_Y, 0);
    rayMesh.rotation.x = 0;
    rayMesh.rotation.z = 0;
  }
  recycleRooftopBuildings();
  playerBody?.wakeUp();
  syncCeezWalkRunLocomotionWeights();
}

async function startGame() {
  closeGamePausePanel();
  hideGameOverOverlay();
  state = "playing";
  screenMenu?.classList.add("hidden");
  screenMenu?.classList.remove("flex");
  screenPreLevel?.classList.add("hidden");
  screenPreLevel?.classList.remove("flex");
  hud?.classList.remove("hidden");
  document.getElementById("hud-coins-row")?.classList.toggle("hidden", !COINS_ENABLED);

  applyTouchLayout();
  if ("ontouchstart" in window && getControlMode() !== "kb") {
    touchLayer?.classList.remove("hidden");
  }

  resetRun();
  playerNameInput?.blur();
  canvas?.focus({ preventScroll: true });
  syncGameMusicWithSettings();
  syncCeezWalkRunLocomotionWeights();
}

/** Leave the run for the main menu; optionally beat the saved high score. */
function returnToMainMenuFromRun(bestCandidateScore) {
  if (state !== "playing" && state !== "gameOver") return;
  closeGamePausePanel();
  const hi = readHighScore();
  if (bestCandidateScore > hi) writeHighScore(bestCandidateScore);
  if (highScoreLine) {
    highScoreLine.textContent = `Best: ${readHighScore()}`;
    highScoreLine.classList.remove("hidden");
  }
  restoreRooftopPresentation();
  state = "menu";
  level1VictoryFreeze = false;
  passedFinishRibbon = false;
  level1FinishedAtMs = 0;
  clearProjectiles();
  stopGameMusic();
  hideGameOverOverlay();
  ceezRunAction?.fadeOut(0.15);
  ceezWalkAction?.fadeOut(0.15);
  ceezThrowAction?.fadeOut(0.15);
  ceezJumpOverObstaclesAction?.fadeOut(0.15);
  screenMenu?.classList.remove("hidden");
  screenMenu?.classList.add("flex");
  screenPreLevel?.classList.add("hidden");
  screenPreLevel?.classList.remove("flex");
  hud?.classList.add("hidden");
  touchLayer?.classList.add("hidden");
}

function hideGameOverOverlay() {
  gameOverOverlay?.classList.remove("flex", "pointer-events-auto");
  gameOverOverlay?.classList.add("hidden");
  gameOverOverlay?.classList.add("pointer-events-none");
  gameOverOverlay?.setAttribute("aria-hidden", "true");
}

/** Full-screen game over after three obstacle hits (or pit). Main menu updates best score. */
function showGameOverScreen(score) {
  lastGameOverScore = score;
  closeGamePausePanel();
  hideLevel1EndOverlay();
  stopGameMusic();
  hud?.classList.add("hidden");
  touchLayer?.classList.add("hidden");
  if (gameOverScoreLine) {
    const hi = readHighScore();
    const beat = score > hi;
    gameOverScoreLine.textContent = beat
      ? `Score ${score}\nNew best!`
      : `Score ${score}\nBest ${hi}`;
    gameOverScoreLine.style.whiteSpace = "pre-line";
  }
  gameOverOverlay?.classList.remove("hidden", "pointer-events-none");
  gameOverOverlay?.classList.add("flex", "pointer-events-auto");
  gameOverOverlay?.setAttribute("aria-hidden", "false");
  state = "gameOver";
}

/**
 * Put the player back on the runway at the current forward progress (keeps run / score).
 * @param {{ refillLives?: boolean }} [options]
 */
function respawnPlayerOnRunway(options) {
  const refillLives = options?.refillLives === true;
  if (!playerBody || state !== "playing") return;
  updateRunBasisVectors();
  const F = _runForward;
  const R = _runRight;
  const p = playerBody.position;
  let tAlong = (p.x - runOrigin.x) * F.x + (p.z - runOrigin.z) * F.z;
  if (ENABLE_GAPS) {
    for (let i = 0; i < 24; i++) {
      const cz = runOrigin.z + F.z * tAlong;
      if (!isRooftopGap(cz)) break;
      tAlong -= BUILDING_CYCLE * 0.5;
    }
  }
  const L = LANES[laneIndex];
  const safeX = runOrigin.x + F.x * tAlong + R.x * L;
  const safeZ = runOrigin.z + F.z * tAlong + R.z * L;
  const safeY = RUNWAY_SURFACE_Y + PLAYER_HALF.y;
  playerBody.position.set(safeX, safeY, safeZ);
  playerBody.velocity.set(0, 0, 0);
  playerBody.angularVelocity.set(0, 0, 0);
  invincibleUntil = performance.now() + INVINCIBLE_MS;
  if (refillLives) {
    lives = 3;
    updateHeartsDom();
  }
  updateRunBasisVectors();
  _kbFacingSm.copy(_runForward);
}

/** After level-1 end cinematic — return to main menu with best score updated. */
function finishLevel1WinAfterVideo() {
  returnToMainMenuFromRun(level1WinScore);
}

function updateHud(dt) {
  const dist = Math.max(0, Math.floor(runDistanceTraveledM));
  const score = dist + coins * 100;
  if (hudScore) hudScore.textContent = String(score);
  if (hudDistance) {
    const elapsedSecs = Math.max(0, (performance.now() - runStartAtMs) / 1000);
    if (level1VictoryFreeze) {
      hudDistance.textContent = `Level complete`;
    } else if (level1EndCinematicStarted) {
      hudDistance.textContent = `Finishing…`;
    } else if (passedFinishRibbon && ENABLE_LEVEL_AUTO_END) {
      hudDistance.textContent = `${elapsedSecs.toFixed(1)} s`;
    } else {
      hudDistance.textContent = `${dist} m · ${elapsedSecs.toFixed(1)} s`;
    }
  }
}

function stepPlaying(dt) {
  if (ENABLE_LEVEL_AUTO_END) {
    passFinishRibbonIfNeeded();
    tryStartLevel1EndInAir();
    tryCompleteLevel1AfterLanding();
  }

  syncWorldRunYawFromParts();
  updateRunBasisVectors();

  {
    const p = playerBody.position;
    const latTarget = LANES[laneIndex];
    const latErr = latTarget - p.x;
    const locomotion = isForwardLocomotionActive();
    const blocked = level1VictoryFreeze;
    const vF_mag = blocked || !locomotion ? 0 : FORWARD_SPEED;
    if (!blocked) {
      playerBody.wakeUp();
      playerBody.velocity.x = latErr * LANE_SMOOTH;
      playerBody.velocity.z = vF_mag;
      if (locomotion) runDistanceTraveledM += vF_mag * dt;
    } else {
      playerBody.velocity.x = 0;
      playerBody.velocity.z = 0;
    }
  }

  world.step(1 / 60, dt, 4);

  if (
    playerBody.position.y < -(BUILDING_FACADE_HEIGHT + 4) &&
    !level1VictoryFreeze &&
    !level1EndCinematicStarted
  ) {
    respawnPlayerOnRunway({ refillLives: false });
  }

  syncPlayerMesh(dt);
  updateProjectiles(dt);
  recycleGroundTiles();
  spawnContentAhead();
  cullBehind();
  if (COINS_ENABLED) {
    updateCoinsVisual();
    checkCoinCollection();
  }
  updateHud(dt);
  updateCamera();
}

function animate() {
  requestAnimationFrame(animate);
  try {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (state === "playing" && !runPaused) {
      stepPlaying(dt);
    } else if (state === "playing" && runPaused) {
      syncPlayerMesh(dt);
      syncVisibleRunwayPlane();
      updateCamera();
      updateHud(dt);
    } else if (playerRoot && playerBody) {
      playerRoot.position.copy(playerBody.position);
      syncPlayerFacingFromVelocity(dt);
      syncVisibleRunwayPlane();
      updateCamera();
    } else {
      syncRunEnvironmentLights();
    }
    renderer.render(scene, camera);
  } catch (err) {
    console.error("[Sky Hustle] frame error", err);
  }
}

function bindUi() {
  const goPreLevel = () => showPreLevel();
  btnStart?.addEventListener("click", goPreLevel);
  // Touch / iOS: same pattern as Enter Level 1 — pointerdown + preventDefault so the gesture reliably opens pre-level.
  btnStart?.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      goPreLevel();
    },
    { passive: false }
  );
  btnEnterLevel1?.addEventListener("click", () => {
    void tryEnterLevelFromPrelevel();
  });
  playerNameInput?.addEventListener("input", () => {
    if (getPrelevelNameTrimmed()) setPrelevelMeta("");
    syncEnterLevel1Button();
  });
  playerNameInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void tryEnterLevelFromPrelevel();
  });
  btnPrelevelHighScore?.addEventListener("click", () => {
    updatePrelevelSummary();
    setPrelevelMeta(`High Score: ${readHighScore()}`);
  });
  btnPrelevelHighScore?.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    updatePrelevelSummary();
    setPrelevelMeta(`High Score: ${readHighScore()}`);
  });
  btnPrelevelSettings?.addEventListener("click", () => {
    prelevelSettingsModal?.classList.remove("hidden");
    prelevelSettingsModal?.classList.add("flex");
    syncPrelevelSettingsUi();
  });
  btnPrelevelSettings?.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    prelevelSettingsModal?.classList.remove("hidden");
    prelevelSettingsModal?.classList.add("flex");
    syncPrelevelSettingsUi();
  });
  btnPrelevelSettingsClose?.addEventListener("click", () => {
    prelevelSettingsModal?.classList.add("hidden");
    prelevelSettingsModal?.classList.remove("flex");
  });
  prelevelSettingsBackdrop?.addEventListener("click", () => {
    prelevelSettingsModal?.classList.add("hidden");
    prelevelSettingsModal?.classList.remove("flex");
  });
  settingMode1h?.addEventListener("click", () => {
    setControlMode("1h");
    syncPrelevelSettingsUi();
    updatePrelevelSummary();
    setPrelevelMeta("Settings saved: Play mode set to 1 Hand.");
  });
  settingMode2h?.addEventListener("click", () => {
    setControlMode("2h");
    syncPrelevelSettingsUi();
    updatePrelevelSummary();
    setPrelevelMeta("Settings saved: Play mode set to 2 Hand.");
  });
  settingModeKb?.addEventListener("click", () => {
    setControlMode("kb");
    syncPrelevelSettingsUi();
    updatePrelevelSummary();
    setPrelevelMeta("Settings saved: Play mode set to Keyboard.");
  });
  settingSoundOn?.addEventListener("click", () => {
    setSoundOn(true);
    syncPrelevelSettingsUi();
    updatePrelevelSummary();
    setPrelevelMeta("Settings saved: Sound On.");
  });
  settingSoundOff?.addEventListener("click", () => {
    setSoundOn(false);
    syncPrelevelSettingsUi();
    updatePrelevelSummary();
    setPrelevelMeta("Settings saved: Sound Off.");
  });
  settingMusicOn?.addEventListener("click", () => {
    setMusicOn(true);
    syncPrelevelSettingsUi();
    updatePrelevelSummary();
    setPrelevelMeta("Settings saved: Music On.");
  });
  settingMusicOff?.addEventListener("click", () => {
    setMusicOn(false);
    syncPrelevelSettingsUi();
    updatePrelevelSummary();
    setPrelevelMeta("Settings saved: Music Off.");
  });

  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      fn();
    });
  };

  bind("btn-lane-left-1h", tryNavigateLaneOrTurnLeft);
  bind("btn-lane-right-1h", tryNavigateLaneOrTurnRight);
  bind("btn-banana-1h", throwBanana);
  bind("btn-seeds-1h", fireSeeds);

  bind("btn-lane-left-2h", tryNavigateLaneOrTurnLeft);
  bind("btn-lane-right-2h", tryNavigateLaneOrTurnRight);
  bind("btn-banana-2h", throwBanana);
  bind("btn-seeds-2h", fireSeeds);

  btnGameSettings?.addEventListener("click", (e) => {
    e.preventDefault();
    if (state !== "playing") return;
    if (runPaused) closeGamePausePanel();
    else openGamePausePanel();
  });
  btnGamePauseResume?.addEventListener("click", (e) => {
    e.preventDefault();
    closeGamePausePanel();
  });
  btnGamePauseTryAgain?.addEventListener("click", (e) => {
    e.preventDefault();
    tryAgainFromPause();
  });
  btnGameOverMenu?.addEventListener("click", (e) => {
    e.preventDefault();
    returnToMainMenuFromRun(lastGameOverScore);
  });
  gamePauseBackdrop?.addEventListener("click", () => closeGamePausePanel());
  gamePauseSoundOn?.addEventListener("click", () => {
    setSoundOn(true);
    syncGamePausePanelUi();
  });
  gamePauseSoundOff?.addEventListener("click", () => {
    setSoundOn(false);
    syncGamePausePanelUi();
  });
  gamePauseMusicOn?.addEventListener("click", () => {
    setMusicOn(true);
    syncGamePausePanelUi();
  });
  gamePauseMusicOff?.addEventListener("click", () => {
    setMusicOn(false);
    syncGamePausePanelUi();
  });
  gamePauseMode1h?.addEventListener("click", () => {
    setControlMode("1h");
    syncGamePausePanelUi();
    applyTouchLayout();
  });
  gamePauseMode2h?.addEventListener("click", () => {
    setControlMode("2h");
    syncGamePausePanelUi();
    applyTouchLayout();
  });
  gamePauseModeKb?.addEventListener("click", () => {
    setControlMode("kb");
    syncGamePausePanelUi();
    applyTouchLayout();
  });

  document.getElementById("control-mode-1h")?.addEventListener("click", () => {
    setControlMode("1h");
  });
  document.getElementById("control-mode-2h")?.addEventListener("click", () => {
    setControlMode("2h");
  });

  /** Capture phase so lane / throw keys reach the game when focus is odd. */
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.code === "Escape") {
        if (state === "playing" && (level1VictoryFreeze || level1EndCinematicStarted)) {
          e.preventDefault();
          return;
        }
        if (state === "playing" && runPaused) {
          e.preventDefault();
          closeGamePausePanel();
          return;
        }
        if (state === "playing" && !runPaused) {
          e.preventDefault();
          openGamePausePanel();
          return;
        }
      }
      if (state !== "playing" || runPaused) return;
      if (level1VictoryFreeze || level1EndCinematicStarted) return;
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        if (e.repeat) return;
        e.preventDefault();
        if (e.code === "ArrowLeft") tryNavigateLaneOrTurnLeft();
        else tryNavigateLaneOrTurnRight();
        return;
      }
      const kbKeys = getControlMode() === "kb";
      if (kbKeys) {
        if (e.code === "ArrowUp") {
          if (e.repeat) return;
          e.preventDefault();
          fireSeeds();
          return;
        }
        if (e.code === "ArrowDown") {
          if (e.repeat) return;
          e.preventDefault();
          throwBanana();
          return;
        }
        if (e.code === "KeyA") {
          if (e.repeat) return;
          e.preventDefault();
          tryNavigateLaneOrTurnLeft();
          return;
        }
        if (e.code === "KeyD") {
          if (e.repeat) return;
          e.preventDefault();
          tryNavigateLaneOrTurnRight();
          return;
        }
      } else {
        if (e.code === "KeyZ") {
          e.preventDefault();
          if (!e.repeat) kbKeyZHeld = true;
          return;
        }
        if (e.code === "KeyA" || e.code === "ArrowLeft" || e.code === "KeyQ") {
          if (e.repeat) return;
          e.preventDefault();
          tryNavigateLaneOrTurnLeft();
          return;
        }
        if (e.code === "KeyD" || e.code === "ArrowRight" || e.code === "KeyE") {
          if (e.repeat) return;
          e.preventDefault();
          tryNavigateLaneOrTurnRight();
          return;
        }
      }
      if (e.code === "Space" || e.key === " ") {
        if (e.repeat) return;
        e.preventDefault();
        playJumpOverObstaclesAnim();
        return;
      }
      if (!kbKeys && e.code === "ArrowDown") {
        if (e.repeat) return;
        e.preventDefault();
        throwBanana();
        return;
      }
      if (e.code === "KeyB") {
        if (e.repeat) return;
        e.preventDefault();
        throwBanana();
        return;
      }
      if (!kbKeys && e.code === "KeyN") {
        if (e.repeat) return;
        e.preventDefault();
        fireSeeds();
      }
    },
    true
  );
  window.addEventListener(
    "keyup",
    (e) => {
      if (e.code === "KeyZ") kbKeyZHeld = false;
    },
    true
  );
  window.addEventListener("blur", () => {
    resetKbSteeringState();
  });
}

async function bootstrap() {
  if (highScoreLine) highScoreLine.textContent = `Best: ${readHighScore()}`;
  syncMenuControlButtons();
  applyTouchLayout();
  initThree();
  initPhysics();
  await tryLoadSkyBackgroundOnce();
  bindUi();

  const bananaUrls = [`${DIR_ASSETS}placeholders/banana_projectile.gltf`, `${DIR_PLACEHOLDERS}banana_projectile.gltf`];
  let bananaGltf = null;
  for (const url of bananaUrls) {
    try {
      bananaGltf = await loadGltf(url);
      break;
    } catch (err) {
      console.warn("Banana projectile GLTF failed:", url, err);
    }
  }
  if (!bananaGltf) {
    console.warn("Banana projectile unavailable; banana throw disabled.");
  }
  bananaTemplate = bananaGltf?.scene ?? null;

  if (OBSTACLES_ENABLED) {
    obstacleVariantSpecs = [];
    try {
      const atl = await loadTrashCanAtlasTextures();
      appendTrashCanObstacleVariants(atl);
    } catch (err) {
      console.warn("Trash can atlas load failed; only dumpster obstacles may appear.", err);
    }

    let dumpsterFbx = null;
    let loadedPath = "";
    for (const candidate of DUMPSTER_FBX_CANDIDATES) {
      try {
        dumpsterFbx = await loadFbx(candidate);
        loadedPath = candidate;
        break;
      } catch {
        // Try next candidate.
      }
    }
    if (!dumpsterFbx) {
      console.warn(
        `Dumpster obstacle FBX unavailable. Tried: ${DUMPSTER_FBX_CANDIDATES.join(", ")}`
      );
    } else {
      console.info(`Loaded dumpster FBX from: ${loadedPath}`);
      appendDumpsterObstacleVariantSpecs(dumpsterFbx);
    }
    if (obstacleVariantSpecs.length === 0) {
      console.warn("No obstacle variants: trash atlas and dumpster FBX both unavailable.");
    }
  } else {
    obstacleVariantSpecs = [];
  }

  if (COINS_ENABLED) {
    const coinGltf = await loadGltf(`${DIR_PLACEHOLDERS}coin_collectible.gltf`);
    coinTemplate = coinGltf.scene;
    try {
      const coinTex = await new THREE.TextureLoader().loadAsync(
        `${DIR_UI}gold-coin-transparent.png`
      );
      coinTex.colorSpace = THREE.SRGBColorSpace;
      coinTex.minFilter = THREE.LinearMipmapLinearFilter;
      coinTex.magFilter = THREE.LinearFilter;
      coinSpriteMaterial = new THREE.SpriteMaterial({
        map: coinTex,
        transparent: true,
        alphaTest: 0.08,
        depthWrite: false,
        sizeAttenuation: true,
        color: new THREE.Color(0xfff4b8),
      });
    } catch (err) {
      console.warn("Coin image unavailable, using GLTF coin model.", err);
    }
  } else {
    coinTemplate = null;
    coinSpriteMaterial = null;
  }

  await buildPlayer();
  await buildGroundTiles();
  ensureVisibleRunwayPlane();
  restoreRooftopPresentation();

  playerRoot.position.copy(playerBody.position);
  updateCamera();
  updateHeartsDom();

  animate();
}

bootstrap().catch((err) => {
  console.error(err);
  const sub = document.getElementById("menu-subtitle");
  if (sub) sub.textContent = `Failed to load assets: ${err?.message || err}`;
});
