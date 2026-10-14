'use strict';

/**
 * Camunda Desktop Modeler plugin entry point.
 *
 * Copy the whole folder (index.js + dist/ + style/) to
 *   {USER_DATA_DIRECTORY}/resources/plugins/pdf-export
 * e.g. on macOS: ~/Library/Application Support/camunda-modeler/resources/plugins/pdf-export
 */
module.exports = {
  name: 'PDF Export (subprocess drill-down)',
  script: './dist/client.js',
  style: './style/style.css'
};
