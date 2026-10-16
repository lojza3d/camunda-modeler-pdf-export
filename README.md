# PDF Export – plugin for Camunda Desktop Modeler

Adds a **PDF** button to the bottom status bar of BPMN tabs. The export creates a PDF
(A4 landscape) where each page = title + diagram as **vector graphics** (shrink-to-fit,
centered, stays sharp when zoomed or printed on A3; diagram labels are converted to outlines).

Clicking the button opens the **Export as PDF** dialog right above it:

- **Current diagram only** – one page with the diagram currently open in the editor.
- **Current diagram and subdiagrams** – the open diagram followed by
  1. its collapsed subprocesses – left to right, then top to bottom,
  2. their collapsed subprocesses (next level), grouped by parent in page order,
  3. … down to the N-th level (breadth-first traversal).
- **Mark subprocesses with diagrams** – draws the Modeler's blue drill-down arrow next to
  every collapsed subprocess whose diagram is not empty (same position and colors as in the editor).

*Export* (or Enter) asks where to save the PDF, *Cancel* (or Escape) closes the dialog.
The last used choices are remembered.

With the main diagram open, the whole model is exported. With a subprocess open
(drilled down), the export starts with that subprocess and contains only its
descendants – not the main diagram or other subprocesses. The save dialog then
suggests `<model_name> - <subprocess>.pdf`.

Title: `model_name → subprocess "A" → subprocess "B"` (`model_name` = file name without extension;
always the full path from the main diagram, also when exporting a subtree).
Also distinguishes `event subprocess`, `transaction` and `ad-hoc subprocess`.
The PDF has hierarchical bookmarks and a footer `model_name … 3 / 12`.

Works for both Camunda 7 (`bpmn`) and Camunda 8 (`cloud-bpmn`) tabs. Verified in Camunda Modeler 5.44 and 5.52.

## Installation

Download `camunda-modeler-pdf-export-vX.Y.Z.zip` from the latest
[release](../../releases/latest) and unzip it into the plugins folder below – the zip already
contains the `camunda-modeler-pdf-export` folder with everything needed (`index.js`, `dist/`, `style/`).
No build required.

Alternatively copy the `camunda-modeler-pdf-export` folder from this repo (`index.js`, `dist/` and `style/` are sufficient) to:

| OS      | path |
|---------|------|
| macOS   | `~/Library/Application Support/camunda-modeler/resources/plugins/` |
| Windows | `%APPDATA%\camunda-modeler\resources\plugins\` |
| Linux   | `~/.config/camunda-modeler/resources/plugins/` |

Quit the Modeler completely (Cmd+Q / close all windows) and start it again – the Modeler
discovers plugin folders only at startup, a reload (Cmd/Ctrl+R) is not enough for a newly added plugin.
The **PDF** button appears in the status bar only while a BPMN diagram tab is active.
To check that the plugin was loaded: F12 → console → `window.plugins` lists the client extension.

## Customization and build

```bash
npm install
npm run build   # production bundle to dist/client.js
npm run dev     # watch mode; in the Modeler press F12 → Cmd/Ctrl+R to reload the plugin
npm run package # build + release/camunda-modeler-pdf-export-v<version>.zip
```

## Releasing

1. Bump `version` in `package.json`, run `npm run build`, commit and push.
2. GitHub → Releases → *Create a new release* → new tag `v<version>` (must match `package.json`) → *Publish*.
3. The workflow `.github/workflows/release.yml` builds the plugin and attaches
   `camunda-modeler-pdf-export-v<version>.zip` to the release (Actions tab shows progress).

Without the workflow: run `npm run package` locally and drag the zip from `release/`
into *Attach binaries* of the release form.

All settings live in `client/config.js` (page format, margins, title size, `shrinkOnly`,
`textToCurves`, drill-down marker colors, initial dialog choices, UI texts). Page order: `client/export/collectPages.js`
(functions `byPosition`, `describeSubProcess`).

## How it works

- `client/PdfExportPlugin.js` – React client extension: `Fill slot="status-bar__file"`,
  subscribes to the `bpmn.modeler.created` event (bpmn-js instance for each tab) and
  `app.activeTabChanged`; saves via `_getGlobal('dialog').showSaveFileDialog`
  and `_getGlobal('fileSystem').writeFile(..., { encoding: 'base64' })`.
- `client/ExportOverlay.js` – the export dialog, built from the Modeler's own `Overlay` and
  `Section` components and form/button styles (like the Deploy dialog).
- `client/export/collectPages.js` – in bpmn-js every collapsed subprocess has its own
  plane (`<id>_plane`); BFS over the planes, starting at the plane currently open.
- `client/export/exportPdf.js` – switches `canvas.setRootElement(plane)`, calls
  `modeler.saveSVG()`, and right after that restores the original plane, viewbox and selection.
- `client/export/svgPrepare.js` – removes diagram-js helpers (hit areas, outlines), adds the
  drill-down markers (the editor shows them as HTML overlays, which are not part of the SVG), fixes
  svg2pdf quirks and converts all text to outlines with [opentype.js](https://github.com/opentypejs/opentype.js)
  using Arimo (metric-compatible with Arial, which bpmn-js uses to lay out labels).
  With `textToCurves: false` the labels stay real text (selectable/searchable) in the embedded Arimo font.
- `client/export/pdf.js` – [jsPDF](https://github.com/parallax/jsPDF) + [svg2pdf.js](https://github.com/yWorks/svg2pdf.js)
  (SVG → native PDF vector paths); titles, footer and bookmarks use an embedded subset of Arimo
  (Latin incl. Czech, Greek, Cyrillic, arrows). Only embedded fonts are referenced.

Limitations: PDF has no native SVG, so the SVG is translated into PDF drawing operators.
Raster images in the diagram (e.g. PNG icons of element templates) stay raster; SVG icons stay vector.

The Modeler plugin API is not officially stable – test the plugin after a major Modeler upgrade.

## License

MIT. Arimo font – SIL Open Font License 1.1, see `client/fonts/Arimo-OFL.txt`.
