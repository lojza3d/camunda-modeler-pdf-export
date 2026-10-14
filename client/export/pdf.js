import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';

import { EMBEDDED_FONT_FAMILY } from './svgPrepare';

// subsetted Arimo (Latin incl. Czech, Greek, Cyrillic, arrows), bundled as base64 strings
import fontRegular from '../fonts/Arimo-Regular.ttf';
import fontBold from '../fonts/Arimo-Bold.ttf';

const FONT = EMBEDDED_FONT_FAMILY;

const PT_TO_MM = 25.4 / 72;

/**
 * Thin wrapper around jsPDF: one page = title + vector diagram.
 */
export class PdfBuilder {

  /**
   * @param {Object} config - see ../config.js
   * @param {Object} meta
   * @param {string} meta.title - document title (PDF metadata)
   * @param {string} meta.footer - text in the bottom left corner of every page
   */
  constructor(config, { title, footer }) {
    this.config = config;
    this.footerText = footer;
    this.pageCount = 0;

    const doc = this.doc = new jsPDF({
      orientation: config.orientation,
      unit: 'mm',
      format: config.format,
      compress: true,

      // do not reference the (non-embedded) standard 14 fonts
      putOnlyUsedFonts: true
    });

    // used for titles/footer and – with textToCurves: false – for diagram labels
    doc.addFileToVFS('Arimo-Regular.ttf', fontRegular);
    doc.addFont('Arimo-Regular.ttf', FONT, 'normal');
    doc.addFileToVFS('Arimo-Bold.ttf', fontBold);
    doc.addFont('Arimo-Bold.ttf', FONT, 'bold');

    doc.setDocumentProperties({
      title: toPdfTextString(title),
      creator: 'Camunda Modeler - PDF Export plugin'
    });

    // open the bookmarks panel in PDF viewers
    doc.setDisplayMode('fullpage', 'continuous', 'UseOutlines');

    this.pageWidth = doc.internal.pageSize.getWidth();
    this.pageHeight = doc.internal.pageSize.getHeight();
  }

  /**
   * Layout of a page with the given title.
   *
   * @param {string} title
   *
   * @return {{ x: number, y: number, width: number, height: number, lines: string[] }} mm
   */
  getDiagramArea(title) {
    const { doc, config, pageWidth, pageHeight } = this;

    const margin = config.marginMm;

    doc.setFont(FONT, 'bold');
    doc.setFontSize(config.titleFontSize);

    const lines = doc.splitTextToSize(title, pageWidth - 2 * margin);
    const lineHeight = config.titleFontSize * config.titleLineHeight * PT_TO_MM;

    const top = margin + lines.length * lineHeight + config.titleGapMm;
    const bottom = pageHeight - margin - (config.footer ? config.footerFontSize * PT_TO_MM + 2 : 0);

    return {
      x: margin,
      y: top,
      width: pageWidth - 2 * margin,
      height: Math.max(10, bottom - top),
      lines
    };
  }

  /**
   * @param {Object} page
   * @param {string} page.title
   * @param {{ svg: SVGSVGElement, widthMm: number, heightMm: number }|null} page.diagram
   * @param {string} [page.emptyText]
   *
   * @return {Promise<number>} page number (1-based)
   */
  async addPage({ title, diagram, emptyText }) {
    const { doc, config } = this;

    if (this.pageCount > 0) {
      doc.addPage(config.format, config.orientation);
    }

    const pageNumber = ++this.pageCount;

    const area = this.getDiagramArea(title);
    const margin = config.marginMm;

    // title
    doc.setFont(FONT, 'bold');
    doc.setFontSize(config.titleFontSize);
    doc.setTextColor(20, 20, 20);
    doc.text(area.lines, margin, margin, {
      baseline: 'top',
      lineHeightFactor: config.titleLineHeight
    });

    // separator
    const separatorY = area.y - config.titleGapMm / 2;

    doc.setDrawColor(190, 190, 190);
    doc.setLineWidth(0.2);
    doc.line(margin, separatorY, this.pageWidth - margin, separatorY);

    // diagram as vector graphics, centered (both axes) in the area
    // between the title and the footer
    if (diagram) {

      // svg2pdf only switches the font style when it differs from its own
      // default (normal) -> do not leak the bold title font into labels
      doc.setFont(FONT, 'normal');

      await svg2pdf(diagram.svg, doc, {
        x: area.x + (area.width - diagram.widthMm) / 2,
        y: area.y + (area.height - diagram.heightMm) / 2,
        width: diagram.widthMm,
        height: diagram.heightMm
      });
    } else if (emptyText) {
      doc.setFont(FONT, 'normal');
      doc.setFontSize(11);
      doc.setTextColor(120, 120, 120);
      doc.text(emptyText, area.x, area.y + 2, { baseline: 'top' });
    }

    return pageNumber;
  }

  /**
   * Adds a PDF bookmark.
   *
   * @param {Object|null} parent - result of a previous addOutline call
   * @param {string} label
   * @param {number} pageNumber
   *
   * @return {Object}
   */
  addOutline(parent, label, pageNumber) {
    return this.doc.outline.add(parent, toPdfTextString(label), { pageNumber });
  }

  /**
   * @return {string} the PDF as base64
   */
  toBase64() {
    const { doc, config, pageWidth, pageHeight } = this;

    if (config.footer) {
      const total = doc.getNumberOfPages();
      const margin = config.marginMm;

      for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        doc.setFont(FONT, 'normal');
        doc.setFontSize(config.footerFontSize);
        doc.setTextColor(140, 140, 140);

        doc.text(this.footerText, margin, pageHeight - margin, { baseline: 'bottom' });
        doc.text(`${ i } / ${ total }`, pageWidth - margin, pageHeight - margin, { baseline: 'bottom', align: 'right' });
      }
    }

    return arrayBufferToBase64(doc.output('arraybuffer'));
  }
}


// helpers //////////

/**
 * jsPDF writes bookmark titles and document info as raw byte strings.
 * Non-ASCII text has to be passed as UTF-16BE with BOM (PDF "text string").
 */
export function toPdfTextString(str) {
  if (/^[\x20-\x7e]*$/.test(str)) {
    return str;
  }

  let result = '\u00fe\u00ff';

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);

    result += String.fromCharCode(code >> 8, code & 0xff);
  }

  return result;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}
