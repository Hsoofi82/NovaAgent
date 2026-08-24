// Ambient declarations for Wrangler "Text" rule imports (see wrangler.toml [[rules]]).
declare module "*.html" {
  const content: string;
  export default content;
}
declare module "*.txt" {
  const content: string;
  export default content;
}
