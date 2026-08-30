DRAFT — not reviewed by a lawyer. Confirm with a paid consult before publishing.

# Gold Coast Arcade — How the Games Work and What They Pay

**Last updated:** [FOUNDER: needs your input — publication date]

This document describes how each game decides its outcome and what it pays, based on the actual
game code running on our server.

---

## Before the numbers: what a "payout" means here

This matters more than any figure below, so read it first.

**You bet Gold Coins. You win Gold Coins. There is one currency.**

- Gold Coins are spent on every round, win or lose, like a token in an arcade cabinet. They do not
  come back automatically — a win credits Gold Coins back to you as a separate payout.
- Gold Coins also buy virtual cosmetic items in the Item Shop.
- **Gold Coins have no cash value.** They cannot be sold, traded, gifted, or cashed out. There is no
  redemption of any kind.

So when this document says a game "returns 97%", it means: *for every 100 Gold Coins bet, the game
pays out an average of about 97 Gold Coins, over a very large number of rounds.* It does **not**
mean you get 97% of your money back. No money comes back, because none was ever at stake. This is a
measure of how generous a game is with an in-game score, not a rate of return.

**One important consequence:** a game's average return is just a ratio of Gold Coins paid to Gold
Coins bet, so nothing stops it from landing above 100% if a game is mis-tuned. See Dragon Tower
below.

## How outcomes are decided

- Every outcome is decided by **our server**, not by the game running in your browser. The browser
  only animates a result the server already chose.
- Randomness comes from your operating system's cryptographic random number generator, not from an
  ordinary `Math.random()` shuffle.
- Nothing about your account, your balance, how long you have played, whether you have bought Gold
  Coins, or how much you have won or lost changes your odds. There is no adaptive difficulty, no
  loss-chasing adjustment, and no per-player tuning anywhere in the code.
- Every round is independent. Past results do not influence future ones.
- Bets are limited to 5–500 Gold Coins per round.

## Reading the tables

- **Chance** = probability of that outcome on any single round.
- **Pays** = multiplier applied to your Gold Coin bet, credited back to you in Gold Coins.
- **Average return** = long-run Gold Coins paid per 100 Gold Coins bet. Short sessions will vary
  enormously from this figure; it describes millions of rounds, not your afternoon.

---

# Single-decision games

## Coin Flip

**How it works.** You pick heads or tails. The server flips a fair coin.

| Outcome | Chance | Pays |
|---|---|---|
| You guessed right | 50% | 2× your bet |
| You guessed wrong | 50% | nothing |

**Average return: 100%.**

There is no house edge on this game at all. A fair 50/50 flip paying exactly 2× returns exactly
what it takes in, in Gold Coins.

[FOUNDER: needs your input — this is almost certainly deliberate (it is the simplest possible
"honest coin" game) but it is worth confirming, because it is the only game with no edge, and it
sits oddly beside the other games' 94–99%. It is not a *financial* problem — no money is at risk
either way — but it does mean Coin Flip is the most Gold-Coin-efficient game in the arcade by a
clear margin, and players will find that out. Flagging it as an economy-balance question for
Phase 1's "economy balanced in internal testing" exit criterion, not a compliance problem.]

## Dice

**How it works.** You choose a target number between 5 and 95. The server rolls a whole number from
0 to 99. You win if the roll is **below** your target. A lower target is harder to hit and pays
more.

The multiplier is 99 divided by your target, rounded to two decimals. The 99 (rather than 100) is
where the house edge comes from.

| Your target | Chance of winning | Pays | Average return |
|---|---|---|---|
| Under 5 | 5% | 19.80× | 99.0% |
| Under 10 | 10% | 9.90× | 99.0% |
| Under 25 | 25% | 3.96× | 99.0% |
| Under 33 | 33% | 3.00× | 99.0% |
| Under 50 | 50% | 1.98× | 99.0% |
| Under 75 | 75% | 1.32× | 99.0% |
| Under 90 | 90% | 1.10× | 99.0% |
| Under 95 | 95% | 1.04× | 98.8% |

**Average return: 99.0% at almost every target.**

A few targets land slightly below 99% because the multiplier is rounded to two decimal places —
"under 95" is the worst case in the table at 98.8%. Rounding never pushes a target above 99%.

## Limbo

**How it works.** You choose a target multiplier. The server rolls a "crash point". If the crash
point lands at or above your target, you win your target multiplier. If it lands below, you lose.

Crash points are generated so that low results are common and high results are rare, with a long
tail. Your chance of winning is very close to **99 divided by your target**.

| Your target | Approximate chance of winning | Pays | Average return |
|---|---|---|---|
| 1.50× | 66.0% | 1.50× | 99% |
| 2.00× | 49.5% | 2.00× | 99% |
| 5.00× | 19.8% | 5.00× | 99% |
| 10.00× | 9.9% | 10.00× | 99% |
| 50.00× | 1.98% | 50.00× | 99% |
| 100.00× | 0.99% | 100.00× | 99% |

**Average return: 99%, at every target.**

Targets from 1.01× up to 1000× are accepted. The return is the same at every one; a higher target
simply trades frequency for size.

## Plinko

**How it works.** A ball drops through 8 rows of pegs. At each row it bounces left or right with
equal chance. After 8 bounces it lands in one of 9 slots. Middle slots are far more likely than
edge slots, and pay less.

| Slot | Chance | Pays |
|---|---|---|
| Far left / far right | 0.39% each | 16× |
| Second from each edge | 3.13% each | 5× |
| Third from each edge | 10.94% each | 1.2× |
| Fourth from each edge | 21.88% each | 0.5× |
| Centre | 27.34% | 0.2× |

**Average return: 97.3%.**

The slot chances above are fixed by the shape of the board — eight fair left/right bounces — and
cannot be changed without changing the board. Almost every drop lands near the middle: the three
central slots take 71.1% of all drops between them, and each pays back **less than you bet** (0.5×,
0.2× and 0.5×). That is where the house edge comes from. The two 16× edge slots, which are what the
game is really about, come up on about 1 drop in 128.

## Wheel

**How it works.** A wheel with 20 segments spins and lands on one at random — every segment is
equally likely. You pick a risk level first, which changes what is on the segments. Higher risk
means more losing segments and bigger wins on the rest.

**Low risk** — 2 losing segments out of 20

| Segment value | How many | Chance |
|---|---|---|
| 0.81× | 12 | 60% |
| 1.62× | 6 | 30% |
| nothing | 2 | 10% |

**Average return: 97.2%**

**Medium risk** — 6 losing segments out of 20

| Segment value | How many | Chance |
|---|---|---|
| 0.81× | 8 | 40% |
| 1.62× | 4 | 20% |
| 3.23× | 2 | 10% |
| nothing | 6 | 30% |

**Average return: 97.1%**

**High risk** — 16 losing segments out of 20

| Segment value | How many | Chance |
|---|---|---|
| 1.08× | 2 | 10% |
| 2.87× | 1 | 5% |
| 14.37× | 1 | 5% |
| nothing | 16 | 80% |

**Average return: 97.0%**

Note that at low and medium risk, the most common winning segment (0.81×) pays back **less than
you bet**. That is normal for this style of wheel, but it is worth stating plainly rather than
letting it look like a win.

## Keno

**How it works.** You pick between 1 and 10 numbers from a pool of 40. The server draws 10 numbers
at random. You are paid based on how many of your picks were drawn.

You need to match at least 40% of your picks (rounded up, minimum 1) before anything pays. Picking
more numbers means bigger possible wins but a harder minimum to reach.

The paytable is not hand-written; it is calculated from the true probability of each outcome, so
that the game returns 94% overall no matter how many numbers you pick. There is a maximum
multiplier of 10,000×, which only affects the rarest outcomes at high pick counts, and the paytable
compensates by shifting that value onto the outcomes that can actually carry it.

**Average return: 94%, at every pick count from 1 to 10.**

The arcade's own automated tests check this 94% figure directly against the true probabilities for
every pick count, so it cannot drift unnoticed.

**Some real probabilities, for scale** (10 numbers drawn from 40):

[FOUNDER: needs your input — I want to publish a short table of exact hit probabilities and their
multipliers here rather than describe them in prose, because "1 in 850 million" lands much harder
than "very rare". The code's own comment notes that matching all 10 of 10 picks has a probability
of about 1.18 in a billion — roughly **1 in 850 million**. Getting the full table out requires
running the game's own paytable builder, which is a small CTO task. Worth doing: for a chance
disclosure, the exact long-odds numbers are the most useful thing on the page.]

## Roulette

**How it works.** A single-zero wheel with 37 pockets: numbers 1–36 plus a green 0. You bet on red,
black, or green.

| Your bet | Chance of winning | Pays | Average return |
|---|---|---|---|
| Red | 18 in 37 (48.6%) | 2× | 97.3% |
| Black | 18 in 37 (48.6%) | 2× | 97.3% |
| Green (0) | 1 in 37 (2.7%) | 36× | 97.3% |

**Average return: 97.3% on all three bets.**

All three bets return the same amount over time. Green is the long shot — it wins about once in
every 37 spins instead of about once in every two — but it pays 36× when it does, which works out
to the same 97.3% as red or black. Choosing green trades frequency for size and nothing else. This
matches a real single-zero wheel, where a straight-up bet on a single number also pays 36×.

## Slots

**How it works.** Three reels spin independently. Each reel picks a symbol at random, but the
symbols are not equally likely — common symbols come up far more often and pay far less.

| Symbol | Chance per reel | Three of a kind pays | Exactly two pays |
|---|---|---|---|
| Cherry | 35% | 2× | 0.2× |
| Lemon | 28% | 4× | 0.5× |
| Bell | 20% | 20× | 1.1× |
| Diamond | 12% | 80× | 2.5× |
| Seven | 5% | 400× | 15× |

**Your chance of any result:**

| Result | Chance |
|---|---|
| Three of a kind (any symbol) | 7.47% |
| Exactly two matching (any symbol) | 54.94% |
| No match — nothing paid | 37.60% |

**Chance of the top prize (three sevens): 0.0125%, or about 1 in 8,000 spins.**

Note that a pair of cherries pays 0.2× and a pair of lemons 0.5×, both **less than you bet**. They
look like a win on screen but they are not one. Between them these two are the most common paying
result on the machine, at about 41% of all spins.

**Average return: 96.2%.**

Where that comes from: three of a kind contributes 52.2 of those 96.2 points, and "exactly two
matching" the remaining 44.0. Pairs land on more than half of all spins, so their payouts are what
sets the overall level; the three-of-a-kind prizes, including the 400× seven, are what make the
game worth playing.

---

# Multi-step games (reveal, then choose to stop)

These games let you keep going or stop and take your Gold Coins. Your decisions affect the outcome,
so the return depends on how you play.

## Mines

**How it works.** A 5×5 grid of 25 tiles hides **3 mines**. You reveal tiles one at a time. Every
safe tile raises your multiplier. You can stop and take your Gold Coins at any point. Hitting a
mine ends the round and you get nothing.

The multiplier is calculated from the true odds of having survived that many picks, then reduced by
2%. That is where the house edge comes from.

| Tiles safely revealed | Chance of getting that far | Multiplier |
|---|---|---|
| 1 | 88.00% | 1.11× |
| 2 | 77.00% | 1.27× |
| 3 | 66.96% | 1.46× |
| 5 | 49.57% | 1.98× |
| 10 | 19.78% | 4.95× |
| 15 | 5.22% | 18.78× |
| 20 | 0.43% | 225.40× |
| 22 (whole board) | 0.043% | 2,254× |

**Average return: 98%, wherever you choose to stop.**

This is the cleanest game in the arcade. Because the multiplier is derived from the real odds at
every single step, stopping early and going deep return exactly the same 98%. There is no better or
worse strategy. Small rounding differences at low pick counts move it between 97.7% and 98.0%.

**If you close the game or walk away mid-round, the round is forfeited** and the Gold Coins you bet
are not returned. This is deliberate and applies to every multi-step game here.

## Dragon Tower

**How it works.** A tower of 6 rows, 4 tiles in each row. One tile in each row is bad. You pick one
tile per row and climb. You can stop and take your Gold Coins after any completed row. Picking the
bad tile ends the round with nothing.

Your chance of clearing any single row is 3 in 4 (75%).

| Cash out after row | Chance of getting that far | Pays | Average return |
|---|---|---|---|
| 1 | 75.00% | 1.3× | 97.5% |
| 2 | 56.25% | 1.8× | 101.3% |
| 3 | 42.19% | 2.7× | 113.9% |
| 4 | 31.64% | 4× | 126.6% |
| 5 | 23.73% | 7× | 166.1% |
| 6 (top) | 17.80% | 12× | **213.6%** |

**Average return: 97.5% if you stop at row 1, rising to 213.6% if you always climb to the top.**

> **[FOUNDER: needs your input — the biggest imbalance in the arcade.]**
>
> **Status (2026-08-27): known open item, deliberately deferred.** The founder's decision is to
> leave Dragon Tower alone for now and address it as part of a wider game-mechanics pass; the
> other three mis-tuned games (Plinko, Slots, Roulette green) were rebalanced on that date and
> their figures above are current. The figures in this section are Dragon Tower's true, present
> values — this section has not been corrected because nothing about the game has changed.
>
> Unlike Mines, Dragon Tower's paytable is hand-picked rather than derived from the odds, and it
> drifts further from fair with every row. Row 1 is about right at 97.5%. By row 3 it is over 100%,
> and a player who always climbs to the top averages **214 Gold Coins per 100 Gold Coins bet**.
>
> The practical effect is that Dragon Tower has a strictly optimal strategy — always climb, never
> cash out early — and playing it that way is the fastest way to accumulate Gold Coins in the whole
> arcade. Players will find this quickly.
>
> Contrast with Mines, which does this correctly: it derives the multiplier from the true odds at
> each step, so every stopping point returns the same 98% and no strategy beats another. The clean
> fix is to do the same here — a fair multiplier after row n is (4/3)^n, so a 2% edge would give
> roughly 1.31×, 1.74×, 2.32×, 3.10×, 4.13×, 5.51×. Note how close row 1 already is, and how far
> row 6 is (12× against a fair 5.51×).
>
> **Do not publish this table as-is.** Route to the CTO as an economy fix first.

## Hi-Lo

**How it works.** A card is dealt from a shuffled 52-card deck. You guess whether the next card
will be higher or lower. Only the rank matters (Ace is high); suits are decorative. Guess right and
your multiplier grows and you may keep going or stop. Guess wrong and the round ends with nothing.

**A card of equal rank loses.** If you guess "higher" and the next card is the same rank, that is a
loss, not a tie. The game shows you how many cards remain that would win your guess, so you can see
the real odds before every guess.

Because the deck shrinks as you play, your odds change with every card. The multiplier is
recalculated from the true remaining-deck odds at each step, then reduced by 2%.

**Average return: 98%, wherever you choose to stop.**

Like Mines, this is derived from the real odds rather than hand-picked, so no stopping point or
strategy returns more than any other. Guessing the *more likely* side or the *less likely* side
changes how big and how frequent your wins are, but not the 98%. Multipliers are capped at
100,000×, which in practice only binds after an extraordinary run.

As with Mines and Dragon Tower, leaving mid-round forfeits the bet.

## Triple Chance

**How it works.** This is a bonus round, not one of the main cabinets. It is offered after a free
Gold Coin win at the Coin Kiosk (and after the signup bonus). Three cups; one wins.

**Triple Chance pays Gold Coins, same as every other game**, but it works differently from the 14
main cabinets: it is chained onto a free Gold Coin win rather than being a separately wagered game,
and it settles through its own code path rather than the shared one the other 14 use. Which cup you
click does not change anything — the server decides the outcome before the animation plays, and the
cup you pick is purely for show.

| Outcome | Chance | Pays |
|---|---|---|
| Win | 1 in 3 (33.33%) | 3× |
| Lose | 2 in 3 (66.67%) | nothing |

**Average return: exactly 100%.**

There is no house edge here at all, and that is deliberate: it is a bonus game played with Gold
Coins you were given for free, so 3× at 1-in-3 is exactly fair. The arcade's automated tests check
this lands at 100% rather than the 94–99% of the edged games.

You may be offered the chance to play again with your winnings. Each round is independent and the
odds never change, so chaining wins is exactly as unlikely as it sounds: two in a row is 1 in 9,
three in a row is 1 in 27.

---

# Card games

## Baccarat

**How it works.** Two hands are dealt, "Player" and "Banker". You bet on which will win, or on a
tie. Card values: Ace = 1, 2 through 9 face value, 10 and all face cards = 0. Hands total to the
last digit only (a 7 and an 8 makes 5, not 15). A third card may be drawn according to the standard
baccarat drawing rules, which are fixed — neither you nor the dealer chooses.

You make one decision: which of the three bets to place. Nothing after that is up to you, which is
why exact figures can be given here.

**Outcome probabilities** (computed exactly from the game's own rules and card model):

| Outcome | Chance |
|---|---|
| Banker wins | 45.84% |
| Player wins | 44.61% |
| Tie | 9.54% |

| Your bet | Pays on a win | On a tie | Average return |
|---|---|---|---|
| Player | 2× | your bet back (1×) | 98.8% |
| Banker | 1.95× | your bet back (1×) | 98.9% |
| Tie | 9× | — | **85.9%** |

**Average return: 98.8% on Player, 98.9% on Banker, 85.9% on Tie.**

Two things worth stating plainly:

- **The Banker bet pays 1.95× rather than 2×.** This is the standard 5% commission on Banker wins
  found in real baccarat. Banker wins slightly more often, and the reduced payout is what offsets
  that. Even so, Banker is the marginally better bet.
- **The Tie bet is much worse than the other two**, at about 86% against roughly 99%. This is
  normal — the tie bet is the bad bet in real baccarat too — but it is a large enough gap that it
  deserves to be said out loud rather than buried in a table.

**A note on how the cards are dealt.** The game draws each card independently at random rather than
dealing from a finite shuffled shoe. In practice this matches how real casinos deal baccarat from
eight decks closely enough that the probabilities above land within a hundredth of a percent of the
published figures for a real eight-deck game. It does mean the same card can appear more often than
it could in one physical deck, and that card-counting has no effect here. I would disclose this
rather than let a sharp player discover it.

[FOUNDER: needs your input — confirm you are happy disclosing the independent-draw detail above.
I think you should: it is true, it is discoverable from play, and saying it first is much better
than being asked about it later. Same disclosure applies to Video Poker and Blackjack if they deal
the same way — noted below.]

## Video Poker

**How it works.** Five cards are dealt from a properly shuffled 52-card deck. You choose which
cards to keep. The ones you discard are replaced from the same deck. You are paid on the final
five-card hand.

**The paytable:**

| Hand | Pays |
|---|---|
| Royal Flush | 250× |
| Straight Flush | 50× |
| Four of a Kind | 25× |
| Full House | 9× |
| Flush | 6× |
| Straight | 4× |
| Three of a Kind | 3× |
| Two Pair | 2× |
| Pair of Jacks or better | 1× |
| Anything else | nothing |

A pair below Jacks pays nothing. A "Jacks or better" win pays 1×, which returns your bet's worth in
Gold Coins but does not gain you anything — it is a push, not a win, despite looking like one on
screen.

Cards are dealt from a real 52-card deck without replacement, so unlike Baccarat, each card can
only appear once per hand.

**Average return: needs verification. I am not going to publish a number I cannot stand behind.**

Here is exactly what is and is not known:

- The **9/6 Jacks or Better** structure (Full House 9×, Flush 6×) is the well-known one, and the
  commonly published return for it is 99.54% with perfect play.
- **That published figure does not apply here**, and this is the important part. It assumes a Royal
  Flush paying 800-for-1, which real machines only give at maximum coins. This game pays a Royal at
  **250×**. That is a substantial reduction on the single largest jackpot, so the true return here
  is meaningfully below 99.54%.
- The return also depends on **how well the player plays**. Video poker has an optimal hold
  strategy for every possible dealt hand. A player following it does far better than one holding by
  instinct. Any single "return" figure is really "return with perfect play", and most players will
  do worse.

[FOUNDER: needs your input — getting a defensible number here requires running an optimal-strategy
solver against this exact paytable: for each of the 2,598,960 possible dealt hands, evaluate all 32
hold combinations against every possible draw, take the best, and average. It is a standard,
well-understood computation and a genuinely small job for the CTO — likely an afternoon — and it
would give you an exact figure rather than an estimate. **I would not publish this game's return
until that is run.** Naming a number here that turns out to be wrong is worse than saying "we are
verifying this", because a chance disclosure with a wrong figure in it is the specific thing that
would undermine every other number on the page.

Two things to decide alongside it: (1) whether to raise the Royal payout so the game matches the
familiar 9/6 return, and (2) whether to publish the optimal-play figure, the average-actual-play
figure, or both. Real machines publish optimal-play, so following that convention is defensible —
but say clearly that it assumes perfect play.]

## Blackjack

**How it works.** You are dealt two cards face up. The dealer takes two, one of which stays hidden.
Face cards count 10, an Ace counts 11 or 1 — whichever is better for the hand. You may **hit** (take
another card) or **stand**. Going over 21 loses immediately. When you stand, the dealer reveals the
hidden card and draws.

**The house rules in this game:**

- **The dealer draws until reaching 17, then stops** — including on a "soft" 17 (an Ace counted as
  11 plus 6). Standing on soft 17 is the version that favours the player.
- **A single 52-card deck**, freshly shuffled each hand.
- **A win pays 2× your bet. A tie returns your bet (1×). A loss pays nothing.**
- **A natural blackjack — 21 on your first two cards — also pays 2×**, the same as any other win.
- Your only choices are hit and stand. **There is no doubling down, no splitting pairs, no
  insurance, and no surrender.**
- The dealer's hidden card is genuinely hidden — it is held on our server and never sent to your
  browser until the hand resolves.

**Two of those rules deserve to be called out plainly, because players will expect otherwise:**

1. **A natural blackjack pays even money, not 3:2.** In almost every real blackjack game, a natural
   pays 1.5× your bet on top of your stake. Here it pays the same as an ordinary win. This is the
   single biggest difference from the game people expect, and it moves the return down by roughly
   two percentage points on its own.
2. **You cannot double or split.** Both are player-favourable options in real blackjack, and their
   absence reduces the return further.

Neither of these is hidden or unfair — but both are non-standard, and a disclosure document is
exactly where they should be stated.

**Average return: needs verification. I am deliberately not giving a figure.**

What is known: the dealer rules here (stand on soft 17, single deck) are player-favourable, while
even-money naturals and the absence of double/split are house-favourable, and the house-favourable
ones are larger. So the return is somewhere below the ~99.5% a standard single-deck game returns to
a perfect basic-strategy player. Beyond that direction, I will not estimate.

[FOUNDER: needs your input — same situation as Video Poker, and same recommendation. An exact
figure requires computing optimal play against this specific rule set, because the player's own
decisions determine the outcome. This is a standard computation the CTO can run, but it is a bigger
job than the video poker one.

There is a cheaper, and I think better, option worth considering: **change the rules to match a
standard game** — pay 3:2 on a natural, add double down — and then the extensively published
figures for that rule set apply, with no bespoke computation needed. That is less work overall than
computing an exact figure for a non-standard game, and it gives players the game they expect. Your
call, and a CTO job either way.]

---

# Summary

| Game | Average return | Status |
|---|---|---|
| Coin Flip | 100% | Exact. No house edge — confirm this is intended. |
| Dice | 99.0% | Exact. |
| Limbo | 99.0% | Exact. |
| Mines | 98.0% | Exact. Derived from true odds; no strategy beats another. |
| Hi-Lo | 98.0% | Exact. Derived from true odds. |
| Baccarat — Banker | 98.9% | Exact. |
| Baccarat — Player | 98.8% | Exact. |
| Wheel (all risk levels) | 97.0–97.2% | Exact. |
| Roulette — red/black | 97.3% | Exact, and covered by an automated test. |
| Roulette — green | 97.3% | Exact, and covered by an automated test. Same as red/black; green just pays more, less often. |
| Plinko | 97.3% | Exact, and covered by an automated test. |
| Slots | 96.2% | Exact, and covered by an automated test. |
| Keno (any pick count) | 94.0% | Exact, and covered by an automated test. |
| Baccarat — Tie | 85.9% | Exact. Much worse than the other two bets. |
| Dragon Tower | 97.5% to 213.6% | Exact. **Depends on strategy — known open item, deferred to a later game-mechanics pass.** |
| Triple Chance | 100% | Exact. Deliberately fair; a bonus round chained onto a free Gold Coin win. |
| Video Poker | **needs verification** | Requires an optimal-strategy computation. |
| Blackjack | **needs verification** | Requires an optimal-strategy computation. |

**How to read this table.** "Exact" means I derived the figure directly from the game's own code and
verified it numerically, not from a published table or an estimate. The two marked "needs
verification" are the two games where the player's own decisions determine the outcome, so no single
figure is meaningful without computing optimal play — and I would rather leave them blank than put
a wrong number in a compliance document.

**Four games were identified as mis-tuned; three of them have been fixed.** Plinko (was 190.2%) and
Slots (was 150.7%) paid far too much, and the Roulette green bet (was 54.1%) paid far too little.
All three were rebalanced on 2026-08-27, the figures in this document are the ones the game now
runs on, and each is now covered by an automated test that fails if its return drifts back outside
94–100%.

**Dragon Tower is the fourth, and it has not been fixed.** At up to 213.6% it is still the largest
imbalance in the arcade. This is a known open item deferred by founder decision on 2026-08-27, to
be addressed as part of a wider game-mechanics pass — not an oversight. Its figures above are its
true present values, and the "do not publish this table as-is" note in that section still stands.
No other game's numbers were changed.

**A closing note on what all these numbers mean.** Every figure on this page describes Gold Coins
paid per Gold Coin bet. Gold Coins buy cosmetic items and nothing else beyond letting you keep
playing. They cannot be sold, traded, gifted, or exchanged for money, and there is no way to
withdraw anything from this arcade. A game returning 214% is not paying anyone 214% of their money
— it is handing out an in-game score slightly faster than intended.
