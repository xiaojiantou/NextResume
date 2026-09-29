import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync('components/AgentDictation.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function setup() {
  let rec, cleanup;
  const text = [], activity = [];
  const jsx = (type, props) => ({ type, props });
  class Recognition {
    constructor() { rec = this; }
    start() {}
    stop() { this.onend?.(); }
    abort() { this.aborted = true; }
  }
  const modules = {
    '@/components/LanguageProvider': { useI18n: () => ({ t: value => value, locale: 'en' }) },
    'react': { useState: v => [v, () => {}], useRef: v => ({ current: v }), useEffect: fn => { const next = fn(); if (next) cleanup = next; } },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { Mic: 'mic', Square: 'square' },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => modules[id], window: { SpeechRecognition: Recognition }, navigator: { language: 'en-US' }, setTimeout: () => 1, clearTimeout: () => {} });
  const tree = exports.AgentDictation({ value: 'Keep my tone.', disabled: false, onChange: v => text.push(v), onActiveChange: v => activity.push(v) });
  const find = node => !node?.props ? undefined : node.type === 'button' ? node : [node.props.children].flat().map(find).find(Boolean);
  find(tree).props.onClick();
  return { rec, text, activity, cleanup };
}
test('dictation appends to the existing request without duplicating recognition results', () => {
  const { rec, text, activity } = setup();
  const results = [{ 0: { transcript: 'Make it shorter.' }, isFinal: true }];
  rec.onresult({ results }); rec.onresult({ results });
  assert.deepEqual(text, ['Keep my tone. Make it shorter.', 'Keep my tone. Make it shorter.']);
  rec.stop();
  assert.deepEqual(activity, [true, false]);
});
test('dictation limits request size and stops listening', () => {
  const { rec, text, activity } = setup();
  rec.onresult({ results: [{ 0: { transcript: 'x'.repeat(5000) }, isFinal: true }] });
  assert.equal(text[0].length, 4000);
  assert.equal(activity.at(-1), false);
});
test('permission failure releases recording state; unmount detaches callbacks and aborts', () => {
  const first = setup();
  first.rec.onerror({ error: 'not-allowed' });
  assert.equal(first.activity.at(-1), false);
  assert.equal(first.rec.aborted, true);
  const second = setup();
  second.cleanup();
  assert.equal(second.rec.aborted, true);
  assert.equal(second.rec.onresult, null);
});
