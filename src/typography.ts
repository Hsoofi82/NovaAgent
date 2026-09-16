import bidiFactory from "bidi-js";
const bidi = bidiFactory();

/** Unicode UAX #9 resolves paired brackets, neutral punctuation, numbers and isolates. */
export function reorderBidi(text: string, rtl: boolean): string {
  const levels = bidi.getEmbeddingLevels(text, rtl ? "rtl" : "ltr");
  return bidi.getReorderedString(text, levels).replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "");
}

/** Logical-order runs for native shaping engines such as Word; never visually reverse OOXML. */
export function directionalRuns(text: string, rtl: boolean): Array<{ text: string; rtl: boolean }> {
  const { levels } = bidi.getEmbeddingLevels(text, rtl ? "rtl" : "ltr");
  const runs: Array<{ text: string; rtl: boolean }> = [];
  let offset = 0;
  for (const char of text) {
    const direction = Boolean(levels[offset] & 1);
    const last = runs[runs.length - 1];
    if (last && last.rtl === direction) last.text += char;
    else runs.push({ text: char, rtl: direction });
    offset += char.length;
  }
  return runs;
}

/** PDF text strings use UTF-16BE, not raw UTF-8 in a literal string. */
export function pdfUnicodeString(text: string): string {
  let hex = "feff";
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, "0");
  return `<${hex}>`;
}

/** Numeric spreadsheet cells: keep identifiers/leading zeros/long integers as text. */
export function spreadsheetNumber(text: string): number | null {
  const normalized = text.trim().replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6f0))
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660)).replace(/٫/g, ".").replace(/٬/g, ",");
  if (!/^[+-]?(?:0|[1-9]\d{0,14}|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized.replace(/,/g, ""));
  return Number.isFinite(value) && normalized.replace(/\D/g, "").length <= 15 ? value : null;
}
