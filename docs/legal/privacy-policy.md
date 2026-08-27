DRAFT — not reviewed by a lawyer. Confirm with a paid consult before publishing.

# Gold Coast Arcade — Privacy Policy

**Last updated:** [FOUNDER: needs your input — publication date]

This policy describes what Gold Coast Arcade collects, why, where it is kept, and what you can ask
us to do about it. It was written by reading the actual code, not from a template. Where the
product does not have a protection, this policy says so rather than claiming it.

[FOUNDER: needs your input — the legal entity or person responsible for this data ("the data
controller", in EU/UK terms). Same answer as in the Terms.]

---

## The short version

- We collect a username, a password (stored hashed, never in readable form), an optional email,
  what you do in the game, and your in-game balance history.
- **We do not use any third-party analytics service.** No Google Analytics, no PostHog, no Mixpanel,
  no Amplitude, no Segment. Gameplay data goes into our own database and nowhere else.
- **We do not store your IP address.** It is used for a few seconds in memory to stop one machine
  flooding the server, then discarded.
- We do not sell your data. We do not run ad networks or advertising trackers. The "ads" in the
  Coin Kiosk are simulated — they are part of the game, not a real ad network.
- We do not currently collect any payment or card details, because there is no live payment
  processor yet.

## 1. What we collect

### Account information
When you sign up we collect:
- **Username** — chosen by you. It must be 3–32 characters of letters, numbers, and underscores.
- **Password** — stored only as a bcrypt hash. We cannot read your password, and neither can anyone
  who gets a copy of the database.
- **Email address — optional.** You can sign up without one. If you give us one, we store it as you
  typed it.
- **Account created date**, and **last sign-in date** (updated on each successful sign-in — a failed
  sign-in attempt does not update it).

We do **not** collect your real name, date of birth, age, address, phone number, or any government
identifier. We do not ask for them anywhere.

[FOUNDER: needs your input — the optional email field currently has no verification and no stated
purpose. Before publishing, decide what you will actually use it for (password reset? product
emails?) and say so here, because "we collected it and might use it for something" is exactly what
regulators dislike. If you will never use it, the cleanest privacy answer is to stop collecting it.]

### Gameplay activity
We record events about what you do in the game. These land in our own database. The full list of
events currently recorded is:

| Event | What it records |
|---|---|
| `session.start` | The game was loaded. Recorded before sign-in. |
| `auth.signup` | A new account was created. |
| `auth.login` | An existing account signed in. |
| `game.opened` | You entered a game. Records which game. |
| `game.round_played` | A round finished. Records the game, bet amount, outcome, and payout. |
| `kiosk.claim` | A free Coin Kiosk claim completed. Records the Gold Coin amount. |
| `shop.item_purchased` | An Item Shop purchase. Records the item id and price. |
| `shop.skin_purchased` | A skin purchase. Records the skin id and price. |
| `shop.item_equipped` | A cosmetic was equipped. Records the item or skin id. |

Each event also carries:
- **A session id.** This is a random value generated fresh every time the page loads. It is not
  saved to your device, it is not derived from anything about you or your device, and it changes on
  every reload. It exists so activity from a single visit hangs together. It cannot be used to
  recognise you across visits, because it does not survive one.
- **A server-side timestamp**, taken when we receive the event. We do not accept a timestamp from
  your device.
- **Your account id, only if you were signed in.** Events recorded before you sign in have no
  account attached. The account id is taken only from your verified sign-in token — the game
  cannot tell the server "this activity belongs to someone else".

**What event data cannot contain.** Event properties are restricted at the server to a flat set of
short values — text (capped at 200 characters), numbers, true/false, or empty — with at most 20 per
event. Anything larger, nested, or structured is rejected before it is stored. Passwords, tokens,
emails, IP addresses, and anything you typed are not sent and are not accepted.

[FOUNDER: needs your input — the 200-character cap and the flat-value rule are enforced by the
server, which is genuinely good. But they are a *shape* restriction, not a semantic one: nothing
stops a future piece of code from putting something personal into a short text field. This is fine
today because I read every call site. Worth a note-to-self to re-check before adding new events.]

### Game and balance records
- **Your balances** of Gold Coins and Tickets.
- **A transaction record for every balance change**, including the type (bet, win, package
  purchase, free claim, cosmetic purchase), the amount, the resulting balance, a timestamp, and
  some technical details about the round.
- **Which cosmetics you own and which you have equipped.**
- **Your last position on the arcade floor**, so you reappear where you left off.
- **Round state for multi-step games** (like Blackjack or Mines) while that round is in progress.

### Purchase history
Gold Coin package purchases appear in your transaction record as a purchase of a named package.

**There is currently no live payment processor.** Today the purchase flow assumes payment succeeded
and grants the coins; no card is charged and no payment details are collected, seen, or stored by
us. When a real payment processor is added, it will collect and hold the payment details, not us —
and this policy will need updating at that point.

[FOUNDER: needs your input — this section must be rewritten the day payments go live. At minimum
you will need to name the processor, link its privacy policy, and describe what it collects. Do not
let this section go stale.]

### Your IP address
Your IP address reaches our server, as it does for any website. We use it for one thing: as a
temporary key to limit how many requests one source can send in a sixty-second window. It is held
in the server's memory for at most a minute and then discarded.

**It is never written to the events table, and our application code writes no request log.**

[FOUNDER: needs your input — one honest caveat you should confirm before publishing: our own code
does not log IPs, but our hosting providers (Netlify for the site, Railway for the server) run
their own infrastructure logs, which typically do include IP addresses and request details, on
their own retention schedules and outside our control. That is normal and unavoidable for any
hosted site, but "we never store your IP" is only true of *our* code. I would say so plainly rather
than claim more than is true. Confirm Netlify's and Railway's actual log retention periods and
name them here.]

### Your browser's storage
The game stores a small amount of data in your browser, not on our servers:
- **Your sign-in token**, so a page reload does not sign you out. It expires after 7 days.
- **Local game profile data**, so some progress survives a reload.

You can clear this at any time through your browser's settings. Doing so signs you out.

We do not use advertising cookies or tracking pixels.

[FOUNDER: needs your input — whether you need a cookie/storage consent banner depends on where your
players are. EU/UK rules generally exempt storage that is strictly necessary for a service the user
asked for (a sign-in token qualifies) but are less clear about analytics-style storage. Our session
id is not stored on the device at all, which helps a lot here. Still a lawyer question.]

## 2. Why we collect it

- **To run your account** — signing you in, keeping your balances and cosmetics.
- **To make the game work** — resolving rounds, applying purchases, remembering where you were.
- **To understand whether people come back and which games they play**, so the game can be
  improved. This is read by hand, by the operator, for questions like "how many of last week's
  signups came back a week later".
- **To keep the service standing up** — the rate limit described above.
- **To detect cheating or abuse**, and to enforce the Terms.

We do not use your data to build advertising profiles, and we do not do automated decision-making
that has a legal or similarly significant effect on you.

[FOUNDER: needs your input — if you have EU or UK players, this policy needs to state a "lawful
basis" for each purpose (contract, legitimate interest, consent). That is a formal requirement with
specific wording, and it is a lawyer's call which basis applies to the analytics events in
particular. I have deliberately not guessed.]

## 3. Who else sees it

We do not sell, rent, or trade your data, and we do not share it for anyone else's marketing.

Your data is handled by:
- **Railway**, which hosts our server and our PostgreSQL database.
- **Netlify**, which hosts the game itself.

Both are infrastructure providers acting on our behalf. No analytics vendor, ad network, or data
broker receives anything.

We may disclose data if we are legally required to, or where it is necessary to protect the service
or someone's safety.

If the Arcade is ever sold or transferred, account data would transfer with it.

[FOUNDER: needs your input — if you have EU/UK players, note that Railway and Netlify may store
data outside the EU/UK, which triggers international-transfer rules and usually requires a data
processing agreement with each provider. Both offer one. This is a concrete, checkable item to
raise in the consult.]

## 4. How long we keep it

- **Account data** — for as long as your account exists.
- **Transaction records** — for as long as your account exists. These are append-only; we do not
  edit or delete individual entries.
- **Gameplay events** — [FOUNDER: needs your input — **there is currently no deletion or expiry
  routine for the events table.** In practice that means "kept indefinitely". You have two honest
  options: (a) state that events are kept indefinitely, or (b) pick a retention period, say 24
  months, and have the CTO add a job that actually deletes older rows. Option (b) is much stronger
  ground for a compliance-phase product, and it is a small piece of work. Do not publish a
  retention period the code does not enforce.]
- **Rate-limit data** — under one minute, in memory only.

## 5. Your rights

Whatever your location, you can ask us to:
- **See** what we hold about you.
- **Correct** it if it is wrong.
- **Delete** your account and the data attached to it.

To make a request, contact us at [FOUNDER: needs your input — support email]. We will respond
within [FOUNDER: needs your input — 30 days is the common standard and is what GDPR requires; pick
something you can actually meet].

**What deletion actually does today.** Deleting your account removes your account row, and the
database is set up so that everything linked to it — balances, transactions, owned cosmetics,
saved position, in-progress rounds, and your gameplay events — is deleted along with it. Events
recorded before you signed in have no account attached, so they cannot be linked back to you and
cannot be found and deleted on request.

[FOUNDER: needs your input — **there is no self-service account deletion in the product**, and I did
not find a delete-account route on the server. Right now deletion is a manual database operation
you would perform yourself. That is workable at your scale, but: (1) it needs a written process so
you actually do it consistently; (2) some jurisdictions and both major app stores require
self-service deletion; (3) it is worth asking the CTO for a `DELETE /me` route before Phase 2
brings real users in.]

If you are in the EU or UK, you may have further rights (portability, objection, restriction) and
the right to complain to your local data protection authority.

[FOUNDER: needs your input — whether GDPR, UK GDPR, CCPA/CPRA, or any US state privacy law applies
to you depends on where your players are and how many there are. Most of them have thresholds you
are nowhere near today, but a public website has no geographic filter. Ask the lawyer which regimes
you should write for.]

## 6. Children

The Arcade is not intended for children.

[FOUNDER: needs your input — this section cannot be finished until you set a minimum age (see the
Terms). It is also the sharpest gap in the product right now: there is no age gate at signup, so
a child can create an account today, which means a children's-privacy regime could apply to data
you have already collected. Of everything in these three documents, this is the item I would fix
in code first.]

If you believe a child has created an account, contact us at [FOUNDER: needs your input — support
email] and we will delete it.

## 7. Security

- Passwords are stored as bcrypt hashes and never in readable form.
- Sign-in uses a signed token that expires after 7 days.
- The server decides all game outcomes and all balance changes; the game in your browser cannot
  change your balance.
- Every balance change is written as an append-only ledger entry, so the record cannot be quietly
  altered.
- Traffic between your browser and our server is encrypted (HTTPS).

No service can promise perfect security, and we do not. This is a small, solo-run project. We do
not have a dedicated security team, a formal incident-response process, or third-party security
audits, and we would rather tell you that than imply protections we do not have.

[FOUNDER: needs your input — a growing number of jurisdictions require you to notify affected users
(and sometimes a regulator, often within 72 hours) after a data breach. Worth writing down a short
plan for what you would actually do, before you need it.]

## 8. Changes to this policy

If we change this policy we will update the date at the top and post the new version. If a change
matters, we will try to tell you more directly.

## 9. Contact

[FOUNDER: needs your input — support/privacy email address, and a postal address if a regime that
applies to you requires one.]
