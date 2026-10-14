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

/**
 * @param {string} svgString
 * @param {Object} options
 * @param {boolean} options.textToCurves
 *
 * @return {SVGSVGElement}
 */
export function prepareSvg(svgString, { textToCurves }) {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const svg = doc.documentElement;

  if (!svg || svg.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) {
    throw new Error('The exported SVG could not be processed.');
  }

  svg.querySelectorAll(HELPER_SELECTOR).forEach(element => element.remove());

  normalizeDashArrays(svg);

  if (textToCurves) {
    convertTextToCurves(svg);
  } else {
    useEmbeddedFont(svg);
  }

  return svg;
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
