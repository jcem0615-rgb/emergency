const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
// Run from a directory where `npm install lucide` has been done,
// or pass the package path as argv[2].
const lucide = require(process.argv[2] || 'lucide/dist/umd/lucide.js');

const html = ['index.html', 'offline.html']
  .map(f => { const p = path.join(ROOT, f);
              return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; })
  .join('\n');

// Every way this app names an icon: markup attributes, setAttribute calls and
// the turn-by-turn step definitions.
const names = new Set();
for (const re of [/data-lucide="([a-z0-9-]+)"/g,
                  /setAttribute\('data-lucide',\s*'([a-z0-9-]+)'\)/g,
                  /icon:\s*'([a-z0-9-]+)'/g,
                  /\?\s*'([a-z0-9-]+)'\s*:\s*'([a-z0-9-]+)'/g]) {
  let m; while ((m = re.exec(html))) { if (m[1]) names.add(m[1]); if (m[2]) names.add(m[2]); }
}

const pascal = (k) => k.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('');
const subset = {};
const missing = [];
for (const name of [...names].sort()) {
  const key = pascal(name);
  if (lucide.icons[key]) subset[name] = lucide.icons[key];
  else missing.push(name);
}

const runtime = `/* =============================================================================
 * Lucide icon subset for E-mergency (${Object.keys(subset).length} icons).
 * Generated from the lucide npm package: only the icons this app renders, so
 * the offline precache stays small. Upstream: https://lucide.dev (ISC licence).
 * ========================================================================== */
(function (root) {
  'use strict';
  var icons = ${JSON.stringify(subset)};

  var SVG_ATTRS = {
    xmlns: 'http://www.w3.org/2000/svg', width: 24, height: 24,
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  };
  var NS = 'http://www.w3.org/2000/svg';

  function build(name, node) {
    var svg = document.createElementNS(NS, 'svg');
    Object.keys(SVG_ATTRS).forEach(function (k) { svg.setAttribute(k, SVG_ATTRS[k]); });
    // An icon node is a list of [tag, attrs] element tuples. Older shapes wrap
    // them as ['svg', attrs, children], so accept that too.
    var children = (node[0] === 'svg' && Array.isArray(node[2])) ? node[2] : node;
    children.forEach(function (child) {
      var el = document.createElementNS(NS, child[0]);
      Object.keys(child[1] || {}).forEach(function (k) { el.setAttribute(k, child[1][k]); });
      svg.appendChild(el);
    });
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('lucide', 'lucide-' + name);
    return svg;
  }

  function createIcons() {
    var nodes = document.querySelectorAll('[data-lucide]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var name = el.getAttribute('data-lucide');
      var def = icons[name];
      if (!def) { console.warn('[lucide-subset] unknown icon:', name); continue; }
      var svg = build(name, def);
      // Carry over every authored attribute (class, title, style, ...)
      for (var a = 0; a < el.attributes.length; a++) {
        var attr = el.attributes[a];
        if (attr.name === 'data-lucide') continue;
        if (attr.name === 'class') svg.setAttribute('class', attr.value + ' lucide lucide-' + name);
        else svg.setAttribute(attr.name, attr.value);
      }
      el.parentNode.replaceChild(svg, el);
    }
  }

  root.lucide = { icons: icons, createIcons: createIcons };
})(typeof globalThis !== 'undefined' ? globalThis : window);
`;

fs.writeFileSync(path.join(ROOT, 'assets/lucide.min.js'), runtime);
console.log('icons bundled:', Object.keys(subset).length);
console.log('names:', Object.keys(subset).join(' '));
if (missing.length) console.log('NOT FOUND (ignored, not real icon names):', missing.join(' '));
console.log('size:', (fs.statSync(path.join(ROOT, 'assets/lucide.min.js')).size / 1024).toFixed(1), 'KB');
