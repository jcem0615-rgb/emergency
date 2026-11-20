/** Tailwind config for the E-mergency app shell.
 *  The content globs include index.html because class names are also assembled
 *  inside its inline <script> template literals. */
const path = require('path');
const root = path.resolve(__dirname, '..');
module.exports = {
  content: [path.join(root, 'index.html'), path.join(root, 'offline.html')],
  theme: { extend: {} },
  plugins: []
};
