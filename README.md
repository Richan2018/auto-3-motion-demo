# Auto 3.0 Demo

Static HTML prototype based on the Figma frame:

- File: `Auto 3.0 锦全的素材库`
- Page node: `1092:145288`
- Frame node: `1092:145289`
- Canvas: `1600 x 1000`

Open `index.html` directly in a browser. The main stage uses an SVG
`viewBox="0 0 1600 1000"` so every element stays aligned to the Figma canvas
coordinate system.

## Interaction

- `#icon-list` contains the icon frames, including the initially hidden Figma
  layers.
- `#icon-list-simulation` contains the visible outline frames used as click targets.
- `#icon-list-more` is the `84px` overflow placeholder from the Figma icon
  list: a divider plus a `60px` more button. It appears when desired icons
  would get closer than `10px` to the agentbar (`#status-progress`).
- Clicking a simulation frame toggles its matching icon frame by index.
- Frames 8 through 14 start in the collapsed hidden state and can be restored
  from the simulation layer.
- If there is not enough space, tail icons collapse into the overflow state and
  the more control takes the last safe slot. Without more, list width is
  measured to the final rendered icon; with more, the list width includes the
  full `84px` more group.
- Each icon uses an outer `icon-slot` for list movement and an inner
  `icon-frame` for scale/opacity, so scaling stays centered on its own
  geometry center. The center is read from the SVG graphic bounding box at
  runtime.
- Collapse uses `scale 1 -> 0.5` and `opacity 1 -> 0`.
- Restore reverses the effect after the following frames move back.
- Spring settings are kept in `app.js`: `duration 440ms`, `stiffness 320`,
  `damping 0.9`, `velocity 0`, `factor 0.526`.
