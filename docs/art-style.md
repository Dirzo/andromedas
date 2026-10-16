# Andromedas in the Siege of Legends art style

Source of truth for the look: `Dirzo/manatorium` (Siege of Legends). Target: `Dirzo/andromedas` (three.js, 3D).

## What Siege of Legends looks like

- **Chunky 16-bit pixel art.** The arena renders at 480 × 270 game pixels and is upscaled with nearest-neighbour sampling (`imageSmoothingEnabled = false`, `image-rendering: pixelated`). No anti-aliasing, no blur.
- **Ink outlines.** Every sprite gets a 1-pixel outline in deep navy ink `#1a1230` (UI ink `#0f1430`), never pure black (`src/sprites.js`, `PixGrid.finish`).
- **Soft volume, not real lighting.** Sprites are flat colours with three tweaks: the back (left) edge is 22% darker, the top edge 18% lighter, the bottom edge 12% darker. Light reads as coming from the upper front.
- **Bright, saturated, friendly palette.** Gold `#ffcf3a`, mint `#5ee07a`, rose `#ff5d8f`, sky `#5fd3ff`, violet `#a98aff`. Skies and backgrounds are banded gradients with pixel clouds, not smooth gradients.
- **Navy UI.** Page `#161d3a`, panels `#222c5a`, raised cards `#2c3870`, lines `#42509a`, text `#f1efff`, muted `#a9b0dc`. Panels and buttons have a 2px ink border, 4 to 6px corner radius, an inner top highlight and a hard 3 to 4px ink drop shadow underneath (a "chunky" pressed-button feel).
- **Type.** Fredoka for headings, numbers and buttons; Atkinson Hyperlegible for body text; Pixelify Sans (700) for the logo, gold with a two-step ink and orange drop shadow.

## How that maps onto Andromedas

Andromedas is a 3D game, so the goal is "Siege of Legends seen through a 3D camera": keep the models and the spherical asteroid, change how they are drawn.

| Siege of Legends | Andromedas equivalent |
| --- | --- |
| 480 × 270 canvas, nearest upscale | Render the scene into a low-resolution target (about 360 pixels tall) and upscale with nearest sampling |
| 1px `#1a1230` sprite outline | Depth-edge outline pass in the same ink colour, one low-res pixel wide |
| Flat colours, soft volume | Posterise lighting into a few brightness bands and lift saturation; no film grain, no vignette, no bloom haze |
| Bright element palettes | Team colours and ore colours pushed toward the SoL accents (sky for Blue, rose/orange for Red, gold for ore) |
| Navy chunky UI, Fredoka / Atkinson / Pixelify | Re-skin the HUD tokens, fonts, borders and button shadows; Pixelify wordmark |
| Pixel portraits and icons | Render unit portraits at low resolution and show them pixelated |

## Rules for new Andromedas art

1. Never ship anti-aliased edges inside the game view; anything 2D drawn over it (icons, markers) uses whole pixels and the ink outline.
2. Use the ink `#1a1230` instead of black for outlines and shadows.
3. Pick colours from the SoL palette above first; add new hues only as tints of it.
4. Keep shapes readable at 360 pixels tall: chunky silhouettes, no thin details under 2 low-res pixels.
5. Light from the upper front, top edges lighter, back edges darker.
6. The smooth (original) renderer stays available as a graphics option for comparison.
