#!/usr/bin/env node
/**
 * 装进 DSH profile 时补两笔（#154）：
 *   1. dsh.profile.bundles
 *   2. 用户层 cordis.patch.yml 的本体 insert
 * pnpm add / dsh plugin add 都不会自己写 insert；市场会写，已有则跳过。
 * 在插件仓库里跑 pnpm install 则整段跳过。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "dsh-purge";

const INSERT_BLOCK = [
  "- insert:",
  "    - id: dsh-purge",
  "      name: dsh-purge",
  "",
].join("\n");

function readJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function isProfilePkg(pkg) {
  if (!pkg || typeof pkg !== "object") return false;
  if (typeof pkg.name === "string" && pkg.name.startsWith("dsh-profile-")) return true;
  return Array.isArray(pkg.dsh?.profile?.bundles);
}

function findProfileDir() {
  const seeds = [process.env.INIT_CWD, process.env.npm_config_local_prefix, process.cwd()].filter(Boolean);
  for (const seed of seeds) {
    let dir = path.resolve(seed);
    for (let i = 0; i < 8; i += 1) {
      if (isProfilePkg(readJson(path.join(dir, "package.json")))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return "";
}

export function profileHasPurgeBodyInsert(text) {
  const lines = String(text || "").split(/\r?\n/);
  let insertIndent = -1;
  for (const line of lines) {
    if (/^-\s*insert:\s*$/.test(line) || /^\s+-\s*insert:\s*$/.test(line)) {
      insertIndent = (line.match(/^[ \t]*/) || [""])[0].length;
      continue;
    }
    if (insertIndent < 0) continue;
    const indent = (line.match(/^[ \t]*/) || [""])[0].length;
    const trimmed = line.trim();
    if (trimmed && indent <= insertIndent && /^-\s/.test(trimmed)) {
      insertIndent = -1;
      if (/^-\s*insert:\s*$/.test(trimmed)) {
        insertIndent = indent;
      }
      continue;
    }
    if (/^-\s*id:\s*dsh-purge\s*$/.test(trimmed)) return true;
  }
  return false;
}

function ensureProfileInsert(profileDir) {
  const fp = path.join(profileDir, "cordis.patch.yml");
  let text = "";
  try { text = fs.readFileSync(fp, "utf8"); } catch { text = ""; }
  if (profileHasPurgeBodyInsert(text)) {
    process.stdout.write(`dsh-purge: insert already in ${fp}\n`);
    return false;
  }
  const prefix = text && !text.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(fp, `${text}${prefix}${text ? "\n" : ""}${INSERT_BLOCK}`, "utf8");
  process.stdout.write(`dsh-purge: wrote body insert (${fp})\n`);
  return true;
}

function main() {
  const profileDir = findProfileDir();
  if (!profileDir) return;

  const fp = path.join(profileDir, "package.json");
  const pkg = readJson(fp);
  if (!pkg) {
    process.stderr.write(`dsh-purge: cannot read ${fp}\n`);
    process.exit(1);
  }
  pkg.dsh = pkg.dsh && typeof pkg.dsh === "object" ? pkg.dsh : {};
  pkg.dsh.profile = pkg.dsh.profile && typeof pkg.dsh.profile === "object" ? pkg.dsh.profile : {};
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
  if (!bundles.includes(NAME)) {
    pkg.dsh.profile.bundles = [...bundles, NAME];
    fs.writeFileSync(fp, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    process.stdout.write(`dsh-purge: appended to bundles (${profileDir})\n`);
  } else {
    process.stdout.write(`dsh-purge: already in bundles (${profileDir})\n`);
  }

  try {
    ensureProfileInsert(profileDir);
  } catch (e) {
    process.stderr.write(`dsh-purge: insert failed: ${e && e.message ? e.message : e}\n`);
    process.exit(1);
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url)) main();
