# Gold Coast handoff

Updated September 27, 2026.

## Start here

Read `CLAUDE.md`, this file, and `MOBILE_PREVIEW.md` before changing the project.
The owner is not technical and needs exact, plain-language instructions.

## Current work

- Branch: `feature/mobile-rewards-portrait`
- Pull request: https://github.com/goldcoastv11/Gold-Coast/pull/42
- The branch is pushed to GitHub and should be used for continued work.
- This batch has **not** been merged or deployed.

The batch includes portrait Quickplay, restored Challenges and XP, the Coin
Kiosk and shuffle-cup reward, clearer sign-in/account creation, expanded color
customization, modernized embedded game presentation, and 10 additional
animated CC0 characters. The wardrobe now contains 21 outfits.

## Validation completed

- Frontend production build passes.
- Frontend: 207 tests pass.
- Backend typechecks pass.
- Backend: 287 tests pass.
- All 10 new character models load successfully in the browser.
- Casual and worker women characters were visually checked in the wardrobe.
- Portrait browser checks covered Mines, Dice, Blackjack, and Keno, plus
  sign-up, Challenges, XP claims, the Coin Kiosk, and shuffle cups.

Real iPhone/Android testing and a complete playthrough of all 14 games are
still recommended before production release.

## Release rule

Do not merge or deploy without the owner's explicit approval. Netlify preview
deploys are disabled to avoid burning credits. Group meaningful, tested
features into one release. Both Netlify and Railway deploy from `main`, so
merging pull request 42 is the production release action.

## Links

- Local preview: http://localhost:3000/mobile.html
- Live site (previous release): https://goldcoastv1.netlify.app/
- Review: https://github.com/goldcoastv11/Gold-Coast/pull/42

For local work, start the frontend from the repository root with `npm run dev
-- --host 0.0.0.0 --open false`. Start the existing local database from
`server/` with `npm run db:up`, then start the backend with `npm run dev`.
