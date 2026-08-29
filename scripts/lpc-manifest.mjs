/**
 * The curated pick-list for scripts/import-lpc.mjs - which LPC art the game
 * actually sells.
 *
 * ## Why this is a hand-written list and not "import the folder"
 *
 * The Universal LPC Spritesheet Generator ships ~650 clothing/hair sheets.
 * Importing them all would add tens of MB to the site, take the Item Shop
 * from browsable to unusable, and - the part that actually matters - drag in
 * art this project is not allowed to ship. See import-lpc.mjs's header on
 * licensing: only CC0 and OGA-BY art may be used here, and that is decided
 * per asset, from the asset's own sheet definition, at import time.
 *
 * So this file is the taste layer: roughly 9-13 pieces per slot, chosen to
 * mix and match into outfits that read as one wardrobe rather than a costume
 * box. Everyday basics are cheap, showpieces are expensive.
 *
 * ## Adding a piece
 *
 * Add an entry here and re-run `node scripts/import-lpc.mjs`. The script
 * checks the licence, downloads the sheet, verifies its size, recolours it
 * and rewrites both generated catalogues and CREDITS.txt. Nothing else has
 * to be touched.
 *
 * Fields:
 *  - `id`       stable ownership + texture key. NEVER change one: players own
 *               pieces by id. (The ids that predate the art import are kept
 *               deliberately, so nobody loses a purchase.)
 *  - `slot`     which wardrobe layer it draws on.
 *  - `price`    TICKETS. Spend-only; TICKETS are still credited solely by
 *               GAME_WIN_TICKETS, which this import does not touch.
 *  - `def`      path under the generator's `sheet_definitions/`. This is what
 *               carries the licence and the art's location.
 *  - `color`    palette ramp to recolour into (LPC ships every sheet in one
 *               neutral base ramp). Omit to keep the source colours.
 *  - `swatch`   fallback/placeholder tint, roughly the recoloured result.
 */

/** @typedef {{id:string,slot:string,name:string,price:number,def:string,color?:string,swatch:number}} LpcPick */

/** @type {LpcPick[]} */
export const MANIFEST = [
  // --- BODY -----------------------------------------------------------
  // Skin tones. The default body (body_default) is not imported here - it is
  // the full 13x54 generator export already committed as body_base.png.
  { id: "body_tan", slot: "BODY", name: "Tan", price: 150, def: "body/body.json", color: "taupe", swatch: 0xba8454 },
  { id: "body_deep", slot: "BODY", name: "Deep", price: 150, def: "body/body.json", color: "brown", swatch: 0x9c663e },

  // --- HAIR -----------------------------------------------------------
  // Single-layer styles only. LPC's long/ponytail styles ship as separate
  // foreground+background sheets meant to straddle the body; this wardrobe
  // has one HAIR layer, so those would draw their back hair over the
  // shoulders. Skipped rather than shipped wrong.
  { id: "hair_short", slot: "HAIR", name: "Short Crop", price: 120, def: "hair/bald/hair_buzzcut.json", color: "black", swatch: 0x1c2222 },
  { id: "hair_long", slot: "HAIR", name: "Long", price: 180, def: "hair/long/hair_long_straight.json", color: "dark_brown", swatch: 0x3b2519 },
  { id: "hair_ponytail", slot: "HAIR", name: "Top Bun", price: 220, def: "hair/braids/hair_bangs_bun.json", color: "chestnut", swatch: 0x6b3a1f },
  { id: "hair_bleach", slot: "HAIR", name: "Bleached", price: 300, def: "hair/short/hair_plain.json", color: "platinum", swatch: 0xeddf95 },
  { id: "hair_afro", slot: "HAIR", name: "Afro", price: 200, def: "hair/afro/hair_afro.json", color: "black", swatch: 0x1c2222 },
  { id: "hair_cornrows", slot: "HAIR", name: "Cornrows", price: 240, def: "hair/afro/hair_cornrows.json", color: "black", swatch: 0x1c2222 },
  { id: "hair_dreads", slot: "HAIR", name: "Dreadlocks", price: 260, def: "hair/afro/hair_dreadlocks_short.json", color: "dark_brown", swatch: 0x3b2519 },
  { id: "hair_bob", slot: "HAIR", name: "Bob", price: 220, def: "hair/bob/hair_bob.json", color: "raven", swatch: 0x18181f },
  { id: "hair_cowlick", slot: "HAIR", name: "Cowlick", price: 160, def: "hair/short/hair_cowlick.json", color: "sandy", swatch: 0xbf9d5a },
  { id: "hair_swoop", slot: "HAIR", name: "Side Swoop", price: 200, def: "hair/short/hair_swoop_side.json", color: "chestnut", swatch: 0x6b3a1f },
  { id: "hair_curly", slot: "HAIR", name: "Curly", price: 240, def: "hair/curly/hair_curly_short.json", color: "ginger", swatch: 0xb5561d },
  { id: "hair_flattop", slot: "HAIR", name: "Flat Top", price: 280, def: "hair/afro/hair_flat_top_fade.json", color: "black", swatch: 0x1c2222 },
  { id: "hair_idol", slot: "HAIR", name: "Stage Red", price: 340, def: "hair/short/hair_idol.json", color: "red", swatch: 0xc0221f },

  // --- TORSO ----------------------------------------------------------
  { id: "torso_tee", slot: "TORSO", name: "Plain Tee", price: 200, def: "torso/shirts/shortsleeve/torso_clothes_tshirt.json", color: "white", swatch: 0xe5e6c7 },
  { id: "torso_hoodie", slot: "TORSO", name: "Cardigan", price: 380, def: "torso/shirts/longsleeve/torso_clothes_longsleeve2_cardigan.json", color: "forest", swatch: 0x1b5502 },
  { id: "torso_vest", slot: "TORSO", name: "Dealer Vest", price: 600, def: "torso/shirts/sleeveless/torso_clothes_sleeveless2_buttoned.json", color: "maroon", swatch: 0x832121 },
  { id: "torso_suit", slot: "TORSO", name: "Suit Jacket", price: 1200, def: "torso/shirts/longsleeve/torso_clothes_longsleeve2_buttoned.json", color: "charcoal", swatch: 0x2a3034 },
  { id: "torso_polo", slot: "TORSO", name: "Polo Shirt", price: 300, def: "torso/shirts/shortsleeve/torso_clothes_shortsleeve_polo.json", color: "navy", swatch: 0x322d6a },
  { id: "torso_vneck", slot: "TORSO", name: "V-Neck Tee", price: 240, def: "torso/shirts/shortsleeve/torso_clothes_tshirt_vneck.json", color: "teal", swatch: 0x156c99 },
  { id: "torso_longsleeve", slot: "TORSO", name: "Long Sleeve", price: 260, def: "torso/shirts/longsleeve/torso_clothes_longsleeve2.json", color: "blue", swatch: 0x466ac9 },
  { id: "torso_tank", slot: "TORSO", name: "Tank Top", price: 180, def: "torso/shirts/sleeveless/torso_clothes_sleeveless2.json", color: "white", swatch: 0xe5e6c7 },
  { id: "torso_striped", slot: "TORSO", name: "Striped Vest", price: 420, def: "torso/shirts/sleeveless/torso_clothes_sleeveless_striped.json", color: "red", swatch: 0xab1e1e },
  { id: "torso_scoop", slot: "TORSO", name: "Scoop Neck", price: 340, def: "torso/shirts/longsleeve/torso_clothes_longsleeve2_scoop.json", color: "purple", swatch: 0x621e78 },
  { id: "torso_apron", slot: "TORSO", name: "Service Apron", price: 460, def: "torso/aprons/torso_aprons_apron.json", color: "brown", swatch: 0x62351c },
  { id: "torso_overalls", slot: "TORSO", name: "Overalls", price: 520, def: "torso/aprons/torso_aprons_overalls.json", color: "navy", swatch: 0x322d6a },

  // --- LEGS -----------------------------------------------------------
  { id: "legs_jeans", slot: "LEGS", name: "Jeans", price: 200, def: "legs/pants/legs_pants.json", color: "navy", swatch: 0x322d6a },
  { id: "legs_slacks", slot: "LEGS", name: "Slacks", price: 350, def: "legs/pants/legs_pants2.json", color: "charcoal", swatch: 0x2a3034 },
  { id: "legs_shorts", slot: "LEGS", name: "Shorts", price: 160, def: "legs/shorts/legs_shorts.json", color: "tan", swatch: 0xb7996a },
  { id: "legs_cuffed", slot: "LEGS", name: "Cuffed Pants", price: 260, def: "legs/pants/legs_cuffed.json", color: "brown", swatch: 0x62351c },
  { id: "legs_striped", slot: "LEGS", name: "Striped Trousers", price: 640, def: "legs/pants/legs_formal_striped.json", color: "slate", swatch: 0x4a5057 },
  { id: "legs_hose", slot: "LEGS", name: "Hose", price: 220, def: "legs/leggings/legs_hose.json", color: "maroon", swatch: 0x832121 },
  { id: "legs_leggings", slot: "LEGS", name: "Leggings", price: 240, def: "legs/leggings/legs_leggings.json", color: "black", swatch: 0x22282a },
  { id: "legs_shortshorts", slot: "LEGS", name: "Short Shorts", price: 180, def: "legs/shorts/legs_shorts_short.json", color: "red", swatch: 0xab1e1e },
  { id: "legs_formal", slot: "LEGS", name: "Formal Pants", price: 480, def: "legs/pants/legs_formal.json", swatch: 0x314f22 },
  { id: "legs_skirt", slot: "LEGS", name: "Plain Skirt", price: 300, def: "legs/skirts/legs_skirts_plain.json", color: "forest", swatch: 0x1b5502 },

  // --- FEET -----------------------------------------------------------
  { id: "feet_sneakers", slot: "FEET", name: "Sneakers", price: 150, def: "feet/shoes/feet_shoes_basic.json", color: "white", swatch: 0xe5e6c7 },
  { id: "feet_boots", slot: "FEET", name: "Boots", price: 260, def: "feet/boots/feet_boots_basic.json", color: "brown", swatch: 0x62351c },
  { id: "feet_dress", slot: "FEET", name: "Dress Shoes", price: 400, def: "feet/shoes/feet_shoes_revised.json", color: "black", swatch: 0x22282a },
  { id: "feet_sandals", slot: "FEET", name: "Sandals", price: 140, def: "feet/feet_sandals.json", color: "tan", swatch: 0xb7996a },
  { id: "feet_boots_fold", slot: "FEET", name: "Folded Boots", price: 320, def: "feet/boots/feet_boots_fold.json", color: "leather", swatch: 0x75502d },
  { id: "feet_boots_rim", slot: "FEET", name: "Rimmed Boots", price: 380, def: "feet/boots/feet_boots_rim.json", color: "charcoal", swatch: 0x2a3034 },
  { id: "feet_boots_tall", slot: "FEET", name: "Tall Boots", price: 440, def: "feet/boots/feet_boots_revised.json", color: "maroon", swatch: 0x832121 },
  { id: "feet_slipon", slot: "FEET", name: "Slip-Ons", price: 200, def: "feet/shoes/feet_shoes_sara.json", color: "navy", swatch: 0x322d6a },
  { id: "feet_socks", slot: "FEET", name: "High Socks", price: 120, def: "feet/socks/feet_socks_high.json", color: "red", swatch: 0xab1e1e },

  // --- HAT ------------------------------------------------------------
  { id: "hat_cap", slot: "HAT", name: "Leather Cap", price: 250, def: "headwear/hats/caps/hat_cap_leather.json", color: "navy", swatch: 0x322d6a },
  { id: "hat_visor", slot: "HAT", name: "Dealer Bandana", price: 500, def: "headwear/coverings/bandana/hat_bandana.json", color: "green", swatch: 0x2f8136 },
  { id: "hat_fedora", slot: "HAT", name: "Tricorne", price: 900, def: "headwear/hats/tricorne/hat_tricorne.json", color: "black", swatch: 0x22282a },
  { id: "hat_bandana", slot: "HAT", name: "Bordered Bandana", price: 300, def: "headwear/coverings/bandana/hat_bandana2.json", color: "red", swatch: 0xab1e1e },
  { id: "hat_kerchief", slot: "HAT", name: "Kerchief", price: 220, def: "headwear/coverings/headbands/hat_headband_kerchief.json", color: "maroon", swatch: 0x832121 },
  { id: "hat_headband", slot: "HAT", name: "Headband", price: 180, def: "headwear/coverings/headbands/hat_headband_thick.json", color: "blue", swatch: 0x466ac9 },
  { id: "hat_hood", slot: "HAT", name: "Hood", price: 560, def: "headwear/coverings/hoods/hat_hood_cloth.json", color: "charcoal", swatch: 0x2a3034 },
  { id: "hat_bonnie", slot: "HAT", name: "Bonnie Hat", price: 640, def: "headwear/hats/caps/hat_cap_bonnie.json", color: "maroon", swatch: 0x832121 },
  { id: "hat_cavalier", slot: "HAT", name: "Cavalier Hat", price: 1100, def: "headwear/hats/caps/hat_cap_cavalier.json", color: "purple", swatch: 0x621e78 },
  { id: "hat_admiral", slot: "HAT", name: "Admiral Bicorne", price: 1500, def: "headwear/hats/athwart/hat_bicorne_athwart_admiral.json", swatch: 0x22282a }
];
