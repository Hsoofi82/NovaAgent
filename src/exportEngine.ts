/**
 * ƝØVΛ — Advanced AI Agent Platform for Telegram
 * Copyright (C) 2026 Hsoofi82
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of Nova (https://github.com/Hsoofi82/NovaAgent).
 *
 * Nova is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * Nova is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for
 * more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Nova. If not, see <https://www.gnu.org/licenses/>.
 */

import {
  NOVA_FONT_TTF_B64,
  NOVA_FONT_UNI2GID,
  NOVA_FONT_GID2ADV,
} from "./novaFont";

/* ════════════════════════════════════════════════════════════════════════
 * SECTION 1 — PUBLIC TYPES
 * ══════════════════════════════════════════════════════════════════════ */

/** Engine identity — bump the version when you extend renderers/themes. */
export const NOVA_OFFICE_VERSION = "0.21 Beta";
export const NOVA_OFFICE_NAME = "Nova Office Engine";

export type ExportFormat = "pdf" | "docx" | "xlsx" | "pptx" | "html" | "md";

/** The five built-in themes shipped with the engine. */
export type BuiltinThemeName = "professional" | "modern" | "elegant" | "minimal" | "dark";
/**
 * A theme name: one of the built-ins, OR any custom theme name registered at
 * runtime via `registerTheme()`. The `(string & {})` keeps IDE autocomplete for
 * the built-ins while still accepting arbitrary registered names — this is what
 * makes the theme system genuinely extensible without editing the core.
 */
export type ThemeName = BuiltinThemeName | (string & {});

export interface ExportOptions {
  /** Desired format. Default "pdf". RTL content requesting "pdf" is auto-routed to "docx". */
  format?: ExportFormat;
  /** Visual theme. Default "professional". */
  theme?: ThemeName;
  /** Document title. Used for cover page / metadata / first heading fallback. */
  title?: string;
  /** Author / organisation shown on the cover and in metadata. */
  author?: string;
  /** BCP-ish language hint ("fa" | "ar" | "en" | ...). Drives RTL auto-detection. */
  lang?: string;
  /** Force text direction. When omitted it is auto-detected from the content. */
  rtl?: boolean;
  /** Force a cover page. When omitted: shown if a title exists and the doc is non-trivial. */
  cover?: boolean;
  /** Force a table of contents. When omitted: shown if there are enough headings. */
  toc?: boolean;
  /** Show page numbers / footers (PDF). Default true. */
  pageNumbers?: boolean;
  /** Custom running-header text (PDF/HTML). Falls back to the title. */
  header?: string;
  /** Custom footer text (PDF/HTML). Falls back to a generated credit line. */
  footer?: string;
}

export interface ExportResult {
  bytes: Uint8Array;
  mime: string;
  ext: string;
  format: ExportFormat;
  /** Human-readable note when the pipeline adjusted the request (e.g. RTL → DOCX). */
  note?: string;
}

/* ── Internal AST ─────────────────────────────────────────────────────── */

/** An inline text span with optional styling. */
export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  link?: string;
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4; inlines: Inline[]; anchor: string }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "code"; lang?: string; text: string }
  | { type: "quote"; inlines: Inline[] }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] }
  | { type: "image"; url: string; alt: string }
  | { type: "hr" };

export interface ParsedDoc {
  title?: string;
  blocks: Block[];
  rtl: boolean;
  /** True when the body contains any tabular data (used by the XLSX heuristic). */
  hasTables: boolean;
}

/* ════════════════════════════════════════════════════════════════════════
 * SECTION 2 — SHARED UTILITIES
 * ══════════════════════════════════════════════════════════════════════ */

const ENC = new TextEncoder();

function utf8(s: string): Uint8Array {
  return ENC.encode(s);
}

/** Concatenate byte chunks into one buffer. */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** XML-escape text content. */
function xmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // strip control chars that are illegal in XML 1.0
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

/** HTML-escape text content. */
function htmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const RTL_STRONG_RE = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LTR_STRONG_RE = /[A-Za-zÀ-ɏ]/g;

/**
 * Decide the dominant direction of a document by counting strong characters.
 * More robust than "contains any Persian char" for mixed content.
 */
function detectRTL(s: string): boolean {
  const rtl = (s.match(RTL_STRONG_RE) || []).length;
  if (rtl === 0) return false;
  const ltr = (s.match(LTR_STRONG_RE) || []).length;
  return rtl >= ltr;
}

/** Slugify a heading into a stable anchor id. */
function slugify(s: string, seen: Set<string>): string {
  let base = s
    .toLowerCase()
    .replace(/[^\w؀-ۿ\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48);
  if (!base) base = "section";
  let id = base;
  let n = 2;
  while (seen.has(id)) id = `${base}-${n++}`;
  seen.add(id);
  return id;
}

function plainInline(inlines: Inline[]): string {
  return inlines.map(i => i.text).join("");
}

function nowStamp(lang?: string): string {
  const d = new Date();
  try {
    const locale = lang === "fa" ? "fa-IR" : lang === "ar" ? "ar" : "en-US";
    return d.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * SECTION 3 — CONTENT PARSER  (Markdown-subset → AST)
 * ════════════════════════════════════════════════════════════════════════
 * Supports: ATX headings (#..####), fenced code (``` ), blockquotes (>),
 * unordered (-, *, +) and ordered (1.) lists, GFM tables (| a | b |),
 * horizontal rules (---, ***), images ![alt](url), and inline spans:
 * **bold**, *italic* / _italic_, `code`, ~~strike~~, [text](url), bare URLs.
 * ────────────────────────────────────────────────────────────────────── */

function parseInline(raw: string): Inline[] {
  const out: Inline[] = [];
  const text = raw;
  let i = 0;

  const push = (t: string, style: Partial<Inline>) => {
    if (!t) return;
    out.push({ text: t, ...style });
  };

  // Tokeniser with a small precedence: code > link/image > bold > italic > strike.
  while (i < text.length) {
    const ch = text[i];

    // inline code `...`
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        push(text.slice(i + 1, end), { code: true });
        i = end + 1;
        continue;
      }
    }

    // links [text](url)
    if (ch === "[") {
      const close = text.indexOf("]", i);
      if (close > i && text[close + 1] === "(") {
        const paren = text.indexOf(")", close + 2);
        if (paren > close) {
          const label = text.slice(i + 1, close);
          const url = text.slice(close + 2, paren).trim();
          // labels may themselves contain styling
          for (const seg of parseInline(label)) out.push({ ...seg, link: url });
          i = paren + 1;
          continue;
        }
      }
    }

    // bold **...** or __...__
    if ((ch === "*" && text[i + 1] === "*") || (ch === "_" && text[i + 1] === "_")) {
      const marker = ch + ch;
      const end = text.indexOf(marker, i + 2);
      if (end > i) {
        for (const seg of parseInline(text.slice(i + 2, end))) out.push({ ...seg, bold: true });
        i = end + 2;
        continue;
      }
    }

    // strike ~~...~~
    if (ch === "~" && text[i + 1] === "~") {
      const end = text.indexOf("~~", i + 2);
      if (end > i) {
        for (const seg of parseInline(text.slice(i + 2, end))) out.push({ ...seg, strike: true });
        i = end + 2;
        continue;
      }
    }

    // italic *...* or _..._  (single marker, not part of a double)
    if ((ch === "*" || ch === "_") && text[i + 1] !== ch) {
      const end = text.indexOf(ch, i + 1);
      if (end > i && text[end - 1] !== " ") {
        for (const seg of parseInline(text.slice(i + 1, end))) out.push({ ...seg, italic: true });
        i = end + 1;
        continue;
      }
    }

    // plain run up to the next potential marker
    let j = i + 1;
    while (j < text.length && !"`[*_~".includes(text[j])) j++;
    push(text.slice(i, j), {});
    i = j;
  }

  // Merge adjacent identical-style plain runs for cleaner output.
  const merged: Inline[] = [];
  for (const seg of out) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      !!prev.bold === !!seg.bold &&
      !!prev.italic === !!seg.italic &&
      !!prev.code === !!seg.code &&
      !!prev.strike === !!seg.strike &&
      prev.link === seg.link
    ) {
      prev.text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged.length ? merged : [{ text: raw }];
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === "\\" && trimmed[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

export function parseDocument(input: string, opts: ExportOptions = {}): ParsedDoc {
  const src = (input || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = src.split("\n");
  const blocks: Block[] = [];
  const seenAnchors = new Set<string>();
  let hasTables = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // blank line
    if (!trimmed) {
      i++;
      continue;
    }

    // fenced code block
    const fence = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const marker = fence[1][0];
      const lang = fence[2].trim() || undefined;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker.repeat(3))) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      blocks.push({ type: "code", lang, text: buf.join("\n") });
      continue;
    }

    // heading
    const h = trimmed.match(/^(#{1,4})\s+(.+?)\s*#*$/);
    if (h) {
      const level = h[1].length as 1 | 2 | 3 | 4;
      const inlines = parseInline(h[2]);
      const anchor = slugify(plainInline(inlines), seenAnchors);
      blocks.push({ type: "heading", level, inlines, anchor });
      i++;
      continue;
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // standalone image  ![alt](url)
    const img = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (img) {
      blocks.push({ type: "image", alt: img[1], url: img[2].trim() });
      i++;
      continue;
    }

    // table: current line has pipes and next line is a divider
    if (trimmed.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitTableRow(line).map(parseInline);
      i += 2; // header + divider
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]).map(parseInline));
        i++;
      }
      hasTables = true;
      blocks.push({ type: "table", header, rows });
      continue;
    }

    // blockquote (possibly multi-line)
    if (/^>\s?/.test(trimmed)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", inlines: parseInline(buf.join(" ").trim()) });
      continue;
    }

    // lists (unordered / ordered) — consume consecutive item lines
    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    const olMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ulMatch || olMatch) {
      const ordered = !!olMatch;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const lt = lines[i].trim();
        const um = lt.match(/^[-*+]\s+(.+)$/);
        const om = lt.match(/^\d+[.)]\s+(.+)$/);
        if (ordered && om) items.push(parseInline(om[1]));
        else if (!ordered && um) items.push(parseInline(um[1]));
        else if (lt && !/^(#{1,4}\s|>|```|~~~)/.test(lt) && (um || om ? false : items.length > 0) && /^\s+/.test(lines[i])) {
          // continuation line indented under the previous item
          const last = items[items.length - 1];
          if (last) last.push({ text: " " + lt });
        } else break;
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // paragraph: gather until blank line or a block starter
    const buf: string[] = [line];
    i++;
    while (i < lines.length) {
      const lt = lines[i].trim();
      if (!lt) break;
      if (/^(#{1,4}\s|>|\s*[-*+]\s|\s*\d+[.)]\s|```|~~~|-{3,}$|\*{3,}$)/.test(lt)) break;
      if (lt.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) break;
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", inlines: parseInline(buf.join(" ").trim()) });
  }

  // Title inference: explicit option wins, else a leading H1.
  let title = opts.title;
  if (!title) {
    const firstH1 = blocks.find(b => b.type === "heading" && b.level === 1) as
      | Extract<Block, { type: "heading" }>
      | undefined;
    if (firstH1) title = plainInline(firstH1.inlines);
  }

  const rtl =
    typeof opts.rtl === "boolean"
      ? opts.rtl
      : opts.lang === "fa" || opts.lang === "ar"
      ? true
      : detectRTL(src);

  return { title, blocks, rtl, hasTables };
}

/* ════════════════════════════════════════════════════════════════════════
 * SECTION 4 — THEME REGISTRY
 * ══════════════════════════════════════════════════════════════════════ */

export interface Theme {
  name: ThemeName;
  /** RGB 0..1 triples for the PDF renderer. */
  pageBg: [number, number, number] | null; // null = white (no fill)
  text: [number, number, number];
  textFaint: [number, number, number];
  heading: [number, number, number];
  accent: [number, number, number];
  rule: [number, number, number];
  codeBg: [number, number, number];
  codeText: [number, number, number];
  quoteBar: [number, number, number];
  tableHeaderBg: [number, number, number];
  tableHeaderText: [number, number, number];
  tableStripe: [number, number, number];
  /** Base PDF font family. */
  serif: boolean;
  /** CSS hex equivalents for HTML/OOXML renderers. */
  css: {
    pageBg: string;
    text: string;
    heading: string;
    accent: string;
    rule: string;
    codeBg: string;
    quoteBar: string;
    tableHeaderBg: string;
    tableHeaderText: string;
    stripe: string;
    fontStack: string;
  };
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const FONT_SANS = "'Segoe UI', Tahoma, 'Iranian Sans', Vazirmatn, Arial, sans-serif";
const FONT_SERIF = "Georgia, 'Times New Roman', 'B Nazanin', serif";

export const THEMES: Record<BuiltinThemeName, Theme> = {
  professional: {
    name: "professional",
    pageBg: null,
    text: rgb("#1f2430"),
    textFaint: rgb("#6b7280"),
    heading: rgb("#0f3460"),
    accent: rgb("#1d6fb8"),
    rule: rgb("#d5dbe5"),
    codeBg: rgb("#f4f5f8"),
    codeText: rgb("#22303c"),
    quoteBar: rgb("#1d6fb8"),
    tableHeaderBg: rgb("#0f3460"),
    tableHeaderText: rgb("#ffffff"),
    tableStripe: rgb("#f2f5f9"),
    serif: false,
    css: { pageBg: "#ffffff", text: "#1f2430", heading: "#0f3460", accent: "#1d6fb8", rule: "#d5dbe5", codeBg: "#f4f5f8", quoteBar: "#1d6fb8", tableHeaderBg: "#0f3460", tableHeaderText: "#ffffff", stripe: "#f2f5f9", fontStack: FONT_SANS },
  },
  modern: {
    name: "modern",
    pageBg: null,
    text: rgb("#111827"),
    textFaint: rgb("#6b7280"),
    heading: rgb("#111827"),
    accent: rgb("#6d28d9"),
    rule: rgb("#e5e7eb"),
    codeBg: rgb("#f5f3ff"),
    codeText: rgb("#3b0764"),
    quoteBar: rgb("#8b5cf6"),
    tableHeaderBg: rgb("#6d28d9"),
    tableHeaderText: rgb("#ffffff"),
    tableStripe: rgb("#f7f5ff"),
    serif: false,
    css: { pageBg: "#ffffff", text: "#111827", heading: "#111827", accent: "#6d28d9", rule: "#e5e7eb", codeBg: "#f5f3ff", quoteBar: "#8b5cf6", tableHeaderBg: "#6d28d9", tableHeaderText: "#ffffff", stripe: "#f7f5ff", fontStack: FONT_SANS },
  },
  elegant: {
    name: "elegant",
    pageBg: null,
    text: rgb("#2b2b2b"),
    textFaint: rgb("#7a7266"),
    heading: rgb("#5b3a29"),
    accent: rgb("#a67c52"),
    rule: rgb("#e3d9c8"),
    codeBg: rgb("#f7f3ec"),
    codeText: rgb("#4a3b2a"),
    quoteBar: rgb("#a67c52"),
    tableHeaderBg: rgb("#5b3a29"),
    tableHeaderText: rgb("#fbf6ee"),
    tableStripe: rgb("#faf6ef"),
    serif: true,
    css: { pageBg: "#fffdf9", text: "#2b2b2b", heading: "#5b3a29", accent: "#a67c52", rule: "#e3d9c8", codeBg: "#f7f3ec", quoteBar: "#a67c52", tableHeaderBg: "#5b3a29", tableHeaderText: "#fbf6ee", stripe: "#faf6ef", fontStack: FONT_SERIF },
  },
  minimal: {
    name: "minimal",
    pageBg: null,
    text: rgb("#222222"),
    textFaint: rgb("#888888"),
    heading: rgb("#000000"),
    accent: rgb("#000000"),
    rule: rgb("#e0e0e0"),
    codeBg: rgb("#f6f6f6"),
    codeText: rgb("#222222"),
    quoteBar: rgb("#bdbdbd"),
    tableHeaderBg: rgb("#efefef"),
    tableHeaderText: rgb("#111111"),
    tableStripe: rgb("#fafafa"),
    serif: false,
    css: { pageBg: "#ffffff", text: "#222222", heading: "#000000", accent: "#000000", rule: "#e0e0e0", codeBg: "#f6f6f6", quoteBar: "#bdbdbd", tableHeaderBg: "#efefef", tableHeaderText: "#111111", stripe: "#fafafa", fontStack: FONT_SANS },
  },
  dark: {
    name: "dark",
    pageBg: rgb("#0f1420"),
    text: rgb("#e6e9ef"),
    textFaint: rgb("#9aa4b2"),
    heading: rgb("#7ab8ff"),
    accent: rgb("#4f9dff"),
    rule: rgb("#2a3446"),
    codeBg: rgb("#161d2c"),
    codeText: rgb("#d6deea"),
    quoteBar: rgb("#4f9dff"),
    tableHeaderBg: rgb("#1b2536"),
    tableHeaderText: rgb("#e6e9ef"),
    tableStripe: rgb("#141b28"),
    serif: false,
    css: { pageBg: "#0f1420", text: "#e6e9ef", heading: "#7ab8ff", accent: "#4f9dff", rule: "#2a3446", codeBg: "#161d2c", quoteBar: "#4f9dff", tableHeaderBg: "#1b2536", tableHeaderText: "#e6e9ef", stripe: "#141b28", fontStack: FONT_SANS },
  },
};

/**
 * Runtime registry for custom themes added via `registerTheme()`. Built-ins in
 * THEMES always win a name clash unless explicitly overridden here. This is the
 * seam that lets future Nova Office versions ship extra palettes — or lets a
 * caller inject a brand theme — without touching the core renderers.
 */
const CUSTOM_THEMES = new Map<string, Theme>();

/**
 * Register (or override) a theme by name. Pass a full Theme, or a partial that
 * is merged onto a base theme (default "professional") so you only specify what
 * changes. Returns the resolved Theme.
 *
 *   registerTheme("brand", { accent: rgb("#e11d48"), css: { ...pro.css, accent: "#e11d48" } })
 */
export function registerTheme(
  name: string,
  theme: Partial<Theme> & { base?: BuiltinThemeName },
): Theme {
  const base = THEMES[theme.base || "professional"];
  const merged: Theme = {
    ...base,
    ...theme,
    name,
    css: { ...base.css, ...(theme.css || {}) },
  };
  CUSTOM_THEMES.set(name, merged);
  return merged;
}

// ── تم‌های اضافه‌ی جدید — با همون API عمومیِ registerTheme، برای افزایش
// تنوع بصری بدون دست‌زدن به موتور رندر. ───────────────────────────────
registerTheme("corporate", {
  base: "professional",
  pageBg: null,
  text: rgb("#1b1f27"), textFaint: rgb("#6b7280"), heading: rgb("#0b2545"),
  accent: rgb("#c9972c"), rule: rgb("#dde3ec"), codeBg: rgb("#f2f4f8"),
  codeText: rgb("#1b1f27"), quoteBar: rgb("#c9972c"),
  tableHeaderBg: rgb("#0b2545"), tableHeaderText: rgb("#ffffff"), tableStripe: rgb("#f5f7fb"),
  serif: false,
  css: { pageBg: "#ffffff", text: "#1b1f27", heading: "#0b2545", accent: "#c9972c", rule: "#dde3ec", codeBg: "#f2f4f8", quoteBar: "#c9972c", tableHeaderBg: "#0b2545", tableHeaderText: "#ffffff", stripe: "#f5f7fb", fontStack: FONT_SANS },
});

registerTheme("sunset", {
  base: "modern",
  pageBg: null,
  text: rgb("#2a1e1a"), textFaint: rgb("#8a6f63"), heading: rgb("#9a2d1f"),
  accent: rgb("#e8703a"), rule: rgb("#f0ddd0"), codeBg: rgb("#fdf1e8"),
  codeText: rgb("#5c3a24"), quoteBar: rgb("#e8703a"),
  tableHeaderBg: rgb("#9a2d1f"), tableHeaderText: rgb("#fff7f0"), tableStripe: rgb("#fdf3ec"),
  serif: false,
  css: { pageBg: "#fffaf6", text: "#2a1e1a", heading: "#9a2d1f", accent: "#e8703a", rule: "#f0ddd0", codeBg: "#fdf1e8", quoteBar: "#e8703a", tableHeaderBg: "#9a2d1f", tableHeaderText: "#fff7f0", stripe: "#fdf3ec", fontStack: FONT_SANS },
});

registerTheme("ocean", {
  base: "minimal",
  pageBg: null,
  text: rgb("#132a33"), textFaint: rgb("#5c7a83"), heading: rgb("#0e5c6b"),
  accent: rgb("#12939e"), rule: rgb("#d7ecef"), codeBg: rgb("#eaf7f8"),
  codeText: rgb("#0e3d45"), quoteBar: rgb("#12939e"),
  tableHeaderBg: rgb("#0e5c6b"), tableHeaderText: rgb("#ffffff"), tableStripe: rgb("#eefaf9"),
  serif: false,
  css: { pageBg: "#ffffff", text: "#132a33", heading: "#0e5c6b", accent: "#12939e", rule: "#d7ecef", codeBg: "#eaf7f8", quoteBar: "#12939e", tableHeaderBg: "#0e5c6b", tableHeaderText: "#ffffff", stripe: "#eefaf9", fontStack: FONT_SANS },
});

/** List every theme name the engine can currently resolve (built-in + custom). */
export function listThemes(): string[] {
  return [...Object.keys(THEMES), ...CUSTOM_THEMES.keys()];
}

function resolveTheme(name?: ThemeName): Theme {
  if (name) {
    if (name in THEMES) return THEMES[name as BuiltinThemeName];
    const custom = CUSTOM_THEMES.get(name);
    if (custom) return custom;
  }
  return THEMES.professional;
}

/* ════════════════════════════════════════════════════════════════════════
 * SECTION 5 — ZIP WRITER + CRC32  (OOXML packaging)
 * ════════════════════════════════════════════════════════════════════════
 * Minimal ZIP writer using the STORE method (no compression). OOXML readers
 * (Word/Excel/PowerPoint) accept stored entries, which lets us avoid shipping
 * a DEFLATE implementation. Files are small, so the size cost is acceptable.
 * ────────────────────────────────────────────────────────────────────── */

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
  crc: number;
}

/** Build a valid ZIP archive (STORE method) from named UTF-8/byte entries. */
function buildZip(files: Array<{ name: string; data: string | Uint8Array }>): Uint8Array {
  const entries: ZipEntry[] = files.map(f => {
    const data = typeof f.data === "string" ? utf8(f.data) : f.data;
    return { name: f.name, data, crc: crc32(data) };
  });

  const localChunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;

  const dosTime = 0; // 00:00:00
  const dosDate = 0x21; // 1980-01-01 (deterministic output)

  for (const e of entries) {
    const nameBytes = utf8(e.name);
    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); // local file header sig
    dv.setUint16(4, 20, true); // version needed
    dv.setUint16(6, 0x0800, true); // flags: UTF-8 filenames
    dv.setUint16(8, 0, true); // method: store
    dv.setUint16(10, dosTime, true);
    dv.setUint16(12, dosDate, true);
    dv.setUint32(14, e.crc, true);
    dv.setUint32(18, e.data.length, true); // compressed size
    dv.setUint32(22, e.data.length, true); // uncompressed size
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true); // extra len
    local.set(nameBytes, 30);

    offsets.push(offset);
    localChunks.push(local, e.data);
    offset += local.length + e.data.length;
  }

  entries.forEach((e, idx) => {
    const nameBytes = utf8(e.name);
    const cd = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(cd.buffer);
    dv.setUint32(0, 0x02014b50, true); // central dir sig
    dv.setUint16(4, 20, true); // version made by
    dv.setUint16(6, 20, true); // version needed
    dv.setUint16(8, 0x0800, true); // flags
    dv.setUint16(10, 0, true); // method
    dv.setUint16(12, dosTime, true);
    dv.setUint16(14, dosDate, true);
    dv.setUint32(16, e.crc, true);
    dv.setUint32(20, e.data.length, true);
    dv.setUint32(24, e.data.length, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint16(30, 0, true); // extra
    dv.setUint16(32, 0, true); // comment
    dv.setUint16(34, 0, true); // disk number
    dv.setUint16(36, 0, true); // internal attrs
    dv.setUint32(38, 0, true); // external attrs
    dv.setUint32(42, offsets[idx], true); // local header offset
    cd.set(nameBytes, 46);
    central.push(cd);
  });

  const centralBytes = concatBytes(central);
  const localBytes = concatBytes(localChunks);

  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true); // EOCD sig
  dv.setUint16(4, 0, true); // disk
  dv.setUint16(6, 0, true); // cd start disk
  dv.setUint16(8, entries.length, true);
  dv.setUint16(10, entries.length, true);
  dv.setUint32(12, centralBytes.length, true);
  dv.setUint32(16, localBytes.length, true); // central dir offset
  dv.setUint16(20, 0, true); // comment len

  return concatBytes([localBytes, centralBytes, eocd]);
}

/** Ergonomic wrapper: zip a list of OPC parts addressed by `path`. */
function zipSync(parts: Array<{ path: string; data: string | Uint8Array }>): Uint8Array {
  return buildZip(parts.map(p => ({ name: p.path, data: p.data })));
}

/* ════════════════════════════════════════════════════════════════════════
 * SECTION 6 — PDF FONT METRICS  (Standard-14 AFM widths, units/1000 em)
 * ══════════════════════════════════════════════════════════════════════ */

// Widths for printable ASCII 0x20..0x7E. Canonical Adobe AFM values.
const W_HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_HELV_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const W_TIMES = [250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541];
const W_TIMES_B = [250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,520];

/** Text-width in em-units for a WinAnsi string under the chosen standard font. */
function pdfTextWidth(text: string, bold: boolean, serif: boolean, mono: boolean): number {
  if (mono) return text.length * 600;
  const table = serif ? (bold ? W_TIMES_B : W_TIMES) : bold ? W_HELV_B : W_HELV;
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) w += table[code - 0x20];
    else if (code === 0x2022) w += serif ? 460 : 350; // bullet approx
    else w += table[bold ? 34 : 34] || 556; // approx for extended/WinAnsi
  }
  return w;
}

// Map common Unicode punctuation to CP1252/WinAnsi byte values.
const WINANSI_MAP: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

/** Convert a Unicode string to a PDF literal escaped for WinAnsiEncoding. */
function toPdfLiteral(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code > 0xff) {
      code = WINANSI_MAP[code] ?? 0x3f; // '?'
    } else if (code >= 0x80 && code <= 0x9f) {
      // C1 range is not directly WinAnsi; only keep if we have a mapping target
      code = 0x3f;
    }
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += "\\" + String.fromCharCode(code);
    else if (code < 0x20 || code > 0x7e) out += "\\" + code.toString(8).padStart(3, "0");
    else out += String.fromCharCode(code);
  }
  return out;
}

/** Sanitise a string for WinAnsi width measurement (mirror toPdfLiteral mapping). */
function toWinAnsiChars(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) out += WINANSI_MAP[code] !== undefined ? String.fromCharCode(WINANSI_MAP[code]) : "?";
    else if (code >= 0x80 && code <= 0x9f) out += "?";
    else out += text[i];
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════════════
 * SECTION 6.5 — ARABIC/PERSIAN SHAPING + EMBEDDED-FONT SUPPORT (Nova Office)
 * ════════════════════════════════════════════════════════════════════════
 * The base-14 PDF fonts cannot shape Arabic script, which historically forced
 * a PDF→DOCX reroute for Persian/Arabic. Nova Office instead embeds a real
 * Unicode font (Vazirmatn subset, see novaFont.ts) and does its own contextual
 * shaping + RTL reordering, so a user who asks for a PDF gets a REAL Persian
 * PDF. The renderer maps each shaped code point to a glyph id and emits it via
 * an Identity-H CIDFontType2 (2-byte glyph codes).
 * ────────────────────────────────────────────────────────────────────── */

/** Arabic joining classes for the letters Vazirmatn covers. */
// For each base letter: [isolated, final, initial, medial] presentation-form
// code points (U+FExx). A letter that only joins to the RIGHT (like alef) has
// no initial/medial form → those entries repeat the isolated/final form.
const ARABIC_FORMS: Record<number, [number, number, number, number]> = {
  0x0621: [0xFE80, 0xFE80, 0xFE80, 0xFE80], // hamza (non-joining)
  0x0622: [0xFE81, 0xFE82, 0xFE81, 0xFE82], // alef madda
  0x0623: [0xFE83, 0xFE84, 0xFE83, 0xFE84], // alef hamza above
  0x0624: [0xFE85, 0xFE86, 0xFE85, 0xFE86], // waw hamza
  0x0625: [0xFE87, 0xFE88, 0xFE87, 0xFE88], // alef hamza below
  0x0626: [0xFE89, 0xFE8A, 0xFE8B, 0xFE8C], // yeh hamza
  0x0627: [0xFE8D, 0xFE8E, 0xFE8D, 0xFE8E], // alef
  0x0628: [0xFE8F, 0xFE90, 0xFE91, 0xFE92], // beh
  0x0629: [0xFE93, 0xFE94, 0xFE93, 0xFE94], // teh marbuta
  0x062A: [0xFE95, 0xFE96, 0xFE97, 0xFE98], // teh
  0x062B: [0xFE99, 0xFE9A, 0xFE9B, 0xFE9C], // theh
  0x062C: [0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0], // jeem
  0x062D: [0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4], // hah
  0x062E: [0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8], // khah
  0x062F: [0xFEA9, 0xFEAA, 0xFEA9, 0xFEAA], // dal
  0x0630: [0xFEAB, 0xFEAC, 0xFEAB, 0xFEAC], // thal
  0x0631: [0xFEAD, 0xFEAE, 0xFEAD, 0xFEAE], // reh
  0x0632: [0xFEAF, 0xFEB0, 0xFEAF, 0xFEB0], // zain
  0x0633: [0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4], // seen
  0x0634: [0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8], // sheen
  0x0635: [0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC], // sad
  0x0636: [0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0], // dad
  0x0637: [0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4], // tah
  0x0638: [0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8], // zah
  0x0639: [0xFEC9, 0xFECA, 0xFECB, 0xFECC], // ain
  0x063A: [0xFECD, 0xFECE, 0xFECF, 0xFED0], // ghain
  0x0641: [0xFED1, 0xFED2, 0xFED3, 0xFED4], // feh
  0x0642: [0xFED5, 0xFED6, 0xFED7, 0xFED8], // qaf
  0x0643: [0xFED9, 0xFEDA, 0xFEDB, 0xFEDC], // kaf
  0x0644: [0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0], // lam
  0x0645: [0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4], // meem
  0x0646: [0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8], // noon
  0x0647: [0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC], // heh
  0x0648: [0xFEED, 0xFEEE, 0xFEED, 0xFEEE], // waw
  0x0649: [0xFEEF, 0xFEF0, 0xFBE8, 0xFBE9], // alef maksura
  0x064A: [0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4], // yeh
  // Persian-specific letters
  0x067E: [0xFB56, 0xFB57, 0xFB58, 0xFB59], // peh
  0x0686: [0xFB7A, 0xFB7B, 0xFB7C, 0xFB7D], // cheh
  0x0698: [0xFB8A, 0xFB8B, 0xFB8A, 0xFB8B], // jeh (right-joining)
  0x06A9: [0xFB8E, 0xFB8F, 0xFB90, 0xFB91], // keheh (Persian kaf)
  0x06AF: [0xFB92, 0xFB93, 0xFB94, 0xFB95], // gaf
  0x06CC: [0xFBFC, 0xFBFD, 0xFBFE, 0xFBFF], // farsi yeh
  0x0640: [0x0640, 0x0640, 0x0640, 0x0640], // tatweel (joins both, no change)
};

// Letters that join to the following letter (have initial/medial forms).
function joinsToNext(cp: number): boolean {
  const f = ARABIC_FORMS[cp];
  return !!f && f[2] !== f[0]; // initial differs from isolated ⇒ dual-joining
}
// Every Arabic letter joins to the previous one if the previous one joins-to-next.
function isArabicLetter(cp: number): boolean {
  return ARABIC_FORMS[cp] !== undefined && cp !== 0x0640;
}
function isArabicChar(cp: number): boolean {
  return (cp >= 0x0600 && cp <= 0x06FF) || (cp >= 0xFB50 && cp <= 0xFEFF);
}
// Combining marks (harakat) — they don't affect joining and sit on the base.
function isArabicMark(cp: number): boolean {
  return (cp >= 0x064B && cp <= 0x065F) || cp === 0x0670 || (cp >= 0x06D6 && cp <= 0x06ED);
}

/**
 * Contextual shaping: turn a logical Arabic/Persian string into its
 * presentation forms, handling lam-alef ligatures. Returns an array of code
 * points ready to be reversed for RTL and mapped to glyphs. Non-Arabic
 * characters pass through unchanged.
 */
function shapeArabic(text: string): number[] {
  const cps: number[] = [];
  for (const ch of text) cps.push(ch.codePointAt(0)!);

  const out: number[] = [];
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (!isArabicLetter(cp)) { out.push(cp); continue; }

    // Determine neighbours ignoring combining marks.
    let prev = -1;
    for (let j = i - 1; j >= 0; j--) { if (!isArabicMark(cps[j])) { prev = cps[j]; break; } }
    let next = -1;
    for (let j = i + 1; j < cps.length; j++) { if (!isArabicMark(cps[j])) { next = cps[j]; break; } }

    const prevJoins = prev >= 0 && joinsToNext(prev);
    const nextIsLetter = next >= 0 && isArabicLetter(next);

    // lam-alef ligature: lam (0x0644) + one of the alef family.
    if (cp === 0x0644 && (next === 0x0627 || next === 0x0622 || next === 0x0623 || next === 0x0625)) {
      const ligIso: Record<number, number> = { 0x0627: 0xFEFB, 0x0622: 0xFEF5, 0x0623: 0xFEF7, 0x0625: 0xFEF9 };
      const ligFin: Record<number, number> = { 0x0627: 0xFEFC, 0x0622: 0xFEF6, 0x0623: 0xFEF8, 0x0625: 0xFEFA };
      out.push(prevJoins ? ligFin[next] : ligIso[next]);
      i++; // consume the alef too
      continue;
    }

    const forms = ARABIC_FORMS[cp];
    const canJoinNext = nextIsLetter && joinsToNext(cp);
    let form: number;
    if (prevJoins && canJoinNext) form = forms[3];      // medial
    else if (prevJoins && !canJoinNext) form = forms[1]; // final
    else if (!prevJoins && canJoinNext) form = forms[2]; // initial
    else form = forms[0];                                // isolated
    out.push(form);
  }
  return out;
}

/** Strong-RTL detection for a run (used to decide bidi reversal). */
function runIsRTL(text: string): boolean {
  return /[؀-ۿݐ-ݿﭐ-﻿]/.test(text);
}

/**
 * Reorder a shaped line for visual (left-to-right) rendering. This is a
 * pragmatic bidi: it reverses the whole line for RTL context but keeps runs of
 * Latin/digits/neutral characters in their original left-to-right order.
 * Sufficient for typical Persian documents with embedded numbers/English.
 */
function bidiReorder(cps: number[], baseRTL: boolean): number[] {
  if (!baseRTL) return cps;
  // Split into runs of "strong LTR" (latin letters, ASCII digits, and
  // Persian/Arabic-Indic digits) vs the rest. Persian/Arabic digits (۰-۹ and
  // ٠-٩) are logically LTR even inside RTL text — without this, a whole-line
  // reversal scrambles their internal order too (e.g. "۱۳۹۹" -> "۹۹۳۱").
  const isNumeric = (c: number) =>
    (c >= 0x30 && c <= 0x39) ||   // ASCII digits
    (c >= 0x0660 && c <= 0x0669) || // Arabic-Indic digits ٠-٩
    (c >= 0x06F0 && c <= 0x06F9);   // Extended Arabic-Indic (Persian) digits ۰-۹
  const isLatin = (c: number) => isNumeric(c) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A);
  const out: number[] = [];
  let i = cps.length - 1;
  while (i >= 0) {
    if (isLatin(cps[i])) {
      // collect the contiguous latin/numeric run, keep its internal order
      let j = i;
      while (
        j >= 0 &&
        (isLatin(cps[j]) || cps[j] === 0x20 || cps[j] === 0x2E || cps[j] === 0x2C || cps[j] === 0x066B || cps[j] === 0x066C)
      ) j--;
      for (let k = j + 1; k <= i; k++) out.push(cps[k]);
      i = j;
    } else {
      out.push(cps[i]);
      i--;
    }
  }
  return out;
}

/** Full pipeline: shape + reorder a string for PDF emission. */
function shapeForPdf(text: string, rtl: boolean): number[] {
  const shaped = shapeArabic(text);
  return bidiReorder(shaped, rtl);
}

/** Map a code point to an embedded-font glyph id (0 = .notdef fallback). */
function glyphId(cp: number): number {
  return NOVA_FONT_UNI2GID[cp] ?? 0;
}
/** Advance width (1000-unit space) for a code point via its glyph. */
function glyphAdvance(cp: number): number {
  const g = glyphId(cp);
  return NOVA_FONT_GID2ADV[g] ?? 500;
}
/** Does the embedded font have a glyph for this code point? */
function fontHasGlyph(cp: number): boolean {
  return NOVA_FONT_UNI2GID[cp] !== undefined;
}

/** Decode the embedded base64 TTF into bytes (once, memoized). */
let _fontBytesCache: Uint8Array | null = null;
function embeddedFontBytes(): Uint8Array {
  if (_fontBytesCache) return _fontBytesCache;
  const bin = atob(NOVA_FONT_TTF_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  _fontBytesCache = out;
  return out;
}

/* ════════════════════════════════════════════════════════════════════════
 * SECTION 7 — PDF RENDERER  (vector layout for Latin / LTR content)
 * ════════════════════════════════════════════════════════════════════════
 * Produces a real, standards-compliant PDF 1.7 with the Standard-14 fonts
 * (Helvetica / Times family + Courier). Features: cover page, table of
 * contents, headings, paragraphs, lists, code blocks, quotes, tables,
 * hyperlinks (link annotations), running header/footer, page numbers, and
 * automatic page breaks with smart word wrapping.
 *
 * Coordinate system: PDF origin is bottom-left; we track a top-down `cursorY`
 * and convert on emit. Units are points (72 pt = 1 inch). Page = US Letter.
 * ────────────────────────────────────────────────────────────────────── */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 64;
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 66;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

interface LinkAnnot {
  x: number;
  y: number; // bottom-left in PDF space
  w: number;
  h: number;
  url: string;
}

interface PdfPage {
  ops: string[];
  links: LinkAnnot[];
}

type RunStyle = "regular" | "bold" | "italic" | "mono";
interface LaidRun { text: string; style: RunStyle; link?: string; w: number }

class PdfBuilder {
  private pages: PdfPage[] = [];
  private cur!: PdfPage;
  private cursorY = 0;
  private theme: Theme;
  private opts: ExportOptions;
  private serif: boolean;
  // RTL mode: emit text through the embedded Unicode font (Vazirmatn) with our
  // own Arabic shaping, so Persian/Arabic renders as a REAL PDF instead of the
  // old PDF→DOCX reroute. When false, the proven base-14 Latin path is used.
  private rtl: boolean;

  constructor(theme: Theme, opts: ExportOptions, rtl = false) {
    this.theme = theme;
    this.opts = opts;
    this.serif = theme.serif;
    this.rtl = rtl;
  }

  private col(c: [number, number, number]): string {
    return `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)}`;
  }

  private fontName(style: RunStyle): string {
    return style === "mono" ? "FM" : style === "bold" ? "FB" : style === "italic" ? "FI" : "FR";
  }

  /* ── RTL / embedded-font text helpers ───────────────────────────────── */

  /** Width (in text-space/1000) of a shaped-then-mapped string in the embedded font. */
  private measureEmbedded(text: string): number {
    let w = 0;
    for (const ch of text) w += glyphAdvance(ch.codePointAt(0)!);
    return w;
  }

  /** Escape a run of code points into a 2-byte-hex Identity-H string `<....>`. */
  private glyphHex(cps: number[]): string {
    let s = "";
    for (const cp of cps) {
      const g = glyphId(cp) & 0xffff;
      s += g.toString(16).padStart(4, "0");
    }
    return `<${s}>`;
  }

  /**
   * Emit one visual line of RTL text at (xRight baseline top = this.cursorY).
   * `text` is logical order; we shape + bidi-reorder, then right-align so the
   * line ends at the right margin. Uses the embedded font "/FA".
   */
  private emitRtlText(text: string, size: number, color: [number, number, number], opts: { xRight?: number; xLeft?: number } = {}): void {
    const cps = shapeForPdf(text, true);
    const widthUnits = cps.reduce((a, cp) => a + glyphAdvance(cp), 0);
    const wPts = (widthUnits / 1000) * size;
    const xRight = opts.xRight ?? (PAGE_W - MARGIN_X);
    const x = Math.max(opts.xLeft ?? MARGIN_X, xRight - wPts);
    const baseline = PAGE_H - this.cursorY - size;
    this.cur.ops.push(
      "BT", `/FA ${size} Tf`, `${this.col(color)} rg`,
      `1 0 0 1 ${x.toFixed(2)} ${baseline.toFixed(2)} Tm`,
      `${this.glyphHex(cps)} Tj`, "ET",
    );
  }

  /** Word-wrap logical RTL text to fit maxWidthPts; returns visual lines. */
  private wrapRtl(text: string, size: number, maxWidthPts: number): string[] {
    const words = text.split(/(\s+)/).filter(w => w !== "");
    const lines: string[] = [];
    let cur = "";
    const widthOf = (s: string) => (this.measureEmbedded(s) / 1000) * size;
    for (const word of words) {
      const trial = cur + word;
      if (widthOf(trial) > maxWidthPts && cur.trim()) {
        lines.push(cur.trim());
        cur = /^\s+$/.test(word) ? "" : word;
      } else {
        cur = trial;
      }
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines.length ? lines : [""];
  }

  get pageCount(): number { return this.pages.length; }

  newPage(withChrome = true): void {
    this.cur = { ops: [], links: [] };
    this.pages.push(this.cur);
    if (this.theme.pageBg) {
      this.cur.ops.push(`${this.col(this.theme.pageBg)} rg`, `0 0 ${PAGE_W} ${PAGE_H} re f`);
    }
    this.cursorY = MARGIN_TOP;
    if (withChrome) this.drawChrome();
  }

  private drawChrome(): void {
    const pageNo = this.pages.length;
    const headerText = this.opts.header ?? this.opts.title ?? "";
    if (this.rtl) {
      // RTL chrome: header shaped & right-aligned, footer shaped, page number left.
      if (headerText) {
        this.cur.ops.push("BT", `/FA 8 Tf`, `${this.col(this.theme.textFaint)} rg`);
        const cps = shapeForPdf(this.clip(headerText, 60), true);
        const w = (cps.reduce((a, c) => a + glyphAdvance(c), 0) / 1000) * 8;
        this.cur.ops.push(
          `1 0 0 1 ${(PAGE_W - MARGIN_X - w).toFixed(2)} ${PAGE_H - 44} Tm`,
          `${this.glyphHex(cps)} Tj`, "ET",
          `${this.col(this.theme.rule)} RG 0.5 w`,
          `${MARGIN_X} ${PAGE_H - 50} m ${PAGE_W - MARGIN_X} ${PAGE_H - 50} l S`,
        );
      }
      if (this.opts.pageNumbers !== false) {
        const footer = this.opts.footer ?? `ساخته‌شده با ${NOVA_OFFICE_NAME}`;
        const fcps = shapeForPdf(this.clip(footer, 60), true);
        const fw = (fcps.reduce((a, c) => a + glyphAdvance(c), 0) / 1000) * 8;
        this.cur.ops.push(
          `${this.col(this.theme.rule)} RG 0.5 w`,
          `${MARGIN_X} ${MARGIN_BOTTOM - 14} m ${PAGE_W - MARGIN_X} ${MARGIN_BOTTOM - 14} l S`,
          "BT", `/FA 8 Tf`, `${this.col(this.theme.textFaint)} rg`,
          `1 0 0 1 ${(PAGE_W - MARGIN_X - fw).toFixed(2)} ${MARGIN_BOTTOM - 26} Tm`,
          `${this.glyphHex(fcps)} Tj`, "ET",
          "BT", `/FR 8 Tf`, `${this.col(this.theme.textFaint)} rg`,
          `${MARGIN_X} ${MARGIN_BOTTOM - 26} Td`, `(${toPdfLiteral(String(pageNo))}) Tj`, "ET",
        );
      }
      return;
    }
    if (headerText) {
      this.cur.ops.push(
        "BT", `/FI 8 Tf`, `${this.col(this.theme.textFaint)} rg`,
        `${MARGIN_X} ${PAGE_H - 44} Td`,
        `(${toPdfLiteral(this.clip(headerText, 90))}) Tj`, "ET",
        `${this.col(this.theme.rule)} RG 0.5 w`,
        `${MARGIN_X} ${PAGE_H - 50} m ${PAGE_W - MARGIN_X} ${PAGE_H - 50} l S`,
      );
    }
    if (this.opts.pageNumbers !== false) {
      const footer = this.opts.footer ?? "";
      this.cur.ops.push(
        `${this.col(this.theme.rule)} RG 0.5 w`,
        `${MARGIN_X} ${MARGIN_BOTTOM - 14} m ${PAGE_W - MARGIN_X} ${MARGIN_BOTTOM - 14} l S`,
        "BT", `/FR 8 Tf`, `${this.col(this.theme.textFaint)} rg`,
        `${MARGIN_X} ${MARGIN_BOTTOM - 26} Td`,
        `(${toPdfLiteral(this.clip(footer, 80))}) Tj`, "ET",
      );
      const num = String(pageNo);
      const nw = (pdfTextWidth(toWinAnsiChars(num), false, this.serif, false) / 1000) * 8;
      this.cur.ops.push(
        "BT", `/FR 8 Tf`, `${this.col(this.theme.textFaint)} rg`,
        `${PAGE_W - MARGIN_X - nw} ${MARGIN_BOTTOM - 26} Td`,
        `(${toPdfLiteral(num)}) Tj`, "ET",
      );
    }
  }

  private ensureSpace(needed: number): void {
    if (this.cursorY + needed > PAGE_H - MARGIN_BOTTOM) this.newPage();
  }

  private measure(text: string, style: RunStyle, size: number): number {
    return (pdfTextWidth(toWinAnsiChars(text), style === "bold", this.serif, style === "mono") / 1000) * size;
  }

  private clip(text: string, maxChars: number): string {
    return text.length <= maxChars ? text : text.slice(0, maxChars - 1) + "…";
  }

  /* ── word wrapping over styled inline runs ──────────────────────────── */
  private layoutInlines(inlines: Inline[], size: number, maxWidth: number): LaidRun[][] {
    type Tok = { text: string; style: RunStyle; link?: string };
    const tokens: Tok[] = [];
    for (const inl of inlines) {
      const style: RunStyle = inl.code ? "mono" : inl.bold ? "bold" : inl.italic ? "italic" : "regular";
      for (const p of inl.text.split(/(\s+)/)) {
        if (p === "") continue;
        tokens.push({ text: p, style, link: inl.link });
      }
    }
    const lines: LaidRun[][] = [];
    let line: LaidRun[] = [];
    let lineW = 0;
    const pushLine = () => {
      while (line.length && /^\s+$/.test(line[line.length - 1].text)) { lineW -= line[line.length - 1].w; line.pop(); }
      lines.push(line); line = []; lineW = 0;
    };
    for (const tok of tokens) {
      const isSpace = /^\s+$/.test(tok.text);
      let w = this.measure(tok.text, tok.style, size);
      if (!isSpace && w > maxWidth) {
        if (line.length) pushLine();
        let chunk = "";
        for (const chr of tok.text) {
          const test = chunk + chr;
          if (this.measure(test, tok.style, size) > maxWidth && chunk) {
            lines.push([{ text: chunk, style: tok.style, link: tok.link, w: this.measure(chunk, tok.style, size) }]);
            chunk = chr;
          } else chunk = test;
        }
        if (chunk) { line = [{ text: chunk, style: tok.style, link: tok.link, w: this.measure(chunk, tok.style, size) }]; lineW = line[0].w; }
        continue;
      }
      if (lineW + w > maxWidth && line.length) {
        pushLine();
        if (isSpace) continue;
        w = this.measure(tok.text, tok.style, size);
      }
      line.push({ text: tok.text, style: tok.style, link: tok.link, w });
      lineW += w;
    }
    if (line.length) pushLine();
    if (!lines.length) lines.push([]);
    return lines;
  }

  /** Emit one visual line of runs at left `x`; registers link annots + underlines. */
  private emitLine(runs: LaidRun[], x: number, size: number, color: [number, number, number], lineH: number): void {
    const baseline = PAGE_H - this.cursorY - size;
    this.cur.ops.push("BT", `${this.col(color)} rg`, `1 0 0 1 ${x.toFixed(2)} ${baseline.toFixed(2)} Tm`);
    let curFont = "";
    for (const r of runs) {
      const fn = this.fontName(r.style);
      if (fn !== curFont) { this.cur.ops.push(`/${fn} ${size} Tf`); curFont = fn; }
      this.cur.ops.push(`(${toPdfLiteral(r.text)}) Tj`, `${r.w.toFixed(2)} 0 Td`);
    }
    this.cur.ops.push("ET");
    // link underlines + annotations
    let cx = x;
    for (const r of runs) {
      if (r.link) {
        const uy = PAGE_H - this.cursorY - size - 1.5;
        this.cur.ops.push(
          `${this.col(this.theme.accent)} RG 0.5 w`,
          `${cx.toFixed(2)} ${uy.toFixed(2)} m ${(cx + r.w).toFixed(2)} ${uy.toFixed(2)} l S`,
        );
        this.cur.links.push({ x: cx, y: baseline - 2, w: r.w, h: size + 4, url: r.link });
      }
      cx += r.w;
    }
    this.cursorY += lineH;
  }

  /* ── block renderers ────────────────────────────────────────────────── */

  private renderHeading(b: Extract<Block, { type: "heading" }>): void {
    const sizes = { 1: 21, 2: 16.5, 3: 13.5, 4: 12 } as const;
    const size = sizes[b.level];
    const before = b.level <= 2 ? 16 : 11;
    const after = b.level <= 2 ? 7 : 5;
    this.cursorY += before;
    this.ensureSpace(size + after + 6);
    // force bold styling on headings
    const styled: Inline[] = b.inlines.map(i => ({ ...i, bold: true, code: false, italic: false }));
    const lines = this.layoutInlines(styled, size, CONTENT_W);
    const lineH = size * 1.22;
    for (const ln of lines) {
      this.ensureSpace(lineH);
      this.emitLine(ln, MARGIN_X, size, this.theme.heading, lineH);
    }
    if (b.level === 1) {
      // accent rule under H1
      const ry = PAGE_H - this.cursorY + 1;
      this.cur.ops.push(
        `${this.col(this.theme.accent)} RG 1.4 w`,
        `${MARGIN_X} ${ry.toFixed(2)} m ${(MARGIN_X + 46)} ${ry.toFixed(2)} l S`,
      );
    }
    this.cursorY += after;
  }

  private renderParagraph(inlines: Inline[], size = 10.8, color = this.theme.text, gap = 7): void {
    const lines = this.layoutInlines(inlines, size, CONTENT_W);
    const lineH = size * 1.5;
    for (const ln of lines) {
      this.ensureSpace(lineH);
      this.emitLine(ln, MARGIN_X, size, color, lineH);
    }
    this.cursorY += gap;
  }

  private renderList(b: Extract<Block, { type: "list" }>): void {
    const size = 10.8;
    const lineH = size * 1.45;
    const indent = 18;
    b.items.forEach((item, idx) => {
      const marker = b.ordered ? `${idx + 1}.` : "•";
      const markerW = this.measure(marker + " ", "regular", size);
      const lines = this.layoutInlines(item, size, CONTENT_W - indent);
      lines.forEach((ln, li) => {
        this.ensureSpace(lineH);
        if (li === 0) {
          this.emitLine(
            [{ text: marker, style: b.ordered ? "bold" : "regular", w: this.measure(marker, "regular", size) }],
            MARGIN_X + indent - markerW,
            size,
            b.ordered ? this.theme.accent : this.theme.accent,
            0,
          );
          this.cursorY -= 0; // emitLine already advanced 0
        }
        this.emitLine(ln, MARGIN_X + indent, size, this.theme.text, lineH);
      });
      this.cursorY += 2;
    });
    this.cursorY += 5;
  }

  private renderCode(b: Extract<Block, { type: "code" }>): void {
    const size = 9;
    const lineH = size * 1.42;
    const pad = 9;
    const rawLines = b.text.replace(/\n$/, "").split("\n");
    // wrap each logical line to the box width
    const boxW = CONTENT_W;
    const innerW = boxW - pad * 2;
    const visual: string[] = [];
    for (const rl of rawLines) {
      if (this.measure(rl, "mono", size) <= innerW) { visual.push(rl); continue; }
      let chunk = "";
      for (const ch of rl) {
        if (this.measure(chunk + ch, "mono", size) > innerW && chunk) { visual.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      visual.push(chunk);
    }
    this.cursorY += 4;
    // draw in page-sized segments so long code paginates with a fresh box each page
    let idx = 0;
    while (idx < visual.length) {
      const avail = PAGE_H - MARGIN_BOTTOM - this.cursorY - pad * 2;
      let capacity = Math.max(1, Math.floor(avail / lineH));
      if (avail < lineH + pad * 2) { this.newPage(); continue; }
      const seg = visual.slice(idx, idx + capacity);
      const boxH = seg.length * lineH + pad * 2;
      const topY = PAGE_H - this.cursorY;
      this.cur.ops.push(
        `${this.col(this.theme.codeBg)} rg`,
        `${MARGIN_X} ${(topY - boxH).toFixed(2)} ${boxW} ${boxH.toFixed(2)} re f`,
        `${this.col(this.theme.accent)} rg`,
        `${MARGIN_X} ${(topY - boxH).toFixed(2)} 3 ${boxH.toFixed(2)} re f`,
      );
      this.cursorY += pad;
      for (const ln of seg) {
        this.emitLine([{ text: ln || " ", style: "mono", w: this.measure(ln, "mono", size) }], MARGIN_X + pad + 4, size, this.theme.codeText, lineH);
      }
      this.cursorY += pad + 6;
      idx += seg.length;
    }
  }

  private renderQuote(inlines: Inline[]): void {
    const size = 10.8;
    const lineH = size * 1.5;
    const indent = 16;
    const italic: Inline[] = inlines.map(i => ({ ...i, italic: true }));
    const lines = this.layoutInlines(italic, size, CONTENT_W - indent);
    this.cursorY += 3;
    const startY = PAGE_H - this.cursorY + size * 0.2;
    const startCursor = this.cursorY;
    for (const ln of lines) {
      this.ensureSpace(lineH);
      this.emitLine(ln, MARGIN_X + indent, size, this.theme.textFaint, lineH);
    }
    // quote bar (only if it stayed on one page)
    const endY = PAGE_H - this.cursorY;
    if (this.cursorY > startCursor) {
      this.cur.ops.push(
        `${this.col(this.theme.quoteBar)} rg`,
        `${MARGIN_X} ${endY.toFixed(2)} 3 ${(startY - endY).toFixed(2)} re f`,
      );
    }
    this.cursorY += 7;
  }

  private renderTable(b: Extract<Block, { type: "table" }>): void {
    const size = 9.5;
    const pad = 6;
    const cols = b.header.length || (b.rows[0]?.length ?? 1);
    const colW = CONTENT_W / cols;
    const lineH = size * 1.35;

    const drawRow = (cells: Inline[][], isHeader: boolean, stripe: boolean): void => {
      // wrap each cell
      const cellLines = cells.slice(0, cols).map(c =>
        this.layoutInlines(isHeader ? c.map(i => ({ ...i, bold: true })) : c, size, colW - pad * 2),
      );
      while (cellLines.length < cols) cellLines.push([[]]);
      const rowLines = Math.max(1, ...cellLines.map(cl => cl.length));
      const rowH = rowLines * lineH + pad;
      this.ensureSpace(rowH);
      const topY = PAGE_H - this.cursorY;
      // background
      if (isHeader) {
        this.cur.ops.push(`${this.col(this.theme.tableHeaderBg)} rg`, `${MARGIN_X} ${(topY - rowH).toFixed(2)} ${CONTENT_W} ${rowH.toFixed(2)} re f`);
      } else if (stripe) {
        this.cur.ops.push(`${this.col(this.theme.tableStripe)} rg`, `${MARGIN_X} ${(topY - rowH).toFixed(2)} ${CONTENT_W} ${rowH.toFixed(2)} re f`);
      }
      const textColor = isHeader ? this.theme.tableHeaderText : this.theme.text;
      const cursorAtRowTop = this.cursorY;
      for (let c = 0; c < cols; c++) {
        this.cursorY = cursorAtRowTop + pad * 0.5;
        const cx = MARGIN_X + c * colW + pad;
        for (const ln of cellLines[c]) {
          this.emitLine(ln, cx, size, textColor, lineH);
        }
      }
      this.cursorY = cursorAtRowTop + rowH;
      // column separators + bottom border
      this.cur.ops.push(`${this.col(this.theme.rule)} RG 0.4 w`);
      for (let c = 1; c < cols; c++) {
        const lx = MARGIN_X + c * colW;
        this.cur.ops.push(`${lx.toFixed(2)} ${topY.toFixed(2)} m ${lx.toFixed(2)} ${(topY - rowH).toFixed(2)} l S`);
      }
      this.cur.ops.push(`${MARGIN_X} ${(topY - rowH).toFixed(2)} m ${PAGE_W - MARGIN_X} ${(topY - rowH).toFixed(2)} l S`);
    };

    this.cursorY += 4;
    if (b.header.length) drawRow(b.header, true, false);
    b.rows.forEach((r, i) => drawRow(r, false, i % 2 === 1));
    this.cursorY += 8;
  }

  private renderImagePlaceholder(b: Extract<Block, { type: "image" }>): void {
    // We cannot fetch/embed remote images in the Worker synchronously; show a
    // captioned reference box so the layout still communicates the image.
    const boxH = 46;
    this.ensureSpace(boxH + 10);
    this.cursorY += 4;
    const topY = PAGE_H - this.cursorY;
    this.cur.ops.push(
      `${this.col(this.theme.codeBg)} rg`,
      `${MARGIN_X} ${(topY - boxH).toFixed(2)} ${CONTENT_W} ${boxH} re f`,
      `${this.col(this.theme.rule)} RG 0.6 w`,
      `${MARGIN_X} ${(topY - boxH).toFixed(2)} ${CONTENT_W} ${boxH} re S`,
    );
    this.cursorY += 16;
    const label = this.clip(("[img] " + (b.alt || b.url)).replace(/[^\x20-\x7e]/g, ""), 84);
    const labelRun: LaidRun = { text: label, style: "italic", link: b.url, w: this.measure(label, "italic", 10) };
    this.emitLine(
      [labelRun],
      MARGIN_X + 12, 10, this.theme.textFaint, 14,
    );
    this.cursorY += boxH - 16 - 14 + 10;
  }

  private renderHr(): void {
    this.cursorY += 6;
    this.ensureSpace(8);
    const y = PAGE_H - this.cursorY;
    this.cur.ops.push(`${this.col(this.theme.rule)} RG 0.8 w`, `${MARGIN_X} ${y.toFixed(2)} m ${PAGE_W - MARGIN_X} ${y.toFixed(2)} l S`);
    this.cursorY += 8;
  }

  renderBlock(b: Block): void {
    if (this.rtl) { this.renderBlockRtl(b); return; }
    switch (b.type) {
      case "heading": this.renderHeading(b); break;
      case "paragraph": this.renderParagraph(b.inlines); break;
      case "list": this.renderList(b); break;
      case "code": this.renderCode(b); break;
      case "quote": this.renderQuote(b.inlines); break;
      case "table": this.renderTable(b); break;
      case "image": this.renderImagePlaceholder(b); break;
      case "hr": this.renderHr(); break;
    }
  }

  /* ── RTL block rendering (embedded font, right-aligned, shaped) ──────── */
  private renderBlockRtl(b: Block): void {
    const right = PAGE_W - MARGIN_X;
    switch (b.type) {
      case "heading": {
        const size = b.level === 1 ? 22 : b.level === 2 ? 17 : b.level === 3 ? 14 : 12;
        const lineH = size * 1.5;
        this.cursorY += b.level <= 2 ? 12 : 8;
        this.ensureSpaceRtl(lineH);
        const txt = plainInline(b.inlines);
        for (const ln of this.wrapRtl(txt, size, CONTENT_W)) {
          this.ensureSpaceRtl(lineH);
          this.emitRtlText(ln, size, this.theme.heading, { xRight: right });
          this.cursorY += lineH;
        }
        // underline accent for H1/H2
        if (b.level <= 2) {
          const ry = PAGE_H - this.cursorY + 4;
          this.cur.ops.push(`${this.col(this.theme.accent)} RG 1.5 w`, `${right - 60} ${ry.toFixed(2)} m ${right} ${ry.toFixed(2)} l S`);
          this.cursorY += 6;
        }
        break;
      }
      case "paragraph": {
        const size = 11.5; const lineH = size * 1.6;
        const txt = plainInline(b.inlines);
        for (const ln of this.wrapRtl(txt, size, CONTENT_W)) {
          this.ensureSpaceRtl(lineH);
          this.emitRtlText(ln, size, this.theme.text, { xRight: right });
          this.cursorY += lineH;
        }
        this.cursorY += 5;
        break;
      }
      case "list": {
        const size = 11.5; const lineH = size * 1.6;
        b.items.forEach((it, i) => {
          const bullet = b.ordered ? `${i + 1}.` : "•";
          const txt = plainInline(it);
          const wrapped = this.wrapRtl(txt, size, CONTENT_W - 22);
          wrapped.forEach((ln, li) => {
            this.ensureSpaceRtl(lineH);
            // bullet sits at the right; text indented left of it
            if (li === 0) this.emitRtlText(bullet, size, this.theme.accent, { xRight: right });
            this.emitRtlText(ln, size, this.theme.text, { xRight: right - 22 });
            this.cursorY += lineH;
          });
        });
        this.cursorY += 5;
        break;
      }
      case "quote": {
        const size = 11.5; const lineH = size * 1.6;
        const txt = plainInline(b.inlines);
        const lines = this.wrapRtl(txt, size, CONTENT_W - 18);
        const startY = this.cursorY;
        for (const ln of lines) {
          this.ensureSpaceRtl(lineH);
          this.emitRtlText(ln, size, this.theme.textFaint, { xRight: right - 14 });
          this.cursorY += lineH;
        }
        // quote bar on the RIGHT for RTL
        const barTop = PAGE_H - startY + 2;
        const barBot = PAGE_H - this.cursorY + 4;
        this.cur.ops.push(`${this.col(this.theme.quoteBar)} RG 3 w`, `${right} ${barTop.toFixed(2)} m ${right} ${barBot.toFixed(2)} l S`);
        this.cursorY += 5;
        break;
      }
      case "code": {
        // Code stays LTR (monospace) — reuse the base-14 path for correctness.
        this.renderCode(b);
        break;
      }
      case "table": {
        // Render each cell as a right-aligned shaped line, simple grid.
        const size = 10.5; const lineH = size * 1.7;
        const allRows = [b.header, ...b.rows].filter(r => r.length);
        const cols = Math.max(1, ...allRows.map(r => r.length));
        const colW = CONTENT_W / cols;
        allRows.forEach((row, ri) => {
          this.ensureSpaceRtl(lineH);
          const baseY = PAGE_H - this.cursorY;
          if (ri === 0) this.cur.ops.push(`${this.col(this.theme.tableHeaderBg)} rg`, `${MARGIN_X} ${(baseY - lineH + 4).toFixed(2)} ${CONTENT_W} ${lineH} re f`);
          row.forEach((cell, ci) => {
            // columns laid right-to-left
            const cellRight = right - ci * colW;
            const color = ri === 0 ? this.theme.tableHeaderText : this.theme.text;
            const txt = this.clip(plainInline(cell), 40);
            this.emitRtlText(txt, size, color, { xRight: cellRight - 4, xLeft: cellRight - colW + 4 });
          });
          this.cursorY += lineH;
        });
        this.cursorY += 6;
        break;
      }
      case "image": this.renderImagePlaceholder(b); break;
      case "hr": this.renderHr(); break;
    }
  }

  private ensureSpaceRtl(needed: number): void {
    if (this.cursorY + needed > PAGE_H - MARGIN_BOTTOM) this.newPage();
  }

  /* ── cover page ─────────────────────────────────────────────────────── */
  renderCover(title: string, subtitle: string): void {
    this.newPage(false); // no header/footer on cover
    // top accent band
    this.cur.ops.push(
      `${this.col(this.theme.accent)} rg`,
      `0 ${PAGE_H - 6} ${PAGE_W} 6 re f`,
      `0 0 ${PAGE_W} 6 re f`,
    );
    if (this.rtl) {
      // RTL cover: right-aligned, shaped title via the embedded font.
      const titleSize = 28; const lineH = titleSize * 1.4;
      const lines = this.wrapRtl(title, titleSize, CONTENT_W);
      const blockH = lines.length * lineH + 60;
      this.cursorY = (PAGE_H - blockH) / 2;
      const kicker = (this.opts.author || "NOVA");
      this.emitRtlText(kicker, 11, this.theme.accent, { xRight: PAGE_W - MARGIN_X });
      this.cursorY += 22;
      for (const ln of lines) { this.emitRtlText(ln, titleSize, this.theme.heading, { xRight: PAGE_W - MARGIN_X }); this.cursorY += lineH; }
      this.cursorY += 10;
      const ry = PAGE_H - this.cursorY;
      this.cur.ops.push(`${this.col(this.theme.accent)} RG 2 w`, `${PAGE_W - MARGIN_X - 70} ${ry.toFixed(2)} m ${PAGE_W - MARGIN_X} ${ry.toFixed(2)} l S`);
      this.cursorY += 20;
      if (subtitle) { this.emitRtlText(subtitle, 12, this.theme.textFaint, { xRight: PAGE_W - MARGIN_X }); }
      return;
    }
    // vertically-centred title block
    const titleSize = 30;
    const titleInlines: Inline[] = [{ text: title, bold: true }];
    const lines = this.layoutInlines(titleInlines, titleSize, CONTENT_W);
    const lineH = titleSize * 1.2;
    const blockH = lines.length * lineH + 60;
    this.cursorY = (PAGE_H - blockH) / 2;
    // small kicker
    this.emitLine(
      [{ text: (this.opts.author || "NOVA").toUpperCase(), style: "bold", w: this.measure((this.opts.author || "NOVA").toUpperCase(), "bold", 11) }],
      MARGIN_X, 11, this.theme.accent, 22,
    );
    this.cursorY += 8;
    for (const ln of lines) this.emitLine(ln, MARGIN_X, titleSize, this.theme.heading, lineH);
    this.cursorY += 10;
    // rule
    const ry = PAGE_H - this.cursorY;
    this.cur.ops.push(`${this.col(this.theme.accent)} RG 2 w`, `${MARGIN_X} ${ry.toFixed(2)} m ${MARGIN_X + 70} ${ry.toFixed(2)} l S`);
    this.cursorY += 20;
    if (subtitle) {
      this.emitLine(
        [{ text: subtitle, style: "italic", w: this.measure(subtitle, "italic", 12) }],
        MARGIN_X, 12, this.theme.textFaint, 18,
      );
    }
  }

  /* ── table of contents ──────────────────────────────────────────────── */
  renderToc(entries: Array<{ title: string; level: number; page: number }>, heading: string): void {
    this.newPage();
    this.renderHeading({ type: "heading", level: 1, inlines: [{ text: heading, bold: true }], anchor: "toc" });
    const size = 11;
    const lineH = size * 1.7;
    for (const e of entries) {
      this.ensureSpace(lineH);
      const indent = (e.level - 1) * 14;
      const label = this.clip(e.title, 72);
      const labelW = this.measure(label, e.level === 1 ? "bold" : "regular", size);
      const pageStr = String(e.page);
      const pageW = this.measure(pageStr, "regular", size);
      // label
      this.emitLine(
        [{ text: label, style: e.level === 1 ? "bold" : "regular", w: labelW }],
        MARGIN_X + indent, size, e.level === 1 ? this.theme.heading : this.theme.text, 0,
      );
      // dotted leader + page number (draw manually on same line)
      const baseline = PAGE_H - this.cursorY - size;
      const leaderStart = MARGIN_X + indent + labelW + 6;
      const leaderEnd = PAGE_W - MARGIN_X - pageW - 6;
      if (leaderEnd > leaderStart) {
        this.cur.ops.push(
          `${this.col(this.theme.rule)} RG 0.5 w [1 2] 0 d`,
          `${leaderStart.toFixed(2)} ${(baseline + 2).toFixed(2)} m ${leaderEnd.toFixed(2)} ${(baseline + 2).toFixed(2)} l S`,
          `[] 0 d`,
        );
      }
      this.cur.ops.push(
        "BT", `/FR ${size} Tf`, `${this.col(this.theme.textFaint)} rg`,
        `1 0 0 1 ${(PAGE_W - MARGIN_X - pageW).toFixed(2)} ${baseline.toFixed(2)} Tm`,
        `(${toPdfLiteral(pageStr)}) Tj`, "ET",
      );
      this.cursorY += lineH;
    }
  }

  /* ── PDF serialisation ──────────────────────────────────────────────── */
  toBytes(meta: { title?: string; author?: string }): Uint8Array {
    const objects: string[] = [];
    const streams: Array<Uint8Array | null> = [];
    const addObj = (body: string, stream?: Uint8Array): number => {
      objects.push(body);
      streams.push(stream ?? null);
      return objects.length; // 1-based object number
    };

    // Reserve: 1=Catalog, 2=Pages. Fonts + pages appended after.
    addObj(""); // 1 catalog (filled later)
    addObj(""); // 2 pages (filled later)

    // Standard-14 fonts
    const fam = this.serif
      ? { R: "Times-Roman", B: "Times-Bold", I: "Times-Italic" }
      : { R: "Helvetica", B: "Helvetica-Bold", I: "Helvetica-Oblique" };
    const fR = addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /${fam.R} /Encoding /WinAnsiEncoding >>`);
    const fB = addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /${fam.B} /Encoding /WinAnsiEncoding >>`);
    const fI = addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /${fam.I} /Encoding /WinAnsiEncoding >>`);
    const fM = addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`);

    // ── Embedded Unicode CID font (only when RTL) ─────────────────────────
    // Persian/Arabic is emitted through this Type0/Identity-H font as 2-byte
    // glyph ids, so a Persian PDF renders correctly instead of rerouting to DOCX.
    let fA = 0;
    if (this.rtl) {
      const fontBytes = embeddedFontBytes();
      const fontFileNum = addObj(`<< /Length ${fontBytes.length} /Length1 ${fontBytes.length} >>`, fontBytes);
      // FontDescriptor. Flags 4 = symbolic; bbox/ascent are safe generic values.
      const descNum = addObj(
        `<< /Type /FontDescriptor /FontName /NovaVazir /Flags 4 ` +
        `/FontBBox [-1000 -400 2000 1100] /ItalicAngle 0 /Ascent 1000 /Descent -300 ` +
        `/CapHeight 700 /StemV 80 /FontFile2 ${fontFileNum} 0 R >>`,
      );
      // Build the W array (per-glyph advance widths) from the embedded metrics.
      const wEntries: string[] = [];
      const gids = Object.keys(NOVA_FONT_GID2ADV).map(Number).sort((a, b) => a - b);
      for (const g of gids) {
        const adv = NOVA_FONT_GID2ADV[g];
        wEntries.push(`${g} [${adv}]`);
      }
      const cidFontNum = addObj(
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NovaVazir ` +
        `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
        `/FontDescriptor ${descNum} 0 R /CIDToGIDMap /Identity /DW 500 /W [${wEntries.join(" ")}] >>`,
      );
      fA = addObj(
        `<< /Type /Font /Subtype /Type0 /BaseFont /NovaVazir /Encoding /Identity-H ` +
        `/DescendantFonts [${cidFontNum} 0 R] >>`,
      );
    }

    const pageObjNums: number[] = [];
    for (const pg of this.pages) {
      const content = utf8(pg.ops.join("\n"));
      const contentNum = addObj(`<< /Length ${content.length} >>`, content);
      // link annotations
      const annotNums: number[] = [];
      for (const l of pg.links) {
        const rect = `[${l.x.toFixed(2)} ${l.y.toFixed(2)} ${(l.x + l.w).toFixed(2)} ${(l.y + l.h).toFixed(2)}]`;
        const uri = l.url.replace(/[()\\]/g, "\\$&");
        annotNums.push(addObj(`<< /Type /Annot /Subtype /Link /Rect ${rect} /Border [0 0 0] /A << /S /URI /URI (${uri}) >> >>`));
      }
      const annotsRef = annotNums.length ? ` /Annots [${annotNums.map(n => `${n} 0 R`).join(" ")}]` : "";
      const faRef = fA ? ` /FA ${fA} 0 R` : "";
      const pageNum = addObj(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /FR ${fR} 0 R /FB ${fB} 0 R /FI ${fI} 0 R /FM ${fM} 0 R${faRef} >> >> ` +
        `/Contents ${contentNum} 0 R${annotsRef} >>`,
      );
      pageObjNums.push(pageNum);
    }

    // fill reserved objects
    objects[0] = `<< /Type /Catalog /Pages 2 0 R >>`;
    objects[1] = `<< /Type /Pages /Kids [${pageObjNums.map(n => `${n} 0 R`).join(" ")}] /Count ${pageObjNums.length} >>`;

    // metadata (info dict)
    const esc = (s: string) => s.replace(/[()\\]/g, "\\$&");
    const infoNum = addObj(
      `<< /Title (${esc(meta.title || "Document")}) /Author (${esc(meta.author || "Nova")}) /Producer (${NOVA_OFFICE_NAME}) /Creator (Nova) >>`,
    );

    // assemble byte stream with xref
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [0];
    let pos = 0;
    const header = utf8("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");
    chunks.push(header);
    pos += header.length;

    objects.forEach((body, idx) => {
      offsets.push(pos);
      const stream = streams[idx];
      if (stream) {
        const pre = utf8(`${idx + 1} 0 obj\n${body}\nstream\n`);
        const post = utf8(`\nendstream\nendobj\n`);
        chunks.push(pre, stream, post);
        pos += pre.length + stream.length + post.length;
      } else {
        const b = utf8(`${idx + 1} 0 obj\n${body}\nendobj\n`);
        chunks.push(b);
        pos += b.length;
      }
    });

    const xrefStart = pos;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    chunks.push(utf8(xref));

    return concatBytes(chunks);
  }
}

/** Public PDF renderer: parsed AST → PDF bytes with cover, TOC, chrome. */
function renderPdf(doc: ParsedDoc, opts: ExportOptions): Uint8Array {
  const theme = resolveTheme(opts.theme);
  const rtl = opts.rtl ?? doc.rtl;
  const headings = doc.blocks.filter(b => b.type === "heading") as Array<Extract<Block, { type: "heading" }>>;
  const wantCover = opts.cover ?? (!!doc.title && doc.blocks.length > 2);
  // TOC page-number leaders aren't RTL-shaped yet, so skip TOC for RTL docs.
  const wantToc = !rtl && (opts.toc ?? headings.filter(h => h.level <= 2).length >= 3);
  const tocLabel = opts.lang === "fa" ? "فهرست مطالب" : opts.lang === "ar" ? "المحتويات" : "Table of Contents";
  const coverSub = opts.author ? `${opts.author} · ${nowStamp(opts.lang)}` : nowStamp(opts.lang);
  const coverPages = wantCover && doc.title ? 1 : 0;

  const builder = new PdfBuilder(theme, opts, rtl);

  if (wantToc) {
    // Pass 1: probe body-only pagination to learn each heading's page.
    const probe = new PdfBuilder(theme, opts, rtl);
    probe.newPage();
    const tocHeadings: Array<Extract<Block, { type: "heading" }>> = [];
    const probePageAtHeading: number[] = [];
    for (const b of doc.blocks) {
      if (b.type === "heading" && b.level <= 3) { probePageAtHeading.push(probe.pageCount); tocHeadings.push(b); }
      probe.renderBlock(b);
    }
    const tocPageCount = Math.max(1, Math.ceil(tocHeadings.length / 28));
    const entries = tocHeadings.map((h, i) => ({
      title: plainInline(h.inlines),
      level: h.level,
      page: probePageAtHeading[i] + coverPages + tocPageCount,
    }));
    // Pass 2: real document = cover + TOC + body.
    if (wantCover && doc.title) builder.renderCover(doc.title, coverSub);
    builder.renderToc(entries, tocLabel);
    builder.newPage();
    for (const b of doc.blocks) builder.renderBlock(b);
    return builder.toBytes({ title: doc.title, author: opts.author });
  }

  if (wantCover && doc.title) builder.renderCover(doc.title, coverSub);
  builder.newPage();
  for (const b of doc.blocks) builder.renderBlock(b);
  return builder.toBytes({ title: doc.title, author: opts.author });
}

/* ════════════════════════════════════════════════════════════════════════
 * SECTION 8 — DOCX RENDERER  (OOXML — full Unicode incl. RTL Persian/Arabic)
 * ════════════════════════════════════════════════════════════════════════
 * A .docx is a ZIP (OPC package) of XML parts. Word shapes complex scripts
 * itself, so this is the correct path for Persian/Arabic: we only need to set
 * bidi/rtl properties and Word renders perfectly.
 *
 * Package layout produced here:
 *   [Content_Types].xml
 *   _rels/.rels
 *   docProps/core.xml, docProps/app.xml
 *   word/_rels/document.xml.rels
 *   word/styles.xml
 *   word/document.xml
 * ────────────────────────────────────────────────────────────────────── */

/** Convert a theme colour triple (0..1) to an OOXML hex string "RRGGBB". */
function hex(c: [number, number, number]): string {
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return (to(c[0]) + to(c[1]) + to(c[2])).toUpperCase();
}

/** Half-point font size for OOXML (w:sz val is in half-points). */
function hp(pt: number): string {
  return String(Math.round(pt * 2));
}

class DocxRenderer {
  private theme: Theme;
  private opts: ExportOptions;
  private rtl: boolean;
  private rels: string[] = [];
  private relSeq = 0;

  constructor(theme: Theme, opts: ExportOptions, rtl: boolean) {
    this.theme = theme;
    this.opts = opts;
    this.rtl = rtl;
  }

  /** Register an external hyperlink relationship; returns its r:id. */
  private addHyperlink(url: string): string {
    const id = `rId${100 + this.relSeq++}`;
    this.rels.push(
      `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEsc(url)}" TargetMode="External"/>`,
    );
    return id;
  }

  /** Build the <w:r> runs for a set of inlines. */
  private runs(inlines: Inline[], baseColor?: string): string {
    let out = "";
    for (const inl of inlines) {
      if (!inl.text) continue;
      const rpr: string[] = [];
      if (inl.bold) rpr.push("<w:b/><w:bCs/>");
      if (inl.italic) rpr.push("<w:i/><w:iCs/>");
      if (inl.strike) rpr.push("<w:strike/>");
      if (inl.code) rpr.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:fill="' + hex(this.theme.codeBg) + '"/>');
      if (this.rtl) rpr.push("<w:rtl/>");
      const color = inl.link ? "0563C1" : baseColor;
      if (color) rpr.push(`<w:color w:val="${color}"/>`);
      if (inl.link) rpr.push("<w:u w:val=\"single\"/>");
      const rprXml = rpr.length ? `<w:rPr>${rpr.join("")}</w:rPr>` : "";
      // preserve spaces
      const text = `<w:t xml:space="preserve">${xmlEsc(inl.text)}</w:t>`;
      const run = `<w:r>${rprXml}${text}</w:r>`;
      if (inl.link) {
        const rid = this.addHyperlink(inl.link);
        out += `<w:hyperlink r:id="${rid}">${run}</w:hyperlink>`;
      } else {
        out += run;
      }
    }
    return out;
  }

  private para(inlines: Inline[], opts: { style?: string; align?: string; spacingBefore?: number; spacingAfter?: number; ind?: number; numId?: number; ilvl?: number } = {}): string {
    const ppr: string[] = [];
    if (opts.style) ppr.push(`<w:pStyle w:val="${opts.style}"/>`);
    if (opts.numId !== undefined) ppr.push(`<w:numPr><w:ilvl w:val="${opts.ilvl ?? 0}"/><w:numId w:val="${opts.numId}"/></w:numPr>`);
    if (this.rtl) ppr.push("<w:bidi/>");
    const spacing: string[] = [];
    if (opts.spacingBefore !== undefined) spacing.push(`w:before="${opts.spacingBefore}"`);
    if (opts.spacingAfter !== undefined) spacing.push(`w:after="${opts.spacingAfter}"`);
    if (spacing.length) ppr.push(`<w:spacing ${spacing.join(" ")}/>`);
    if (opts.ind) ppr.push(`<w:ind w:${this.rtl ? "right" : "left"}="${opts.ind}"/>`);
    if (opts.align) ppr.push(`<w:jc w:val="${opts.align}"/>`);
    const pprXml = ppr.length ? `<w:pPr>${ppr.join("")}</w:pPr>` : "";
    return `<w:p>${pprXml}${this.runs(inlines)}</w:p>`;
  }

  private block(b: Block): string {
    switch (b.type) {
      case "heading":
        return this.para(b.inlines, { style: `Heading${b.level}` });
      case "paragraph":
        return this.para(b.inlines, { style: "Body" });
      case "quote":
        return this.para(b.inlines, { style: "Quote" });
      case "list": {
        const numId = b.ordered ? 2 : 1;
        return b.items.map(it => this.para(it, { numId, ilvl: 0, style: "Body" })).join("");
      }
      case "code": {
        // one shaded paragraph per line to preserve line breaks
        const lines = b.text.replace(/\n$/, "").split("\n");
        return lines.map(ln =>
          this.para([{ text: ln || " ", code: true }], { style: "Code" }),
        ).join("");
      }
      case "table":
        return this.table(b);
      case "image":
        return this.para([{ text: `[${b.alt || "image"}] ${b.url}`, italic: true, link: b.url }], { style: "Body" });
      case "hr":
        return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${hex(this.theme.rule)}"/></w:pBdr></w:pPr></w:p>`;
    }
  }

  private table(b: Extract<Block, { type: "table" }>): string {
    const cols = b.header.length || (b.rows[0]?.length ?? 1);
    const totalW = 9360; // twips (~6.5in)
    const colW = Math.floor(totalW / cols);
    const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${colW}"/>`).join("")}</w:tblGrid>`;
    const borderColor = hex(this.theme.rule);
    const border = (v: string) => `<w:${v} w:val="single" w:sz="4" w:space="0" w:color="${borderColor}"/>`;
    const tblPr =
      `<w:tblPr><w:tblStyle w:val="NovaTable"/><w:tblW w:w="${totalW}" w:type="dxa"/>` +
      (this.rtl ? "<w:bidiVisual/>" : "") +
      `<w:tblBorders>${border("top")}${border("left")}${border("bottom")}${border("right")}${border("insideH")}${border("insideV")}</w:tblBorders></w:tblPr>`;

    const mkCell = (cell: Inline[], header: boolean): string => {
      const shd = header ? `<w:shd w:val="clear" w:fill="${hex(this.theme.tableHeaderBg)}"/>` : "";
      const styled = header ? cell.map(i => ({ ...i, bold: true })) : cell;
      const color = header ? hex(this.theme.heading) : undefined;
      const pprInner = this.rtl ? "<w:bidi/>" : "";
      return `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>${shd}<w:vAlign w:val="center"/></w:tcPr>` +
        `<w:p><w:pPr>${pprInner}<w:spacing w:before="20" w:after="20"/></w:pPr>${this.runs(styled, color)}</w:p></w:tc>`;
    };

    let rows = "";
    if (b.header.length) {
      rows += `<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.header.map(c => mkCell(c, true)).join("")}</w:tr>`;
    }
    for (const r of b.rows) {
      const cells = r.slice(0, cols);
      while (cells.length < cols) cells.push([]);
      rows += `<w:tr>${cells.map(c => mkCell(c, false)).join("")}</w:tr>`;
    }
    return `<w:tbl>${tblPr}${grid}${rows}</w:tbl>`;
  }

  render(doc: ParsedDoc): Uint8Array {
    const files: Array<{ path: string; data: Uint8Array }> = [];
    const add = (path: string, content: string) => files.push({ path, data: utf8(content) });

    // ── body ──
    let body = "";
    // cover-ish title heading
    const wantCover = this.opts.cover ?? (!!doc.title && doc.blocks.length > 2);
    if (wantCover && doc.title) {
      body += this.para([{ text: doc.title, bold: true }], { style: "Title", align: this.rtl ? "right" : "left" });
      const sub = this.opts.author ? `${this.opts.author} · ${nowStamp(this.opts.lang)}` : nowStamp(this.opts.lang);
      body += this.para([{ text: sub, italic: true }], { style: "Subtitle" });
      body += `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="1" w:color="${hex(this.theme.accent)}"/></w:pBdr></w:pPr></w:p>`;
    }
    for (const b of doc.blocks) body += this.block(b);

    // section props (page size + RTL)
    const sect =
      `<w:sectPr>${this.rtl ? "<w:bidi/>" : ""}` +
      `<w:pgSz w:w="12240" w:h="15840"/>` +
      `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>` +
      `</w:sectPr>`;

    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<w:body>${body}${sect}</w:body></w:document>`;

    add("word/document.xml", documentXml);
    add("word/styles.xml", this.stylesXml());
    add("word/numbering.xml", this.numberingXml());
    add("[Content_Types].xml", this.contentTypesXml());
    add("_rels/.rels", this.rootRelsXml());
    add("docProps/core.xml", this.coreXml(doc));
    add("docProps/app.xml", this.appXml());
    add("word/_rels/document.xml.rels", this.docRelsXml());

    return zipSync(files);
  }

  private stylesXml(): string {
    const bodyFont = "Calibri";
    const headColor = hex(this.theme.heading);
    const accent = hex(this.theme.accent);
    const faint = hex(this.theme.textFaint);
    const textColor = hex(this.theme.text);
    const rtlDef = this.rtl ? "<w:bidi/>" : "";
    const rprDefRtl = this.rtl ? "<w:rtl/>" : "";
    const heading = (n: number, size: number, before: number) =>
      `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Body"/><w:pPr>${rtlDef}<w:keepNext/><w:spacing w:before="${before}" w:after="80"/></w:pPr>` +
      `<w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:b/><w:bCs/>${rprDefRtl}<w:color w:val="${n === 1 ? headColor : n === 2 ? accent : headColor}"/><w:sz w:val="${hp(size)}"/><w:szCs w:val="${hp(size)}"/></w:rPr></w:style>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${bodyFont}" w:hAnsi="${bodyFont}" w:cs="${bodyFont}"/><w:color w:val="${textColor}"/><w:sz w:val="${hp(11)}"/><w:szCs w:val="${hp(11)}"/></w:rPr></w:rPrDefault>` +
      `<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/><w:pPr>${rtlDef}</w:pPr><w:rPr>${rprDefRtl}</w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr>${rtlDef}<w:spacing w:before="240" w:after="60"/></w:pPr><w:rPr><w:b/><w:bCs/>${rprDefRtl}<w:color w:val="${headColor}"/><w:sz w:val="${hp(30)}"/><w:szCs w:val="${hp(30)}"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr>${rtlDef}<w:spacing w:after="240"/></w:pPr><w:rPr><w:i/><w:iCs/>${rprDefRtl}<w:color w:val="${faint}"/><w:sz w:val="${hp(13)}"/><w:szCs w:val="${hp(13)}"/></w:rPr></w:style>` +
      heading(1, 20, 280) + heading(2, 16, 240) + heading(3, 13, 200) + heading(4, 12, 180) +
      `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Body"/><w:pPr>${rtlDef}<w:ind w:${this.rtl ? "right" : "left"}="360"/><w:pBdr><w:${this.rtl ? "right" : "left"} w:val="single" w:sz="18" w:space="10" w:color="${accent}"/></w:pBdr><w:spacing w:before="80" w:after="80"/></w:pPr><w:rPr><w:i/><w:iCs/>${rprDefRtl}<w:color w:val="${faint}"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:fill="${hex(this.theme.codeBg)}"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="${hp(9.5)}"/><w:szCs w:val="${hp(9.5)}"/></w:rPr></w:style>` +
      `<w:style w:type="table" w:styleId="NovaTable"><w:name w:val="Nova Table"/><w:tblPr><w:tblStyleRowBandSize w:val="1"/></w:tblPr><w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr></w:style>` +
      `</w:styles>`;
  }

  private numberingXml(): string {
    // abstractNum 0 = bullet, 1 = decimal; numId 1 -> bullet, 2 -> decimal
    const lvl = (fmt: string, text: string) =>
      `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="420" w:hanging="280"/></w:pPr>${fmt === "bullet" ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>' : ""}</w:lvl>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>${lvl("bullet", "")}</w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${lvl("decimal", "%1.")}</w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
      `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>` +
      `</w:numbering>`;
  }

  private contentTypesXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
      `</Types>`;
  }

  private rootRelsXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
      `</Relationships>`;
  }

  private docRelsXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
      this.rels.join("") +
      `</Relationships>`;
  }

  private coreXml(doc: ParsedDoc): string {
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${xmlEsc(doc.title || this.opts.title || "Document")}</dc:title>` +
      `<dc:creator>${xmlEsc(this.opts.author || "Nova")}</dc:creator>` +
      `<cp:lastModifiedBy>Nova</cp:lastModifiedBy>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      `</cp:coreProperties>`;
  }

  private appXml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
      `<Application>${NOVA_OFFICE_NAME}</Application></Properties>`;
  }
}

/** Public DOCX renderer. */
function renderDocx(doc: ParsedDoc, opts: ExportOptions): Uint8Array {
  const theme = resolveTheme(opts.theme);
  const rtl = opts.rtl ?? doc.rtl;
  return new DocxRenderer(theme, opts, rtl).render(doc);
}

/* ════════════════════════════════════════════════════════════════════════
 * SECTION 9 — XLSX RENDERER  (SpreadsheetML workbook from tabular content)
 * ════════════════════════════════════════════════════════════════════════
 * Extracts every table block into its own worksheet. When the document has no
 * tables, it emits a single "Document" sheet listing the outline (headings +
 * paragraph previews) so the export is never empty. Uses an inline shared
 * string table and a couple of cell styles (header / title).
 * ────────────────────────────────────────────────────────────────────── */

/** Column index (0-based) → spreadsheet column letters (A, B, ... AA). */
function colLetter(n: number): string {
  let s = "";
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface Sheet {
  name: string;
  rows: Array<Array<{ text: string; style: "header" | "title" | "normal" }>>;
}

class XlsxRenderer {
  private theme: Theme;
  private shared: string[] = [];
  private sharedIdx = new Map<string, number>();

  constructor(theme: Theme, _opts: ExportOptions) {
    this.theme = theme;
  }

  private si(text: string): number {
    let idx = this.sharedIdx.get(text);
    if (idx === undefined) {
      idx = this.shared.length;
      this.shared.push(text);
      this.sharedIdx.set(text, idx);
    }
    return idx;
  }

  private buildSheets(doc: ParsedDoc): Sheet[] {
    const sheets: Sheet[] = [];
    const tables = doc.blocks.filter(b => b.type === "table") as Array<Extract<Block, { type: "table" }>>;
    tables.forEach((t, i) => {
      const rows: Sheet["rows"] = [];
      if (t.header.length) rows.push(t.header.map(c => ({ text: plainInline(c), style: "header" as const })));
      for (const r of t.rows) rows.push(r.map(c => ({ text: plainInline(c), style: "normal" as const })));
      sheets.push({ name: this.sheetName(i, tables.length), rows });
    });
    if (!sheets.length) {
      // outline sheet
      const rows: Sheet["rows"] = [];
      if (doc.title) rows.push([{ text: doc.title, style: "title" }]);
      for (const b of doc.blocks) {
        if (b.type === "heading") rows.push([{ text: plainInline(b.inlines), style: "header" }]);
        else if (b.type === "paragraph") rows.push([{ text: plainInline(b.inlines), style: "normal" }]);
        else if (b.type === "list") for (const it of b.items) rows.push([{ text: "• " + plainInline(it), style: "normal" }]);
        else if (b.type === "quote") rows.push([{ text: plainInline(b.inlines), style: "normal" }]);
      }
      if (!rows.length) rows.push([{ text: doc.title || "Document", style: "title" }]);
      sheets.push({ name: "Document", rows });
    }
    return sheets;
  }

  private sheetName(i: number, total: number): string {
    const base = total === 1 ? "Data" : `Table ${i + 1}`;
    return base.replace(/[\\/?*\[\]:]/g, "").slice(0, 31);
  }

  render(doc: ParsedDoc): Uint8Array {
    const sheets = this.buildSheets(doc);
    const files: Array<{ path: string; data: Uint8Array }> = [];
    const add = (path: string, content: string) => files.push({ path, data: utf8(content) });

    // worksheets
    const sheetXmls = sheets.map((sheet) => {
      let rowsXml = "";
      sheet.rows.forEach((row, r) => {
        const cells = row.map((cell, c) => {
          const ref = `${colLetter(c)}${r + 1}`;
          const styleId = cell.style === "header" ? 1 : cell.style === "title" ? 2 : 0;
          const sAttr = styleId ? ` s="${styleId}"` : "";
          const sidx = this.si(cell.text);
          return `<c r="${ref}"${sAttr} t="s"><v>${sidx}</v></c>`;
        }).join("");
        rowsXml += `<row r="${r + 1}">${cells}</row>`;
      });
      const cols = Math.max(1, ...sheet.rows.map(r => r.length));
      const colsXml = `<cols><col min="1" max="${cols}" width="24" customWidth="1"/></cols>`;
      const dim = `A1:${colLetter(cols - 1)}${Math.max(1, sheet.rows.length)}`;
      return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<dimension ref="${dim}"/>${colsXml}<sheetData>${rowsXml}</sheetData></worksheet>`
      );
    });
    sheetXmls.forEach((xml, i) => add(`xl/worksheets/sheet${i + 1}.xml`, xml));

    // shared strings
    const sst =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.shared.length}" uniqueCount="${this.shared.length}">` +
      this.shared.map(s => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join("") +
      `</sst>`;
    add("xl/sharedStrings.xml", sst);

    // styles: 0 normal, 1 header (bold + fill), 2 title (bold large)
    const headFill = hex(this.theme.tableHeaderBg);
    const headColor = hex(this.theme.heading);
    add("xl/styles.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="3">` +
      `<font><sz val="11"/><name val="Calibri"/></font>` +
      `<font><b/><sz val="11"/><color rgb="FF${headColor}"/><name val="Calibri"/></font>` +
      `<font><b/><sz val="16"/><color rgb="FF${headColor}"/><name val="Calibri"/></font>` +
      `</fonts>` +
      `<fills count="3"><fill><patternFill patternType="none"/></fill>` +
      `<fill><patternFill patternType="gray125"/></fill>` +
      `<fill><patternFill patternType="solid"><fgColor rgb="FF${headFill}"/></patternFill></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="3">` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
      `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>` +
      `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
      `</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`);

    // workbook + rels
    const sheetsMeta = sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
    add("xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${sheetsMeta}</sheets></workbook>`);

    const wbRels = sheets.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    ).join("");
    const ssRelId = sheets.length + 1;
    const styRelId = sheets.length + 2;
    add("xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      wbRels +
      `<Relationship Id="rId${ssRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
      `<Relationship Id="rId${styRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`);

    // content types + root rels
    add("[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`);
    add("_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`);

    return zipSync(files);
  }
}

/** Public XLSX renderer. */
function renderXlsx(doc: ParsedDoc, opts: ExportOptions): Uint8Array {
  const theme = resolveTheme(opts.theme);
  return new XlsxRenderer(theme, opts).render(doc);
}

/* ════════════════════════════════════════════════════════════════════════
 * SECTION 10 — PPTX RENDERER  (PresentationML — slides from document outline)
 * ════════════════════════════════════════════════════════════════════════
 * Splits the document at H1/H2 boundaries into slides. Each slide has a
 * coloured title bar and a bullet body built from the intervening paragraphs,
 * lists, and quotes. A title slide leads. EMU units (914400 per inch).
 * RTL content sets bidi + right alignment on paragraphs.
 * ────────────────────────────────────────────────────────────────────── */

interface Slide {
  title: string;
  bullets: Array<{ text: string; level: number }>;
  isTitle?: boolean;
  subtitle?: string;
}

const EMU = 914400;
const SLIDE_W = Math.round(EMU * 13.333); // 16:9
const SLIDE_H = Math.round(EMU * 7.5);

class PptxRenderer {
  private theme: Theme;
  private opts: ExportOptions;
  private rtl: boolean;

  constructor(theme: Theme, opts: ExportOptions, rtl: boolean) {
    this.theme = theme;
    this.opts = opts;
    this.rtl = rtl;
  }

  private buildSlides(doc: ParsedDoc): Slide[] {
    const slides: Slide[] = [];
    // title slide
    slides.push({
      title: doc.title || (this.opts.title ?? "Presentation"),
      bullets: [],
      isTitle: true,
      subtitle: this.opts.author ? `${this.opts.author} · ${nowStamp(this.opts.lang)}` : nowStamp(this.opts.lang),
    });

    let cur: Slide | null = null;
    const flush = () => { if (cur && (cur.title || cur.bullets.length)) slides.push(cur); cur = null; };
    const ensure = (title: string) => { flush(); cur = { title, bullets: [] }; };

    for (const b of doc.blocks) {
      if (b.type === "heading" && b.level <= 2) {
        ensure(plainInline(b.inlines));
      } else if (b.type === "heading") {
        if (!cur) ensure("");
        cur!.bullets.push({ text: plainInline(b.inlines), level: 0 });
      } else if (b.type === "paragraph") {
        if (!cur) ensure(doc.title || "");
        const t = plainInline(b.inlines).trim();
        if (t) cur!.bullets.push({ text: t, level: 0 });
      } else if (b.type === "list") {
        if (!cur) ensure(doc.title || "");
        for (const it of b.items) cur!.bullets.push({ text: plainInline(it), level: 1 });
      } else if (b.type === "quote") {
        if (!cur) ensure(doc.title || "");
        cur!.bullets.push({ text: "“" + plainInline(b.inlines) + "”", level: 0 });
      } else if (b.type === "table") {
        if (!cur) ensure(doc.title || "");
        // flatten table into "a | b | c" bullet rows (compact)
        if (b.header.length) cur!.bullets.push({ text: b.header.map(plainInline).join("  |  "), level: 0 });
        for (const r of b.rows) cur!.bullets.push({ text: r.map(plainInline).join("  |  "), level: 1 });
      }
    }
    flush();
    // cap bullets per slide to keep slides readable; overflow → continuation slides
    const capped: Slide[] = [];
    for (const s of slides) {
      if (s.isTitle || s.bullets.length <= 10) { capped.push(s); continue; }
      for (let i = 0; i < s.bullets.length; i += 10) {
        capped.push({ title: i === 0 ? s.title : `${s.title} (cont.)`, bullets: s.bullets.slice(i, i + 10) });
      }
    }
    return capped;
  }

  private esc(s: string): string { return xmlEsc(s); }

  private titleSlideXml(s: Slide): string {
    const accent = hex(this.theme.accent);
    const head = hex(this.theme.heading);
    const faint = hex(this.theme.textFaint);
    const algn = this.rtl ? ' algn="r"' : "";
    const rtlAttr = this.rtl ? ' rtl="1"' : "";
    return (
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>` +
      `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
      `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_W}" cy="${SLIDE_H}"/>` +
      `<a:chOff x="0" y="0"/><a:chExt cx="${SLIDE_W}" cy="${SLIDE_H}"/></a:xfrm></p:grpSpPr>` +
      // accent band
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="band"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr><a:xfrm><a:off x="0" y="${Math.round(SLIDE_H * 0.62)}"/><a:ext cx="${SLIDE_W}" cy="${Math.round(EMU * 0.08)}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${accent}"/></a:solidFill></p:spPr>` +
      `<p:txBody><a:bodyPr/><a:p/></p:txBody></p:sp>` +
      // title
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>` +
      `<p:spPr><a:xfrm><a:off x="${Math.round(EMU)}" y="${Math.round(EMU * 2.4)}"/><a:ext cx="${SLIDE_W - Math.round(EMU * 2)}" cy="${Math.round(EMU * 2)}"/></a:xfrm></p:spPr>` +
      `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr${algn}/><a:r><a:rPr lang="en-US" sz="4000" b="1"${rtlAttr}><a:solidFill><a:srgbClr val="${head}"/></a:solidFill></a:rPr>` +
      `<a:t>${this.esc(s.title)}</a:t></a:r></a:p>` +
      (s.subtitle ? `<a:p><a:pPr${algn}/><a:r><a:rPr lang="en-US" sz="1800" i="1"${rtlAttr}><a:solidFill><a:srgbClr val="${faint}"/></a:solidFill></a:rPr><a:t>${this.esc(s.subtitle)}</a:t></a:r></a:p>` : "") +
      `</p:txBody></p:sp>` +
      `</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>`
    );
  }

  private contentSlideXml(s: Slide): string {
    const accent = hex(this.theme.accent);
    const head = hex(this.theme.heading);
    const text = hex(this.theme.text);
    const algn = this.rtl ? ' algn="r"' : "";
    const rtlAttr = this.rtl ? ' rtl="1"' : "";
    const body = s.bullets.length
      ? s.bullets.map(bl => {
          const indent = bl.level > 0 ? ` marL="${457200 * bl.level}" lvl="${Math.min(bl.level, 4)}"` : "";
          return `<a:p><a:pPr${indent}${algn}><a:buChar char="•"/></a:pPr>` +
            `<a:r><a:rPr lang="en-US" sz="2000"${rtlAttr}><a:solidFill><a:srgbClr val="${text}"/></a:solidFill></a:rPr>` +
            `<a:t>${this.esc(bl.text)}</a:t></a:r></a:p>`;
        }).join("")
      : `<a:p><a:endParaRPr lang="en-US"/></a:p>`;
    return (
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>` +
      `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
      `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_W}" cy="${SLIDE_H}"/>` +
      `<a:chOff x="0" y="0"/><a:chExt cx="${SLIDE_W}" cy="${SLIDE_H}"/></a:xfrm></p:grpSpPr>` +
      // title bar
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="bar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_W}" cy="${Math.round(EMU * 1.25)}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${accent}"><a:alpha val="12000"/></a:srgbClr></a:solidFill></p:spPr>` +
      `<p:txBody><a:bodyPr/><a:p/></p:txBody></p:sp>` +
      // title text
      `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
      `<p:spPr><a:xfrm><a:off x="${Math.round(EMU * 0.6)}" y="${Math.round(EMU * 0.2)}"/><a:ext cx="${SLIDE_W - Math.round(EMU * 1.2)}" cy="${Math.round(EMU * 0.9)}"/></a:xfrm></p:spPr>` +
      `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr${algn}/><a:r><a:rPr lang="en-US" sz="2800" b="1"${rtlAttr}><a:solidFill><a:srgbClr val="${head}"/></a:solidFill></a:rPr>` +
      `<a:t>${this.esc(s.title)}</a:t></a:r></a:p></p:txBody></p:sp>` +
      // body
      `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Body"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>` +
      `<p:spPr><a:xfrm><a:off x="${Math.round(EMU * 0.7)}" y="${Math.round(EMU * 1.5)}"/><a:ext cx="${SLIDE_W - Math.round(EMU * 1.4)}" cy="${SLIDE_H - Math.round(EMU * 1.9)}"/></a:xfrm></p:spPr>` +
      `<p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>` +
      `</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>`
    );
  }

  render(doc: ParsedDoc): Uint8Array {
    const slides = this.buildSlides(doc);
    const files: Array<{ path: string; data: Uint8Array }> = [];
    const add = (path: string, content: string) => files.push({ path, data: utf8(content) });

    slides.forEach((s, i) => {
      const xml = s.isTitle ? this.titleSlideXml(s) : this.contentSlideXml(s);
      add(`ppt/slides/slide${i + 1}.xml`, xml);
      add(`ppt/slides/_rels/slide${i + 1}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
        `</Relationships>`);
    });

    add("ppt/slideLayouts/slideLayout1.xml", this.layoutXml());
    add("ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
      `</Relationships>`);
    add("ppt/slideMasters/slideMaster1.xml", this.masterXml());
    add("ppt/slideMasters/_rels/slideMaster1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>` +
      `</Relationships>`);
    add("ppt/theme/theme1.xml", this.themeXml());

    // presentation.xml + rels
    const sldIdList = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("");
    add("ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
      `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst>` +
      `<p:sldIdLst>${sldIdList}</p:sldIdLst>` +
      `<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}" type="screen16x9"/>` +
      `<p:notesSz cx="${SLIDE_H}" cy="${SLIDE_W}"/></p:presentation>`);

    const presRels =
      slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rIdMaster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`;
    add("ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels}</Relationships>`);

    // content types
    add("[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
      slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("") +
      `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>` +
      `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
      `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
      `</Types>`);
    add("_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>` +
      `</Relationships>`);

    return zipSync(files);
  }

  private layoutXml(): string {
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="obj" preserve="1">` +
      `<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
      `<p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
    );
  }

  private masterXml(): string {
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
      `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex(this.theme.pageBg ?? [1, 1, 1])}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` +
      `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>` +
      `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
      `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
      `<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`
    );
  }

  private themeXml(): string {
    const accent = hex(this.theme.accent);
    const head = hex(this.theme.heading);
    const clr = (v: string) => `<a:srgbClr val="${v}"/>`;
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Nova">` +
      `<a:themeElements><a:clrScheme name="Nova">` +
      `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
      `<a:dk2>${clr(head)}</a:dk2><a:lt2>${clr("EEEEEE")}</a:lt2>` +
      `<a:accent1>${clr(accent)}</a:accent1><a:accent2>${clr(accent)}</a:accent2><a:accent3>${clr(accent)}</a:accent3>` +
      `<a:accent4>${clr(accent)}</a:accent4><a:accent5>${clr(accent)}</a:accent5><a:accent6>${clr(accent)}</a:accent6>` +
      `<a:hlink>${clr("0563C1")}</a:hlink><a:folHlink>${clr("954F72")}</a:folHlink></a:clrScheme>` +
      `<a:fontScheme name="Nova"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
      `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
      `<a:fmtScheme name="Nova"><a:fillStyleLst><a:solidFill>${clr(accent)}</a:solidFill><a:solidFill>${clr(accent)}</a:solidFill><a:solidFill>${clr(accent)}</a:solidFill></a:fillStyleLst>` +
      `<a:lnStyleLst><a:ln><a:solidFill>${clr(accent)}</a:solidFill></a:ln><a:ln><a:solidFill>${clr(accent)}</a:solidFill></a:ln><a:ln><a:solidFill>${clr(accent)}</a:solidFill></a:ln></a:lnStyleLst>` +
      `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
      `<a:bgFillStyleLst><a:solidFill>${clr("FFFFFF")}</a:solidFill><a:solidFill>${clr("FFFFFF")}</a:solidFill><a:solidFill>${clr("FFFFFF")}</a:solidFill></a:bgFillStyleLst></a:fmtScheme>` +
      `</a:themeElements></a:theme>`
    );
  }
}

/** Public PPTX renderer. */
function renderPptx(doc: ParsedDoc, opts: ExportOptions): Uint8Array {
  const theme = resolveTheme(opts.theme);
  const rtl = opts.rtl ?? doc.rtl;
  return new PptxRenderer(theme, opts, rtl).render(doc);
}

/* ════════════════════════════════════════════════════════════════════════
 * SECTION 11 — HTML RENDERER  (self-contained, themed, RTL-aware)
 * ════════════════════════════════════════════════════════════════════════
 * Emits a single standalone .html file with inline CSS derived from the theme.
 * Correct for every script (the browser shapes RTL), so it doubles as the
 * safest universal fallback. No external assets, no scripts.
 * ────────────────────────────────────────────────────────────────────── */

function inlineToHtml(inlines: Inline[]): string {
  let out = "";
  for (const inl of inlines) {
    let t = htmlEsc(inl.text);
    if (inl.code) t = `<code>${t}</code>`;
    if (inl.bold) t = `<strong>${t}</strong>`;
    if (inl.italic) t = `<em>${t}</em>`;
    if (inl.strike) t = `<del>${t}</del>`;
    if (inl.link) t = `<a href="${htmlEsc(inl.link)}">${t}</a>`;
    out += t;
  }
  return out;
}

function renderHtml(doc: ParsedDoc, opts: ExportOptions): Uint8Array {
  const theme = resolveTheme(opts.theme);
  const rtl = opts.rtl ?? doc.rtl;
  const c = (v: [number, number, number]) => `#${hex(v)}`;
  const dir = rtl ? "rtl" : "ltr";
  const lang = opts.lang || (rtl ? "fa" : "en");
  const fontStack = rtl
    ? `'Vazirmatn','Segoe UI',Tahoma,Arial,sans-serif`
    : theme.serif
      ? `Georgia,'Times New Roman',serif`
      : `'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

  const headings = doc.blocks.filter(b => b.type === "heading" && b.level <= 2) as Array<Extract<Block, { type: "heading" }>>;
  const wantToc = opts.toc ?? headings.length >= 3;
  const wantCover = opts.cover ?? (!!doc.title && doc.blocks.length > 2);

  const body: string[] = [];
  if (wantCover && doc.title) {
    const sub = opts.author ? `${opts.author} · ${nowStamp(opts.lang)}` : nowStamp(opts.lang);
    body.push(`<header class="cover"><div class="kicker">${htmlEsc((opts.author || "NOVA").toUpperCase())}</div><h1 class="cover-title">${htmlEsc(doc.title)}</h1><p class="cover-sub">${htmlEsc(sub)}</p></header>`);
  }
  if (wantToc) {
    const items = headings.map(h => `<li class="lvl${h.level}"><a href="#${h.anchor}">${inlineToHtml(h.inlines)}</a></li>`).join("");
    body.push(`<nav class="toc"><h2>${rtl ? "فهرست" : "Contents"}</h2><ul>${items}</ul></nav>`);
  }

  for (const b of doc.blocks) {
    switch (b.type) {
      case "heading":
        body.push(`<h${b.level} id="${b.anchor}">${inlineToHtml(b.inlines)}</h${b.level}>`);
        break;
      case "paragraph":
        body.push(`<p>${inlineToHtml(b.inlines)}</p>`);
        break;
      case "quote":
        body.push(`<blockquote>${inlineToHtml(b.inlines)}</blockquote>`);
        break;
      case "list": {
        const tag = b.ordered ? "ol" : "ul";
        body.push(`<${tag}>${b.items.map(it => `<li>${inlineToHtml(it)}</li>`).join("")}</${tag}>`);
        break;
      }
      case "code":
        body.push(`<pre><code>${htmlEsc(b.text.replace(/\n$/, ""))}</code></pre>`);
        break;
      case "table": {
        const head = b.header.length ? `<thead><tr>${b.header.map(h => `<th>${inlineToHtml(h)}</th>`).join("")}</tr></thead>` : "";
        const rows = b.rows.map(r => `<tr>${r.map(cell => `<td>${inlineToHtml(cell)}</td>`).join("")}</tr>`).join("");
        body.push(`<table>${head}<tbody>${rows}</tbody></table>`);
        break;
      }
      case "image":
        body.push(`<figure><img src="${htmlEsc(b.url)}" alt="${htmlEsc(b.alt)}"><figcaption>${htmlEsc(b.alt)}</figcaption></figure>`);
        break;
      case "hr":
        body.push("<hr>");
        break;
    }
  }

  const footer = opts.footer ?? (rtl ? `ساخته‌شده با ${NOVA_OFFICE_NAME}` : `Generated by ${NOVA_OFFICE_NAME}`);
  const css = `
    :root { color-scheme: ${theme.pageBg && theme.pageBg[0] < 0.5 ? "dark" : "light"}; }
    * { box-sizing: border-box; }
    body { font-family: ${fontStack}; line-height: 1.75; color: ${c(theme.text)};
      background: ${c(theme.pageBg ?? [1, 1, 1])}; margin: 0; padding: 0; }
    .page { max-width: 820px; margin: 0 auto; padding: 56px 40px 80px; }
    .cover { text-align: ${rtl ? "right" : "left"}; padding: 48px 0 28px; border-bottom: 3px solid ${c(theme.accent)}; margin-bottom: 36px; }
    .kicker { color: ${c(theme.accent)}; font-weight: 700; letter-spacing: .14em; font-size: 13px; }
    .cover-title { font-size: 2.6rem; margin: 8px 0 6px; color: ${c(theme.heading)}; line-height: 1.15; }
    .cover-sub { color: ${c(theme.textFaint)}; font-style: italic; margin: 0; }
    h1,h2,h3,h4 { color: ${c(theme.heading)}; line-height: 1.25; margin: 1.6em 0 .5em; }
    h1 { font-size: 1.9rem; border-bottom: 2px solid ${c(theme.rule)}; padding-bottom: .2em; }
    h2 { font-size: 1.45rem; }
    h3 { font-size: 1.2rem; }
    a { color: ${c(theme.accent)}; }
    p { margin: 0 0 1em; }
    code { font-family: 'Consolas','SF Mono',monospace; background: ${c(theme.codeBg)}; color: ${c(theme.codeText)}; padding: .12em .4em; border-radius: 4px; font-size: .9em; }
    pre { background: ${c(theme.codeBg)}; color: ${c(theme.codeText)}; padding: 16px 18px; border-radius: 8px; border-${rtl ? "right" : "left"}: 4px solid ${c(theme.accent)}; overflow-x: auto; }
    pre code { background: none; padding: 0; color: inherit; }
    blockquote { margin: 1em 0; padding: .4em 1.1em; border-${rtl ? "right" : "left"}: 4px solid ${c(theme.quoteBar)}; color: ${c(theme.textFaint)}; font-style: italic; }
    ul,ol { padding-${rtl ? "right" : "left"}: 1.5em; }
    li { margin: .3em 0; }
    table { border-collapse: collapse; width: 100%; margin: 1.2em 0; font-size: .95em; }
    th,td { border: 1px solid ${c(theme.rule)}; padding: 8px 12px; text-align: ${rtl ? "right" : "left"}; }
    th { background: ${c(theme.tableHeaderBg)}; color: ${c(theme.heading)}; font-weight: 700; }
    tbody tr:nth-child(even) { background: ${c(theme.tableStripe ?? theme.codeBg)}; }
    figure { margin: 1.2em 0; text-align: center; }
    img { max-width: 100%; border-radius: 6px; }
    figcaption { color: ${c(theme.textFaint)}; font-size: .85em; margin-top: .4em; }
    hr { border: none; border-top: 1px solid ${c(theme.rule)}; margin: 2em 0; }
    .toc { background: ${c(theme.codeBg)}; border-radius: 10px; padding: 8px 24px 18px; margin-bottom: 32px; }
    .toc h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: .08em; color: ${c(theme.textFaint)}; border: none; }
    .toc ul { list-style: none; padding-${rtl ? "right" : "left"}: 0; }
    .toc li.lvl2 { padding-${rtl ? "right" : "left"}: 1.4em; font-size: .95em; }
    .toc a { text-decoration: none; }
    .footer { margin-top: 60px; padding-top: 16px; border-top: 1px solid ${c(theme.rule)}; text-align: center; color: ${c(theme.textFaint)}; font-size: .8em; }
  `.trim();

  const html =
    `<!DOCTYPE html>\n<html lang="${htmlEsc(lang)}" dir="${dir}">\n<head>\n` +
    `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${htmlEsc(doc.title || opts.title || "Document")}</title>\n` +
    `<style>${css}</style>\n</head>\n<body>\n<main class="page">\n${body.join("\n")}\n` +
    `<footer class="footer">${htmlEsc(footer)}</footer>\n</main>\n</body>\n</html>`;

  return utf8(html);
}

/* ════════════════════════════════════════════════════════════════════════
 * SECTION 12 — MARKDOWN RENDERER  (normalised, portable Markdown)
 * ════════════════════════════════════════════════════════════════════════
 * Re-serialises the parsed AST to clean CommonMark-ish Markdown. Useful as a
 * lossless-ish text export and a fallback that is valid on any platform.
 * ────────────────────────────────────────────────────────────────────── */

function inlineToMd(inlines: Inline[]): string {
  let out = "";
  for (const inl of inlines) {
    let t = inl.text;
    if (inl.code) { out += "`" + t + "`"; continue; }
    if (inl.bold && inl.italic) t = `***${t}***`;
    else if (inl.bold) t = `**${t}**`;
    else if (inl.italic) t = `*${t}*`;
    if (inl.strike) t = `~~${t}~~`;
    if (inl.link) t = `[${t}](${inl.link})`;
    out += t;
  }
  return out;
}

function renderMarkdown(doc: ParsedDoc, opts: ExportOptions): Uint8Array {
  const lines: string[] = [];
  if (doc.title && (opts.cover ?? true)) {
    lines.push(`# ${doc.title}`, "");
    if (opts.author) lines.push(`*${opts.author} · ${nowStamp(opts.lang)}*`, "");
  }
  for (const b of doc.blocks) {
    switch (b.type) {
      case "heading":
        lines.push(`${"#".repeat(b.level)} ${inlineToMd(b.inlines)}`, "");
        break;
      case "paragraph":
        lines.push(inlineToMd(b.inlines), "");
        break;
      case "quote":
        lines.push(`> ${inlineToMd(b.inlines)}`, "");
        break;
      case "list":
        b.items.forEach((it, i) => lines.push(`${b.ordered ? `${i + 1}.` : "-"} ${inlineToMd(it)}`));
        lines.push("");
        break;
      case "code":
        lines.push("```" + (b.lang || ""), b.text.replace(/\n$/, ""), "```", "");
        break;
      case "table": {
        if (b.header.length) {
          lines.push(`| ${b.header.map(inlineToMd).join(" | ")} |`);
          lines.push(`| ${b.header.map(() => "---").join(" | ")} |`);
        }
        for (const r of b.rows) lines.push(`| ${r.map(inlineToMd).join(" | ")} |`);
        lines.push("");
        break;
      }
      case "image":
        lines.push(`![${b.alt}](${b.url})`, "");
        break;
      case "hr":
        lines.push("---", "");
        break;
    }
  }
  return utf8(lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n");
}

/* ════════════════════════════════════════════════════════════════════════
 * SECTION 13 — EXPORT PIPELINE  (parse → route → render → package)
 * ════════════════════════════════════════════════════════════════════════
 * The single public entry point `exportDocument()` plus small helpers Nova.ts
 * calls directly. Owns format resolution, the RTL→DOCX safety routing (base-14
 * PDF cannot shape Persian/Arabic), and MIME/extension mapping.
 * ────────────────────────────────────────────────────────────────────── */

const MIME: Record<ExportFormat, { mime: string; ext: string }> = {
  pdf:  { mime: "application/pdf", ext: "pdf" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx" },
  html: { mime: "text/html; charset=utf-8", ext: "html" },
  md:   { mime: "text/markdown; charset=utf-8", ext: "md" },
};

type RendererFn = (doc: ParsedDoc, opts: ExportOptions) => Uint8Array;
const RENDERERS: Record<ExportFormat, RendererFn> = {
  pdf: renderPdf,
  docx: renderDocx,
  xlsx: renderXlsx,
  pptx: renderPptx,
  html: renderHtml,
  md: renderMarkdown,
};

/**
 * Generate a document from Markdown-subset `content`.
 *
 * Routing rules:
 *   • RTL (Persian/Arabic) + format "pdf"  → DOCX (base-14 PDF can't shape it).
 *     This is the single most important correctness fix over the old pipeline,
 *     which shipped raw HTML bytes with a .pdf name.
 *   • Everything else renders in the requested format.
 */
/**
 * Self-describing capability manifest. Lets callers (and future tooling / the
 * admin panel) introspect what this engine version supports without hardcoding
 * assumptions — the extensible counterpart to a version number.
 */
export function officeCapabilities(): {
  name: string;
  version: string;
  formats: ExportFormat[];
  themes: string[];
  features: string[];
} {
  return {
    name: NOVA_OFFICE_NAME,
    version: NOVA_OFFICE_VERSION,
    formats: ["pdf", "docx", "xlsx", "pptx", "html", "md"],
    themes: listThemes(),
    features: [
      "markdown-subset-parser",
      "vector-pdf-standard14",
      "embedded-unicode-font",
      "persian-arabic-pdf-shaping",
      "rtl-pdf-native",
      "ooxml-docx-xlsx-pptx",
      "cover-page",
      "table-of-contents",
      "headers-footers-page-numbers",
      "hyperlinks",
      "tables",
      "code-blocks",
      "custom-themes",
    ],
  };
}

export function exportDocument(content: string, options: ExportOptions = {}): ExportResult {
  const opts: ExportOptions = { format: "pdf", theme: "professional", pageNumbers: true, ...options };
  const doc = parseDocument(content, opts);
  const rtl = opts.rtl ?? doc.rtl;

  let format = opts.format ?? "pdf";
  let note: string | undefined;

  // NOTE: Persian/Arabic PDF used to be force-routed to DOCX because the base-14
  // fonts can't shape Arabic. Nova Office now embeds a real Unicode font and does
  // its own shaping (see SECTION 6.5 + novaFont.ts), so a requested PDF is
  // delivered as a REAL Persian PDF. The user only gets DOCX if they ask for it.

  // XLSX only makes sense with tabular data; if none, still emit an outline sheet
  // (handled inside the renderer) — no reroute needed.

  const bytes = RENDERERS[format](doc, { ...opts, rtl });
  const meta = MIME[format];
  return { bytes, mime: meta.mime, ext: meta.ext, format, note };
}

/**
 * Backward-compatible convenience wrapper matching Nova's historical
 * "make me a PDF" call shape. Always returns *something* openable:
 *   • Latin  → real vector PDF
 *   • RTL    → DOCX (correct shaping)
 * Callers should read `.ext`/`.mime` to name and send the file.
 */
export function generatePdfDocument(
  content: string,
  title?: string,
  opts: Omit<ExportOptions, "format" | "title"> = {},
): ExportResult {
  return exportDocument(content, { ...opts, title, format: "pdf" });
}

/** Parse-only helper (exposed for callers that want the AST, e.g. previews). */
export function analyzeContent(content: string, opts: ExportOptions = {}): { rtl: boolean; blocks: number; hasTables: boolean; headings: number } {
  const doc = parseDocument(content, opts);
  return {
    rtl: doc.rtl,
    blocks: doc.blocks.length,
    hasTables: doc.hasTables,
    headings: doc.blocks.filter(b => b.type === "heading").length,
  };
}

/** List of themes the engine supports (for building UI pickers / menus). */
export const AVAILABLE_THEMES: ThemeName[] = ["professional", "modern", "elegant", "minimal", "dark", "corporate", "sunset", "ocean"];
/** List of formats the engine supports. */
export const AVAILABLE_FORMATS: ExportFormat[] = ["pdf", "docx", "xlsx", "pptx", "html", "md"];
