/**
 * Load the browser-side Scout modules into Node for testing.
 *
 * The search engine and calculator ship to the browser as ES modules. Rather
 * than duplicating them server-side — where the two copies would drift — the
 * export keywords are stripped and the same source is evaluated here. The test
 * therefore exercises exactly the code the user runs.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FRONTEND = path.join(__dirname, '..', '..', '..', 'Awibi-EHR-Frontend', 'src', 'lib');
const DATA = path.join(__dirname, '..', '..', 'src', 'data', 'scout');

function loadEsModule(file) {
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^export\s+(class|function|const)/gm, '$1')
    .replace(/^export\s*\{[^}]*\};?$/gm, '');
  const names = [...source.matchAll(/^(?:class|function|const)\s+(\w+)/gm)].map((m) => m[1]);
  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(`${source}\nmodule.exports = { ${names.join(', ')} };`, context);
  return context.module.exports;
}

function loadScout() {
  const search = loadEsModule(path.join(FRONTEND, 'scoutSearch.js'));
  const calc = loadEsModule(path.join(FRONTEND, 'scoutCalculator.js'));
  const index = JSON.parse(fs.readFileSync(path.join(DATA, 'scout-index.json'), 'utf8'));
  const entries = JSON.parse(fs.readFileSync(path.join(DATA, 'scout-entries.json'), 'utf8'));
  return {
    scoutIndex: search.buildIndex(index),
    scoutEntries: entries,
    scoutSearch: search.search,
    scoutCalculate: calc.calculate,
  };
}

module.exports = { loadScout };
