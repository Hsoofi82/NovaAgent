// Resolver hook: the worker uses extensionless imports (Wrangler resolves them);
// Node ESM does not. This maps "./novaFont" -> "./novaFont.ts" for tests only.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

export function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : process.cwd();
    for (const ext of [".ts", ".mjs", ".js"]) {
      const candidate = resolvePath(base, specifier + ext);
      if (existsSync(candidate)) {
        return next(pathToFileURL(candidate).href, context);
      }
    }
  }
  return next(specifier, context);
}
