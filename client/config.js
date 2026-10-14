/**
 * Everything you may want to tweak lives here.
 */
export const CONFIG = {

  // page ('a4', 'a3', ...)
  format: 'a4',
  orientation: 'landscape',
  marginMm: 10,

  // title above each diagram
  titleFontSize: 14,      // pt
  titleLineHeight: 1.25,  // x font size
  titleGapMm: 5,          // space between title and diagram
  titleSeparator: ' → ',

  // footer: "<model name> ........ 3 / 12"
  footer: true,
  footerFontSize: 8,

  // diagram placement
  shrinkOnly: true,       // true = never enlarge small diagrams, only shrink big ones to fit

  // diagram labels:
  //  true  = converted to vector outlines (no font dependency, not selectable/searchable)
  //  false = real text in the embedded Arimo font (selectable/searchable)
  textToCurves: true,

  texts: {
    buttonLabel: 'PDF',
    buttonTitle: 'Export to PDF (open diagram + all collapsed subprocesses below it)',
    dialogTitle: 'Export to PDF',
    emptySubProcess: '(subprocess contains no elements)',
    successTitle: 'PDF exported',
    errorTitle: 'PDF export failed',
    pageCount: count => `${ count } ${ count === 1 ? 'page' : 'pages' }`,
    noModeler: 'No BPMN modeler found for the active tab. Close and reopen the file (or open it after the plugin has loaded).',
    notVisible: 'The diagram is not visible – switch from the XML view back to the diagram.'
  }
};
