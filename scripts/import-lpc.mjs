#!/usr/bin/env node
/**
 * Imports wardrobe art from the Universal LPC Spritesheet Character
 * Generator into public/assets/characters/lpc/wardrobe/, and regenerates the
 * catalogue entries and credits that ship with it.
 *
 *     node scripts/import-lpc.mjs            # import everything in the manifest
 *     node scripts/import-lpc.mjs --check    # licences only, download nothing
 *     node scripts/import-lpc.mjs --survey hair   # what else is importable?
 *
 * Edit scripts/lpc-manifest.mjs to change what gets imported, then re-run.
 *
 * ==========================================================================
 * LICENSING - the part of this script that actually matters
 * ==========================================================================
 *
 * The generator REPOSITORY is GPL-3.0, but that is the licence of the
 * generator's own source code. Every piece of art in it carries its own,
 * separate licence, declared in that asset's sheet definition under
 * `credits[].licenses`. The values in the wild are CC0, OGA-BY 3.0/4.0,
 * CC-BY, CC-BY-SA, OGA-SA and GPL 2/3, and a single asset is often offered
 * under several at once.
 *
 * This game is a commercial product that takes real money, so it imports
 * ONLY art available under CC0 or OGA-BY - the two that impose no
 * copyleft/share-alike obligation on the game itself. An asset offered under
 * several licences at once (the common case: "OGA-BY 3.0, CC-BY-SA 3.0, GPL
 * 3.0") is fine, and is taken under the permissive one. CC-BY-SA, OGA-SA,
 * GPL and CC-BY assets are skipped; so is anything whose licence field is
 * missing, empty or unrecognised.
 *
 * Two details this gets right that a naive filter gets wrong:
 *
 *  1. `credits` is a LIST, and its entries cover different files inside one
 *     definition. body.json, for instance, licenses `body/bodies/male` as
 *     OGA-BY but `body/bodies/muscular` as CC-BY-SA/GPL only. So the check is
 *     scoped to the credit entries that actually cover the directory being
 *     downloaded, and every one of those must qualify.
 *  2. Licence strings are not normalised upstream ("OGA-BY 3.0",
 *     "OGA-BY-3.0", "OGA-BY 3.0+"), and "OGA-SA" is share-alike, not
 *     OGA-BY. Matching is done on a normalised string with an exact-prefix
 *     test, so OGA-SA can never be mistaken for OGA-BY.
 *
 * OGA-BY requires attribution, so every imported asset's authors, notes and
 * source links are written into public/assets/characters/lpc/CREDITS.txt,
 * which ships with the game. That is a licence condition, not a courtesy: an
 * import that cannot produce credits must not happen.
 *
 * ==========================================================================
 * FORMAT
 * ==========================================================================
 *
 * The game only ever animates the four walk rows of an LPC sheet, so this
 * downloads each asset's `walk.png` - a 9x4 grid of 64x64 frames (576x256),
 * 1/13th the pixels of the generator's full 832x3456 export. Every download
 * is checked against those dimensions before it is written; a sheet that is
 * any other size is rejected rather than shipped, because a wrongly-sized
 * sheet does not fail loudly at runtime, it just renders as garbage.
 *
 * BootScene re-registers the 9x4 grid under the real LPC frame indices, so
 * the rest of the game addresses these exactly like a full sheet - see
 * `remapWalkOnlySheets` there, and WardrobePieceDef's `sheetLayout`.
 *
 * ==========================================================================
 * COLOUR
 * ==========================================================================
 *
 * LPC art ships in one neutral base ramp per material (cloth is a bone-white
 * ramp, hair a rust-orange one); the generator recolours it in the browser
 * from palette_definitions/. A straight copy would give us twelve identical
 * off-white shirts, so this does the same swap at import time: it detects
 * which named ramp the source sheet is drawn in, then maps that ramp's
 * colours, index for index, onto the ramp named by the manifest entry.
 * Pixels outside the detected ramp (trim, buckles, feathers) are left alone.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST } from "./lpc-manifest.mjs";
import { decodePng, encodeIndexedPng, paletteOf, readHeader } from "./lpc-png.mjs";

const REPO = "liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator";
const BRANCH = "master";
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const ART_DIR = path.join(ROOT, "public/assets/characters/lpc/wardrobe");
const CREDITS_FILE = path.join(ROOT, "public/assets/characters/lpc/CREDITS.txt");
const CLIENT_OUT = path.join(ROOT, "src/wardrobeLpcPieces.ts");
const SERVER_OUT = path.join(ROOT, "server/src/wardrobeLpcPieces.ts");

/** LPC's standard walk sheet: 9 columns (a standing pose + an 8-frame cycle) x 4 directions, 64px frames. */
const WALK_SHEET = { width: 576, height: 256 };

/** Which body variant to import. LPC ships each garment cut for several body types; the game has one. */
const BODY_TYPE = ["male", "muscular", "adult", "thin", "female"];

// --- licensing ------------------------------------------------------------

/**
 * The only two licences this project may ship art under.
 *
 * Deliberately a prefix test on a normalised string rather than a set of
 * exact names: upstream writes "OGA-BY 3.0", "OGA-BY-3.0" and "OGA-BY 3.0+"
 * for the same licence, and new versions appear over time. "OGA-SA" - a
 * share-alike licence - is NOT matched by "OGA-BY", which is exactly why the
 * prefixes include the "-BY".
 */
const PERMISSIVE_PREFIXES = ["CC0", "OGA-BY"];

const normaliseLicence = (s) =>
  String(s).toUpperCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

function isPermissive(licence) {
  const n = normaliseLicence(licence);
  return PERMISSIVE_PREFIXES.some((p) => n === p || n.startsWith(`${p}-`) || n.startsWith(`${p} `));
}

/** True when `dir` is inside (or equal to) the path a credit entry covers. */
function creditCovers(creditFile, dir) {
  const a = String(creditFile ?? "").replace(/^\/+|\/+$/g, "");
  const b = dir.replace(/^\/+|\/+$/g, "");
  if (!a) return false;
  return b === a || b.startsWith(`${a}/`) || a.startsWith(`${b}/`);
}

/**
 * Decides whether the art in `dir` may be shipped, and returns the credits
 * that have to be published alongside it.
 *
 * Returns `{ ok: false, reason }` for anything not clearly CC0/OGA-BY -
 * including a definition with no credits at all, which is treated as
 * unlicensed rather than as unrestricted.
 */
function clearForUse(definition, dir) {
  const credits = definition.credits;
  if (!Array.isArray(credits) || credits.length === 0) {
    return { ok: false, reason: "no credits block - licence unknown" };
  }

  const applicable = credits.filter((c) => creditCovers(c.file, dir));
  if (applicable.length === 0) {
    return { ok: false, reason: `no credit entry covers ${dir}` };
  }

  for (const credit of applicable) {
    const licences = credit.licenses;
    if (!Array.isArray(licences) || licences.length === 0) {
      return { ok: false, reason: `credit for ${credit.file} lists no licence` };
    }
    if (!licences.some(isPermissive)) {
      return { ok: false, reason: `${credit.file} is ${licences.join(", ")} only` };
    }
  }

  return { ok: true, credits: applicable };
}

// --- fetching -------------------------------------------------------------

const cache = new Map();

async function getText(repoPath) {
  if (cache.has(repoPath)) return cache.get(repoPath);
  const res = await fetch(RAW + repoPath);
  if (!res.ok) throw new Error(`${repoPath}: HTTP ${res.status}`);
  const text = await res.text();
  cache.set(repoPath, text);
  return text;
}

const getJson = async (repoPath) => JSON.parse(await getText(repoPath));

async function getBinary(repoPath) {
  const res = await fetch(RAW + repoPath);
  if (!res.ok) throw new Error(`${repoPath}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// --- palettes -------------------------------------------------------------

const paletteCache = new Map();

/** All named colour ramps for a material ("cloth", "hair", "body", ...). */
async function ramps(material) {
  if (paletteCache.has(material)) return paletteCache.get(material);
  let loaded = {};
  for (const scheme of ["ulpc", "lpcr"]) {
    try {
      const json = await getJson(`palette_definitions/${material}/${material}_${scheme}.json`);
      loaded = { ...json, ...loaded }; // ulpc wins on a name clash - it is the modern scheme
    } catch {
      /* not every material publishes every scheme */
    }
  }
  paletteCache.set(material, loaded);
  return loaded;
}

/**
 * Works out which named ramp a sheet is drawn in, by overlap with its own
 * colours.
 *
 * Requires at least three shared colours before it will claim a match: two
 * could easily be a coincidence between ramps (every dark ramp shares its
 * near-blacks), and mis-detecting the source ramp maps colours to the wrong
 * index and produces a garish mess rather than a recolour.
 */
function detectRamp(sheetColours, allRamps) {
  const colours = new Set(sheetColours.map((c) => c.toLowerCase()));
  let best = null;
  for (const [name, ramp] of Object.entries(allRamps)) {
    const hits = ramp.filter((c) => colours.has(c.toLowerCase())).length;
    if (!best || hits > best.hits) best = { name, ramp, hits };
  }
  return best && best.hits >= 3 ? best : null;
}

/** Maps every pixel drawn in `from` onto the same index of `to`. Anything else is untouched. */
function recolour(image, from, to) {
  const map = new Map();
  from.forEach((hex, i) => {
    const target = to[i];
    if (!target) return;
    map.set(hex.toLowerCase(), [
      parseInt(target.slice(1, 3), 16),
      parseInt(target.slice(3, 5), 16),
      parseInt(target.slice(5, 7), 16)
    ]);
  });

  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const hex =
      "#" + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    const to3 = map.get(hex);
    if (!to3) continue;
    data[i] = to3[0];
    data[i + 1] = to3[1];
    data[i + 2] = to3[2];
  }
  return image;
}

// --- the import -----------------------------------------------------------

/** The directory a definition keeps this game's body-type art in. */
function sheetDir(definition) {
  const layers = Object.keys(definition)
    .filter((k) => /^layer_\d+$/.test(k))
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  if (layers.length === 0) return null;
  if (layers.length > 1) {
    // Multi-layer pieces (hair with separate front/back sheets, coats with
    // separate trim) need more than one texture stacked in a fixed order.
    // The wardrobe draws one texture per slot, so these are a curation
    // mistake rather than something to paper over at runtime.
    return { error: `${layers.length} layers - the wardrobe draws one texture per slot` };
  }
  const layer = definition[layers[0]];
  const dir = BODY_TYPE.map((t) => layer[t]).find(Boolean);
  if (!dir) return { error: `no art for body types ${BODY_TYPE.join("/")}` };
  return { dir: dir.replace(/\/+$/, "") };
}

async function importPiece(pick, { checkOnly }) {
  const definition = await getJson(`sheet_definitions/${pick.def}`);

  const resolved = sheetDir(definition);
  if (!resolved || resolved.error) throw new Error(resolved?.error ?? "no layers");
  const { dir } = resolved;

  const verdict = clearForUse(definition, dir);
  if (!verdict.ok) throw new Error(`LICENCE: ${verdict.reason}`);

  if (checkOnly) {
    return { pick, dir, credits: verdict.credits, licences: licencesOf(verdict.credits) };
  }

  const png = await getBinary(`spritesheets/${dir}/walk.png`);
  const header = readHeader(png);
  if (header.width !== WALK_SHEET.width || header.height !== WALK_SHEET.height) {
    throw new Error(
      `sheet is ${header.width}x${header.height}, expected ${WALK_SHEET.width}x${WALK_SHEET.height} ` +
        "(9x4 frames of 64px) - refusing to ship a sheet the rig cannot address"
    );
  }

  let image = decodePng(png);
  let colourNote = "source colours";

  if (pick.color) {
    const material = definition.recolors?.material ?? "cloth";
    const all = await ramps(material);
    const target = Object.entries(all).find(([n]) => n.toLowerCase() === pick.color.toLowerCase());
    if (!target) throw new Error(`no "${pick.color}" ramp in the ${material} palette`);
    const source = detectRamp(paletteOf(image), all);
    if (!source) throw new Error(`could not identify the base ramp of ${dir} (material ${material})`);
    image = recolour(image, source.ramp, target[1]);
    colourNote = `${material}: ${source.name} -> ${target[0]}`;
  }

  const file = `wardrobe/${pick.id}.png`;
  const out = encodeIndexedPng(image);
  fs.mkdirSync(ART_DIR, { recursive: true });
  fs.writeFileSync(path.join(ROOT, "public/assets/characters/lpc", file), out);

  return { pick, dir, file, bytes: out.length, credits: verdict.credits, colourNote, licences: licencesOf(verdict.credits) };
}

const licencesOf = (credits) => [
  ...new Set(credits.flatMap((c) => c.licenses).filter(isPermissive).map(normaliseLicence))
];

// --- generated output -----------------------------------------------------

const HEADER = (extra) => `/**
 * GENERATED FILE - do not edit by hand.
 *
 * Written by scripts/import-lpc.mjs from the pick-list in
 * scripts/lpc-manifest.mjs. Change the manifest and re-run the script; any
 * edit made here is lost on the next import.
 *
 * Every piece below is real art from the Universal LPC Spritesheet Character
 * Generator, imported only where the asset's own sheet definition offers it
 * under CC0 or OGA-BY. Attribution for the OGA-BY pieces ships with the game
 * in public/assets/characters/lpc/CREDITS.txt.
${extra}
 */`;

function writeClient(results) {
  const rows = results
    .map(
      (r) =>
        `  { id: ${JSON.stringify(r.pick.id)}, slot: ${JSON.stringify(r.pick.slot)}, name: ${JSON.stringify(
          r.pick.name
        )}, price: ${r.pick.price}, file: ${JSON.stringify(r.file)}, sheetLayout: "walk", placeholderColor: 0x${r.pick.swatch
          .toString(16)
          .padStart(6, "0")} }`
    )
    .join(",\n");

  fs.writeFileSync(
    CLIENT_OUT,
    `${HEADER(
      ` *\n * Prices are in TICKETS and are spend-only: TICKETS are still credited\n * solely by GAME_WIN_TICKETS, which the import does not touch.`
    )}

import type { WardrobePieceDef } from "./wardrobeCatalog";

export const LPC_WARDROBE_PIECES: readonly WardrobePieceDef[] = [
${rows}
];
`
  );
}

function writeServer(results) {
  const rows = results
    .map(
      (r) =>
        `  { id: ${JSON.stringify(r.pick.id)}, slot: ${JSON.stringify(r.pick.slot)}, name: ${JSON.stringify(
          r.pick.name
        )}, price: ${r.pick.price} }`
    )
    .join(",\n");

  fs.writeFileSync(
    SERVER_OUT,
    `${HEADER(
      ` *\n * The server never draws anything, so the rendering-only fields (file,\n * sheetLayout, placeholderColor) are deliberately not copied here - same\n * split as wardrobeCatalog.ts itself.`
    )}

import type { WardrobePieceDef } from "./wardrobeCatalog";

export const LPC_WARDROBE_PIECES: readonly WardrobePieceDef[] = [
${rows}
];
`
  );
}

const CREDITS_BEGIN = "=== BEGIN GENERATED (scripts/import-lpc.mjs) - do not edit by hand ===";
const CREDITS_END = "=== END GENERATED ===";

/**
 * Rewrites the generated half of CREDITS.txt, leaving everything outside the
 * markers (the hand-written base-body credits) untouched.
 */
function writeCredits(results) {
  const blocks = results.map((r) => {
    const lines = [`${r.pick.name} (${r.pick.id}) - spritesheets/${r.dir}/walk.png`];
    for (const c of r.credits) {
      if (c.notes) lines.push(`\t- Note: ${c.notes}`);
      lines.push("\t- Used under:");
      for (const l of r.licences) lines.push(`\t\t- ${l}`);
      lines.push("\t- Authors:");
      for (const a of c.authors ?? []) lines.push(`\t\t- ${a}`);
      if (c.urls?.length) {
        lines.push("\t- Links:");
        for (const u of c.urls) lines.push(`\t\t- ${u}`);
      }
    }
    return lines.join("\n");
  });

  const generated = [
    CREDITS_BEGIN,
    "",
    "Wardrobe art from the Universal LPC Spritesheet Character Generator",
    `(https://github.com/${REPO}), imported by scripts/import-lpc.mjs.`,
    "",
    "Only assets offered under CC0 or OGA-BY are imported. OGA-BY requires",
    "attribution, which is what this section is. Each entry lists the permissive",
    "licence the asset is used under, its authors, and where it came from.",
    "",
    ...blocks.flatMap((b) => [b, ""]),
    CREDITS_END,
    ""
  ].join("\n");

  const existing = fs.existsSync(CREDITS_FILE) ? fs.readFileSync(CREDITS_FILE, "utf8") : "";
  const start = existing.indexOf(CREDITS_BEGIN);
  const end = existing.indexOf(CREDITS_END);
  const preserved =
    start >= 0 && end > start ? existing.slice(0, start) + existing.slice(end + CREDITS_END.length + 1) : existing;

  fs.writeFileSync(CREDITS_FILE, `${preserved.trimEnd()}\n\n${generated}`);
}

// --- survey (what else could we import?) ----------------------------------

/**
 * Lists the permissively-licensed, single-layer, walk-capable assets in a
 * category that aren't already in the manifest - the "show me what else is
 * available" mode, so picking more art doesn't mean hand-reading 650 JSON
 * files.
 */
async function survey(category) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
  const tree = await res.json();
  const paths = tree.tree
    .filter((e) => e.type === "blob" && e.path.startsWith(`sheet_definitions/${category}`) && e.path.endsWith(".json"))
    .map((e) => e.path.replace("sheet_definitions/", ""))
    .filter((p) => !path.basename(p).startsWith("meta_"));

  const already = new Set(MANIFEST.map((m) => m.def));
  for (const p of paths) {
    let definition;
    try {
      definition = await getJson(`sheet_definitions/${p}`);
    } catch {
      continue;
    }
    const resolved = sheetDir(definition);
    if (!resolved || resolved.error) continue;
    const verdict = clearForUse(definition, resolved.dir);
    if (!verdict.ok) continue;
    console.log(
      `${already.has(p) ? "[in manifest] " : "              "}${p}  "${definition.name}"  ${resolved.dir}  ${licencesOf(
        verdict.credits
      ).join(", ")}`
    );
  }
}

// --- main -----------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const surveyAt = args.indexOf("--survey");
  if (surveyAt >= 0) return survey(args[surveyAt + 1] ?? "");

  const checkOnly = args.includes("--check");
  const results = [];
  const failures = [];

  for (const pick of MANIFEST) {
    try {
      const result = await importPiece(pick, { checkOnly });
      results.push(result);
      console.log(
        `ok   ${pick.id.padEnd(18)} ${result.licences.join("/").padEnd(12)} ${result.dir}` +
          (result.bytes ? `  ${(result.bytes / 1024).toFixed(1)}kB  ${result.colourNote}` : "")
      );
    } catch (err) {
      failures.push({ pick, message: err.message });
      console.error(`SKIP ${pick.id.padEnd(18)} ${err.message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} piece(s) skipped:`);
    for (const f of failures) console.error(`  ${f.pick.id}: ${f.message}`);
  }

  if (checkOnly) {
    console.log(`\n${results.length} of ${MANIFEST.length} pieces clear to ship.`);
    process.exitCode = failures.length ? 1 : 0;
    return;
  }

  // A partial catalogue is worse than none: it would silently drop pieces
  // players may already own. Write nothing unless every pick landed.
  if (failures.length > 0) {
    console.error("\nNothing written - fix the manifest and re-run.");
    process.exitCode = 1;
    return;
  }

  writeClient(results);
  writeServer(results);
  writeCredits(results);

  const bytes = results.reduce((n, r) => n + r.bytes, 0);
  console.log(
    `\n${results.length} pieces, ${(bytes / 1024).toFixed(0)}kB of art. ` +
      `Wrote ${path.relative(ROOT, CLIENT_OUT)}, ${path.relative(ROOT, SERVER_OUT)}, ` +
      `${path.relative(ROOT, CREDITS_FILE)}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
