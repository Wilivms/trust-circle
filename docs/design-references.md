# Design references

Sites Wiliams shared as references for the Trust Circle front end, with what has been observed so far and how each idea maps to code.

## Already studied and used

| Site | What we took | Where in the code |
|---|---|---|
| [why.zero.university](https://why.zero.university/) and its [Awwwards page](https://www.awwwards.com/sites/why-zero) | Scroll-driven story in one WebGL scene, countdown/odometer, "draw a zero" gate, two-colour palette, glass window frame, ruler HUD, bottom dock, hold to proceed | `demo/public/circle.js` (story, gate), `circle.css` (frame, ruler, dock) |
| [Awwwards Elements](https://www.awwwards.com/elements/) | Loader, custom cursor, magnetic buttons, iris transition, word-by-word reveal, clickable navigation | `circle.js` (preloader, cursor, iris, reveal) |
| [prompt-motion.com](https://prompt-motion.com) | Minimal monochrome motion with a single accent | overall art direction |

## To inspect live (needs the Chrome link)

Both pages render almost everything in JavaScript, so a text fetch returns only their titles. They need a visual session in Chrome: screenshots at each scroll step, a GIF of the interactions, the loaded scripts (network panel) and the DOM/canvas structure.

### hancore.dev — <https://hancore.dev/site/#about>

What the fetch confirmed:
- Landing (`/`): "hancore.dev — Engineering with feeling.", meta "a quiet wall of code", a modal-editor status bar reading `NORMAL`, an `enter ↩` link into `/site/`, and a `:theme` command.
- Site (`/site/`): "projects, themes and the log, opened in an editor"; a `~/Projects↓` file-tree heading; entries HANCORE-LINUX, WORMlurking, EYEclosed, GHOSTidle; a `VISITORS` label.
- The author publishes terminal and desktop themes ([GitHub](https://github.com/HANCORE-linux)), so the site is built around a Vim/terminal metaphor with switchable themes.

Techniques to expect and how to build them (to confirm tonight):
- Editor shell: status bar with mode (`NORMAL` / `INSERT`), line numbers gutter, tabs, file tree; plain HTML/CSS grid, monospace type.
- Keyboard navigation: `j`/`k`, `:command` palette (`:theme`, `:about`), `Enter` to open; a keydown router.
- Theme switching: CSS custom properties swapped per theme, with a transition.
- Typed text / caret, boot or "opening file" sequence; a small text-scramble or typewriter routine.
- Visitor counter: needs a tiny backend or a counter service.

### kai.house — <https://kai.house/>

What the fetch confirmed: only the title "Kai's House" and a full-bleed mobile viewport (`viewport-fit=cover`, zoom disabled). Everything else is drawn client-side, very likely an interactive 3D scene. Nothing more is known yet; do not assume its content.

Checklist for the live session:
1. Screenshot the first frame, the loader and each scroll or click state.
2. Record a GIF of camera moves, hovers and transitions.
3. Read the network panel for the libraries (three.js, React Three Fiber, GSAP, Lenis, Theatre.js, Spline…) and asset types (`.glb`, `.ktx2`, `.hdr`, audio).
4. Note the interaction model: scroll, drag, click hotspots, keyboard, sound.
5. Map each effect to a build plan, then prototype the two or three strongest in Trust Circle.
