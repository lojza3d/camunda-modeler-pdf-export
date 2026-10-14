/**
 * Creates release/camunda-modeler-pdf-export-v<version>.zip containing only
 * what the Modeler needs, wrapped in the plugin folder:
 *
 *   camunda-modeler-pdf-export/
 *   ├── index.js
 *   ├── dist/client.js (+ license notices of bundled libraries and font)
 *   ├── style/style.css
 *   ├── README.md
 *   └── LICENSE (if present)
 *
 * Unzip it into .../camunda-modeler/resources/plugins/ and restart the Modeler.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_FOLDER = 'camunda-modeler-pdf-export';

// [ source, target inside the plugin folder, required ]
const FILES = [
  [ 'index.js', 'index.js', true ],
  [ 'dist/client.js', 'dist/client.js', true ],
  [ 'dist/client.js.LICENSE.txt', 'dist/client.js.LICENSE.txt', true ],
  [ 'client/fonts/Arimo-OFL.txt', 'dist/Arimo-OFL.txt', true ],
  [ 'style', 'style', true ],
  [ 'README.md', 'README.md', false ],
  [ 'LICENSE', 'LICENSE', false ]
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const releaseDir = path.join(root, 'release');
const stageDir = path.join(releaseDir, PLUGIN_FOLDER);
const zipName = `${ PLUGIN_FOLDER }-v${ version }.zip`;

rmSync(stageDir, { recursive: true, force: true });
rmSync(path.join(releaseDir, zipName), { force: true });
mkdirSync(stageDir, { recursive: true });

for (const [ from, to, required ] of FILES) {
  const source = path.join(root, from);

  if (!existsSync(source)) {
    if (required) {
      throw new Error(`Missing ${ from } - run "npm run build" first.`);
    }

    continue;
  }

  const target = path.join(stageDir, to);

  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

execFileSync('zip', [ '-r', '-X', '-q', zipName, PLUGIN_FOLDER, '-x', '*.DS_Store', '*.map' ], {
  cwd: releaseDir,
  stdio: 'inherit'
});

rmSync(stageDir, { recursive: true, force: true });

console.log(`Created release/${ zipName }`);
