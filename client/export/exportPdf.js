import { collectPages, getTitle } from './collectPages';
import { prepareSvg, getSvgSize, PX_TO_MM } from './svgPrepare';
import { PdfBuilder } from './pdf';

/**
 * Renders the diagram currently open in the editor – optionally with all
 * collapsed subprocesses below it (any depth) – into a PDF with vector graphics.
 * Main diagram open = whole model; subprocess open = that subtree only.
 *
 * Phase 1: the canvas is switched through all planes to grab their SVG and
 *          restored afterwards (root element, viewbox, selection); it stays
 *          hidden meanwhile.
 * Phase 2: SVGs are cleaned up, text is converted to curves and everything
 *          is drawn into the PDF.
 *
 * @param {Object} bpmnjs - bpmn-js Modeler / Viewer
 * @param {Object} options
 * @param {string} options.modelName
 * @param {Object} options.config - see ../config.js
 * @param {boolean} [options.includeSubProcesses=true] - false = current diagram only
 * @param {boolean} [options.markSubProcesses=false] - draw the blue drill-down
 *   arrow next to collapsed subprocesses that contain a diagram
 * @param {(done: number, total: number) => void} [options.onProgress]
 *
 * @return {Promise<{ base64: string, pageCount: number, titles: string[] }>}
 */
export async function exportToPdf(bpmnjs, {
  modelName,
  config,
  includeSubProcesses = true,
  markSubProcesses = false,
  onProgress = () => {}
}) {
  const pages = collectPages(bpmnjs, {
    modelName,
    startRoot: bpmnjs.get('canvas').getRootElement(),
    includeSubProcesses
  });

  if (!pages.length) {
    throw new Error('Nothing to export – the diagram is empty.');
  }

  const svgs = await collectSvgs(bpmnjs, pages, config);

  const drilldownColors = markSubProcesses
    ? getDrilldownColors(bpmnjs, config.drilldownMarker)
    : null;

  const pdf = new PdfBuilder(config, {
    title: getTitle(pages[0], config.titleSeparator),
    footer: modelName
  });

  const outlineNodes = new Map();
  const titles = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const title = getTitle(page, config.titleSeparator);

    onProgress(i, pages.length);

    let diagram = null;

    if (svgs[i]) {
      const svg = prepareSvg(svgs[i], {
        textToCurves: config.textToCurves,
        drilldowns: markSubProcesses ? page.drilldowns : [],
        drilldownColors
      });

      const size = getSvgSize(svg);
      const area = pdf.getDiagramArea(title);
      const fitScale = getFitScale(size, area, config);

      diagram = {
        svg,
        widthMm: size.width * PX_TO_MM * fitScale,
        heightMm: size.height * PX_TO_MM * fitScale
      };
    }

    const pageNumber = await pdf.addPage({
      title,
      diagram,
      emptyText: config.texts.emptySubProcess
    });

    outlineNodes.set(page, pdf.addOutline(
      outlineNodes.get(page.parent) || null,
      page.path[page.path.length - 1],
      pageNumber
    ));

    titles.push(title);

    // let the UI breathe between pages
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  onProgress(pages.length, pages.length);

  return {
    base64: pdf.toBase64(),
    pageCount: pages.length,
    titles
  };
}

/**
 * How much the diagram has to shrink (or grow) to fit the given area.
 *
 * @param {{ width: number, height: number }} size - px
 * @param {{ width: number, height: number }} area - mm
 * @param {Object} config
 *
 * @return {number}
 */
export function getFitScale(size, area, config) {
  const fit = Math.min(
    area.width / (size.width * PX_TO_MM),
    area.height / (size.height * PX_TO_MM)
  );

  return config.shrinkOnly ? Math.min(1, fit) : fit;
}


// helpers //////////

const DEFAULT_DRILLDOWN_COLORS = {
  background: '#0077cc',
  foreground: '#ffffff'
};

/**
 * Colors of the drill-down button as styled by the running Modeler
 * (they differ between versions), unless set explicitly in the config.
 */
function getDrilldownColors(bpmnjs, configured = {}) {
  const colors = { ...DEFAULT_DRILLDOWN_COLORS };

  try {
    const probe = document.createElement('button');

    probe.className = 'bjs-drilldown';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';

    bpmnjs.get('canvas').getContainer().appendChild(probe);

    const style = window.getComputedStyle(probe);

    if (isOpaque(style.backgroundColor)) {
      colors.background = style.backgroundColor;
    }

    if (isOpaque(style.fill)) {
      colors.foreground = style.fill;
    }

    probe.remove();
  } catch (error) {

    // keep defaults
  }

  if (configured && configured.background) {
    colors.background = configured.background;
  }

  if (configured && configured.foreground) {
    colors.foreground = configured.foreground;
  }

  return colors;
}

function isOpaque(color) {
  return !!color &&
    color !== 'none' &&
    color !== 'transparent' &&
    !/^rgba\(.*,\s*0\)$/.test(color);
}

/**
 * @return {Promise<Array<string|null>>} SVG per page, null for empty planes
 */
async function collectSvgs(bpmnjs, pages, config) {
  const canvas = bpmnjs.get('canvas');
  const selection = bpmnjs.get('selection', false);
  const container = canvas.getContainer();

  if (!container.isConnected || !container.getClientRects().length) {
    throw new Error(config.texts.notVisible);
  }

  const original = {
    root: canvas.getRootElement(),
    viewbox: canvas.viewbox(),
    selection: selection ? selection.get().slice() : [],
    visibility: container.style.visibility
  };

  const svgs = [];

  try {

    // avoid flickering through all subprocesses; getBBox() still works
    container.style.visibility = 'hidden';

    // selection outlines must not end up in the export
    if (selection) {
      selection.select(null);
    }

    for (const page of pages) {
      if (page.empty) {
        svgs.push(null);
        continue;
      }

      canvas.setRootElement(page.root);

      const { svg } = await bpmnjs.saveSVG();

      svgs.push(svg);
    }
  } finally {
    canvas.setRootElement(original.root);
    canvas.viewbox(original.viewbox);

    if (selection) {
      selection.select(original.selection);
    }

    container.style.visibility = original.visibility;
  }

  return svgs;
}
