/**
 * Prepares the SVG produced by bpmn-js `saveSVG()` for vector rendering into a PDF:
 *
 *  - removes diagram-js interaction helpers (hit areas, outlines, ...)
 *  - converts all <text> to <path> outlines (font independent), or
 *    alternatively maps all text to the font embedded in the PDF
 */

import opentype from 'opentype.js';

// Arimo = metric-compatible with Arial, which bpmn-js uses to lay out labels
import arimoRegular from '../fonts/Arimo-Regular.ttf';
import arimoBold from '../fonts/Arimo-Bold.ttf';

export const PX_TO_MM = 25.4 / 96;

export const EMBEDDED_FONT_FAMILY = 'Arimo';

const SVG_NS = 'http://www.w3.org/2000/svg';

const HELPER_SELECTOR = [
  '.djs-hit',
  '.djs-outline',
  '.djs-bendpoints',
  '.djs-segment-dragger',
  '.djs-resizer',
  '.djs-dragger'
].join(',');

const INHERITED_TEXT_PROPERTIES = [
  'font-size',
  'font-weight',
  'fill',
  'fill-opacity',
  'text-anchor'
];

let fonts = null;

// drill-down button of bpmn-js (DrilldownOverlayBehavior): 20x20 px,
// 12 px left of the shape's right edge, 7 px below its bottom edge
const DRILLDOWN_SIZE = 20;
const DRILLDOWN_OFFSET_X = -12;
const DRILLDOWN_OFFSET_Y = 7;
const DRILLDOWN_RADIUS = 3;
const DRILLDOWN_ICON_SCALE = DRILLDOWN_SIZE / 16;
const DRILLDOWN_ICON = 'M4.81801948,3.50735931 L10.4996894,9.1896894 L10.5,4 L12,4 L12,12 L4,12 L4,10.5 ' +
  'L9.6896894,10.4996894 L3.75735931,4.56801948 C3.46446609,4.27512627 3.46446609,3.80025253 3.75735931,3.50735931 ' +
  'C4.05025253,3.21446609 4.52512627,3.21446609 4.81801948,3.50735931 Z';

// padding bpmn-js adds around the exported diagram
const EXPORT_PADDING = 10;

/**
 * @param {string} svgString
 * @param {Object} options
 * @param {boolean} options.textToCurves
 * @param {Array<{ x: number, y: number, width: number, height: number }>} [options.drilldowns]
 *   collapsed subprocesses to mark with a drill-down arrow (diagram coordinates)
 * @param {{ background: string, foreground: string }} [options.drilldownColors]
 *
 * @return {SVGSVGElement}
 */
export function prepareSvg(svgString, { textToCurves, drilldowns = [], drilldownColors }) {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const svg = doc.documentElement;

  if (!svg || svg.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) {
    throw new Error('The exported SVG could not be processed.');
  }

  svg.querySelectorAll(HELPER_SELECTOR).forEach(element => element.remove());

  if (drilldowns.length) {
    addDrilldownMarkers(svg, drilldowns, drilldownColors);
  }

  normalizeDashArrays(svg);

  if (textToCurves) {
    convertTextToCurves(svg);
  } else {
    useEmbeddedFont(svg);
  }

  return svg;
}

const XLINK_NS = 'http://www.w3.org/1999/xlink';

const IMAGE_FETCH_TIMEOUT = 5000;

const IMAGE_TYPES_BY_EXTENSION = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
};

/**
 * Images referenced by URL (e.g. element template icons given as https://…)
 * are fetched here and embedded as data URIs, so that svg2pdf never touches
 * the network itself. Images that cannot be loaded (offline, 404, timeout)
 * are left out instead of failing or blocking the whole export.
 *
 * @param {SVGSVGElement} svg
 * @param {Map<string, Promise<string|null>>} [cache] - shared across pages
 *
 * @return {Promise<string[]>} URLs that could not be embedded
 */
export async function inlineExternalImages(svg, cache = new Map()) {
  const images = Array.from(svg.getElementsByTagName('image'));

  const failed = [];

  await Promise.all(images.map(async image => {
    const href = image.getAttribute('href') || image.getAttributeNS(XLINK_NS, 'href') || '';

    if (/^data:/i.test(href.trim())) {
      return;
    }

    if (!cache.has(href)) {
      cache.set(href, fetchAsDataUrl(href));
    }

    const dataUrl = await cache.get(href);

    if (dataUrl) {
      image.removeAttributeNS(XLINK_NS, 'href');
      image.setAttribute('href', dataUrl);
    } else {
      failed.push(href);
      image.remove();
    }
  }));

  return failed;
}

async function fetchAsDataUrl(url) {
  if (!/^https?:\/\//i.test(url)) {
    return null;
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller && setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT);

  try {
    const response = await fetch(url, controller ? { signal: controller.signal } : {});

    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();

    const extension = (url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1];
    const type = /^image\//.test(blob.type)
      ? blob.type
      : IMAGE_TYPES_BY_EXTENSION[(extension || '').toLowerCase()];

    if (!type) {
      return null;
    }

    return await blobToDataUrl(blob.type === type ? blob : new Blob([ blob ], { type }));
  } catch (error) {
    return null;
  } finally {
    timeout && clearTimeout(timeout);
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);

    reader.readAsDataURL(blob);
  });
}

/**
 * @param {SVGSVGElement} svg
 * @return {{ width: number, height: number }} in diagram px
 */
export function getSvgSize(svg) {
  const width = parseFloat(svg.getAttribute('width')),
        height = parseFloat(svg.getAttribute('height'));

  if (!(width > 0) || !(height > 0)) {
    throw new Error('Could not determine the size of the exported SVG.');
  }

  return { width, height };
}


// drill-down markers //////////

/**
 * Draws the Modeler's blue drill-down button next to each given subprocess
 * (on top of everything, like the HTML overlay in the editor) and grows the
 * exported area if a marker sticks out of it.
 */
function addDrilldownMarkers(svg, drilldowns, colors = {}) {
  const {
    background = '#0077cc',
    foreground = '#ffffff'
  } = colors;

  const doc = svg.ownerDocument;

  const layer = doc.createElementNS(SVG_NS, 'g');

  layer.setAttribute('class', 'pdf-export-drilldowns');

  const markerBounds = drilldowns.map(({ x, y, width, height }) => {
    const markerX = x + width + DRILLDOWN_OFFSET_X,
          markerY = y + height + DRILLDOWN_OFFSET_Y;

    const group = doc.createElementNS(SVG_NS, 'g');

    group.setAttribute('transform', `translate(${ markerX } ${ markerY })`);

    const rect = doc.createElementNS(SVG_NS, 'rect');

    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(DRILLDOWN_SIZE));
    rect.setAttribute('height', String(DRILLDOWN_SIZE));
    rect.setAttribute('rx', String(DRILLDOWN_RADIUS));
    rect.setAttribute('ry', String(DRILLDOWN_RADIUS));
    rect.setAttribute('style', `fill: ${ background }; stroke: none`);

    const icon = doc.createElementNS(SVG_NS, 'path');

    icon.setAttribute('d', DRILLDOWN_ICON);
    icon.setAttribute('transform', `scale(${ DRILLDOWN_ICON_SCALE })`);
    icon.setAttribute('style', `fill: ${ foreground }; fill-rule: evenodd; stroke: none`);

    group.appendChild(rect);
    group.appendChild(icon);
    layer.appendChild(group);

    return { x: markerX, y: markerY, width: DRILLDOWN_SIZE, height: DRILLDOWN_SIZE };
  });

  svg.appendChild(layer);

  expandViewBox(svg, markerBounds);
}

/**
 * Grows viewBox, width and height (1 user unit = 1 px, as exported by
 * bpmn-js) so that all given bounds plus the export padding are visible.
 */
function expandViewBox(svg, boundsList) {
  const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(parseFloat);

  if (viewBox.length !== 4 || viewBox.some(value => !isFinite(value))) {
    return;
  }

  let [ minX, minY, width, height ] = viewBox;

  let maxX = minX + width,
      maxY = minY + height;

  boundsList.forEach(bounds => {
    minX = Math.min(minX, bounds.x - EXPORT_PADDING);
    minY = Math.min(minY, bounds.y - EXPORT_PADDING);
    maxX = Math.max(maxX, bounds.x + bounds.width + EXPORT_PADDING);
    maxY = Math.max(maxY, bounds.y + bounds.height + EXPORT_PADDING);
  });

  width = maxX - minX;
  height = maxY - minY;

  svg.setAttribute('viewBox', `${ minX } ${ minY } ${ width } ${ height }`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
}


// svg2pdf quirks //////////

/**
 * SVG: a dash array of zeros means "solid line" (bpmn-js uses
 * `stroke-dasharray: 0` e.g. for the start event of a collapsed event
 * subprocess), svg2pdf would draw nothing -> rewrite to `none`.
 */
function normalizeDashArrays(svg) {
  const isAllZero = value => {
    const numbers = String(value).trim().split(/[\s,]+/).filter(Boolean).map(parseFloat);

    return numbers.length > 0 && numbers.every(number => number === 0);
  };

  svg.querySelectorAll('[style*="stroke-dasharray"]').forEach(element => {
    element.setAttribute('style', element.getAttribute('style').replace(
      /stroke-dasharray\s*:\s*([^;]*)/g,
      (match, value) => isAllZero(value) ? 'stroke-dasharray: none' : match
    ));
  });

  svg.querySelectorAll('[stroke-dasharray]').forEach(element => {
    if (isAllZero(element.getAttribute('stroke-dasharray'))) {
      element.setAttribute('stroke-dasharray', 'none');
    }
  });
}


// text -> curves //////////

function convertTextToCurves(svg) {
  const { normal, bold } = getFonts();

  Array.from(svg.getElementsByTagName('text')).forEach(text => {
    const group = svg.ownerDocument.createElementNS(SVG_NS, 'g');

    [ 'transform', 'class', 'opacity' ].forEach(name => {
      if (text.hasAttribute(name)) {
        group.setAttribute(name, text.getAttribute(name));
      }
    });

    getTextRuns(text).forEach(run => {
      const { style } = run;

      if (!run.content || style.fill === 'none') {
        return;
      }

      const font = isBold(style['font-weight']) ? bold : normal;
      const fontSize = parseFontSize(style['font-size']);

      let x = run.x;

      if (style['text-anchor'] === 'middle' || style['text-anchor'] === 'end') {
        const width = font.getAdvanceWidth(run.content, fontSize, { kerning: true });

        x -= style['text-anchor'] === 'middle' ? width / 2 : width;
      }

      const d = font.getPath(run.content, x, run.y, fontSize, { kerning: true }).toPathData(2);

      if (!d) {
        return;
      }

      const path = svg.ownerDocument.createElementNS(SVG_NS, 'path');

      path.setAttribute('d', d);
      path.setAttribute('style', [
        `fill: ${ style.fill || 'black' }`,
        style['fill-opacity'] ? `fill-opacity: ${ style['fill-opacity'] }` : null,
        'stroke: none'
      ].filter(Boolean).join('; '));

      group.appendChild(path);
    });

    text.parentNode.replaceChild(group, text);
  });
}

/**
 * One run per <tspan> (bpmn-js: one tspan per line, absolute x/y),
 * or the <text> itself when it has no tspans.
 */
function getTextRuns(text) {
  const tspans = Array.from(text.getElementsByTagName('tspan'));

  const textX = firstNumber(text.getAttribute('x')),
        textY = firstNumber(text.getAttribute('y'));

  if (!tspans.length) {
    return [ {
      content: normalizeWhitespace(text.textContent),
      x: textX + firstNumber(text.getAttribute('dx')),
      y: textY + firstNumber(text.getAttribute('dy')),
      style: getInheritedStyle(text)
    } ];
  }

  let lastX = textX,
      lastY = textY;

  return tspans.map(tspan => {
    const x = tspan.hasAttribute('x') ? firstNumber(tspan.getAttribute('x')) : lastX;
    const y = tspan.hasAttribute('y') ? firstNumber(tspan.getAttribute('y')) : lastY;

    lastX = x + firstNumber(tspan.getAttribute('dx'));
    lastY = y + firstNumber(tspan.getAttribute('dy'));

    return {
      content: normalizeWhitespace(tspan.textContent),
      x: lastX,
      y: lastY,
      style: getInheritedStyle(tspan)
    };
  });
}

/**
 * Resolves inheritable text properties from inline styles and presentation
 * attributes (nearest ancestor wins). Document CSS is ignored on purpose:
 * bpmn-js writes everything it renders inline.
 */
function getInheritedStyle(element) {
  const result = {};

  for (let node = element; node && node.nodeType === 1; node = node.parentNode) {
    const inline = parseStyleAttribute(node.getAttribute('style'));

    INHERITED_TEXT_PROPERTIES.forEach(name => {
      if (result[name] !== undefined) {
        return;
      }

      const value = inline[name] !== undefined ? inline[name] : node.getAttribute(name);

      if (value !== null && value !== undefined && value !== '' && value !== 'inherit') {
        result[name] = value;
      }
    });
  }

  return result;
}


// text -> embedded font //////////

function useEmbeddedFont(svg) {
  svg.querySelectorAll('[style*="font-family"]').forEach(element => {
    element.setAttribute(
      'style',
      element.getAttribute('style').replace(/font-family\s*:[^;]*/g, `font-family: ${ EMBEDDED_FONT_FAMILY }`)
    );
  });

  svg.querySelectorAll('[font-family]').forEach(element => {
    element.setAttribute('font-family', EMBEDDED_FONT_FAMILY);
  });

  svg.querySelectorAll('text').forEach(text => {
    if (!text.closest('[font-family], [style*="font-family"]')) {
      text.setAttribute('font-family', EMBEDDED_FONT_FAMILY);
    }
  });
}


// helpers //////////

function getFonts() {
  if (!fonts) {
    fonts = {
      normal: opentype.parse(base64ToArrayBuffer(arimoRegular)),
      bold: opentype.parse(base64ToArrayBuffer(arimoBold))
    };
  }

  return fonts;
}

function parseStyleAttribute(style) {
  const result = {};

  (style || '').split(';').forEach(declaration => {
    const index = declaration.indexOf(':');

    if (index > 0) {
      result[declaration.slice(0, index).trim().toLowerCase()] = declaration.slice(index + 1).trim();
    }
  });

  return result;
}

function parseFontSize(value) {
  const size = parseFloat(value);

  if (!(size > 0)) {
    return 16;
  }

  if (/pt$/i.test(value)) {
    return size * 96 / 72;
  }

  return size;
}

function isBold(weight) {
  return weight === 'bold' || weight === 'bolder' || parseInt(weight, 10) >= 600;
}

function firstNumber(value) {
  const number = parseFloat(String(value || '').trim().split(/[\s,]+/)[0]);

  return isFinite(number) ? number : 0;
}

function normalizeWhitespace(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}
