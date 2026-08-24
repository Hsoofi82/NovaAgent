/**
 * Nova game DESIGN INTENT layer.
 *
 * Why this exists: every generated game used to look the same. `wrapGameHtml`
 * hardcoded one shell (`--bg:#050816`, `--primary:#8b5cf6`, `--accent:#22d3ee`,
 * one radial+linear gradient, one border radius, one system font stack, the
 * literal hint "Touch / WASD / Keys"), the runtime's draw defaults hardcoded one
 * palette (`clear`→#07111f, `rect`→#7c3aed, `circle`→#22d3ee, `burst`→#38bdf8),
 * `playBeep` knew four bright chiptune effects, and the system prompt mandated a
 * single arcade template ("Must define 3 scenes: menu, play, gameover" + "high
 * score" + "Tap / Space to Restart"). A horror game, a medieval strategy game
 * and a candy puzzle all came out as the same purple/cyan neon arcade cabinet.
 *
 * This module turns the user's concept into an explicit, inspectable design
 * intent — genre, mood, setting, camera, palette, typography, chrome, motion,
 * audio character, scene shape — which then drives:
 *   1. the HTML shell (deterministic: colors/frame/typography/hint never depend
 *      on the model remembering to vary them),
 *   2. the runtime's draw + audio defaults (so an uncoloured `game.rect()` picks
 *      up the genre's shape colour instead of the old hardcoded purple),
 *   3. the system prompt (scene shape, presentation directives, palette tokens).
 *
 * Deliberately a pure lookup layer: no colour math, no dependencies, fully
 * deterministic and unit-testable. Detection is bilingual (Persian + English)
 * because the whole product is.
 */

export type GameGenre =
  | "horror" | "shooter" | "platformer" | "puzzle" | "strategy"
  | "racing" | "rpg" | "rhythm" | "sports" | "survival" | "arcade";

export type GameMood =
  | "dread" | "tense" | "energetic" | "playful" | "calm" | "gritty" | "epic";

export type GameSetting =
  | "noir" | "cyberpunk" | "space" | "medieval" | "nature" | "underwater"
  | "desert" | "candy" | "urban" | "retro" | "paper" | "minimal";

export type CameraStyle = "side" | "top-down" | "fixed" | "isometric" | "board" | "lane";

export type FrameStyle = "vignette" | "crt" | "clean" | "parchment" | "panel" | "arcade";

export type AudioCharacter = "chiptune" | "sub" | "industrial" | "soft" | "orchestral" | "lofi";

export interface GamePalette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  accent: string;
  danger: string;
  /** Canvas background — what `game.clear()` uses with no argument. */
  canvas: string;
  /** Canvas foreground text — what `game.text()` uses with no colour. */
  ink: string;
  /** Default `game.rect()` fill. */
  shapeA: string;
  /** Default `game.circle()` fill. */
  shapeB: string;
  /** Default `game.burst()` particle colour. */
  particle: string;
}

export interface GameTypography {
  /** Font stack for titles/HUD. System/local families only — no network fetch. */
  display: string;
  /** Font stack for body copy and canvas text. */
  body: string;
  weight: number;
  tracking: string;
  transform: "none" | "uppercase";
}

export interface GameChrome {
  frame: FrameStyle;
  /** Full CSS `background` value for the page behind the playfield. */
  backdrop: string;
  radius: string;
  border: string;
  shadow: string;
  /** Extra CSS painted over the canvas (scanlines, vignette, grain). May be "". */
  overlay: string;
  /** Where the in-game HUD belongs, stated for the model. */
  hud: string;
}

export interface GameMotion {
  /** Particle count multiplier hint for the model (1 = restrained, 3 = showy). */
  particleDensity: number;
  /** Scene-transition feel. */
  transition: string;
  /** Camera/impact feedback. */
  impact: string;
}

export interface GameDesignIntent {
  genre: GameGenre;
  mood: GameMood;
  setting: GameSetting;
  camera: CameraStyle;
  palette: GamePalette;
  typography: GameTypography;
  chrome: GameChrome;
  motion: GameMotion;
  audio: AudioCharacter;
  /** Scene names the generated game should define. Always starts with menu/play. */
  scenes: string[];
  /** One-line description of the core loop for this genre. */
  loop: string;
  /** Genre/mood specific presentation directives injected into the prompt. */
  presentation: string[];
  /** Localised control hint rendered in the shell header. */
  hint: { en: string; fa: string };
}

/* ── Detection tables ─────────────────────────────────────────────────────────
   Ordered by specificity: the first table entry wins a tie, so narrow genres
   (horror, rhythm) are listed before the catch-all arcade shapes.            */

const GENRE_PATTERNS: Array<[GameGenre, RegExp]> = [
  ["horror", /\b(horror|scary|creepy|haunted|zombie|nightmare|survival horror|dread|ghost|monster|eerie|slasher)\b|(ترسناک|وحشت|جن|روح|زامبی|کابوس|خوف|هراس|شبح)/i],
  ["rhythm", /\b(rhythm|music|beat|dance|tempo|osu|guitar|piano|drum|melody)\b|(ریتم|موسیقی|ضرب|رقص|آهنگ|نت)/i],
  ["racing", /\b(racing|race|drift|kart|rally|drive|driving|car|traffic|speedway|lap)\b|(مسابقه|رانندگی|ماشین|رالی|دریفت|سرعت|ترافیک)/i],
  ["strategy", /\b(strategy|tower defense|rts|4x|base building|resource|tactics|turn[- ]based|city builder|management)\b|(استراتژی|دفاع از برج|تاکتیک|نوبتی|مدیریت|منابع|شهرسازی)/i],
  ["rpg", /\b(rpg|role[- ]playing|dungeon|quest|adventure|loot|level up|inventory|fantasy|knight|wizard|dragon)\b|(نقش.?آفرینی|سیاه.?چال|ماجراجویی|شمشیر|جادوگر|اژدها|شوالیه|کوئست)/i],
  ["puzzle", /\b(puzzle|match[- ]?3|sudoku|2048|tetris|block|sokoban|jigsaw|logic|brain|minesweeper|memory|word)\b|(پازل|فکری|جدول|حافظه|منطق|مین|کلمه|چیدمان)/i],
  ["shooter", /\b(shooter|shoot|shmup|bullet|space invaders|galaga|gun|blast|turret|asteroid)\b|(تیراندازی|شوتر|گلوله|تفنگ|فضاپیما|شهاب|موشک)/i],
  ["sports", /\b(sports?|football|soccer|basketball|tennis|golf|pong|volleyball|boxing|penalty|goal)\b|(ورزش|فوتبال|بسکتبال|تنیس|گلف|والیبال|بوکس|پنالتی|گل)/i],
  ["survival", /\b(survival|crafting|hunger|forage|wilderness|island|escape|endless night|scavenge)\b|(بقا|زنده.?ماندن|جزیره|فرار|گرسنگی|بیابان.?گردی)/i],
  ["platformer", /\b(platformer|platform|jump|jumper|runner|mario|parkour|doodle|climb|flappy)\b|(پلتفرمر|پرش|دونده|بالا.?رفتن|سکو)/i],
];

const MOOD_PATTERNS: Array<[GameMood, RegExp]> = [
  ["dread", /\b(horror|scary|creepy|dread|grim|dark|sinister|haunted|nightmare|ominous)\b|(ترسناک|تاریک|دلهره|شوم|وحشت)/i],
  ["epic", /\b(epic|heroic|legendary|grand|saga|mythic|boss rush|kingdom|empire)\b|(حماسی|قهرمانانه|افسانه|امپراتوری|پادشاهی)/i],
  ["gritty", /\b(gritty|brutal|hardcore|dystopian|war|post[- ]apocalyptic|rust|industrial|noir)\b|(خشن|جنگ|آخرالزمان|صنعتی|بی.?رحم)/i],
  ["calm", /\b(calm|cozy|relaxing|zen|peaceful|meditative|slow|ambient|chill)\b|(آرام|دل.?نشین|ریلکس|مدیتیشن|آسوده)/i],
  ["playful", /\b(cute|playful|funny|silly|cartoon|candy|kids|cheerful|colorful|colourful|kawaii)\b|(بامزه|شاد|کارتونی|بچه|رنگی|خنده.?دار|فانتزی.?شاد)/i],
  ["energetic", /\b(fast|frantic|hyper|arcade|neon|rush|frenzy|action|intense speed)\b|(سریع|پرشور|هیجان|نئون|پرسرعت)/i],
  ["tense", /\b(tense|suspense|stealth|hunted|pressure|deadline|survival)\b|(پرتنش|تعلیق|مخفی|تحت.?فشار)/i],
];

const SETTING_PATTERNS: Array<[GameSetting, RegExp]> = [
  ["cyberpunk", /\b(cyberpunk|neon|synthwave|hacker|dystopian city|android|blade runner|vaporwave|matrix)\b|(سایبرپانک|نئون|هکر|اندروید|سایبری)/i],
  ["space", /\b(space|galaxy|galactic|cosmic|star|planet|asteroid|orbit|alien|nebula|sci[- ]?fi|spaceship)\b|(فضا|کهکشان|ستاره|سیاره|فضایی|بیگانه|سفینه)/i],
  ["medieval", /\b(medieval|castle|knight|kingdom|dragon|sword|dungeon|fantasy|wizard|elf|orc|tavern)\b|(قرون.?وسطا|قلعه|شوالیه|شمشیر|اژدها|جادوگر|پادشاهی|سیاه.?چال)/i],
  ["underwater", /\b(underwater|ocean|sea|fish|submarine|reef|diver|aquatic|deep sea)\b|(زیر.?آب|اقیانوس|دریا|ماهی|زیردریایی|غواص)/i],
  ["nature", /\b(forest|jungle|garden|farm|nature|tree|plant|animal|mountain|meadow|bee|mushroom)\b|(جنگل|باغ|مزرعه|طبیعت|درخت|گیاه|حیوان|کوه)/i],
  ["desert", /\b(desert|sand|dune|pyramid|oasis|egypt|mummy|canyon|wasteland)\b|(کویر|بیابان|شن|هرم|مصر|واحه|دره)/i],
  ["candy", /\b(candy|sweet|cake|donut|cookie|bubble|pastel|jelly|fruit|ice cream)\b|(شکلات|شیرینی|آب.?نبات|کیک|میوه|بستنی|پاستل)/i],
  ["noir", /\b(noir|detective|crime|mystery|shadow|smoke|1940s|gangster|asylum|hospital)\b|(کارآگاه|جنایی|معمایی|سایه|گانگستر|تیمارستان)/i],
  ["urban", /\b(city|street|urban|rooftop|subway|skate|graffiti|stadium|arena|traffic)\b|(شهر|خیابان|پشت.?بام|مترو|ورزشگاه|آسفالت)/i],
  ["retro", /\b(retro|8[- ]?bit|pixel|nes|gameboy|crt|arcade cabinet|vintage|old school|chiptune)\b|(رترو|هشت.?بیتی|پیکسلی|قدیمی|آرکید)/i],
  ["paper", /\b(board game|hex|paper|blueprint|map|chess|card|tabletop|notebook|sketch)\b|(تخته|کاغذ|نقشه|شطرنج|کارت|رومیزی|دفتر)/i],
  ["minimal", /\b(minimal|minimalist|abstract|geometric|monochrome|clean|flat|simple shapes)\b|(مینیمال|انتزاعی|هندسی|ساده|تک.?رنگ)/i],
];

/** Genre → setting when the concept names no setting of its own. */
const SETTING_FOR_GENRE: Record<GameGenre, GameSetting> = {
  horror: "noir",
  shooter: "space",
  platformer: "retro",
  puzzle: "minimal",
  strategy: "paper",
  racing: "urban",
  rpg: "medieval",
  rhythm: "cyberpunk",
  sports: "urban",
  survival: "nature",
  arcade: "retro",
};

/** Genre → mood when the concept names no mood of its own. */
const MOOD_FOR_GENRE: Record<GameGenre, GameMood> = {
  horror: "dread",
  shooter: "energetic",
  platformer: "playful",
  puzzle: "calm",
  strategy: "epic",
  racing: "energetic",
  rpg: "epic",
  rhythm: "energetic",
  sports: "energetic",
  survival: "tense",
  arcade: "playful",
};

const CAMERA_FOR_GENRE: Record<GameGenre, CameraStyle> = {
  horror: "top-down",
  shooter: "fixed",
  platformer: "side",
  puzzle: "board",
  strategy: "isometric",
  racing: "lane",
  rpg: "top-down",
  rhythm: "lane",
  sports: "fixed",
  survival: "top-down",
  arcade: "fixed",
};

/* ── Palettes ────────────────────────────────────────────────────────────────
   Twelve genuinely distinct colour stories, four of them LIGHT — the old shell
   was dark-only, which is most of why every game shared an atmosphere.       */

const PALETTES: Record<GameSetting, GamePalette> = {
  noir: {
    bg: "#08090b", surface: "#121417", surfaceAlt: "#1b1e22", text: "#e7e5e4",
    muted: "#8a8580", border: "rgba(231,229,228,.13)", primary: "#b91c1c",
    accent: "#d6d3d1", danger: "#7f1d1d", canvas: "#0a0b0d", ink: "#e7e5e4",
    shapeA: "#57534e", shapeB: "#991b1b", particle: "#dc2626",
  },
  cyberpunk: {
    bg: "#05010f", surface: "#140a2e", surfaceAlt: "#1e1145", text: "#f0f9ff",
    muted: "#a78bfa", border: "rgba(240,171,252,.28)", primary: "#f0abfc",
    accent: "#06b6d4", danger: "#fb7185", canvas: "#0a0420", ink: "#f0f9ff",
    shapeA: "#6d28d9", shapeB: "#06b6d4", particle: "#f0abfc",
  },
  space: {
    bg: "#02030a", surface: "#0b1026", surfaceAlt: "#141b3d", text: "#e2e8ff",
    muted: "#8fa3d9", border: "rgba(165,180,252,.22)", primary: "#60a5fa",
    accent: "#a5b4fc", danger: "#f87171", canvas: "#04061a", ink: "#e2e8ff",
    shapeA: "#3b82f6", shapeB: "#c7d2fe", particle: "#93c5fd",
  },
  medieval: {
    bg: "#1a1410", surface: "#2b2117", surfaceAlt: "#3a2c1e", text: "#f5ead6",
    muted: "#b9a685", border: "rgba(192,138,62,.35)", primary: "#c08a3e",
    accent: "#7f9d6b", danger: "#9b3a2f", canvas: "#221a13", ink: "#f5ead6",
    shapeA: "#8a6a3f", shapeB: "#c08a3e", particle: "#e8c88a",
  },
  nature: {
    bg: "#0d1f14", surface: "#16321f", surfaceAlt: "#1f452b", text: "#eefaf0",
    muted: "#9dc4a8", border: "rgba(52,211,153,.26)", primary: "#34d399",
    accent: "#fbbf24", danger: "#ef4444", canvas: "#102a19", ink: "#eefaf0",
    shapeA: "#4ade80", shapeB: "#fbbf24", particle: "#a7f3d0",
  },
  underwater: {
    bg: "#021826", surface: "#063445", surfaceAlt: "#0a4a60", text: "#e0f7ff",
    muted: "#7fc0d8", border: "rgba(34,211,238,.26)", primary: "#06b6d4",
    accent: "#a3e635", danger: "#fb7185", canvas: "#04222f", ink: "#e0f7ff",
    shapeA: "#0ea5e9", shapeB: "#a3e635", particle: "#bae6fd",
  },
  desert: {
    bg: "#2a1a0e", surface: "#3d2a17", surfaceAlt: "#523a20", text: "#fff4e0",
    muted: "#d0ab7d", border: "rgba(245,158,11,.3)", primary: "#f59e0b",
    accent: "#14b8a6", danger: "#dc2626", canvas: "#33200f", ink: "#fff4e0",
    shapeA: "#d97706", shapeB: "#fcd34d", particle: "#fde68a",
  },
  candy: {
    bg: "#fff1f7", surface: "#ffffff", surfaceAlt: "#ffe6f1", text: "#3b1d3a",
    muted: "#9d7a99", border: "rgba(236,72,153,.24)", primary: "#ec4899",
    accent: "#a855f7", danger: "#f43f5e", canvas: "#ffe6f1", ink: "#3b1d3a",
    shapeA: "#fb7185", shapeB: "#a78bfa", particle: "#fbbf24",
  },
  urban: {
    bg: "#0b0f14", surface: "#151c25", surfaceAlt: "#1e2836", text: "#f8fafc",
    muted: "#94a3b8", border: "rgba(248,250,252,.16)", primary: "#22c55e",
    accent: "#f8fafc", danger: "#ef4444", canvas: "#0e141b", ink: "#f8fafc",
    shapeA: "#64748b", shapeB: "#22c55e", particle: "#e2e8f0",
  },
  retro: {
    bg: "#16161d", surface: "#23233a", surfaceAlt: "#2f2f4d", text: "#fdf6e3",
    muted: "#b3a9c9", border: "rgba(255,204,0,.3)", primary: "#ffcc00",
    accent: "#ff4d6d", danger: "#ff4d6d", canvas: "#1b1b2a", ink: "#fdf6e3",
    shapeA: "#00e5a0", shapeB: "#ffcc00", particle: "#ff4d6d",
  },
  paper: {
    bg: "#ece5d8", surface: "#f7f2e7", surfaceAlt: "#e3dac7", text: "#2c2418",
    muted: "#7b6a53", border: "rgba(44,36,24,.22)", primary: "#1e5f74",
    accent: "#b4531f", danger: "#9b2c2c", canvas: "#e3dac7", ink: "#2c2418",
    shapeA: "#1e5f74", shapeB: "#b4531f", particle: "#7b6a53",
  },
  minimal: {
    bg: "#f6f6f4", surface: "#ffffff", surfaceAlt: "#ececea", text: "#18181b",
    muted: "#71717a", border: "rgba(24,24,27,.14)", primary: "#18181b",
    accent: "#f97316", danger: "#dc2626", canvas: "#ececea", ink: "#18181b",
    shapeA: "#18181b", shapeB: "#f97316", particle: "#a1a1aa",
  },
};

/** True when the setting's page background is light — the shell needs different
 *  shadows/overlays and the canvas needs dark ink. */
export function isLightSetting(setting: GameSetting): boolean {
  return setting === "candy" || setting === "paper" || setting === "minimal";
}

const SANS = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const SERIF = `"Iowan Old Style", Georgia, "Times New Roman", serif`;
const MONO = `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
const ROUNDED = `"Trebuchet MS", ui-rounded, "Segoe UI", system-ui, sans-serif`;

const TYPOGRAPHY: Record<GameSetting, GameTypography> = {
  noir: { display: SERIF, body: SERIF, weight: 600, tracking: ".18em", transform: "uppercase" },
  cyberpunk: { display: MONO, body: MONO, weight: 700, tracking: ".22em", transform: "uppercase" },
  space: { display: SANS, body: SANS, weight: 700, tracking: ".14em", transform: "uppercase" },
  medieval: { display: SERIF, body: SERIF, weight: 700, tracking: ".04em", transform: "none" },
  nature: { display: ROUNDED, body: SANS, weight: 700, tracking: ".02em", transform: "none" },
  underwater: { display: ROUNDED, body: SANS, weight: 600, tracking: ".08em", transform: "none" },
  desert: { display: SERIF, body: SANS, weight: 700, tracking: ".1em", transform: "uppercase" },
  candy: { display: ROUNDED, body: ROUNDED, weight: 800, tracking: "0", transform: "none" },
  urban: { display: SANS, body: SANS, weight: 800, tracking: ".06em", transform: "uppercase" },
  retro: { display: MONO, body: MONO, weight: 700, tracking: ".16em", transform: "uppercase" },
  paper: { display: SERIF, body: SERIF, weight: 700, tracking: ".01em", transform: "none" },
  minimal: { display: SANS, body: SANS, weight: 600, tracking: "-.01em", transform: "none" },
};

const FRAME_FOR_SETTING: Record<GameSetting, FrameStyle> = {
  noir: "vignette",
  cyberpunk: "panel",
  space: "panel",
  medieval: "parchment",
  nature: "arcade",
  underwater: "arcade",
  desert: "parchment",
  candy: "arcade",
  urban: "clean",
  retro: "crt",
  paper: "parchment",
  minimal: "clean",
};

/** Page backdrop per setting — the single most visible differentiator. */
function backdropFor(setting: GameSetting, p: GamePalette): string {
  switch (setting) {
    case "noir":
      return `radial-gradient(ellipse at 50% -10%, #1c1f24 0, transparent 55%), ${p.bg}`;
    case "cyberpunk":
      return `radial-gradient(circle at 12% 0, #3b0764 0, transparent 45%), radial-gradient(circle at 90% 100%, #083344 0, transparent 45%), linear-gradient(160deg, ${p.bg}, #0b0320)`;
    case "space":
      return `radial-gradient(circle at 70% 10%, #1e2a5a 0, transparent 50%), linear-gradient(180deg, ${p.bg}, #060a1c)`;
    case "medieval":
      return `radial-gradient(ellipse at 50% 0, #3a2c1e 0, transparent 60%), ${p.bg}`;
    case "nature":
      return `radial-gradient(circle at 20% 0, #1f452b 0, transparent 50%), linear-gradient(180deg, ${p.bg}, #08150d)`;
    case "underwater":
      return `linear-gradient(180deg, #0a4a60 0, ${p.bg} 70%)`;
    case "desert":
      return `linear-gradient(180deg, #6b4415 0, ${p.bg} 65%)`;
    case "candy":
      return `radial-gradient(circle at 15% 0, #ffe0ef 0, transparent 45%), radial-gradient(circle at 85% 100%, #eae0ff 0, transparent 45%), ${p.bg}`;
    case "urban":
      return `linear-gradient(180deg, #151c25 0, ${p.bg} 60%)`;
    case "retro":
      return `repeating-linear-gradient(180deg, rgba(255,255,255,.03) 0 2px, transparent 2px 4px), ${p.bg}`;
    case "paper":
      return `repeating-linear-gradient(90deg, rgba(44,36,24,.045) 0 1px, transparent 1px 22px), repeating-linear-gradient(0deg, rgba(44,36,24,.045) 0 1px, transparent 1px 22px), ${p.bg}`;
    case "minimal":
      return p.bg;
  }
}

/** CSS painted over the canvas. Empty string means "no overlay". */
function overlayFor(frame: FrameStyle, mood: GameMood): string {
  if (frame === "vignette") {
    return `radial-gradient(ellipse at 50% 50%, transparent 42%, rgba(0,0,0,.55) 100%)`;
  }
  if (frame === "crt") {
    return `repeating-linear-gradient(0deg, rgba(0,0,0,.22) 0 1px, transparent 1px 3px)`;
  }
  if (frame === "panel" && mood !== "calm") {
    return `linear-gradient(180deg, rgba(255,255,255,.05) 0, transparent 18%)`;
  }
  if (frame === "parchment") {
    return `radial-gradient(ellipse at 50% 50%, transparent 60%, rgba(60,45,25,.25) 100%)`;
  }
  return "";
}

const MOTION: Record<GameMood, GameMotion> = {
  dread: { particleDensity: 1, transition: "slow fade to black, no bounce", impact: "brief blackout and a low rumble, never a confetti burst" },
  tense: { particleDensity: 1, transition: "hard cut", impact: "short sharp screen shake, restrained particles" },
  energetic: { particleDensity: 3, transition: "fast slide with overshoot", impact: "screen shake plus a wide particle burst" },
  playful: { particleDensity: 3, transition: "springy pop", impact: "bouncy squash-and-stretch and colourful bursts" },
  calm: { particleDensity: 1, transition: "gentle crossfade", impact: "soft glow pulse, no shake" },
  gritty: { particleDensity: 2, transition: "abrupt cut with grain", impact: "heavy shake, sparse dark debris" },
  epic: { particleDensity: 2, transition: "deliberate wipe", impact: "slow zoom and a broad, weighty burst" },
};

const AUDIO_FOR_MOOD: Record<GameMood, AudioCharacter> = {
  dread: "sub",
  tense: "industrial",
  energetic: "chiptune",
  playful: "chiptune",
  calm: "soft",
  gritty: "industrial",
  epic: "orchestral",
};

/* ── Scene shape and loop per genre ───────────────────────────────────────────
   "menu" and "play" are mandatory everywhere: `isGameComplete` gates on
   `.scene("play")` and `game.start("menu")`, and the runtime boots from "menu".
   Everything after that varies, so a strategy game gets a briefing and a
   results table instead of an arcade "GAME OVER — tap to restart" card.      */

const SCENES_FOR_GENRE: Record<GameGenre, string[]> = {
  horror: ["menu", "play", "caught"],
  shooter: ["menu", "play", "gameover"],
  platformer: ["menu", "play", "gameover"],
  puzzle: ["menu", "play", "solved", "failed"],
  strategy: ["menu", "briefing", "play", "results"],
  racing: ["menu", "play", "finish"],
  rpg: ["menu", "play", "defeat", "victory"],
  rhythm: ["menu", "play", "score"],
  sports: ["menu", "play", "fulltime"],
  survival: ["menu", "play", "gameover"],
  arcade: ["menu", "play", "gameover"],
};

const LOOP_FOR_GENRE: Record<GameGenre, string> = {
  horror: "explore a dark space with limited visibility, avoid or hide from a threat that hunts the player, and reach an objective before it catches them",
  shooter: "dodge incoming hazards while destroying waves of enemies that escalate in count and speed",
  platformer: "traverse hazards with precise jumps, collect pickups, and reach the end of each stretch without falling",
  puzzle: "present a solvable board state, let the player manipulate it with clear rules, and validate progress toward a win condition",
  strategy: "spend a limited resource to place or upgrade units, then survive/resolve a wave or turn, then repeat with rising pressure",
  racing: "steer along a track or lane at speed, avoid traffic/obstacles, and beat a time or opponent",
  rpg: "move through an area, engage encounters that consume and reward resources, level up, and progress toward a goal",
  rhythm: "spawn cues on a fixed timeline and score the player on how precisely they hit them",
  sports: "simulate one clear sporting mechanic with a score, a timer, and an opponent or par to beat",
  survival: "manage a depleting need (light, warmth, hunger, oxygen) while gathering what refills it, for as long as possible",
  arcade: "one simple, immediately readable mechanic that gets harder the longer the player survives, chasing a high score",
};

/** Genre + mood specific presentation rules. These are what actually stop every
 *  game from being rendered as the same neon arcade cabinet. */
function presentationFor(genre: GameGenre, mood: GameMood, setting: GameSetting, camera: CameraStyle): string[] {
  const rules: string[] = [];

  const cameraRule: Record<CameraStyle, string> = {
    side: "SIDE VIEW: a ground line with parallax layers behind it. Gravity is visible; the player silhouette reads against the background.",
    "top-down": "TOP-DOWN VIEW: the player is seen from above and moves on both axes. Use cast shadows or footprints for depth, not a horizon.",
    fixed: "FIXED SINGLE-SCREEN VIEW: the whole playfield is visible at once. Nothing scrolls; composition is symmetrical and centred.",
    isometric: "ISOMETRIC/GRID VIEW: draw a tilted grid of cells and place units on cell centres. Highlight the hovered/selected cell.",
    board: "BOARD VIEW: a centred grid of tiles with generous margins, a title above and a compact status row below. Static camera.",
    lane: "LANE VIEW: two to five fixed lanes running away from or across the screen; movement is snapping between lanes, not free 2D.",
  };
  rules.push(cameraRule[camera]);

  switch (genre) {
    case "horror":
      rules.push("Visibility is the core mechanic: draw a limited light radius / cone around the player and keep the rest of the playfield near-black. Do NOT light the whole level.");
      rules.push("The HUD is minimal and diegetic — no score counter, no bright badges. Show only what the fiction justifies (battery, heartbeat, objectives found).");
      rules.push("Never use confetti-style particle bursts or cheerful colours on damage; use a dark red flash, a vignette pulse and a low sound.");
      break;
    case "shooter":
      rules.push("Readability first: player, enemy and projectile silhouettes must be instantly distinguishable by shape AND colour.");
      rules.push("HUD in the corners (score, lives, wave). Keep the centre of the screen clear of chrome.");
      break;
    case "platformer":
      rules.push("Add at least two parallax background layers scrolling at different speeds, plus a distinct foreground ground band.");
      rules.push("Give the player coyote-time and a variable-height jump so control feels forgiving.");
      break;
    case "puzzle":
      rules.push("Presentation is calm and typographic: a real title, a generous board, no screen shake, no scrolling background. Whitespace is part of the design.");
      rules.push("Show the rule/goal on the menu scene in one sentence. Every tile state must differ by shape or symbol as well as by colour.");
      break;
    case "strategy":
      rules.push("Draw a proper interface, not an arcade HUD: a resource bar, a build/selection panel, and a turn/wave indicator with tabular numbers.");
      rules.push("Selection and hover feedback on cells is mandatory. Never rely on twitch reflexes for the core interaction.");
      break;
    case "racing":
      rules.push("Convey speed: dashed lane markings scrolling toward the camera, motion streaks, and a speed/lap readout with tabular numbers.");
      break;
    case "rpg":
      rules.push("Show a stat block (HP/level/currency) in a framed panel and use short diegetic text lines for events, in the game's own voice.");
      break;
    case "rhythm":
      rules.push("A visible timeline/track with a fixed judgement line. Cue spawn times must be data-driven from a pattern array, never random per frame.");
      rules.push("Score by timing accuracy tiers (perfect/good/miss) and flash the judgement line on each hit.");
      break;
    case "sports":
      rules.push("Draw the pitch/court markings properly, with a scoreboard band in the genre's typography and a visible clock.");
      break;
    case "survival":
      rules.push("A depleting meter is the centre of the UI. Show cause and effect: the meter visibly reacts when the player gathers or is hit.");
      break;
    case "arcade":
      rules.push("One mechanic, escalating. Score is prominent, everything else is quiet.");
      break;
  }

  if (mood === "dread" || mood === "gritty") {
    rules.push("Atmosphere: low contrast, desaturated shapes, slow deliberate motion. No bright saturated accents except for danger.");
  } else if (mood === "playful") {
    rules.push("Atmosphere: high contrast, rounded shapes, bouncy easing, generous particles.");
  } else if (mood === "calm") {
    rules.push("Atmosphere: soft contrast, slow easing, no shake, no aggressive sound. Let the player breathe.");
  } else if (mood === "epic") {
    rules.push("Atmosphere: large type, weighty motion, deliberate pauses before big moments.");
  }

  if (isLightSetting(setting)) {
    rules.push("This is a LIGHT theme: the canvas background is light and the ink is dark. Do NOT draw dark-on-dark or invent a black background.");
  }

  return rules;
}

const HINTS: Record<CameraStyle, { en: string; fa: string }> = {
  side: { en: "◀ ▶ Move · Space / Tap to jump", fa: "◀ ▶ حرکت · Space یا لمس برای پرش" },
  "top-down": { en: "WASD / Arrows · Drag to move", fa: "WASD یا کلیدها · برای حرکت بکشید" },
  fixed: { en: "◀ ▶ Move · Space / Tap to act", fa: "◀ ▶ حرکت · Space یا لمس برای اقدام" },
  isometric: { en: "Click / Tap a cell to act", fa: "روی خانه کلیک یا لمس کنید" },
  board: { en: "Tap or click a tile", fa: "روی خانه ضربه بزنید" },
  lane: { en: "◀ ▶ Switch lane · Tap sides", fa: "◀ ▶ تغییر خط · طرفین را لمس کنید" },
};

/** Every genre/setting the layer knows, exported so tests can assert the tables
 *  are exhaustive rather than trusting the type checker alone. */
export const GAME_GENRES: readonly GameGenre[] = [
  "horror", "shooter", "platformer", "puzzle", "strategy",
  "racing", "rpg", "rhythm", "sports", "survival", "arcade",
];

export const GAME_SETTINGS: readonly GameSetting[] = [
  "noir", "cyberpunk", "space", "medieval", "nature", "underwater",
  "desert", "candy", "urban", "retro", "paper", "minimal",
];

function pick<T>(patterns: Array<[T, RegExp]>, text: string): T | null {
  for (const [value, re] of patterns) {
    if (re.test(text)) return value;
  }
  return null;
}

/**
 * Turn a free-text game concept into an explicit design intent.
 *
 * Deterministic and side-effect free: the same concept always yields the same
 * intent, which is what lets the shell, the runtime theme and the prompt agree
 * on one visual story instead of each inventing its own.
 */
export function detectGameDesignIntent(description: string): GameDesignIntent {
  const text = String(description ?? "");
  const genre = pick(GENRE_PATTERNS, text) ?? "arcade";
  const mood = pick(MOOD_PATTERNS, text) ?? MOOD_FOR_GENRE[genre];
  const setting = pick(SETTING_PATTERNS, text) ?? SETTING_FOR_GENRE[genre];
  const camera = CAMERA_FOR_GENRE[genre];
  const palette = PALETTES[setting];
  const frame = FRAME_FOR_SETTING[setting];

  return {
    genre, mood, setting, camera, palette,
    typography: TYPOGRAPHY[setting],
    chrome: {
      frame,
      backdrop: backdropFor(setting, palette),
      radius: frame === "crt" || frame === "vignette" ? "0px" : frame === "panel" ? "6px" : frame === "arcade" ? "22px" : "10px",
      border: frame === "vignette" ? "none" : `1px solid ${palette.border}`,
      shadow: isLightSetting(setting)
        ? "0 18px 50px rgba(24,24,27,.12)"
        : frame === "vignette" ? "none" : "0 24px 80px rgba(0,0,0,.55)",
      overlay: overlayFor(frame, mood),
      hud: genre === "horror"
        ? "diegetic and minimal, bottom-left"
        : genre === "strategy" || genre === "rpg"
          ? "a framed panel along one edge"
          : genre === "puzzle"
            ? "a quiet status row under the board"
            : "compact, in the screen corners",
    },
    motion: MOTION[mood],
    audio: AUDIO_FOR_MOOD[mood],
    scenes: SCENES_FOR_GENRE[genre],
    loop: LOOP_FOR_GENRE[genre],
    presentation: presentationFor(genre, mood, setting, camera),
    hint: HINTS[camera],
  };
}

/**
 * The subset of the intent the browser runtime needs, as a JSON literal safe to
 * embed in a <script> block. `</` is escaped so a value can never close the tag.
 */
export function serializeRuntimeTheme(intent: GameDesignIntent): string {
  const p = intent.palette;
  const theme = {
    canvas: p.canvas,
    ink: p.ink,
    muted: p.muted,
    primary: p.primary,
    accent: p.accent,
    danger: p.danger,
    shapeA: p.shapeA,
    shapeB: p.shapeB,
    particle: p.particle,
    font: intent.typography.body,
    audio: intent.audio,
    density: intent.motion.particleDensity,
  };
  return JSON.stringify(theme).replace(/</g, "\\u003c");
}

/**
 * Advisory design check for generated game code: did the model actually honour
 * the intent, or did it fall back to the old hardcoded arcade look? Purely
 * diagnostic — `runHeavyGeneration` logs a low score and still ships the game,
 * because a second 30-second generation attempt for aesthetics is worse for the
 * user than a playable game with a weak palette.
 */
export function assessGameDesign(code: string, intent: GameDesignIntent): { pass: boolean; score: number; issues: string[] } {
  const src = String(code ?? "");
  const issues: string[] = [];
  let score = 0;

  if (/game\.palette\b/.test(src)) score += 2;
  else issues.push("ignores-theme-palette");

  // The specific hexes the old hardcoded shell/runtime used. Their presence in
  // generated code is the signature of the sameness problem this layer fixes.
  const legacyHexes = /#8b5cf6|#7c3aed|#22d3ee|#38bdf8|#050816|#0d1630|#07111f/i;
  if (!legacyHexes.test(src)) score++;
  else issues.push("legacy-neon-palette");

  // "menu" and "play" are the only scenes the runtime and isGameComplete
  // actually require — the rest of the scene list varies by genre, so it must
  // not be treated as mandatory (a strategy game's second scene is "briefing").
  const required = ["menu", "play"];
  if (required.every(name => new RegExp(`scene\\s*\\(\\s*["'\`]${name}["'\`]`).test(src))) score += 2;
  else issues.push("missing-required-scenes");

  const declaredScenes = new Set((src.match(/scene\s*\(\s*["'`]([a-z0-9_]+)["'`]/gi) ?? [])
    .map(m => m.replace(/^scene\s*\(\s*["'`]/i, "").replace(/["'`]$/, "").toLowerCase()));
  if (declaredScenes.size >= Math.min(3, intent.scenes.length)) score++;
  else issues.push("flat-scene-structure");

  const sounds = new Set((src.match(/sound\s*\(\s*["'`]([a-z]+)["'`]/gi) ?? []).map(m => m.toLowerCase()));
  if (sounds.size >= 2) score++;
  else issues.push("monotone-audio");

  if (/onResize\s*\(/.test(src)) score++;
  else issues.push("no-resize-hook");

  if (/game\.view\b|game\.width\b|game\.height\b/.test(src)) score++;
  else issues.push("hardcoded-dimensions");

  // Per-frame allocation is the documented stutter source.
  const loopBodies = src.match(/(update|render)\s*\([^)]*\)\s*\{[\s\S]{0,1600}?\n\s{2,4}\}/g) ?? [];
  if (!loopBodies.some(b => /\.(map|filter|slice|concat)\s*\(/.test(b))) score++;
  else issues.push("per-frame-allocation");

  const distinctColors = new Set((src.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map(c => c.toLowerCase()));
  if (distinctColors.size >= 3 || /game\.palette\b/.test(src)) score++;
  else issues.push("weak-color-usage");

  const critical = new Set(["missing-required-scenes", "legacy-neon-palette"]);
  return { pass: score >= 8 && !issues.some(i => critical.has(i)), score, issues };
}

/** Human-readable one-liner for diagnostics/logs — no user content included. */
export function describeIntent(intent: GameDesignIntent): string {
  return `${intent.genre}/${intent.mood}/${intent.setting} · ${intent.camera} · ${intent.chrome.frame} · ${intent.audio}`;
}
