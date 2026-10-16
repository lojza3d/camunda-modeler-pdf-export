/**
 * Collects the pages of the PDF from a bpmn-js instance.
 *
 * Since bpmn-js 9 every collapsed subprocess has its own "plane"
 * (root element with id `<subProcessId>_plane`). We walk the plane tree
 * breadth-first, starting at the plane currently open in the editor
 * (levels below are relative to it when a subprocess is open):
 *
 *   level 1  ... main diagram (process / collaboration)
 *   level 2  ... collapsed subprocesses drawn in the main diagram,
 *                ordered left -> right, then top -> bottom
 *   level 3+ ... collapsed subprocesses inside those, grouped by parent
 *                (in parent page order), each group ordered left -> right,
 *                then top -> bottom
 *
 * Collapsed subprocesses nested in *expanded* subprocesses are part of the
 * same plane, so they belong to the same level as their expanded parent.
 */

export const PLANE_SUFFIX = '_plane';

const IMPLICIT_ROOT_PREFIX = '__implicitroot';

/**
 * @typedef {Object} Page
 * @property {Object} root      - diagram-js root element (plane)
 * @property {number} level     - 1 = main diagram
 * @property {string[]} path    - title segments, e.g. [ 'model', 'subprocess "A"' ]
 * @property {Page|null} parent
 * @property {boolean} empty    - plane has no shapes
 * @property {Bounds[]} drilldowns - collapsed subprocesses on this plane whose
 *   own plane is not empty (where the Modeler shows the blue drill-down arrow)
 *
 * @typedef {{ x: number, y: number, width: number, height: number }} Bounds
 */

/**
 * @param {Object} bpmnjs - bpmn-js Modeler / Viewer instance
 * @param {Object} options
 * @param {string} options.modelName - first title segment
 * @param {Object} [options.startRoot] - plane to start from (the one currently
 *   open in the editor). A subprocess plane exports only that subprocess and
 *   its descendants; the main diagram (or none) exports everything.
 * @param {boolean} [options.includeSubProcesses=true] - false = only the
 *   start plane (one page)
 *
 * @return {Page[]}
 */
export function collectPages(bpmnjs, { modelName, startRoot, includeSubProcesses = true }) {
  const canvas = bpmnjs.get('canvas'),
        elementRegistry = bpmnjs.get('elementRegistry');

  const isExportableRoot = root =>
    !!root && !!root.businessObject && !root.id.startsWith(IMPLICIT_ROOT_PREFIX);

  let queue;

  if (startRoot && isSubProcessPlane(startRoot, elementRegistry)) {
    const path = getPlanePath(startRoot, canvas, elementRegistry, modelName);

    queue = [ {
      root: startRoot,
      level: path.length,
      path,
      parent: null
    } ];
  } else if (!includeSubProcesses && isExportableRoot(startRoot)) {
    queue = [ {
      root: startRoot,
      level: 1,
      path: [ modelName ],
      parent: null
    } ];
  } else {
    queue = canvas.getRootElements()
      .filter(root => isExportableRoot(root) && !isSubProcessPlane(root, elementRegistry))
      .map(root => ({
        root,
        level: 1,
        path: [ modelName ],
        parent: null
      }));

    if (!includeSubProcesses) {
      queue = queue.slice(0, 1);
    }
  }

  const pages = [];
  const visited = new Set();

  while (queue.length) {
    const page = queue.shift();

    if (visited.has(page.root)) {
      continue;
    }

    visited.add(page.root);

    page.empty = !hasShapes(page.root, elementRegistry);

    pages.push(page);

    const subProcesses = getCollapsedSubProcesses(page.root, canvas, elementRegistry)
      .sort(byPosition);

    page.drilldowns = subProcesses
      .filter(shape => hasShapes(elementRegistry.get(shape.id + PLANE_SUFFIX), elementRegistry))
      .map(({ x, y, width, height }) => ({ x, y, width, height }));

    if (!includeSubProcesses) {
      continue;
    }

    subProcesses.forEach(shape => {
      queue.push({
        root: elementRegistry.get(shape.id + PLANE_SUFFIX),
        level: page.level + 1,
        path: [ ...page.path, describeSubProcess(shape.businessObject) ],
        parent: page
      });
    });
  }

  return pages;
}

/**
 * @param {Page} page
 * @param {string} [separator]
 */
export function getTitle(page, separator = ' → ') {
  return page.path.join(separator);
}

/**
 * Name of the subprocess currently open in the editor, or null when the
 * main diagram is open.
 *
 * @param {Object} bpmnjs
 *
 * @return {string|null}
 */
export function getOpenSubProcessName(bpmnjs) {
  const root = bpmnjs.get('canvas').getRootElement(),
        elementRegistry = bpmnjs.get('elementRegistry');

  if (!root || !isSubProcessPlane(root, elementRegistry)) {
    return null;
  }

  return normalizeName(root.businessObject.name) || root.businessObject.id;
}


// helpers //////////

function isSubProcess(element) {
  const bo = element && element.businessObject;

  return !!bo && typeof bo.$instanceOf === 'function' && bo.$instanceOf('bpmn:SubProcess');
}

function isSubProcessPlane(root, elementRegistry) {
  if (!isSubProcess(root) || !root.id.endsWith(PLANE_SUFFIX)) {
    return false;
  }

  const shapeId = root.id.slice(0, -PLANE_SUFFIX.length);

  return !!elementRegistry.get(shapeId);
}

/**
 * Title segments from the main diagram down to the given subprocess plane,
 * e.g. [ 'model', 'subprocess "A"', 'subprocess "B"' ].
 */
function getPlanePath(plane, canvas, elementRegistry, modelName) {
  const segments = [];
  const visited = new Set();

  let current = plane;

  while (current && isSubProcessPlane(current, elementRegistry) && !visited.has(current)) {
    visited.add(current);

    const shape = elementRegistry.get(current.id.slice(0, -PLANE_SUFFIX.length));

    segments.unshift(describeSubProcess(shape.businessObject));

    current = canvas.findRoot(shape);
  }

  return [ modelName, ...segments ];
}

/**
 * Collapsed subprocess shapes that live on the given plane and own a plane.
 */
function getCollapsedSubProcesses(root, canvas, elementRegistry) {
  return elementRegistry.filter(element =>
    element !== root &&
    element.type !== 'label' &&
    !element.waypoints &&
    isSubProcess(element) &&
    !!elementRegistry.get(element.id + PLANE_SUFFIX) &&
    canvas.findRoot(element) === root
  );
}

function hasShapes(root, elementRegistry) {
  return elementRegistry.filter(element => element.parent === root).length > 0;
}

/**
 * Primary: left -> right, secondary: top -> bottom.
 */
function byPosition(a, b) {
  return (a.x - b.x) || (a.y - b.y);
}

function describeSubProcess(bo) {
  let kind = 'subprocess';

  if (bo.$instanceOf('bpmn:Transaction')) {
    kind = 'transaction';
  } else if (bo.$instanceOf('bpmn:AdHocSubProcess')) {
    kind = 'ad-hoc subprocess';
  } else if (bo.triggeredByEvent) {
    kind = 'event subprocess';
  }

  const name = normalizeName(bo.name) || bo.id;

  return `${ kind } "${ name }"`;
}

function normalizeName(name) {
  return (name || '').replace(/\s+/g, ' ').trim();
}
