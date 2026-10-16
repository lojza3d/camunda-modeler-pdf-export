import React, { PureComponent } from 'camunda-modeler-plugin-helpers/vendor/react.js';
import Fill from 'camunda-modeler-plugin-helpers/components/Fill.js';

import ExportOverlay from './ExportOverlay';
import { exportToPdf } from './export/exportPdf';
import { getOpenSubProcessName } from './export/collectPages';
import { CONFIG } from './config';

const BPMN_TAB_TYPES = [ 'bpmn', 'cloud-bpmn' ];

const OPTIONS_STORAGE_KEY = 'camunda-modeler-pdf-export.options';

/**
 * Client extension: adds a "PDF" button to the status bar of BPMN tabs.
 * Clicking it opens the "Export as PDF" dialog right above the button.
 *
 * Props are injected by the Modeler, see
 * https://github.com/camunda/camunda-modeler/blob/main/client/src/app/plugins/PluginsRoot.js
 */
export default class PdfExportPlugin extends PureComponent {

  constructor(props) {
    super(props);

    // tab.id -> bpmn-js modeler
    this.modelers = new Map();

    this.anchorRef = React.createRef();

    this.state = {
      activeTab: this.getAppActiveTab(),
      overlayOpen: false,
      options: loadOptions(),
      progress: null
    };

    // subscribe right away (not in componentDidMount) so that no
    // `bpmn.modeler.created` event can slip through
    const { subscribe } = props;

    this.subscriptions = [
      subscribe('bpmn.modeler.created', this.handleModelerCreated),
      subscribe('app.activeTabChanged', this.handleActiveTabChanged)
    ];
  }

  componentWillUnmount() {
    this.subscriptions.forEach(subscription => subscription && subscription.cancel && subscription.cancel());
  }

  handleModelerCreated = ({ modeler, tab }) => {
    if (!tab || !modeler) {
      return;
    }

    this.modelers.set(tab.id, modeler);

    modeler.on('diagram.destroy', () => {
      if (this.modelers.get(tab.id) === modeler) {
        this.modelers.delete(tab.id);
      }
    });
  };

  handleActiveTabChanged = ({ activeTab }) => {
    this.setState({ activeTab, overlayOpen: false });
  };

  toggleOverlay = () => {
    if (this.state.progress) {
      return;
    }

    this.setState(({ overlayOpen }) => ({ overlayOpen: !overlayOpen }));
  };

  closeOverlay = () => {
    this.setState({ overlayOpen: false });
  };

  handleOverlayExport = options => {
    saveOptions(options);

    this.setState({ overlayOpen: false, options });

    this.handleExport(options);
  };

  getAppActiveTab() {
    try {
      const state = this.props._getFromApp('state');

      return (state && state.activeTab) || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * @param {{ includeSubProcesses: boolean, markSubProcesses: boolean }} options
   */
  handleExport = async (options) => {
    const {
      displayNotification,
      log,
      _getGlobal
    } = this.props;

    const tab = this.getAppActiveTab() || this.state.activeTab;
    const modeler = tab && this.modelers.get(tab.id);

    if (!modeler) {
      return displayNotification({
        type: 'error',
        title: CONFIG.texts.errorTitle,
        content: CONFIG.texts.noModeler,
        duration: 8000
      });
    }

    const dialog = _getGlobal('dialog'),
          fileSystem = _getGlobal('fileSystem');

    const modelName = getModelName(tab);
    const subProcessName = getOpenSubProcessName(modeler);

    // defaults to <folder of the .bpmn>/<model>.pdf,
    // or <model> - <subprocess>.pdf when a subprocess is open
    const defaultName = subProcessName
      ? sanitizeFileName(`${ modelName } - ${ subProcessName }`)
      : modelName;

    const filePath = await dialog.showSaveFileDialog({
      file: { ...tab.file, name: `${ defaultName }.bpmn` },
      filters: [ { name: 'PDF', extensions: [ 'pdf' ] } ],
      title: CONFIG.texts.dialogTitle
    });

    if (!filePath) {
      return;
    }

    this.setState({ progress: { done: 0, total: 0 } });

    try {
      const { base64, pageCount } = await exportToPdf(modeler, {
        modelName,
        config: CONFIG,
        includeSubProcesses: options.includeSubProcesses,
        markSubProcesses: options.markSubProcesses,
        onProgress: (done, total) => this.setState({ progress: { done, total } })
      });

      const written = await fileSystem.writeFile(filePath, { contents: base64 }, {
        encoding: 'base64',
        fileType: 'pdf'
      });

      displayNotification({
        type: 'success',
        title: CONFIG.texts.successTitle,
        content: `${ CONFIG.texts.pageCount(pageCount) } → ${ (written && written.path) || filePath }`,
        duration: 6000
      });
    } catch (error) {
      console.error('[pdf-export]', error);

      log({ category: 'pdf-export', message: `PDF export failed: ${ error.message }` });

      displayNotification({
        type: 'error',
        title: CONFIG.texts.errorTitle,
        content: error.message,
        duration: 8000
      });
    } finally {
      this.setState({ progress: null });
    }
  };

  render() {
    const {
      activeTab,
      overlayOpen,
      options,
      progress
    } = this.state;

    if (!activeTab || !BPMN_TAB_TYPES.includes(activeTab.type)) {
      return null;
    }

    const busy = !!progress;

    const className = [
      'btn',
      'pdf-export-button',
      overlayOpen ? 'btn--active' : '',
      busy ? 'pdf-export-button--busy' : ''
    ].filter(Boolean).join(' ');

    return (
      <React.Fragment>
        <Fill slot="status-bar__file" group="7_pdf-export">
          <button
            type="button"
            ref={ this.anchorRef }
            className={ className }
            title={ CONFIG.texts.buttonTitle }
            onClick={ this.toggleOverlay }
            disabled={ busy }
          >
            <PdfIcon />
            <span className="pdf-export-button__label">
              { busy && progress.total ? `${ progress.done }/${ progress.total }` : CONFIG.texts.buttonLabel }
            </span>
          </button>
        </Fill>

        { overlayOpen && this.anchorRef.current && (
          <ExportOverlay
            anchor={ this.anchorRef.current }
            initialOptions={ options }
            onExport={ this.handleOverlayExport }
            onClose={ this.closeOverlay }
          />
        ) }
      </React.Fragment>
    );
  }
}


// helpers //////////

/**
 * "model_name" = file name without extension.
 */
function getModelName(tab) {
  const name = (tab.file && tab.file.name) || tab.name || 'diagram';

  return name.replace(/\.(bpmn|xml)$/i, '');
}

/**
 * Last used dialog choices (per user, survive restarts).
 */
function loadOptions() {
  const defaults = { ...CONFIG.defaultOptions };

  try {
    const stored = JSON.parse(window.localStorage.getItem(OPTIONS_STORAGE_KEY) || 'null');

    if (stored && typeof stored === 'object') {
      [ 'includeSubProcesses', 'markSubProcesses' ].forEach(key => {
        if (typeof stored[key] === 'boolean') {
          defaults[key] = stored[key];
        }
      });
    }
  } catch (error) {

    // storage not available -> defaults
  }

  return defaults;
}

function saveOptions(options) {
  try {
    window.localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(options));
  } catch (error) {

    // storage not available -> not remembered
  }
}

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim();
}

function PdfIcon() {
  return (
    <svg className="pdf-export-button__icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 1h5.5L13 4.5V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Zm5 1.2V5h2.8L9 2.2ZM4.2 2.2v11.6h7.6V6.2H8.6a.8.8 0 0 1-.8-.8V2.2H4.2Z"
      />
      <path
        fill="currentColor"
        d="M5.2 7.6h5.6v1.1H5.2zM5.2 9.6h5.6v1.1H5.2zM5.2 11.6h3.6v1.1H5.2z"
      />
    </svg>
  );
}
