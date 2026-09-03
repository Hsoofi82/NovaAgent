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

/**
 * How much DEPTH the presentation has. This axis exists because "every game
 * looks flat and 2D" was a distinct complaint from "every game is purple": a
 * side-scroller and a top-down game can both be a single flat plane of
 * rectangles. Depth is about spatial construction, not colour.
 */
export type DepthStyle =
  /** One plane. Legitimate for board/puzzle work, wrong for almost everything else. */
  | "flat"
  /** Discrete parallax planes: far / mid / near, each scrolling at its own rate. */
  | "layered"
  /** Objects scale and converge toward a vanishing point as they approach. */
  | "projected"
  /** Sprites scale by distance on a ground plane (Mode-7 / outrun feel). */
  | "scaled"
  /** Fake volume via drawn faces, cast shadows and consistent light direction. */
  | "pseudo-3d"
  /** Column-wise depth rendering from a 2D map — corridors, walls, fog by distance. */
  | "raycast";

/** How the scene is lit. Lighting is what makes two identical layouts feel different. */
export type LightingStyle =
  | "flat"          // even illumination, no light logic
  | "radial"        // a light radius travelling with an entity, darkness elsewhere
  | "spotlight"     // one hard cone, hard shadow edges
  | "directional"   // consistent light direction with cast shadows/rim light
  | "neon-glow"     // emissive shapes with bloom halos over a dark plate
  | "ambient-tint"  // soft global colour wash, no discrete light source
  | "day-cycle";    // the ambient tint shifts over the course of a run

/** Where the interface lives and what shape it takes. */
export type UiLayout =
  | "corners" | "top-band" | "side-panel" | "bottom-bar"
  | "diegetic" | "framed-card" | "floating-minimal";

/** The physical construction of the playfield — what the player is looking AT. */
export interface GameEnvironment {
  /** One line naming the world's structure (what fills far/mid/near). */
  structure: string;
  /** What the background plane is, concretely. Never "a dark gradient". */
  background: string;
  /** What recurring props/assets populate the space, and how they compose. */
  props: string;
}

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
  /** Spatial construction — the axis that stops everything being one flat plane. */
  depth: DepthStyle;
  lighting: LightingStyle;
  environment: GameEnvironment;
  uiLayout: UiLayout;
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
  /** Explicit "do not build it this way" rules — the anti-repetition contract. */
  avoid: string[];
  /**
   * Stable identifier of the exact style combination chosen for this concept.
   * Two different concepts almost always differ here; the same concept always
   * reproduces, which is what separates this from randomisation.
   */
  styleKey: string;
}

/* ── Persian word boundaries ──────────────────────────────────────────────────
   `\b` is ASCII-only, so a bare Persian stem matches inside unrelated words and
   the whole design brief goes wrong. Three real cases this fixes:
     · `جن` ("ghost") sits inside `جنگل` ("forest") — "a jumping game in the
       forest" was being detected as HORROR.
     · `مترو` ("subway") sits inside `متروکه` ("abandoned") — "abandoned
       hospital" was being detected as an URBAN setting.
     · `مین` ("mine") sits inside `مینیمال` ("minimal") — a minimalist game was
       being detected as a PUZZLE.
   Short stems therefore get explicit script boundaries; long, unambiguous ones
   stay substring-matched so ordinary suffixes (ها/ی/های) still hit.          */
const FA_CH = "؀-ۿ‌";
function faExact(...stems: string[]): string {
  return `(?<![${FA_CH}])(?:${stems.join("|")})(?![${FA_CH}])`;
}

/* ── Detection tables ─────────────────────────────────────────────────────────
   Ordered by specificity: the first table entry wins a tie, so narrow genres
   (horror, rhythm) are listed before the catch-all arcade shapes.            */

const GENRE_PATTERNS: Array<[GameGenre, RegExp]> = [
  ["horror", new RegExp(String.raw`\b(horror|scary|creepy|haunted|zombie|nightmare|survival horror|dread|ghost|monster|eerie|slasher)\b|(ترسناک|وحشت|زامبی|کابوس|خوف|هراس|شبح|روح‌زده|جن‌زده|اجنه)|` + faExact("جن", "روح"), "i")],
  ["rhythm", new RegExp(String.raw`\b(rhythm|music|beat|dance|tempo|osu|guitar|piano|drum|melody)\b|(ریتم|موسیقی|ضرب|رقص|آهنگ)|` + faExact("نت", "نت‌ها"), "i")],
  ["racing", /\b(racing|race|drift|kart|rally|drive|driving|car|traffic|speedway|lap)\b|(مسابقه|رانندگی|ماشین|رالی|دریفت|سرعت|ترافیک)/i],
  ["strategy", /\b(strategy|tower defense|rts|4x|base building|resource|tactics|turn[- ]based|city builder|management)\b|(استراتژی|دفاع از برج|تاکتیک|نوبتی|مدیریت|منابع|شهرسازی)/i],
  ["rpg", /\b(rpg|role[- ]playing|dungeon|quest|adventure|loot|level up|inventory|fantasy|knight|wizard|dragon)\b|(نقش.?آفرینی|سیاه.?چال|ماجراجویی|شمشیر|جادوگر|اژدها|شوالیه|کوئست)/i],
  ["puzzle", new RegExp(String.raw`\b(puzzle|match[- ]?3|sudoku|2048|tetris|block|sokoban|jigsaw|logic|brain|minesweeper|memory|word)\b|(پازل|فکری|جدول|حافظه|منطق|کلمه|چیدمان|مین‌یاب)|` + faExact("مین"), "i")],
  ["shooter", /\b(shooter|shoot|shmup|bullet|space invaders|galaga|gun|blast|turret|asteroid)\b|(تیراندازی|شوتر|گلوله|تفنگ|فضاپیما|شهاب|موشک)/i],
  ["sports", new RegExp(String.raw`\b(sports?|football|soccer|basketball|tennis|golf|pong|volleyball|boxing|penalty|goal)\b|(ورزش|فوتبال|بسکتبال|تنیس|گلف|والیبال|بوکس|پنالتی)|` + faExact("گل", "گل‌زنی"), "i")],
  ["survival", /\b(survival|crafting|hunger|forage|wilderness|island|escape|endless night|scavenge)\b|(بقا|زنده.?ماندن|جزیره|فرار|گرسنگی|بیابان.?گردی)/i],
  ["platformer", /\b(platformer|platform|jump|jumper|runner|mario|parkour|doodle|climb|flappy)\b|(پلتفرمر|پرش|دونده|بالا.?رفتن|سکو)/i],
];

const MOOD_PATTERNS: Array<[GameMood, RegExp]> = [
  ["dread", new RegExp(String.raw`\b(horror|scary|creepy|dread|grim|dark|sinister|haunted|nightmare|ominous)\b|(ترسناک|تاریک|دلهره|وحشت|متروکه)|` + faExact("شوم"), "i")],
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
  ["nature", new RegExp(String.raw`\b(forest|jungle|garden|farm|nature|tree|plant|animal|mountain|meadow|bee|mushroom)\b|(جنگل|باغ|مزرعه|طبیعت|درخت|گیاه|حیوان|کوهستان)|` + faExact("کوه"), "i")],
  ["desert", new RegExp(String.raw`\b(desert|sand|dune|pyramid|oasis|egypt|mummy|canyon|wasteland)\b|(کویر|بیابان|هرم|مصر|واحه|دره|شن‌زار|تپه.?شنی)|` + faExact("شن"), "i")],
  ["candy", /\b(candy|sweet|cake|donut|cookie|bubble|pastel|jelly|fruit|ice cream)\b|(شکلات|شیرینی|آب.?نبات|کیک|میوه|بستنی|پاستل)/i],
  ["noir", /\b(noir|detective|crime|mystery|shadow|smoke|1940s|gangster|asylum|hospital|abandoned)\b|(کارآگاه|جنایی|معمایی|سایه|گانگستر|تیمارستان|بیمارستان|متروکه|رهاشده)/i],
  ["urban", new RegExp(String.raw`\b(city|street|urban|rooftop|subway|skate|graffiti|stadium|arena|traffic)\b|(خیابان|پشت.?بام|ورزشگاه|آسفالت|شهری|شهرها)|` + faExact("شهر", "مترو"), "i")],
  ["retro", /\b(retro|8[- ]?bit|pixel|nes|gameboy|crt|arcade cabinet|vintage|old school|chiptune)\b|(رترو|هشت.?بیتی|پیکسلی|قدیمی|آرکید)/i],
  ["paper", new RegExp(String.raw`\b(board game|hex|paper|blueprint|map|chess|card|tabletop|notebook|sketch)\b|(تخته|کاغذ|نقشه|شطرنج|رومیزی|دفتر|کارت‌بازی)|` + faExact("کارت", "کارت‌ها"), "i")],
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
function presentationFor(
  genre: GameGenre,
  mood: GameMood,
  setting: GameSetting,
  camera: CameraStyle,
  depth: DepthStyle,
  lighting: LightingStyle,
  uiLayout: UiLayout,
  environment: GameEnvironment,
): string[] {
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
  // Depth, lighting, environment and UI shape come before the genre rules: they
  // are the axes that were previously absent entirely, which is why every game
  // arrived as the same flat, evenly-lit, corner-HUD field of rectangles.
  rules.push(DEPTH_RULES[depth]);
  rules.push(LIGHTING_RULES[lighting]);
  rules.push(`ENVIRONMENT — build this specific place, not a generic backdrop: ${environment.structure}. Background: ${environment.background}. Recurring props: ${environment.props}.`);
  rules.push(UI_LAYOUT_RULES[uiLayout]);

  switch (genre) {
    case "horror":
      // Always stated, whatever the lighting model: a horror game that lights
      // its whole level is not a horror game, and the phrasing of the rule has
      // to match the model chosen above or the two instructions fight.
      rules.push(
        lighting === "radial" || lighting === "spotlight"
          ? "Visibility is the core mechanic: the player sees only a limited light radius (or cone) around themselves and everything beyond it stays near-black; threats outside it are readable by sound and silhouette alone."
          : "Visibility is the core mechanic: restrict what the player can see to a limited light radius and keep the rest of the playfield near-black. Do NOT light the whole level.",
      );
      rules.push("The HUD is minimal and diegetic — no score counter, no bright badges. Show only what the fiction justifies (battery, heartbeat, objectives found).");
      rules.push("Never use confetti-style particle bursts or cheerful colours on damage; use a dark red flash, a vignette pulse and a low sound.");
      break;
    case "shooter":
      rules.push("Readability first: player, enemy and projectile silhouettes must be instantly distinguishable by shape AND colour.");
      rules.push("Keep the centre of the screen clear of chrome — score, lives and wave belong wherever the HUD layout above puts them.");
      break;
    case "platformer":
      if (depth !== "layered") rules.push("Give the ground a distinct foreground band so the player silhouette never merges into the environment.");
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

/**
 * The hint is the first thing a player reads, so it has to describe how the
 * game is actually played rather than how the camera moves. A puzzle on a
 * `fixed` camera has no ◀ ▶ movement at all — pointing at tiles is the only
 * true instruction — while a sliding-block or lane puzzle keeps its keys.
 */
function hintFor(camera: CameraStyle, genre: GameGenre): { en: string; fa: string } {
  if (genre === "puzzle" && camera !== "side" && camera !== "lane") return HINTS.board;
  return HINTS[camera];
}

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

/* ── Concept-derived variation ────────────────────────────────────────────────
   The sameness problem has two halves. The first is that every game shared one
   hardcoded look — fixed by the tables above. The second is subtler: with those
   tables alone, EVERY horror concept produced byte-identical design intent,
   because genre was the only input. "A haunted lighthouse keeper" and "escape
   the hospital basement" deserve different cameras, different depth and a
   different room to stand in.

   The fix is NOT randomness. Randomness would make the same request produce a
   different game each time (unreproducible, and it would sometimes pick a
   camera that fights the concept). Instead each axis declares the alternatives
   that are SEMANTICALLY VALID for the detected genre/mood/setting, and the
   concept's own text deterministically selects among them. Same concept → same
   game. Different concept → almost certainly a different combination. Every
   reachable combination is one a designer would accept for that brief.        */

/** FNV-1a over the concept text. Cheap, stable, no dependencies. */
function hashConcept(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministically choose one of several equally-valid options.
 * `salt` keeps the axes independent — without it camera, depth and lighting
 * would all land on the same index of their respective lists and the variation
 * would collapse back into a handful of fixed combinations.
 */
function variantPick<T>(options: readonly T[], hash: number, salt: number): T {
  if (options.length === 0) throw new Error("variantPick: empty options");
  const mixed = (hash ^ (salt * 0x9e3779b1)) >>> 0;
  return options[mixed % options.length];
}

/* ── Camera ──────────────────────────────────────────────────────────────────
   Camera used to be a pure function of genre, so every platformer was a side
   view and every puzzle was a board. It is now (1) whatever the user explicitly
   asked for, else (2) a concept-selected pick from the cameras that genuinely
   suit that genre.                                                            */

const CAMERA_PATTERNS: Array<[CameraStyle, RegExp]> = [
  ["isometric", /\b(isometric|iso|2\.5d|two[- ]and[- ]a[- ]half|diablo|tilted grid|axonometric)\b|(ایزومتریک|سه.?رب|نیمه.?سه.?بعدی)/i],
  ["top-down", /\b(top[- ]?down|birds?[- ]eye|overhead|from above|aerial|zelda|twin[- ]stick)\b|(از.?بالا|نمای.?بالا|دید.?پرنده|بالا.?به.?پایین)/i],
  ["side", /\b(side[- ]?(view|scroll(er|ing)?)|2d side|profile view|horizontal scroll)\b|(نمای.?جانبی|از.?پهلو|اسکرول.?افقی)/i],
  ["lane", /\b(lane|three[- ]lane|subway surfer|endless runner|highway|tunnel run|rail)\b|(خطی|چند.?خط|دوی.?بی.?پایان|بزرگراه|تونل)/i],
  // Tile-grid classics name themselves: a match-3 or a sudoku IS a board, so it
  // must not depend on the genre's variant pick to look like one.
  ["board", /\b(board|grid of tiles|tile grid|chess|checkers|tabletop|hex grid)\b|\bmatch[- ]?(?:3|three)\b|\b(?:bejeweled|candy\s*crush|sudoku|minesweeper|2048|tic[- ]?tac[- ]?toe|connect\s*four|solitaire|mahjong)\b|(تخته|شبکه.?خانه|شطرنجی|رومیزی|سودوکو|مین.?یاب|دوز|منچ)/i],
  ["fixed", /\b(single[- ]screen|one screen|fixed camera|static camera|arena|no scroll)\b|(یک.?صفحه|دوربین.?ثابت|میدان.?بسته)/i],
];

/** Cameras that genuinely work for each genre, most idiomatic first. */
const CAMERA_CANDIDATES: Record<GameGenre, readonly CameraStyle[]> = {
  horror: ["top-down", "side", "fixed"],
  shooter: ["fixed", "top-down", "lane"],
  platformer: ["side", "fixed"],
  puzzle: ["board", "fixed"],
  strategy: ["isometric", "board", "top-down"],
  racing: ["lane", "top-down"],
  rpg: ["top-down", "isometric", "side"],
  rhythm: ["lane", "fixed"],
  sports: ["fixed", "side", "top-down"],
  survival: ["top-down", "side", "fixed"],
  arcade: ["fixed", "side", "top-down", "lane"],
};

/* ── Depth ───────────────────────────────────────────────────────────────────
   "Too flat / too 2D" is its own complaint, so depth is its own axis. Only
   `board`-camera work is allowed to stay genuinely flat; everything else must
   construct space somehow.                                                     */

const DEPTH_PATTERNS: Array<[DepthStyle, RegExp]> = [
  ["raycast", /\b(first[- ]person|fps|doom|wolfenstein|raycast|corridor|maze from inside|dungeon crawler)\b|(اول.?شخص|راهرو|از.?دید.?اول)/i],
  ["pseudo-3d", /\b(3d|three[- ]?d|voxel|volumetric|solid|blocky depth|minecraft)\b|(سه.?بعدی|حجمی|توپر)/i],
  ["projected", /\b(perspective|vanishing point|into the screen|depth|tunnel|toward the camera)\b|(پرسپکتیو|عمق|به.?سمت.?دوربین)/i],
  ["scaled", /\b(mode ?7|outrun|pseudo[- ]?3d road|horizon|sprite scaling)\b|(افق|جاده.?ای)/i],
  ["layered", /\b(parallax|layers?|foreground and background|depth layers)\b|(پارالاکس|لایه)/i],
];

/** Depth treatments that are physically coherent with each camera. */
const DEPTH_CANDIDATES: Record<CameraStyle, readonly DepthStyle[]> = {
  side: ["layered", "pseudo-3d", "scaled"],
  "top-down": ["pseudo-3d", "layered", "scaled"],
  fixed: ["layered", "pseudo-3d", "projected"],
  isometric: ["projected", "pseudo-3d"],
  board: ["flat", "pseudo-3d"],
  lane: ["projected", "scaled", "layered"],
};

const DEPTH_RULES: Record<DepthStyle, string> = {
  flat: "FLAT PLANE (deliberate): no parallax, no fake perspective. Depth is expressed by elevation offsets and drop shadows on the tiles only. Keep it graphic and precise.",
  layered: "LAYERED PARALLAX: draw at least THREE distinct planes — a far plane (silhouettes/sky, ~0.15x scroll), a mid plane (structures, ~0.45x) and a near plane (the playfield + a foreground band at 1.0x or faster). Each plane has its own palette value, darker/hazier with distance. This is mandatory: a single background rectangle is not acceptable.",
  projected: "PERSPECTIVE PROJECTION: define a vanishing point and scale every object by its distance (scale = focal / (focal + z)). Objects enter small near the vanishing point, grow as they approach, and the ground/lane lines converge. Sort draws far-to-near.",
  scaled: "GROUND-PLANE SCALING (Mode-7 feel): a horizon line divides sky from ground; ground rows are drawn with a scanline scale so texture bands widen toward the camera. Sprites scale with their row and their y position follows the ground, not the screen.",
  "pseudo-3d": "PSEUDO-3D VOLUME: nothing is a plain flat rectangle. Give solids a visible top/side face (two extra polygons in a darker/lighter shade of the same colour), a consistent light direction, and a cast shadow offset along that direction. Stack objects by y so nearer objects overlap farther ones.",
  raycast: "COLUMN-DEPTH RENDERING: keep a small 2D grid map, cast one ray per screen column, and draw each column's wall slice with height inversely proportional to distance, darkened by distance (fog). Draw a floor and ceiling band. Entities are billboards scaled by distance.",
};

/* ── Environment structure ───────────────────────────────────────────────────
   Three genuinely different worlds per setting so two concepts in the same
   setting do not stand in the same room.                                      */

const ENVIRONMENTS: Record<GameSetting, readonly GameEnvironment[]> = {
  noir: [
    { structure: "a rain-slick street canyon: tall blank building faces left and right, wet asphalt below", background: "a flat charcoal plate with tall lit window grids and a single distant street lamp halo", props: "hydrants, chain fences, trash bins and telephone poles arranged in rhythmic verticals" },
    { structure: "the interior of an abandoned institution: corridors, doorways and tiled floors receding", background: "peeling wall panels with a hard skirting line and one flickering ceiling fixture", props: "overturned gurneys, filing cabinets, wheelchairs and hanging cables clustered irregularly" },
    { structure: "a warehouse district at night: crates, loading bays and a chain-link perimeter", background: "corrugated metal bands with a low moon and drifting smoke", props: "stacked crates in loose pyramids, pallets, barrels and a parked truck silhouette" },
  ],
  cyberpunk: [
    { structure: "a vertical megacity slice: neon signage stacked upward, walkways crossing the frame", background: "layered building silhouettes edged in emissive strips, holographic billboards behind rain", props: "vending kiosks, cable bundles, antenna clusters and floating drones" },
    { structure: "a data-space interior: wireframe grid floor stretching to a horizon, glowing conduits", background: "a dark plate with a receding grid and vertical data columns", props: "rotating polyhedra, firewall slabs and streaming glyph columns" },
    { structure: "a rain-soaked market alley: awnings overhead, neon reflections in puddles below", background: "a wall of stacked shop signage in three depth planes", props: "noodle stalls, crates, hanging lanterns and parked bikes" },
  ],
  space: [
    { structure: "open void with a planet limb filling one corner and a debris belt crossing the frame", background: "a multi-density starfield in three parallax layers plus one nebula wash", props: "asteroids of varied silhouettes, derelict hull fragments and satellites tumbling slowly" },
    { structure: "a station interior: ribbed corridors, viewports onto the void, deck plating underfoot", background: "bulkhead panels with recessed lighting and one large window showing slow star drift", props: "consoles, pipe runs, airlock frames and floating cargo" },
    { structure: "a planetary surface: a low alien horizon, distant ridges, a huge moon overhead", background: "banded sky gradient, ridge silhouettes at two depths, drifting dust", props: "rock spires, crashed pods, glowing flora and landing beacons" },
  ],
  medieval: [
    { structure: "a castle courtyard: stone walls with crenellations, a gatehouse, banners along the walls", background: "stacked stone masonry with mountain silhouettes beyond the battlements", props: "barrels, braziers, hay bales, weapon racks and hanging banners" },
    { structure: "a dungeon under torchlight: vaulted arches receding, flagstone floor, iron gates", background: "arch repetition darkening with distance, dripping ceiling, dark alcoves", props: "chains, torches in sconces, sarcophagi and rubble piles" },
    { structure: "a forest road approaching a walled town: rutted track, treeline either side", background: "three tree-depth planes with the town wall and a spire on the horizon", props: "cart wheels, milestones, campfires and standing stones" },
  ],
  nature: [
    { structure: "a forest clearing: canopy overhead, trunk columns at varied depths, undergrowth near", background: "layered foliage planes with light shafts breaking through the canopy", props: "mushrooms, fallen logs, ferns and boulders clustered organically" },
    { structure: "a terraced hillside farm: stepped fields, fences, a barn on the ridge", background: "rolling hill bands in three greens with a wide sky and drifting clouds", props: "crop rows, scarecrows, watering troughs and beehives" },
    { structure: "a river valley: the water plane crossing the frame, banks either side, reeds near camera", background: "far mountains, mid treeline, near reed silhouettes", props: "stepping stones, driftwood, lily pads and dragonflies" },
  ],
  underwater: [
    { structure: "a coral shelf: the seabed sloping away, water column above, surface light far overhead", background: "a depth gradient with god-rays and suspended particulate drifting upward", props: "coral fans, kelp columns, anemones and rock arches" },
    { structure: "a sunken wreck: a hull dominating one side, cargo scattered on the sand", background: "murky blue-green haze with the hull silhouette receding into it", props: "portholes, torn plating, crates, chains and schooling fish" },
    { structure: "an abyssal trench: near-black water, bioluminescent life as the only light", background: "a black plate with sparse drifting glow motes and a faint vent glow below", props: "vent chimneys, jellyfish, angler lures and tube worms" },
  ],
  desert: [
    { structure: "open dunes: layered dune crests receding to a heat-hazed horizon", background: "a pale sky-to-sand gradient with three dune silhouette bands and a shimmer line", props: "cacti, sun-bleached bones, rock arches and half-buried ruins" },
    { structure: "a tomb interior: carved corridors, hieroglyph walls, shafts of light from above", background: "sandstone block courses with painted registers and dust in the light shafts", props: "sarcophagi, canopic jars, pillars and collapsed rubble" },
    { structure: "a canyon floor: sheer striated walls on both sides, a dry riverbed underfoot", background: "stratified rock layers in three depths with a narrow strip of sky", props: "boulders, dead trees, rope bridges above and scree slopes" },
  ],
  candy: [
    { structure: "a layer-cake landscape: frosting terraces stacked upward, sprinkle ground", background: "pastel sky with cream cloud swirls and lollipop trees at two depths", props: "gumdrops, candy canes, wafer platforms and jelly blobs" },
    { structure: "a soda-fountain interior: glass surfaces, straw columns, bubble streams rising", background: "a translucent pink-amber wash with rising bubbles in three sizes", props: "cherries, ice cubes, umbrella picks and whipped-cream mounds" },
    { structure: "a bakery counter viewed close: tray edges, doilies, a tiled splashback behind", background: "checkerboard tile with a warm window glow and hanging bunting", props: "cupcakes, donut stacks, piping bags and cookie tins" },
  ],
  urban: [
    { structure: "a rooftop run: parapets, AC units, gaps between blocks, the skyline beyond", background: "three depths of building silhouettes with lit windows and a hazy sky band", props: "water tanks, vents, satellite dishes, washing lines and pigeons" },
    { structure: "a street-level crossing: kerbs, crosswalk stripes, shopfronts along one side", background: "a facade row with awnings and signage, traffic lights receding", props: "cars, bollards, bus shelters, hydrants and street trees" },
    { structure: "a subway platform: the track trench, tiled wall behind, tunnel mouths at both ends", background: "tiled wall with advertising panels and a tunnel darkening into black", props: "benches, columns, turnstiles, rubbish and rails catching light" },
  ],
  retro: [
    { structure: "a tile-block stage: chunky platform blocks on a plain field, pixel ground band", background: "a two-tone sky with 8-bit cloud and hill sprites repeating at two depths", props: "brick blocks, pipes, coin sprites and spring platforms" },
    { structure: "a starfield arena in a hard 4:3 frame with a scanline plate", background: "black with a sparse two-density starfield and one scrolling ground strip", props: "blocky invader rows, bunkers and chunky projectiles" },
    { structure: "a neon vector grid: wireframe ground receding, glowing outlines only", background: "black with a green/amber vector horizon grid", props: "wireframe obstacles, vector explosions and outline typography" },
  ],
  paper: [
    { structure: "a tabletop board: a printed play surface with a visible fold crease and card margins", background: "textured paper stock with a faint print grain and a drawn border rule", props: "punched tokens, dice, meeples and stacked cards with shadow offsets" },
    { structure: "an open notebook: ruled pages, a spiral binding down the centre, doodled elements", background: "ruled or graph paper with margin line and eraser smudges", props: "biro sketches, sticky notes, paper clips and hand-drawn arrows" },
    { structure: "a blueprint sheet: white line work on a technical ground with a title block", background: "a technical plate with a fine measurement grid and dimension lines", props: "drafted schematics, callout bubbles, rulers and stamped labels" },
  ],
  minimal: [
    { structure: "a large field of negative space with a single active band where play happens", background: "one flat surface tone, no gradient, no texture", props: "a small vocabulary of primitives distinguished by shape, not decoration" },
    { structure: "a split composition: two flat colour fields meeting on a hard edge that is the play line", background: "two flat tones and nothing else", props: "circles, bars and one accent shape used sparingly" },
    { structure: "a concentric composition radiating from an exact centre point", background: "a flat tone with thin concentric guide rings", props: "rings, dots and radial ticks; type is part of the composition" },
  ],
};

/* ── Lighting ────────────────────────────────────────────────────────────────
   Filtered by mood, then narrowed so a light setting never gets a treatment
   that only works on a dark plate.                                            */

const LIGHTING_CANDIDATES: Record<GameMood, readonly LightingStyle[]> = {
  dread: ["radial", "spotlight", "directional"],
  tense: ["spotlight", "directional", "radial"],
  energetic: ["neon-glow", "directional", "flat"],
  playful: ["flat", "ambient-tint", "directional"],
  calm: ["ambient-tint", "day-cycle", "flat"],
  gritty: ["directional", "ambient-tint", "spotlight"],
  epic: ["directional", "day-cycle", "ambient-tint"],
};

const LIGHTING_RULES: Record<LightingStyle, string> = {
  flat: "FLAT LIGHTING: even illumination, no light sources, no shadows. Form comes from shape and colour contrast alone — so shapes must be distinctive.",
  radial: "TRAVELLING LIGHT: draw a radial light around the player (a radial gradient or a clipped circle) and keep everything outside it near the canvas colour. The unlit region must genuinely hide information — do not draw the whole level and dim it uniformly.",
  spotlight: "SPOTLIGHT: one hard-edged cone from a known origin. Inside the cone objects are lit and readable; outside they are silhouettes. The cone's angle or origin should move.",
  directional: "DIRECTIONAL LIGHT: choose ONE light direction and honour it everywhere — lit faces brighter, opposite faces darker, and every solid casts a shadow offset the same way with the same skew. Consistency is what sells it.",
  "neon-glow": "EMISSIVE GLOW: bright shapes sit on a dark plate and bloom — draw each glowing shape two or three times at increasing size and decreasing alpha before the solid core. Only emissive elements glow; the environment stays dark and matte.",
  "ambient-tint": "AMBIENT WASH: a soft global colour cast over the scene (one translucent fill), no discrete light source, no hard shadows. Foreground elements are slightly desaturated toward the wash with distance.",
  "day-cycle": "SHIFTING AMBIENCE: the ambient tint and background bands interpolate over the run (dawn → noon → dusk, or calm → storm). Tie it to elapsed time, keep it slow, and make sure readability holds at every point in the cycle.",
};

/* ── UI layout ───────────────────────────────────────────────────────────────
   The old prompt produced one HUD shape for everything: a score in a corner.   */

const UI_LAYOUT_CANDIDATES: Record<GameGenre, readonly UiLayout[]> = {
  horror: ["diegetic", "floating-minimal"],
  shooter: ["corners", "top-band"],
  platformer: ["corners", "top-band", "floating-minimal"],
  puzzle: ["bottom-bar", "framed-card", "top-band"],
  strategy: ["side-panel", "bottom-bar"],
  racing: ["top-band", "corners"],
  rpg: ["side-panel", "framed-card", "bottom-bar"],
  rhythm: ["top-band", "floating-minimal"],
  sports: ["top-band", "framed-card"],
  survival: ["bottom-bar", "diegetic", "corners"],
  arcade: ["corners", "top-band", "floating-minimal"],
};

const UI_LAYOUT_RULES: Record<UiLayout, string> = {
  corners: "HUD IN THE CORNERS: small anchored clusters, safe margins, centre of the screen kept clear. Anchor with margins from game.view so rotation never clips them.",
  "top-band": "HUD AS A TOP BAND: one full-width strip with segmented readouts and tabular figures. The playfield starts below it — account for its height in the play bounds.",
  "side-panel": "HUD AS A SIDE PANEL: a framed vertical column along one edge holding resources, selection and actions. The playfield occupies the remaining width; compute bounds from it, do not overlap.",
  "bottom-bar": "HUD AS A BOTTOM BAR: a grounded strip under the playfield with the primary meter/goal on one side and secondary state on the other.",
  diegetic: "DIEGETIC UI ONLY: no floating numbers. State is shown inside the fiction — a lamp dimming, a torch guttering, breath, a physical dial. If the player must know a number, draw it on an object in the world.",
  "framed-card": "HUD AS A FRAMED CARD: a bordered panel with a header rule, label/value rows and clear typographic hierarchy, sitting over the field with a shadow.",
  "floating-minimal": "MINIMAL FLOATING UI: one or two elements at most, low contrast, positioned by the composition rather than pinned to a corner. Nothing else on screen.",
};

/** Short phrase for the shell/designSkills copy — the long form lives above. */
const HUD_SUMMARY: Record<UiLayout, string> = {
  corners: "compact clusters in the screen corners",
  "top-band": "a full-width band across the top",
  "side-panel": "a framed panel along one edge",
  "bottom-bar": "a grounded strip beneath the playfield",
  diegetic: "diegetic — expressed by objects in the world, not numbers",
  "framed-card": "a bordered card with label/value rows",
  "floating-minimal": "one or two quiet floating elements",
};

/* ── Palette variants ────────────────────────────────────────────────────────
   Each setting keeps its colour STORY (a noir game stays noir) but not one
   fixed set of hexes. These overrides shift the accents — and for a few
   settings the plate itself — so two cyberpunk games are not the same magenta.
   Only the expressive channels vary; text/border/surface stay put so contrast
   and legibility are never at risk.                                           */

type PaletteShift = Partial<Pick<GamePalette,
  "primary" | "accent" | "danger" | "canvas" | "shapeA" | "shapeB" | "particle" | "bg" | "surface">>;

const PALETTE_VARIANTS: Record<GameSetting, readonly PaletteShift[]> = {
  noir: [
    {},
    { primary: "#a16207", accent: "#e7e5e4", shapeB: "#78350f", particle: "#d97706" },
    { primary: "#0e7490", accent: "#cbd5e1", shapeA: "#334155", shapeB: "#155e75", particle: "#06b6d4" },
  ],
  cyberpunk: [
    {},
    { primary: "#f97316", accent: "#fde047", shapeB: "#c2410c", particle: "#fb923c" },
    { primary: "#22c55e", accent: "#a3e635", shapeA: "#134e4a", shapeB: "#15803d", particle: "#4ade80" },
  ],
  space: [
    {},
    { primary: "#f43f5e", accent: "#fda4af", shapeB: "#9f1239", particle: "#fb7185", canvas: "#0a0410" },
    { primary: "#14b8a6", accent: "#5eead4", shapeA: "#1e3a5f", shapeB: "#0f766e", particle: "#2dd4bf" },
  ],
  medieval: [
    {},
    { primary: "#15803d", accent: "#bbf7d0", shapeB: "#166534", particle: "#4ade80" },
    { primary: "#6d28d9", accent: "#ddd6fe", shapeA: "#44403c", shapeB: "#5b21b6", particle: "#a78bfa" },
  ],
  nature: [
    {},
    { primary: "#c2410c", accent: "#fdba74", shapeB: "#9a3412", particle: "#fb923c" },
    { primary: "#0369a1", accent: "#7dd3fc", shapeA: "#3f6212", shapeB: "#075985", particle: "#0ea5e9" },
  ],
  underwater: [
    {},
    { primary: "#a855f7", accent: "#e9d5ff", shapeB: "#7e22ce", particle: "#c084fc" },
    { primary: "#facc15", accent: "#fef08a", shapeA: "#0f766e", shapeB: "#a16207", particle: "#fde047", canvas: "#020a12" },
  ],
  desert: [
    {},
    { primary: "#0d9488", accent: "#99f6e4", shapeB: "#0f766e", particle: "#2dd4bf" },
    { primary: "#9f1239", accent: "#fecdd3", shapeA: "#a8a29e", shapeB: "#be123c", particle: "#fb7185" },
  ],
  candy: [
    {},
    { primary: "#0891b2", accent: "#67e8f9", shapeB: "#0e7490", particle: "#06b6d4" },
    { primary: "#9333ea", accent: "#c4b5fd", shapeA: "#fbcfe8", shapeB: "#a855f7", particle: "#a78bfa" },
  ],
  urban: [
    {},
    { primary: "#eab308", accent: "#fef08a", shapeB: "#a16207", particle: "#facc15" },
    { primary: "#2563eb", accent: "#93c5fd", shapeA: "#475569", shapeB: "#1d4ed8", particle: "#60a5fa" },
  ],
  retro: [
    {},
    { primary: "#22c55e", accent: "#86efac", shapeA: "#166534", shapeB: "#15803d", particle: "#4ade80", canvas: "#020806" },
    { primary: "#f59e0b", accent: "#fcd34d", shapeA: "#78350f", shapeB: "#b45309", particle: "#fbbf24", canvas: "#0c0700" },
  ],
  paper: [
    {},
    { primary: "#1d4ed8", accent: "#1e3a8a", shapeB: "#3b82f6", particle: "#60a5fa" },
    { primary: "#15803d", accent: "#14532d", shapeA: "#d6d3d1", shapeB: "#16a34a", particle: "#4ade80" },
  ],
  minimal: [
    {},
    { primary: "#0f172a", accent: "#334155", shapeA: "#e2e8f0", shapeB: "#64748b", particle: "#94a3b8" },
    { primary: "#ea580c", accent: "#7c2d12", shapeB: "#f97316", particle: "#fb923c" },
  ],
};

function applyPaletteShift(base: GamePalette, shift: PaletteShift): GamePalette {
  return { ...base, ...shift };
}

/* ── Anti-repetition contract ────────────────────────────────────────────────
   Positive direction alone is not enough: models converge on the safest render
   regardless of the brief. Stating what this particular game must NOT look like
   is what keeps the chosen combination from decaying back into the default.    */

function buildAvoidRules(intent: {
  genre: GameGenre; mood: GameMood; setting: GameSetting;
  camera: CameraStyle; depth: DepthStyle; lighting: LightingStyle; uiLayout: UiLayout;
}): string[] {
  const avoid: string[] = [
    "Do NOT render this as a flat field of plain rectangles on a single-colour background. That is the default failure mode and it is not acceptable here.",
    `Do NOT ignore the camera: this is a ${intent.camera.toUpperCase()} game, so do not fall back to a generic centred single-screen arena unless that IS the camera.`,
  ];

  if (intent.depth !== "flat") {
    avoid.push("Do NOT draw a static one-piece background. The background is a constructed, multi-plane environment as described above.");
  }
  if (intent.depth === "pseudo-3d" || intent.depth === "projected" || intent.depth === "raycast" || intent.depth === "scaled") {
    avoid.push("Do NOT use uniform-size sprites and flat fills where the depth model calls for scaling, faces or shadows — the sense of space is a requirement, not a bonus.");
  }
  if (intent.lighting !== "flat") {
    avoid.push("Do NOT light the scene evenly. The lighting model above must be visible in the render.");
  }
  if (intent.uiLayout !== "corners") {
    avoid.push("Do NOT default to a score in the top-left corner — the HUD shape for this game is specified above.");
  }
  if (intent.genre !== "arcade") {
    avoid.push("Do NOT frame this as a high-score arcade game (no 'GAME OVER — tap to restart' card, no high-score table) unless the genre genuinely calls for it.");
  }
  if (intent.mood === "dread" || intent.mood === "gritty" || intent.mood === "tense") {
    avoid.push("Do NOT use bright saturated neon, confetti particles, bouncy easing or cheerful sounds anywhere in this game.");
  }
  if (intent.mood === "calm") {
    avoid.push("Do NOT add screen shake, sudden loud cues, timers that punish, or dense particle bursts.");
  }
  if (intent.setting === "minimal" || intent.setting === "paper") {
    avoid.push("Do NOT add glow, bloom, gradients or neon. This setting is matte and graphic.");
  } else if (intent.setting !== "cyberpunk" && intent.setting !== "retro") {
    avoid.push("Do NOT reach for the purple/cyan neon look — it belongs to a different setting than this one.");
  }
  avoid.push("Do NOT reuse the same shape for two different entity roles; every role must be distinguishable by silhouette alone, with colour as reinforcement.");
  return avoid;
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

  // The concept text drives every variant choice, so the same request always
  // rebuilds the same game while two different requests diverge on all axes.
  // Salts keep the axes from moving in lockstep.
  // Canonicalised before hashing: the prompt path passes the concept trimmed and
  // sliced to 2 000 chars while the shell path passes the raw request, so
  // without this the two would derive DIFFERENT palettes for the same game.
  const h = hashConcept(text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 2_000));

  // Explicit user wording always wins over the genre's idiom. Otherwise pick
  // from the cameras that suit the genre — the genre default stays first in the
  // candidate list, so it remains the most likely outcome, not the only one.
  const camera = pick(CAMERA_PATTERNS, text)
    ?? variantPick(CAMERA_CANDIDATES[genre] ?? [CAMERA_FOR_GENRE[genre]], h, 1);

  // Depth must be coherent with the camera, so an explicitly requested depth is
  // only honoured when that camera can actually express it (asking for "3D" on a
  // board camera yields raised tiles with shadows, not a broken raycaster).
  const askedDepth = pick(DEPTH_PATTERNS, text);
  const depthOptions = DEPTH_CANDIDATES[camera];
  const depth = askedDepth && depthOptions.includes(askedDepth)
    ? askedDepth
    : variantPick(depthOptions, h, 2);

  // Never hand a dark-plate-only treatment to a light setting.
  const lightingOptions = (LIGHTING_CANDIDATES[mood] ?? ["flat"]).filter(
    l => !(isLightSetting(setting) && (l === "neon-glow" || l === "radial")),
  );
  const lighting = variantPick(lightingOptions.length ? lightingOptions : (["flat"] as const), h, 3);

  const environment = variantPick(ENVIRONMENTS[setting], h, 4);
  const uiLayout = variantPick(UI_LAYOUT_CANDIDATES[genre], h, 5);
  const palette = applyPaletteShift(PALETTES[setting], variantPick(PALETTE_VARIANTS[setting], h, 6));
  const frame = FRAME_FOR_SETTING[setting];
  const avoid = buildAvoidRules({ genre, mood, setting, camera, depth, lighting, uiLayout });
  const paletteVariant = hashConcept(palette.primary + palette.accent) % 997;

  return {
    genre, mood, setting, camera, depth, lighting, environment, uiLayout, palette,
    avoid,
    styleKey: `${genre}-${mood}-${setting}-${camera}-${depth}-${lighting}-${uiLayout}-p${paletteVariant}`,
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
      hud: HUD_SUMMARY[uiLayout],
    },
    motion: MOTION[mood],
    audio: AUDIO_FOR_MOOD[mood],
    scenes: SCENES_FOR_GENRE[genre],
    loop: LOOP_FOR_GENRE[genre],
    presentation: presentationFor(genre, mood, setting, camera, depth, lighting, uiLayout, environment),
    hint: hintFor(camera, genre),
  };
}

/** Light direction the runtime shades faces and offsets cast shadows along. */
const LIGHT_DIRECTION: Record<LightingStyle, "top-left" | "top-right" | "top" | "left"> = {
  flat: "top-left",
  radial: "top",
  spotlight: "top",
  directional: "top-left",
  "neon-glow": "top",
  "ambient-tint": "top-right",
  "day-cycle": "left",
};

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
    // Depth/lighting reach the runtime too, so game.shade/box/light default to a
    // direction and strength that match the brief instead of a fixed guess, and
    // generated code can branch on game.design.* rather than re-deriving it.
    light: LIGHT_DIRECTION[intent.lighting],
    depth: intent.depth,
    lighting: intent.lighting,
    camera: intent.camera,
    ui: intent.uiLayout,
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

  // Did the render actually construct space, or is it a flat plane of rects?
  // These are the checks that map onto the "every game looks the same / too 2D"
  // complaint, so they are worth a point each even though they are heuristic.
  const DEPTH_MARKERS: Record<DepthStyle, RegExp> = {
    flat: /game\.(rect|circle|text)\b/,
    layered: /game\.parallax\b|game\.band\b/,
    projected: /game\.project\b/,
    scaled: /game\.groundScale\b|game\.project\b/,
    "pseudo-3d": /game\.box\b|game\.shadow\b|game\.shade\b/,
    raycast: /game\.band\b|game\.shade\b|game\.fade\b/,
  };
  if (DEPTH_MARKERS[intent.depth].test(src)) score++;
  else issues.push(`depth-ignored:${intent.depth}`);

  const LIGHT_MARKERS: Record<LightingStyle, RegExp> = {
    flat: /game\.(rect|circle)\b/,
    radial: /game\.light\b/,
    spotlight: /game\.cone\b|game\.light\b/,
    directional: /game\.box\b|game\.shadow\b|game\.shade\b/,
    "neon-glow": /game\.glow\b|game\.fade\b/,
    "ambient-tint": /game\.tint\b|game\.fade\b/,
    "day-cycle": /game\.tint\b|game\.band\b/,
  };
  if (LIGHT_MARKERS[intent.lighting].test(src)) score++;
  else issues.push(`lighting-ignored:${intent.lighting}`);

  const critical = new Set(["missing-required-scenes", "legacy-neon-palette"]);
  return { pass: score >= 9 && !issues.some(i => critical.has(i)), score, issues };
}

/** Human-readable one-liner for diagnostics/logs — no user content included. */
export function describeIntent(intent: GameDesignIntent): string {
  return `${intent.genre}/${intent.mood}/${intent.setting} · ${intent.camera}/${intent.depth} · ${intent.lighting} · ui:${intent.uiLayout} · ${intent.chrome.frame} · ${intent.audio}`;
}
