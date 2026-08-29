# Character art spec — how to make the wardrobe pieces

This is the recipe for producing character art for the Item Shop. Follow it in order.
You do not need to know anything about game development to do this.

**What we are building:** one character body, wearing separate pieces of clothing that players buy
individually — hair, a shirt, trousers, shoes, a hat. Each piece is its own picture file with a
transparent background, and the game stacks them on top of each other in a fixed order to make a
character.

This replaced the old system of 17 complete, separately-drawn characters. The advantage is that you
draw a shirt **once** and it works on every body, in every combination, forever — instead of
redrawing a whole character every time you want one new look.

**The code is already finished and running.**

> **You probably don't need this page any more.** The shop is stocked: 56 pieces of real LPC art
> were imported automatically, and there is now a script that does the whole job —
> `node scripts/import-lpc.mjs`. To add more, add a line to `scripts/lpc-manifest.mjs` and re-run
> it. The script applies the same licence rule as Step 2 below, but reads it from each asset's own
> metadata instead of trusting a filter checkbox, and writes the credits file for you.
>
> Follow the manual recipe below only for art the script can't fetch — something you drew yourself,
> or a piece that needs two layers stacked.

The generated placeholder art is still there as a safety net: a piece whose picture file goes
missing falls back to a plain coloured block rather than making the character vanish.

---

## Step 1 — Open the generator

<https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/>

Free, runs in the browser, nothing to install or sign up for.

## Step 2 — Set the licence filter FIRST, before choosing anything

This is the most important step and it must happen **before** you start picking clothes. If you
pick an outfit first and set the filter afterwards, you can end up attached to a look we are not
allowed to ship.

1. Find the section called **License Filters** near the top of the options column. It will say
   **(5/5 enabled)**.
2. Click it to open it. It lists five licences.
3. **Leave only these two ticked:**
   - **CC0**
   - **OGA-BY**
4. **Untick these three:**
   - **CC-BY**
   - **CC-BY-SA**
   - **GPL**

**Why:** CC0 art is free to use with no strings. OGA-BY only asks that we credit the artist, which
we handle in Step 6. The three we switch off either create a paperwork burden or carry a
"share-alike" condition — a requirement that can be read as forcing us to publish our own work
under the same terms, which is an unresolved question for an app-store release. We avoid the
question entirely by not using that art. (See `docs/legal/open-questions.md` item B7.)

After this, the generator only shows you art we are cleared to use. Anything you can see, you can
pick.

## Step 3 — Build the base body — once

Pick the body itself: body type, skin tone, face. **Do not pick hair, and do not pick any
clothing** — hair is its own separate piece now, and so is everything else.

- Click **Export to Clipboard (JSON)** and paste the result into a text file. Save it as
  `body-recipe.json` somewhere you will find it again.

That file is the character's DNA. It lets you reload the exact same body later instead of trying
to remember which of forty options you picked. **You will need it for every single piece.**

## Step 4 — Export the body itself

1. Click **Spritesheet (PNG)**.
2. Save the file as **`body_default.png`**.

The file will be **832 pixels wide by 3456 pixels tall**. If it is not, something went wrong —
stop and check with the team rather than continuing.

Do not use the "ZIP: Split by..." buttons. We need the single whole sheet. Also ignore the
animation dropdown (Walk, Run, Jump, and so on) — that only changes the little preview on screen,
not the file you download.

## Step 5 — Export one file per piece — the important bit

This is where the new system differs from the old one, and it is the step that makes layering work.

For **each individual piece** of clothing:

1. **Reload the base body.** Use **Import from Clipboard (JSON)** with your saved
   `body-recipe.json`. Do this every single time. Even one different pixel in the body and the
   pieces stop lining up with each other.
2. Add **exactly one** piece — just the shirt, or just the trousers, or just the hair. Nothing
   else.
3. **Now hide the body.** Set the body's own options to **none / transparent** so only the piece
   you just added is visible. What you want to export is the clothing floating on an otherwise
   empty sheet, with the body invisible underneath it.
4. Click **Spritesheet (PNG)**.
5. Save it under the piece's exact name from the list in Step 7.

**Why step 3 matters:** if the body is baked into the shirt's picture, then every player wearing
that shirt gets that body too, and the shirt can never be worn by a character with a different skin
tone. Each file must contain *only* its own piece.

**If the generator will not let you hide the body:** export the piece with the body visible anyway
and say so. The pieces will still load and the game will still run — the layers just will not
combine properly yet, and it is a fixable problem on our side. Do not let it stop you.

Start with **three or four** pieces, not the whole list. We want to see them working in the game
before you invest a weekend in the full set. A shirt, a pair of trousers and a hat is a perfect
first batch — that is enough to see all three layers stacking.

## Step 6 — Download the credits file (do not skip this)

Click **Credits (TXT)** and save it next to the images as `lpc_credits.txt`.

Do this **once per piece**, or once at the end with every layer you used across all pieces
selected. If two pieces use different art, their credits differ.

**This is a legal condition, not admin.** The OGA-BY art we allowed in Step 2 is free to use *on
the condition that* we name the artist. The credits file is the list of who to name. Losing it
means we cannot ship the art. Keep it with the images.

## Step 7 — File names

Put everything in `public/assets/characters/lpc/`, creating the folder if it does not exist.

The name of each file must match the piece it is for, exactly. These are the pieces the shop
currently sells:

| Slot | File names |
|---|---|
| Body | `body_default.png`, `body_tan.png`, `body_deep.png` |
| Hair | `hair_short.png`, `hair_long.png`, `hair_ponytail.png`, `hair_bleach.png` |
| Shirt | `torso_tee.png`, `torso_hoodie.png`, `torso_vest.png`, `torso_suit.png` |
| Trousers | `legs_jeans.png`, `legs_slacks.png`, `legs_shorts.png` |
| Shoes | `feet_sneakers.png`, `feet_boots.png`, `feet_dress.png` |
| Hat | `hat_cap.png`, `hat_visor.png`, `hat_fedora.png` |

You do not have to do all of them, or do them in order. Any file you add replaces that one piece's
placeholder; every other piece carries on with its placeholder until you get to it.

## Step 8 — Tell the code the file exists

One line per piece, in `src/wardrobeCatalog.ts`. Find the piece in the list and add its filename:

```ts
{ id: "torso_tee", slot: "TORSO", name: "Plain Tee", price: 200, file: "torso_tee.png", placeholderColor: 0x5b9fd6 },
```

The only thing you are adding is `file: "torso_tee.png"`. That is the whole integration — loading
the image, slicing it into frames and layering it onto the character all happen automatically.

If you would rather not touch the code, just say which files you added and it will be done for you.

---

## Adding a piece that is not in the list

Want to sell something the table above does not cover — a second hoodie, a cowboy hat? It is two
lines, no new code:

1. Add an entry to `WARDROBE_CATALOG` in **`src/wardrobeCatalog.ts`** (client) with a new id, its
   slot, a name and a Tickets price.
2. Add the same entry — id, slot, name, price — to **`server/src/wardrobeCatalog.ts`**.

Both files, or the shop and the server will disagree about the price. There is a test that fails if
they drift.

The piece appears in the shop immediately with placeholder art, and picks up real art whenever a
matching PNG lands.

## If something looks wrong

| What you see | What it usually means |
|---|---|
| Character walks facing the wrong direction | The file is not a standard full sheet — re-export with **Spritesheet (PNG)**, not a ZIP option |
| Character stutters or slides once per step | Same cause as above |
| Image is not 832 × 3456 | A ZIP/split export, or the download was interrupted |
| A piece shows a plain coloured block | That piece has no real art yet — it is still on its placeholder |
| A piece covers the whole character | The body was not hidden during export (Step 5.3) |
| Pieces do not line up with each other | The body was rebuilt by hand instead of imported from `body-recipe.json` (Step 5.1) |

---

## Reference — for engineers, not needed to produce the art

The generator's published layout, verified against its own source constants and the live site's
preview canvas (832 × 3456):

- Frame size 64 × 64; 13 frames per row; 54 rows.
- Walk starts at **row 8**, four rows, in the order **up, left, down, right** — *not* down-first
  like this project's older rigs.
- A walk row's **column 0 is the standing pose**; the walk cycle is **columns 1–8**. Including
  column 0 in the cycle is what produces the stutter in the table above.

All of this is declared once in `LPC_RIG` in `src/characterRig.ts` and locked down by regression
tests in `src/characterRig.test.ts`.

Layering is declared in `src/wardrobeCatalog.ts`: each slot carries an explicit `z`, and
`resolveLayers()` turns "what the player is wearing" into an ordered, render-ready stack. The
overworld draws that stack via `src/ui/LayeredCharacter.ts`, which mirrors each layer's frame off
the body sprite rather than running one animation per layer. Placeholder art for a piece with no
file is generated in `BootScene.ensureWardrobePlaceholders()`.
