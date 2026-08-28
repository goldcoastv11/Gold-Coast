# Character art spec — how to make the outfits

This is the recipe for producing character art for the Item Shop. Follow it in order.
You do not need to know anything about game development to do this.

**What we are building:** one character body, wearing different outfits. Today the shop has 17
separate hand-made characters, each drawn from scratch. Instead we make **one body once**, then
export it again and again wearing different clothes. Every outfit is then guaranteed to be the
same person — same height, same walk, same face — which is what makes them feel like a wardrobe
instead of 17 unrelated strangers.

The code is already finished and waiting. It needs the picture files described below.

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

Pick the body itself: body type, skin tone, hair, face. This is our character. **Write down every
choice you make**, or better, do this:

- Click **Export to Clipboard (JSON)** and paste the result into a text file. Save it as
  `body-recipe.json` somewhere you will find it again.

That file is the character's DNA. It lets you reload the exact same body later instead of trying
to remember which of forty hair options you picked. **You will need it for every outfit.**

Do not add any clothing yet.

## Step 4 — Export the first file: the plain body

1. Click **Spritesheet (PNG)**.
2. Save the file as **`lpc_base.png`**.

The file will be **832 pixels wide by 3456 pixels tall**. If it is not, something went wrong —
stop and check with the team rather than continuing.

Do not use the "ZIP: Split by..." buttons. We need the single whole sheet, not the split versions.
Also ignore the animation dropdown (Walk, Run, Jump, and so on) — that only changes the little
preview on screen, not the file you download. The downloaded file always contains everything,
which is what we want.

## Step 5 — Export one file per outfit

For each outfit you want to sell in the shop:

1. **Reload the base body.** Use **Import from Clipboard (JSON)** with your saved `body-recipe.json`.
   This guarantees the body underneath is identical every time. **Do not** rebuild the body by
   hand — even one different pixel and the outfits stop looking like the same person.
2. Add the clothing layers for this outfit: shirt, trousers, shoes, hat, and so on.
3. **Change clothing only.** Do not change the body, skin tone, hair or face.
4. Click **Spritesheet (PNG)**.
5. Save it as `lpc_` plus a short lowercase name, with underscores instead of spaces:
   - `lpc_dealer.png`
   - `lpc_high_roller.png`
   - `lpc_security.png`

Rules for the names: lowercase letters, numbers and underscores only. No spaces, no capitals, no
apostrophes. The name is used inside the code, so it has to be plain.

Start with **three or four** outfits, not seventeen. We want to see them working in the game
before you invest a weekend in the full set.

## Step 6 — Download the credits file (do not skip this)

Click **Credits (TXT)** and save it next to the images as `lpc_credits.txt`.

Do this **once per outfit**, or once at the end with every layer you used across all outfits
selected. If two outfits use different art, their credits differ.

**This is a legal condition, not admin.** The OGA-BY art we allowed in Step 2 is free to use *on
the condition that* we name the artist. The credits file is the list of who to name. Losing it
means we cannot ship the art. Keep it with the images.

## Step 7 — Where the files go

Put everything here, creating the folder if it does not exist:

```
public/assets/characters/lpc/
    lpc_base.png
    lpc_dealer.png
    lpc_high_roller.png
    lpc_credits.txt
```

## Step 8 — Tell the code the files exist

One line per outfit, in `src/characterRig.ts`, in the list called `LPC_CHARACTER_SHEETS` (it is
currently empty):

```ts
export const LPC_CHARACTER_SHEETS: LpcSheetDef[] = [
  { textureKey: "lpc_base", file: "lpc_base.png" },
  { textureKey: "lpc_dealer", file: "lpc_dealer.png" }
];
```

`textureKey` is the filename without `.png`. That is the whole integration — loading the image,
slicing it into frames and building the four walking animations all happen automatically from
that one line. If you would rather not touch the code, just say which files you added and it will
be done for you.

---

## What happens after that

The characters will load and walk correctly in the overworld. Two things still need doing before
they can be sold in the Item Shop, and both are engineering work, not art work:

1. The overworld's character-positioning code still assumes the old smaller character size. It has
   to be pointed at the new size before an LPC character can be the player. Until then the new
   sheets load and animate but are not selectable.
2. The Item Shop needs entries for the new outfits, priced in Tickets.

The existing 17 skins are untouched by all of this and keep working exactly as they do now. The
new system runs alongside the old one — nothing is being replaced until there is real art to
replace it with.

## If something looks wrong

| What you see | What it usually means |
|---|---|
| Character walks facing the wrong direction | The file is not a standard full sheet — re-export with **Spritesheet (PNG)**, not a ZIP option |
| Character stutters or slides once per step | Same cause as above |
| Image is not 832 × 3456 | A ZIP/split export, or the download was interrupted |
| Outfits look like different people | The body was rebuilt by hand instead of imported from `body-recipe.json` (Step 5.1) |

---

## Reference — for engineers, not needed to produce the art

The generator's published layout, verified against its own source constants and the live site's
preview canvas (832 × 3456):

- Frame size 64 × 64; 13 frames per row; 54 rows.
- Walk starts at **row 8**, four rows, in the order **up, left, down, right** — *not* down-first
  like this project's two older rigs.
- A walk row's **column 0 is the standing pose**; the walk cycle is **columns 1–8**. Including
  column 0 in the cycle is what produces the stutter in the table above.

All of this is declared once in `LPC_RIG` in `src/characterRig.ts` and locked down by regression
tests in `src/characterRig.test.ts`.
