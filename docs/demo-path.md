# Demo path

Setup: `npm run build && npm start`, then open `http://localhost:3000` full screen.

1. **Open the page** → the 3D heart beats and slowly turns.
2. **Scroll down** → it zooms into the aortic root and the valve, labelled "schematic valve". Panels fade in.
3. **Look at the wall (right)** → 400 dots, one per test heart: green fit, amber risk, red no fit. Totals are about 239 / 68 / 93.
4. **Press Break it** → the feed fills with the Breaker's tool calls, then 2 findings: an annulus coverage gap below 21 mm and above 27 mm, and narrow sinotubular junction and sinus.
5. **Click a red dot** → a popup with that heart's measurements and why it fails.
6. **Press Open in main view** → the main 3D view switches to that heart, with the problem area tinted.
7. **Press Fix it** → the feed shows:
   - Fix 1 (add 28 mm): 72% fit, then the attack and the verdict that it **broke**.
   - Fix 2 (add 19 mm): 81.25% fit with 0 new risks, then the attack and the verdict that it **held up**.
8. **Watch the wall** → the totals update and the new at-risk hearts turn amber.
9. **Read the line under the feed** → "This valve fits 59.75% of test hearts. With this change, it fits …%, and here's the new risk."
10. **Press Open review in the feed** → the change, trade-offs, attacks, verdict and what wasn't tested. Enter a name and press Approve.
11. **Open `/results`** → the proposal against the 3 baselines on the 100 hidden hearts, including where a baseline ties or wins.
12. **Open `/about`** → the data, rules and limits.
