/** Shared, runtime-independent contract between Nova and native build workers. */
export const FACTORY_VERSION = 1;
export const FLUTTER_VERSION = "3.47.2";
export const TARGETS = ["android-apk", "android-aab", "windows"] as const;
export type AppTarget = typeof TARGETS[number];
export type BuildStatus = "queued" | "generating" | "building" | "repairing" | "succeeded" | "failed" | "cancelled";
export const DEPENDENCIES: Readonly<Record<string, string>> = Object.freeze({
  shared_preferences: "2.5.3", http: "1.4.0", supabase_flutter: "2.9.1",
});
export interface AppFile { path: string; content: string }
export interface AppSpec {
  version: 1; name: string; title: string; language: "fa" | "en" | "ar";
  architecture: string; acceptance: string[]; dependencies: string[]; files: AppFile[];
  backend?: { url: string; anonKey: string };
  dependencyLock?: string;
}
export interface AppPatch {
  architecture?: string; acceptance?: string[]; dependencies?: string[];
  files: Array<{ path: string; content?: string; delete?: boolean }>;
}
export interface BuildArtifact { name: string; key: string; bytes: number; sha256: string; kind: "binary" | "source"; signing: "development" | "release" | "unsigned" | "not-applicable" }
export const MAX_PROJECT_BYTES = 500_000;
export const MAX_ARTIFACT_BYTES = 90 * 1024 * 1024;
export const BUILD_LEASE_MS = 5 * 60_000;
export const MAX_BUILD_REPAIRS = 2;
export const MAX_PROJECTS_PER_USER = 12;
export const MAX_STORED_PROJECTS_PER_USER = 24;

export function appTarget(value: unknown): AppTarget {
  if (!(TARGETS as readonly unknown[]).includes(value)) throw new Error("UNSUPPORTED_APP_TARGET");
  return value as AppTarget;
}
export function isNativeAppRequest(text: string): boolean {
  if(/\b(apk|aab|exe)\b/i.test(text))return true;
  // A responsive web app for a phone/desktop is not a native compilation request.
  if(/\b(web ?app|website|browser|pwa)\b|وب.?اپ|وب.?سایت|مرورگر/i.test(text))return false;
  return /\b(native app|desktop app|android app|windows app)\b|(?:اپلیکیشن|برنامه).{0,24}(اندروید|ویندوز|دسکتاپ)|خروجی.{0,15}(اندروید|ویندوز)/i.test(text);
}
export function targetHost(target: AppTarget): "linux" | "windows" {
  return target === "windows" ? "windows" : "linux";
}
export function safeProjectPath(value: unknown, allowProtected = false): string {
  if (typeof value !== "string" || value.length > 160 || !/^(lib|test|assets|docs)\/[a-zA-Z0-9_./-]+$/.test(value)) throw new Error("INVALID_PROJECT_PATH");
  const parts = value.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error("INVALID_PROJECT_PATH");
  if (!/\.(dart|json|md)$/.test(value) || /(?:^|\/)(?:build|hook)\.dart$/.test(value)) throw new Error("FORBIDDEN_PROJECT_FILE");
  if (!allowProtected && (value === "test/nova_smoke_test.dart" || value.startsWith("lib/nova/"))) throw new Error("PROTECTED_TEMPLATE_FILE");
  return value;
}
export function validateSpec(spec: AppSpec): void {
  if (spec.version !== 1 || !/^nova_[a-z0-9_]{3,40}$/.test(spec.name)) throw new Error("INVALID_PROJECT_NAME");
  if (!["fa", "en", "ar"].includes(spec.language) || typeof spec.title!=="string" || !spec.title || spec.title.length > 120
    || typeof spec.architecture!=="string" || spec.architecture.length>1800 || !Array.isArray(spec.acceptance)
    || spec.acceptance.length>12 || spec.acceptance.some(item=>typeof item!=="string"||item.length>200)) throw new Error("INVALID_PROJECT_METADATA");
  if (!Array.isArray(spec.files) || spec.files.length > 60 || !Array.isArray(spec.dependencies) || spec.dependencies.length > 8) throw new Error("PROJECT_LIMIT");
  if (spec.dependencies.some(name => !Object.hasOwn(DEPENDENCIES, name))) throw new Error("DEPENDENCY_NOT_APPROVED");
  if (spec.backend) validateBackend(spec.backend);
  if (spec.dependencyLock && (typeof spec.dependencyLock!=="string" || spec.dependencyLock.length>100_000 || !/^packages:/m.test(spec.dependencyLock))) throw new Error("INVALID_DEPENDENCY_LOCK");
  const names = new Set<string>();
  let total = 0;
  for (const file of spec.files) {
    if (!file || typeof file.content !== "string" || file.content.length > 100_000) throw new Error("INVALID_PROJECT_FILE");
    safeProjectPath(file.path, true);
    if (names.has(file.path.toLowerCase())) throw new Error("DUPLICATE_PROJECT_PATH");
    names.add(file.path.toLowerCase());
    total += new TextEncoder().encode(file.content).length;
    if (total > MAX_PROJECT_BYTES) throw new Error("PROJECT_TOO_LARGE");
    if (file.path.endsWith(".dart")) {
      for (const match of file.content.matchAll(/(?:import|export)\s+['"]package:([^/]+)\//g)) {
        if (![spec.name, "flutter", "flutter_test", ...spec.dependencies].includes(match[1])) throw new Error(`UNDECLARED_DEPENDENCY:${match[1]}`);
      }
      if (/(?:import|export)\s+['"](?:https?:|file:|\/|\.\.\/\.\.\/)/.test(file.content)) throw new Error("EXTERNAL_DART_SOURCE");
    }
  }
  if (!names.has("lib/main.dart") || !names.has("lib/app.dart") || !names.has("test/generated_test.dart")) throw new Error("MISSING_APP_ENTRY_OR_TESTS");
}
export function validateBackend(value: unknown): {url:string;anonKey:string} {
  const config=value as {url?:unknown;anonKey?:unknown};
  if(!config||typeof config.url!=="string"||typeof config.anonKey!=="string"||config.anonKey.length>4096)throw new Error("INVALID_PUBLIC_BACKEND_CONFIG");
  const url=new URL(config.url);
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!=="/")throw new Error("INVALID_PUBLIC_BACKEND_URL");
  if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.anonKey)){
    try{const part=config.anonKey.split(".")[1];const payload=JSON.parse(atob(part.replace(/-/g,"+").replace(/_/g,"/")));if(payload.role!=="anon")throw new Error();}
    catch{throw new Error("ONLY_PUBLIC_ANON_KEYS_ALLOWED");}
  }
  return {url:url.origin,anonKey:config.anonKey};
}
export function applyAppPatch(base: AppSpec, raw: unknown): AppSpec {
  const patch = raw as AppPatch;
  if (!patch || !Array.isArray(patch.files) || patch.files.length > 40) throw new Error("INVALID_APP_PATCH");
  const files = new Map(base.files.map(file => [file.path, file.content]));
  const touched = new Set<string>();
  for (const edit of patch.files) {
    const path = safeProjectPath(edit?.path);
    if (touched.has(path.toLowerCase())) throw new Error("DUPLICATE_PATCH_PATH");
    touched.add(path.toLowerCase());
    if (edit.delete === true) files.delete(path);
    else if (typeof edit.content === "string") files.set(path, edit.content);
    else throw new Error("INVALID_PATCH_CONTENT");
  }
  const spec: AppSpec = { ...base,
    architecture: typeof patch.architecture === "string" ? patch.architecture.slice(0, 1800) : base.architecture,
    acceptance: Array.isArray(patch.acceptance) ? patch.acceptance.filter(x => typeof x === "string").slice(0, 12).map(x => x.slice(0, 200)) : base.acceptance,
    dependencies: Array.isArray(patch.dependencies) ? [...new Set(["shared_preferences", ...patch.dependencies])] : base.dependencies,
    files: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({ path, content })),
  };
  if (JSON.stringify([...spec.dependencies].sort())!==JSON.stringify([...base.dependencies].sort())) delete spec.dependencyLock;
  validateSpec(spec);
  return spec;
}
export function pubspec(spec: AppSpec, buildNumber = 1): string {
  validateSpec(spec);
  if(!Number.isInteger(buildNumber)||buildNumber<1||buildNumber>2100000000)throw new Error("INVALID_BUILD_NUMBER");
  return `name: ${spec.name}\npublish_to: none\nversion: 1.0.0+${buildNumber}\nenvironment:\n  sdk: '>=3.8.0 <4.0.0'\ndependencies:\n  flutter:\n    sdk: flutter\n${spec.dependencies.map(name => `  ${name}: '${DEPENDENCIES[name]}'`).join("\n")}\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\nflutter:\n  uses-material-design: true\n${spec.files.some(f => f.path.startsWith("assets/")) ? "  assets:\n" + spec.files.filter(f => f.path.startsWith("assets/")).map(f => `    - ${f.path}`).join("\n") + "\n" : ""}`;
}
export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}
export function cleanBuildLog(value: unknown): string {
  return String(value ?? "").replace(/\x1b\[[0-9;]*m/g, "").replace(/(?:Bearer\s+)[^\s]+/gi, "Bearer [redacted]")
    .replace(/((?:token|password|secret|api_key)\s*[=:]\s*)[^\s,]+/gi, "$1[redacted]").slice(-16_000);
}
