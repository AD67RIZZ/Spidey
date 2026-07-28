# Skyline Sling

**Skyline Sling** is an original 3D browser game about momentum, precision, and glowing energy cables. Play as Aero, a futuristic city runner, and collect as much energy as possible during a 90-second run through Meridian City.

Everything in the game is generated locally with JavaScript and Three.js geometry. There are no downloaded models, textures, music, backend services, accounts, or environment variables.

## Local development

Requirements: a current Node.js LTS release and npm.

```bash
npm install
npm run dev
```

Open the local address printed by Vite. Desktop keyboard and mouse provide the best experience.

## Production test

```bash
npm run build
npm run preview
```

Vite writes the production site to `dist`. The `_redirects` rule in `public` is copied to `dist` during the build.

## Controls

### Desktop

| Action | Control |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Look / aim | Mouse |
| Jump | `Space` |
| Sprint | `Shift` |
| Fire and hold energy cable | Hold left mouse button or `E` |
| Release cable | Release left mouse button or `E` |
| Pause / release pointer lock | `Escape` |

Aim the centre marker at a nearby building. When it turns cyan and says **Anchor ready**, hold the cable control. Swing in an arc, steer with the movement keys, and release at speed to keep your momentum.

### Touch

Modern touch devices receive an on-screen movement joystick, a camera-drag area, Jump, Sling, Boost, and Pause buttons. Landscape orientation is recommended.

## Challenge rules

- Collect cyan energy orbs for points.
- Fly through purple-orange gates for larger bonuses.
- Chain pickups before the Flow meter empties to raise the score multiplier.
- The run ends after about 90 seconds.
- The best score is stored on the current device with `localStorage`.
- Falling below or leaving the city safely respawns Aero with a small score penalty.

## Cloudflare Pages deployment

1. Push this repository to GitHub. Keep `package.json` and `index.html` at the repository root.
2. In Cloudflare, open **Workers & Pages**, create a Pages project, and connect the GitHub repository.
3. Use these exact build settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | `Vite` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | Leave blank |
| Environment variables | None required |

After the first deployment, future pushes to `main` should trigger new Cloudflare Pages deployments automatically.

The included `public/_redirects` file contains:

```text
/* /index.html 200
```

This provides a safe single-page fallback when the deployed URL is refreshed.

## Graphics and accessibility

The Settings panel provides Low, Medium, and High graphics modes, mouse sensitivity, sound, fullscreen, and reduced motion. Low mode lowers pixel density and city detail for mid-range phones. Reduced motion turns off speed lines and strong field-of-view changes.

## Troubleshooting

- **Blank or unsupported screen:** update the browser, enable hardware acceleration, and confirm WebGL is available.
- **Slow frame rate:** choose **Low** graphics quality and close other graphics-heavy tabs.
- **Mouse will not stay captured:** click the game canvas once after starting. Browser security requires a user gesture for pointer lock.
- **No sound:** enable Sound Effects in Settings and click or tap the game once; browsers block audio until user interaction.
- **The cable will not attach:** aim at visible building geometry within range. It intentionally cannot attach to empty sky.
- **Cloudflare build fails:** check that the root directory is blank, the build command is `npm run build`, and the output directory is `dist`.

## Project structure

```text
index.html
package.json
public/
  _redirects
  favicon.svg
src/
  main.js
  game.js
  player.js
  swing.js
  city.js
  input.js
  audio.js
  style.css
```

## Originality

Skyline Sling, Aero, Meridian City, the energy-cable system, visual identity, interface, generated sounds, and all geometry are original to this project. The game does not include or depend on assets or characters from existing superhero properties.
