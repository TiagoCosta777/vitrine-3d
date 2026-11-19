import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterAndSortScans} from './static/js/library-logic.mjs';

const scans = [
  {id:'old',name:'Café especial',created_at:'2026-11-01T10:00:00Z'},
  {id:'new',name:'Sabonete',created_at:'2026-11-03T10:00:00Z'},
  {id:'middle',name:'CAFE em grãos',created_at:'2026-11-02T10:00:00Z'},
];

test('library search matches Portuguese accents and case without mutating captures',()=>{
  const before=structuredClone(scans);
  assert.deepEqual(filterAndSortScans(scans,{query:'  cafe  '}).map(scan=>scan.id),['middle','old']);
  assert.deepEqual(scans,before);
});

test('date ordering is consistent and a search result is never replaced by unrelated captures',()=>{
  assert.deepEqual(filterAndSortScans(scans,{sort:'oldest'}).map(scan=>scan.id),['old','middle','new']);
  assert.deepEqual(filterAndSortScans(scans,{sort:'newest'}).map(scan=>scan.id),['new','middle','old']);
  assert.deepEqual(filterAndSortScans(scans,{query:'inexistente'}),[]);
});

test('name ordering uses numeric Portuguese collation and tolerates incomplete metadata',()=>{
  const values=[{id:'a',name:'Produto 10'},{id:'b',name:'Produto 2'},{id:'c',name:''}];
  assert.deepEqual(filterAndSortScans(values,{sort:'name'}).map(scan=>scan.id),['c','b','a']);
  assert.equal(filterAndSortScans(null).length,0);
  assert.equal(filterAndSortScans([null,{},...values]).length,4);
});
