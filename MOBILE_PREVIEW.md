# Gold Coast mobile multiplayer preview

Open `/mobile.html` to try the new 3D experience. The existing `/` arcade remains available.

## What players can do

- Hold a phone sideways. Move with the left thumbstick and drag the right side to turn the camera. Desktop players can use WASD or arrow keys and drag to look.
- Explore a stylized 3D lounge without signing in using the solo tour. The tour has no simulated multiplayer or playable blackjack.
- Change outfit, skin tone, and hair color. These starter colors are free; the selection is saved on the current device and shared with others while connected. Existing purchased cosmetics are not yet represented in 3D.
- Sign in with an existing Gold Coast account, or create an account, then create a room for up to eight players. Copy the invite link or share the six-character room code.
- Walk to the green blackjack table and take one of four seats. Any seated player can deal for all seated players. The server shuffles one deck, hides the dealer's hole card, enforces turns, and resolves everyone against the same dealer.
- Play hit/stand blackjack for free. No Gold Coins are charged, awarded, or changed. Dealer stands on all 17s. Naturals outrank ordinary 21; split, double, insurance, and betting are outside this first preview.

## Hosting

The frontend uses the existing `VITE_API_BASE_URL`. Both the frontend branch and the server branch need this change for multiplayer to work. The server uses the existing authentication and CORS settings. Include the exact preview origin in `CORS_ORIGIN` when testing a hosted frontend preview.

No database migration or production data changes are required. Rooms live in server memory: use **one server replica** for this preview. Restarting or deploying the server ends rooms and asks players to join again. Before larger-scale release, move room ownership/state to a shared service and add durable session recovery.

Presence is polled about five times a second with no overlapping requests. A missing player expires after 15 seconds; an idle turn auto-stands after 25 seconds. Closing a room tab, leaving a table, or losing the network cannot block the table indefinitely. Requests carry the table revision so repeated or stale actions cannot draw additional cards. Room capacity is eight; table capacity is four; total process capacity is capped at 100 rooms. This is a friends-only prototype, not a production load-tested service.

## Phone playtest

1. On an iPhone and an Android phone, open `/mobile.html` sideways. Verify portrait shows the rotate prompt.
2. Try the solo tour and every appearance option. Walk around the table, move and turn the camera together, and check safe areas around phone notches.
3. Sign in using separate accounts. Have one player create a room and send the invite link to the other.
4. Verify both characters move and customization changes appear on the other phone.
5. Take two seats, deal, and take turns. Both screens should show the same hands, active player, dealer, and results. The dealer's second card stays hidden until resolution.
6. Test multiple hits, stand, another hand, leaving during a turn, and a third player arriving mid-hand.
7. Turn one phone's network off. Actions should stop; the other player should be able to continue after the disconnected seat times out. Restore the connection and rejoin if the room session expired.
8. Test a 25-second idle turn, a full four-seat table, a full eight-player room, a wrong room code, and sign-out.

The current artwork is procedural placeholder art, with no purchased or generated assets. The dealer has a gentle idle animation, no voice or conversation. Real-device frame rate, battery use, accessibility with assistive technology, and hosted two-phone networking still require the playtest above.
