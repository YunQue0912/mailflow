import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./AdminPanel.jsx', import.meta.url), 'utf8');

describe('conversation mode layout', () => {
  it('keeps all three mode cards in one equal-width row', () => {
    const start = source.indexOf('<ChoiceCards keepRow value={conversationMode}');
    const end = source.indexOf(']} />', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);

    const block = source.slice(start, end);
    assert.deepEqual([...block.matchAll(/id: '(off|list|pane)'/g)].map(match => match[1]), ['off', 'list', 'pane']);
    const shared = source.slice(source.indexOf('function ChoiceCards('), source.indexOf('function ChoiceChips('));
    assert.match(shared, /options.length > 2 && !keepRow \? 1 : options.length/);
    assert.match(shared, /gridTemplateColumns: `repeat\(\$\{columns\}, minmax\(0, 1fr\)\)`/);
    assert.equal((shared.match(/overflowWrap: 'anywhere'/g) || []).length, 2);
  });
});
