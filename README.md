# IRONWAKE — a three.js tactical FPS

A round-based tactical shooter in the spirit of the classics, built from scratch on
three.js: five **Strikers** carry the Core to plant site A or B in the Foundry
District, five **Sentinels** hold the yard, and money earned between rounds buys
rifles, armour and a scoped DMR. You play alongside four bot teammates against five
bot opponents. First to five rounds (of at most nine, sides swap at the half) takes
the match.

Everything is original: the map, the teams, the weapon names, the art direction —
flat-shaded geometry, a seven-colour palette, and sound synthesised live with
WebAudio. There are no models, no textures and no audio files; the whole game is
static ES modules under `game/` with three.js 0.187.0 vendored beside it.

## Play it

```sh
node serve.ts          # serves game/ on http://localhost:8080
```

Open the page, click **Play**, and you are in the buy phase of round 1.

| Keys | Action |
| --- | --- |
| `W A S D` / mouse | Move / look |
| Click | Fire (`Right-click` scopes the Longshot DMR) |
| `1`–`6` | Buy during the buy phase |
| `1` / `2` | Switch to primary / sidearm in play |
| `E` (hold) | Plant the Core on a site, or defuse it as a Sentinel |
| `R` | Reload |
| `Ctrl` / `C` | Crouch |
| `Shift` | Walk (slower, steadier) |
| `Space` | Jump |

Accuracy counts more than speed: spread blooms hard while moving, the VK-7 rewards
short bursts, and a headshot with most guns ends the argument. The economy is the
game — a lost round still pays, a kill pays $300, and saving for a rifle round is a
real decision.

## How it is built

- `game/src/world.js` — the Foundry District: two warehouses, two plant sites, a
  central plaza, three lanes, and the waypoint graph the bots navigate.
- `game/src/bots.js` — the other nine fighters: waypoint routing, line-of-sight
  perception with reaction times, burst fire with a distance/motion hit model, and
  objective play (push, plant, hold angles, retake, defuse).
- `game/src/physics.js` — one AABB mover shared by the player and every bot.
- `game/src/weapons.js` — five guns (P9 Sidearm, Raptor SMG, Mule Scattergun, VK-7
  Rifle, Longshot DMR), magazines, reloads, spread and view models.
- `game/src/audio.js` — every sound synthesised with WebAudio; nothing to load.
- `game/src/main.js` — the match: phases, round clock, plant/defuse channels, the
  economy, combat resolution and the deterministic screenshot scenes.
- `main.ts` — the hand-in program: copies `game/` and `screenshots/` to the output
  directory and writes `dossier.json` with the vendored make.fun library.

## Screenshots

`screenshots/` holds four captures of the real game in a browser (menu, buy phase,
a plaza firefight, the match-end screen), produced by the game's own deterministic
shot scenes: serve the game and open `?shot=start|buy|play|end&seed=1` — each scene
poses itself, renders, and freezes on `window.__shotReady`.
