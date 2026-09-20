# Gold Coast mobile multiplayer preview

Open `/mobile.html` to try the new 3D experience. The existing `/` arcade remains available.

## What players can do

- Hold a phone sideways. Move with the left thumbstick and drag the right side to turn the camera. Desktop players can use WASD or arrow keys and drag to look.
- Explore a stylized 3D lounge and play free solo blackjack without signing in. Solo play runs the same practice rules locally; it does not simulate other players or touch an account balance.
- Change outfit, skin tone, and hair color. These starter colors are free; the selection is saved on the current device and shared with others while connected. Existing purchased cosmetics are not yet represented in 3D.
- Sign in with an existing Gold Coast account, or create an account, then create a room for up to eight players. Copy the invite link or share the six-character room code.
- Walk to either Palm Blackjack or Coast Blackjack and choose **Sit & play**. Each table has four numbered seats and its own independent deck, dealer, turns, and results. Seated characters appear at their chairs to other players. Any seated player can deal for everyone at their table.
- Visit Sunset Roulette, Pearl Baccarat, or Golden Slots to open the corresponding existing arcade game. These games are individual account-based games, not shared multiplayer tables yet. They retain the original game screens and Gold Coin rules, and require an available backend.
- Choose **Quickplay · All games** to search and launch any of the 14 games without walking. Blackjack chooses an available practice table; other games open their original game screen inside the mobile app. **Walk away** returns to Quickplay when launched from there, or to the lounge when launched from a floor station. An existing active arcade round must be finished or left before another game can open.
- Play hit/stand blackjack for free. No Gold Coins are charged, awarded, or changed. Dealer stands on all 17s. Naturals outrank ordinary 21; split, double, insurance, and betting are outside this first preview.

## Hosting

The frontend uses the existing `VITE_API_BASE_URL`. Both the frontend branch and the server branch need this change for multiplayer to work. The server uses the existing authentication and CORS settings. Include the exact preview origin in `CORS_ORIGIN` when testing a hosted frontend preview.

No database migration or production data changes are required. Rooms live in server memory: use **one server replica** for this preview. Restarting or deploying the server ends rooms and asks players to join again. Before larger-scale release, move room ownership/state to a shared service and add durable session recovery.

Presence is polled about five times a second with no overlapping requests, including while an existing arcade game is open. A missing player expires after 15 seconds; an idle turn auto-stands after 25 seconds. Closing a room tab, leaving a table, or losing the network cannot block the table indefinitely. Requests carry the table identity and revision so repeated, stale, or cross-table actions cannot draw additional cards. Room capacity is eight; each blackjack table has four seats; total process capacity is capped at 100 rooms. Quickplay may move a player directly to an available chair, but still enforces capacity and round state. This is a friends-only prototype, not a production load-tested service.

## Phone playtest

1. On an iPhone and an Android phone, open `/mobile.html` sideways. Verify portrait shows the rotate prompt.
2. Try solo practice and every appearance option. Walk around the five stations, move and turn the camera together, and check safe areas around phone notches. Sit at blackjack, deal, hit/stand, and leave.
3. Sign in using separate accounts. Have one player create a room and send the invite link to the other.
4. Verify both characters move and customization changes appear on the other phone.
5. Take two seats, deal, and take turns. Both screens should show the same hands, active player, dealer, and results. The dealer's second card stays hidden until resolution.
6. Test multiple hits, stand, another hand, leaving during a turn, and a third player arriving mid-hand.
7. Turn one phone's network off. Actions should stop; the other player should be able to continue after the disconnected seat times out. Restore the connection and rejoin if the room session expired.
8. Test a 25-second idle turn, a full four-seat table, a full eight-player room, a wrong room code, and sign-out.
9. Seat players at different blackjack tables and verify their rounds do not affect each other. Test Quickplay while a table is full or mid-hand.
10. Search the Quickplay list, launch roulette, finish a round, and use Walk away. Verify the list returns. Repeat from the physical roulette station and verify the lounge returns. Check remaining original games on real phones.

The current artwork is procedural placeholder art, with no purchased or generated assets. The dealer has a gentle idle animation, no voice or conversation. Real-device frame rate, battery use, accessibility with assistive technology, and hosted two-phone networking still require the playtest above.
