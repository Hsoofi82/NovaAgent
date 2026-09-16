declare module "bidi-js" {
  interface Levels { levels: Uint8Array; paragraphs: Array<{ start: number; end: number; level: number }> }
  export default function bidiFactory(): {
    getEmbeddingLevels(text: string, direction?: "rtl" | "ltr"): Levels;
    getReorderedString(text: string, levels: Levels, start?: number, end?: number): string;
  };
}
