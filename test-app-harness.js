/**
 * Shared test harness: loads the SysRevAI browser code into this Node process the same
 * way index.html does (prisma-generator.js, meta-analysis-engine.js, dedup.js, sources.js,
 * then the inline <script>), against a lightweight DOM mock.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeElement(id) {
  const el = {
    id, value: '', checked: false, textContent: '', innerHTML: '', style: {}, children: [], files: null,
    classList: {
      _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
    },
    appendChild(child) { this.children.push(child); return child; },
    removeChild() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {}, scrollIntoView() {}, focus() {}, select() {}, click() {},
    querySelector() { return makeElement('q'); }, querySelectorAll() { return []; }
  };
  return el;
}

function loadApp() {
  const store = {};
  const mockWindow = {
    addEventListener: () => {}, removeEventListener: () => {},
    STATE: null, PRISMA_DIAGRAM_STATE: null, META_ANALYSIS_STATE: null,
    jspdf: { jsPDF: function () { return { save: () => {} }; } }
  };
  global.window = mockWindow;
  global.document = {
    getElementById: (id) => (store[id] = store[id] || makeElement(id)),
    createElement: (tag) => makeElement(tag),
    querySelector: () => makeElement('q'),
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: makeElement('body')
  };
  const ls = {};
  global.localStorage = { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } };
  global.navigator = { clipboard: { writeText: () => Promise.resolve() } };
  global.alert = () => {};

  Object.assign(global, require('./prisma-generator.js'));
  Object.assign(global, require('./meta-analysis-engine.js'));
  Object.assign(global, require('./dedup.js'), require('./sources.js'));

  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const rx = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let code = '';
  let m;
  while ((m = rx.exec(indexHtml)) !== null) if (!m[0].includes('src=')) code += m[1] + '\n';
  vm.runInThisContext(code);
  return { indexHtml, elements: store, localStorageData: ls };
}

function createAsserter() {
  let pass = 0;
  let fail = 0;
  function assert(cond, name, details = '') {
    if (cond) { pass++; console.log(`  ✅ [PASS] ${name}`); }
    else { fail++; console.error(`  ❌ [FAIL] ${name}${details ? ' - ' + details : ''}`); }
  }
  assert.summary = (label) => {
    console.log('\n================================================================');
    console.log(`🏆 ${label}: ${pass} PASSED | ${fail} FAILED`);
    console.log('================================================================');
    if (fail > 0) process.exitCode = 1;
  };
  return assert;
}

module.exports = { loadApp, createAsserter, makeElement };
