DRAFT — not reviewed by a lawyer. Confirm with a paid consult before publishing.

# Open Questions for the Founder

Everything the three compliance drafts could not answer, in one place. Grouped by how urgent it is,
not by which document it came from.

A note on what this list is: none of it is me being cautious for the sake of it. Each item is
either (a) a fact about the business only you know, (b) a place where the documents claim something
the code does not actually do, or (c) a genuine legal judgement call. Category (b) is the dangerous
one — a compliance document that overstates the product is worse than no document.

---

## A. Fix in code before publishing anything (product gaps)

These are places where the drafts describe protections the product does not have. Publishing the
documents without closing these creates a written record of a promise you are not keeping.

**A1. There is no age gate anywhere in the product.**
Signup collects a username, a password, and an optional email. It never asks for age or date of
birth. Any Terms of Service with a minimum age is unenforced today. This is the single highest
priority item on this list. The cheap version is a self-declared date-of-birth field or an age
checkbox at signup; ask the lawyer whether self-declaration is sufficient where your players are.
*Route to: CTO. Blocks: Terms §2, Privacy §6.*

**A2. There is no way for a player to delete their own account.**
I checked every route on the server; there is no delete endpoint at all. Deletion today is a manual
database operation. The database is correctly set up to cascade — deleting a user does remove their
balances, transactions, cosmetics, position, in-progress rounds, and events — so the mechanism is
sound, it is just not exposed. Two things needed: a written manual process you will actually
follow, and ideally a `DELETE /me` route before Phase 2 brings in real users.
*Route to: CTO. Blocks: Privacy §5.*

**A3. Gameplay events are never deleted.**
There is no expiry or cleanup job on the events table, so in practice events are kept forever.
Decide: state "indefinitely" honestly, or pick a period (24 months is a common choice) and have it
actually enforced by a scheduled deletion. Do not publish a retention period the code does not
enforce.
*Route to: CTO if you pick a period. Blocks: Privacy §4.*

**A4. In-game currency wording has not caught up to the currency split.**
The repo's own notes flag that some on-screen text still says "Tickets" where it means Gold Coins.
An odds disclosure and a Terms of Service that carefully distinguish the two currencies sit badly
next to UI that mixes them up. This is already on the CTO's list; it should land before or with the
legal docs.
*Route to: CTO. Affects: all three documents.*

## B. Business facts only you can supply

**B1. Who is the legal counterparty?** Your own name, an LLC, something else? Every "we" in both
documents needs a real entity behind it, and the answer changes your personal exposure. Worth
raising first in the consult — as a CPA you will have views on this already.

**B2. A support/privacy contact email**, used in five places across the two documents. A postal
address too, if a regime that applies to you (or your eventual payment processor) requires one.

**B3. Minimum age.** 18 is simplest and matches the app-store expectation for simulated gambling.
13+ pulls you into children's-privacy law, which is a large burden for a solo operator. This choice
cascades into A1, the Terms, and the Privacy Policy.

**B4. Publication date and effective date** for both documents.

**B5. Do you want to block any countries or US states?** Some jurisdictions regulate social casino
games even without cash prizes.

**B6. What is the optional email field actually for?** It currently has no verification and no
stated use. Decide (password reset? product mail?) and say so — or stop collecting it, which is
the cleanest privacy answer.

**B7. Do any game names, art assets, fonts, or sounds come from third parties?** Asset-pack and
font licences can restrict what the Terms may claim about ownership and may require attribution
inside the product.

## C. Genuine legal calls for the paid consult

Bring this section to the lawyer directly; it is most of the value of the meeting.

**C1. Governing law, venue, arbitration, class-action waiver.** Left deliberately blank in the
Terms. High-value to get right, easy to get wrong.

**C2. Liability cap and disclaimers.** Drafted as placeholders. Caps and indemnities written by
non-lawyers get struck down routinely, and enforceability varies by jurisdiction. Do not treat that
section as protection until a lawyer has written it.

**C3. Which privacy regimes apply to you?** GDPR, UK GDPR, CCPA/CPRA, other US state laws. Most
have thresholds you are nowhere near, but a public website has no geographic filter. This determines
whether the Privacy Policy needs a formal "lawful basis" section, and whether the analytics events
in particular can rest on legitimate interest or need consent.

**C4. Cookie / browser-storage consent banner — needed or not?** The sign-in token is arguably
strictly necessary and exempt. It helps that the analytics session id is never stored on the device
at all. Still a lawyer's call.

**C5. Does "continued use = acceptance" hold up for terms changes?** Several consumer regimes
require advance notice (often 14–30 days) for material changes.

**C6. Is the "not a sweepstakes" position airtight as built?** This is the core of the whole legal
strategy and deserves an explicit yes from the lawyer, not an assumption. The facts in your favour
are strong and I would put them in front of counsel plainly: nothing of value ever leaves the
system; Tickets are credited only by a game win and spent only on cosmetics, enforced at the ledger
level; there is no redemption path, no transfer, no gifting, and no player-to-player trade; the old
sweepstakes model and its redemption route were deleted outright rather than disabled. The one
thing a regulator or plaintiff would push on is that real money buys Gold Coins and Gold Coins are
required to play — the standard social-casino shape. Ask specifically whether anything about how
this build implements it changes the analysis.

**C7. Breach notification.** Several regimes require notifying users, and sometimes a regulator
within 72 hours. Worth a short written plan before you need one.

## D. Deferred until payments go live

**D1. There is no real payment processor wired up.** The purchase code simulates a successful
payment and grants the coins immediately. No card is charged and no payment details are collected
anywhere. Practical consequences:
- Do not publish the purchase and refund sections as if they are live.
- The Privacy Policy's purchase section must be rewritten the day payments turn on — naming the
  processor and linking its policy.
- The processor's own refund, chargeback, and consumer-protection rules will override whatever the
  Terms say.
- Mandatory cooling-off and refund rights for digital goods (EU and UK notably) cannot be
  contracted away.
Re-run the Terms §5 and Privacy §1 sections past the lawyer once the processor is chosen.

**D2. Refund policy itself.** Placeholder only. Needs a real decision plus review.

## E. Verify before publishing (small, checkable)

**E1. Hosting provider logs.** Our application code writes no request log and never stores an IP.
But Netlify and Railway run their own infrastructure logs that typically do capture IPs, on their
own retention schedules, outside our control. Confirm both providers' actual retention periods and
state them, rather than claiming "we never store your IP" flatly — it is only true of our code.

**E2. Data processing agreements** with Railway and Netlify, and where they store data, if you have
EU/UK players. Both providers offer a DPA; it is a form to sign, not a negotiation.

**E3. Response time for data requests.** 30 days is the common standard and what GDPR requires.
Pick something you can meet solo, alongside a full-time job.

## F. Open items specific to the odds disclosure

I documented all 14 games plus the Triple Chance bonus round. Fourteen of the figures are exact —
derived from the code and verified numerically. Two could not be, and four games came back with
returns badly out of line with the rest. Details in `odds-disclosure.md`; the headlines follow.

**F1. Four games are mis-tuned and should be fixed before the disclosure is published.**
None of these is a legal or financial risk — Tickets have no cash value and nothing can be
extracted — but they are a direct hit to Phase 1's "economy balanced in internal testing" exit
criterion, and publishing figures you are about to change is self-defeating. Every other game in
the arcade sits between 94% and 100%.

| Game | Returns | Should be | Problem |
|---|---|---|---|
| Dragon Tower | up to **213.6%** | ~98% | Hand-picked paytable; always climbing is strictly optimal |
| Plinko | **190.2%** | ~97% | Multiplier table too generous at the edges and centre |
| Slots | **150.7%** | ~96% | The "exactly two matching" tier pays too much, and it hits on 55% of spins |
| Roulette green | **54.1%** | 97.3% | Pays 20× on a 1-in-37 chance; a real wheel pays 36× |

The first three are far too generous and let a player who notices buy out the Item Shop much faster
than intended. The fourth is the opposite — a roughly 46% house edge on one bet, when red and black
are a textbook 97.3%.

Worth noting the contrast: **Mines and Hi-Lo do this correctly** — they derive the multiplier from
the true odds at every step, so every stopping point returns the same 98% and no strategy beats
another. Dragon Tower is the same shape of game with a hand-picked table, and that is exactly why
it drifted. Pointing the CTO at Mines as the reference implementation is probably the fastest fix.
*Route to: CTO.*

**F2. Coin Flip has no house edge at all** — a fair 50/50 paying exactly 2× returns 100%. Almost
certainly deliberate, but it makes Coin Flip the most Ticket-efficient of the properly-tuned games,
so confirm it is intended. *Your call.*

**F3. Two games' returns genuinely cannot be stated without computation: Video Poker and
Blackjack.** In both, the player's own decisions determine the outcome, so any single figure means
"return with perfect play" and requires running an optimal-strategy solver against that exact rule
set. I did not estimate either. Two specific complications:
- **Video Poker** uses the familiar 9/6 Jacks or Better paytable, whose published 99.54% figure is
  widely quoted — but that figure assumes a Royal Flush paying 800-for-1, and this game pays 250×.
  The published number therefore does **not** apply here. Computing the real one is a small, well-
  understood job (likely an afternoon for the CTO).
- **Blackjack pays even money on a natural blackjack, not the standard 3:2**, and has no doubling,
  splitting, insurance, or surrender. Cheaper option than computing a bespoke figure: change the
  rules to a standard set (3:2 naturals, add double down), and the extensively published figures
  apply with no computation needed. That is less work overall and gives players the game they
  expect. *Your call, CTO either way.*

**F4. How much detail do you want published?** A regulator-facing disclosure and a player-facing
"how the games work" page are different documents. The draft is written closer to the first. You
may want a plainer public summary that links to the full version.

**F5. Where does the disclosure live in the product?** A linked page is the minimum. Per-game
in-context display (a small "odds" button on each cabinet) is stronger and is what the Phase 1 exit
criteria imply. CTO task once you decide.

**F6. Two honest disclosures I recommend making, and want your sign-off on.**
- **Baccarat draws each card independently rather than from a finite shoe.** It matches a real
  eight-deck game to within a hundredth of a percent, but it means card-counting does nothing. I
  would say so rather than let a sharp player discover it. (Video Poker and Blackjack both use real
  52-card decks, so this applies to Baccarat only.)
- **Blackjack's even-money naturals and missing double/split**, as above. Non-standard rules belong
  in a disclosure document even when they are not unfair.

**F7. A small Keno addition.** I would like to publish the exact hit probabilities and multipliers
per pick count rather than describing them in prose — "1 in 850 million" for matching all 10 picks
lands much harder than "very rare". Requires running the game's own paytable builder. Small CTO
task, high value for a chance disclosure.

**F2. How much detail do you want published?** A regulator-facing disclosure and a player-facing
"how the games work" page are different documents. The draft is written closer to the first. You
may want a plainer public summary that links to the full version.

**F3. Where does the disclosure live in the product?** A linked page is the minimum. Per-game
in-context display (a small "odds" button on each cabinet) is stronger and is what the phase-1 exit
criteria imply. That is a CTO task once you decide.
