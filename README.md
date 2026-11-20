# Relativistic Cockpit

A first-person starship simulator in the browser. Accelerate at 1 g to 99.9999 % of the speed of light and watch the sky as special relativity draws it: stars crowd ahead and turn blue, the view astern reddens and empties, and above γ ≈ 200 the cosmic microwave background ahead warms into visible light. Then walk through the ship, read mail from Earth that took years to arrive, and park in orbit round a planet to look at it.

**Play it:** https://nikitaefimovit.github.io/relativistic-cockpit/ — a desktop browser with WebGL 2, keyboard and mouse.

Русская версия: [README.ru.md](README.ru.md). Every formula, number and source, with how it is checked: [FORMULAS.md](FORMULAS.md) (in Russian).

## What is in it

- **The sky by special relativity:** aberration, Doppler shift and relativistic beaming of every star, the Milky Way and the CMB, computed for the ship's real speed and place.
- **Real stars:** all 8,785 Hipparcos stars brighter than magnitude 6.5 stand where they are in space, so the constellations really are the ones you know, and really distort as you speed up. Fainter stars are synthetic, drawn to match a model of the Galaxy.
- **The Milky Way** is ray-marched through a 3D model of the Galaxy from where the ship is. Dust closer than 1.25 kpc is the measured 3D map of Edenhofer et al. (2024), with Planck's 5′ structure inside its cells: the Coalsack, the Great Rift and the Taurus and Ophiuchus clouds are where they are.
- **Travel:** 16 nearby and well-known stars, Betelgeuse and the galactic centre, the Sun's planets and the Moon, and every confirmed planet of those stars (NASA Exoplanet Archive). A pilot who brakes on the call arrives; one who is late flies past.
- **Flight by a body:** the flight begins on a circular orbit 25,000 km from the Earth. Near a planet the ship follows exact Kepler orbits; a chemical engine modelled on the Apollo lunar module's descent engine, with propellant, valves and the rocket equation, raises and lowers them; the attitude is the pilot's, by hand.
- **Black holes:** Sgr A* at the centre of the Galaxy, 4.3 million Suns: parked 10 Schwarzschild radii out you see its shadow 28.5° across and the sky bent round it, every star twice, the Milky Way wrapped into rings, all of it blueshifted by the fall into the well, and the ship's clock running at 0.949. Cygnus X-1, with its blue supergiant and a thin accretion disk glowing at up to 1.9 million K. And an invented hole of 10⁸ Suns with the lopsided disk *Interstellar* chose not to show: the side coming at you bluer and brighter, the far side bent over the top of the shadow. The rays are traced through the Schwarzschild metric; spin (Kerr, as in Thorne's work for the film) comes next. By Cygnus X-1 the ship parks 167 r_s out, where the tides are down to 1 g; nearer than 78 r_s they tear it apart. Approach in two or three legs: braking late there is not a flyby but the end, and AUTO BRAKE (J) stops the ship on its parking point by itself.
- **Planets up close:** Mercury, Mars and Jupiter from real maps, turning as the IAU has them turn; Saturn with its rings. No one has seen an exoplanet's surface, so theirs are invented, and the game says so.
- **A ship to live in:** sit in the cockpit or stand up and walk aft — an engineer's desk with three monitors (mail from Earth, delayed by light time; a map of the Galaxy; the ship's systems, log and manual), a bed with drawers, a life-support console.
- **A working ship:** a 3 kW reactor and a battery, heat lost through the hull, air with oxygen and CO₂, the crew's health, the radiation dose and a magnetic shield. Random faults with procedures are written but switched off for now.
- **Legends in three languages:** the controls are labelled in Russian, English or Chinese (the switch in the top-left corner). The screens, the manual and the mail are in Russian.

## Getting started

The ship starts cold, on its orbit round the Earth, nose on α Centauri A.

1. **Power:** MAIN BUS (P). The lamp of the next step of the start blinks red.
2. **To the stars:** LIGHT MODE (G) → ARM (U) → the guarded engine start (I), and the guarded SHIELD (O) before 0.3 c. Push the THRUST sled forward (↑). When BRAKE lights, pull it all the way back (Shift+↓) and the ship stops by the target; or switch AUTO BRAKE on (J) and leave the sled alone: the navigation computer pulls it back and stops the ship on the point.
3. **Round a planet:** PRESSURIZE (1), FEED (2), SUBLIGHT START (4) and the SUBLIGHT lever (] or drag it). MAN ATT (K) hands the attitude to you: W S pitch, A D yaw, Q E roll. The glass marks where the ship is going and the opposite way («ПО ХОДУ», «ПРОТИВ ХОДА»): nose prograde to raise the orbit, retrograde to brake into one. The desk's manual, section 10, has the checklists.
4. **Time:** = and − set how much passes each second, from a second to a year. The clock slows itself whenever something needs you, and says why.

## Controls

| Action | In the cockpit | Key |
|---|---|---|
| Main bus | MAIN BUS, first in the row under the centre screen | P |
| Light mode: the main engine runs only in it | Guarded LIGHT MODE, under the navigation screen, on the right | G |
| Arm the main engine | ARM | U |
| Start the main engine | Guarded ENGINE | I |
| Shield | Guarded SHIELD; its blue lamp glows with the field | O |
| Thrust and braking | THRUST sled on the right desk: drag forward and back, a detent at zero | ↑ ↓, full braking Shift+↓, zero X |
| Auto brake: the computer pulls the sled back itself and stops the ship on its stop point | AUTO BRAKE toggle on the right desk, beside the THRUST sled | J |
| Target | Target screen under the right screen: ▲ ▼ through the table, SELECT turns the ship (at rest) | T, Shift+T, Enter |
| Clock | + and − beside the time screen | = − |
| Master alarm | MASTER ALARM, end of the row | M |
| Cabin lights, fans, CO₂ scrubber | Left wall | L, V, C |
| HUD, blast shields, tint, dimmer, circuit breakers | Right wall | H, B, F, N |
| Chemical engine: pressurize, feed, crossfeed, start | Strip under the navigation screen | 1, 2, 3, 4 |
| Chemical engine lever: off, 10–60 %, full | SUBLIGHT sled on the left desk: drag | ] [ |
| Cutoff of both engines | Red CUTOFF under a clear cover, left desk | 0 |
| Attitude AUTO / MAN | MAN ATT on the strip | K |
| Turn the ship (MAN) | The ATTITUDE stick on the left desk shows the command | W S, A D, Q E; numpad 8 2, 4 6, 7 9 |
| Look around, zoom along the course | Drag, wheel | |
| Stand up, walk, use what is in the sight | Click to take the mouse, Esc to give it back | Space; W A S D; E |
| Desk computer: mail, map, systems, log, manual | Click its screens, seated at the desk | |
| Language of the legends | RU · EN · 中文, top-left corner | |
| New flight | | R |

## Address parameters

- `?lang=en`, `?lang=zh`, `?lang=ru` — the language of the legends.
- `?beta=0.9999` — start already at that speed, powered and shielded, where a 1 g run from the Earth would have brought the ship.
- `?x=15000` — start that many light years out along the first leg, at rest, with the light mode on.
- `?faults=on` — random faults, off by default for now. `?seed=39&x=1` — a fixed flight, whose first fault, a stuck vent valve, comes 19 days in.

## Running it locally

Node 20 or later.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173.

```bash
npm test
```

```bash
npm run e2e
```

`npm test` runs the unit tests (Vitest); `npm run e2e` the browser tests (Playwright, in Chrome); `npm run build` writes the site to `dist/`.

The cockpit model is built by Blender 5.2 from `blender/cockpit.py` into `public/cockpit.glb`, with `src/cockpitLayout.ts`, the air volume, walls and gaze targets the app walks by:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python blender/cockpit.py -- --dry
```

The dust maps in `public/dust` are rebuilt by `python3 -I scripts/build-dust-map.py` from Edenhofer et al.'s file on Zenodo (3.3 GB) and, with `--fine`, from Planck's dust opacity map (Planck Legacy Archive, 403 MB).

GitHub Pages: `.github/workflows/pages.yml` builds the site with `PAGES_BASE=/relativistic-cockpit/` and publishes it on every push to `main`.

## Data and credits

- **Stars:** the Hipparcos catalogue (ESA 1997); nearby targets from SIMBAD.
- **3D dust:** Edenhofer et al. 2024, [A&A 685, A82](https://arxiv.org/abs/2308.01295), data on [Zenodo](https://doi.org/10.5281/zenodo.10658339) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), resampled into `public/dust`. Its structure within cells: ESA/Planck and the Planck Collaboration, [Int. XLVIII 2016](https://arxiv.org/abs/1605.09387).
- **Earth:** NASA Blue Marble 2002, public domain. **Moon:** NASA SVS CGI Moon Kit (NASA's Scientific Visualization Studio). **Mercury:** MESSENGER basemap (NASA/JHUAPL/Carnegie). **Mars:** Viking MDIM 2.1 colorized mosaic (NASA/JPL/USGS). **Jupiter:** Cassini map [PIA07782](https://science.nasa.gov/photojournal/cassinis-best-maps-of-jupiter-cylindrical-map) (NASA/JPL/Space Science Institute).
- **Planets:** places from JPL Horizons (DE441), masses from JPL's astrodynamic parameters (DE440), radii and scale heights from the NASA planetary fact sheets, rotation from the IAU WGCCRE 2015 report (Archinal et al. 2018), Saturn's rings from the NSSDC rings fact sheet. **Exoplanets:** NASA Exoplanet Archive. **Sgr A\*:** mass from the GRAVITY Collaboration (2022). **Cygnus X-1:** Miller-Jones et al. (2021); the disk after Page & Thorne (1974) and Luminet (1979).
- **Sounds:** short cuts from recordings on [Freesound](https://freesound.org) under CC0 — loganzsound, cambrianman, Jofae, Foxfire-, JoontheFloof.

The code is under the [MIT licence](LICENSE); the data, maps and sounds above keep their own terms.
