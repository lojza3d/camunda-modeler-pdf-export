import React, { useEffect, useRef, useState } from 'camunda-modeler-plugin-helpers/vendor/react.js';
import Overlay from 'camunda-modeler-plugin-helpers/components/Overlay.js';
import Section from 'camunda-modeler-plugin-helpers/components/Section.js';

import { CONFIG } from './config';

const { texts } = CONFIG;

/**
 * "Export as PDF" dialog shown right above the status bar button,
 * built from the Modeler's own Overlay/Section components and form styles.
 *
 * @param {Object} props
 * @param {HTMLElement} props.anchor - the status bar button
 * @param {{ includeSubProcesses: boolean, markSubProcesses: boolean }} props.initialOptions
 * @param {(options: Object) => void} props.onExport
 * @param {() => void} props.onClose
 */
export default function ExportOverlay(props) {
  const {
    anchor,
    initialOptions,
    onExport,
    onClose
  } = props;

  const [ includeSubProcesses, setIncludeSubProcesses ] = useState(initialOptions.includeSubProcesses);
  const [ markSubProcesses, setMarkSubProcesses ] = useState(initialOptions.markSubProcesses);

  const exportButtonRef = useRef();

  // Enter = Export, Escape = Cancel (handled by the Overlay)
  useEffect(() => {
    exportButtonRef.current && exportButtonRef.current.focus();
  }, []);

  const handleSubmit = event => {
    event.preventDefault();

    onExport({ includeSubProcesses, markSubProcesses });
  };

  // radio buttons and checkboxes do not submit a form on Enter by themselves
  const handleKeyDown = event => {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
      handleSubmit(event);
    }
  };

  return (
    <Overlay
      anchor={ anchor }
      onClose={ onClose }
      className="pdf-export-overlay"
    >
      <Section>
        <Section.Header>{ texts.overlayTitle }</Section.Header>
        <Section.Body>
          <form onSubmit={ handleSubmit } onKeyDown={ handleKeyDown }>
            <div className="form-group pdf-export-overlay__group">
              <Radio
                id="pdf-export-scope-current"
                checked={ !includeSubProcesses }
                onChange={ () => setIncludeSubProcesses(false) }
                label={ texts.scopeCurrent }
              />
              <Radio
                id="pdf-export-scope-subdiagrams"
                checked={ includeSubProcesses }
                onChange={ () => setIncludeSubProcesses(true) }
                label={ texts.scopeWithSubProcesses }
              />
            </div>

            <div className="form-group pdf-export-overlay__group">
              <div className="custom-control custom-checkbox">
                <input
                  type="checkbox"
                  id="pdf-export-mark-subprocesses"
                  className="custom-control-input"
                  checked={ markSubProcesses }
                  onChange={ event => setMarkSubProcesses(event.target.checked) }
                />
                <label className="custom-control-option" htmlFor="pdf-export-mark-subprocesses">
                  { texts.markSubProcesses }
                </label>
              </div>
            </div>

            <div className="pdf-export-overlay__actions">
              <button type="button" className="btn btn-secondary" onClick={ onClose }>
                { texts.cancel }
              </button>
              <button type="submit" className="btn btn-primary" ref={ exportButtonRef }>
                { texts.export }
              </button>
            </div>
          </form>
        </Section.Body>
      </Section>
    </Overlay>
  );
}

function Radio({ id, checked, onChange, label }) {
  return (
    <div className="custom-control custom-radio">
      <input
        type="radio"
        id={ id }
        name="pdf-export-scope"
        className="custom-control-input"
        checked={ checked }
        onChange={ onChange }
      />
      <label className="custom-control-option" htmlFor={ id }>
        { label }
      </label>
    </div>
  );
}
