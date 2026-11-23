import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../app/app.js',import.meta.url),'utf8');
const context=vm.createContext({structuredClone});
vm.runInContext(source.replace(/  initialize\(\);\s*\}\)\(\);\s*$/, 'globalThis.align=alignAiPlanDays; })();'),context);
let batches=0;
for(const start of ['2026-11-22','2026-12-29','2028-02-26','2027-03-12','2027-11-05']) {
  for(let offset=0;offset<1096;offset+=7) {
    const dates=Array.from({length:Math.min(7,1096-offset)},(_,i)=>{
      const date=new Date(start+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset+i);return date.toISOString().slice(0,10);
    });
    const indexes=dates.map((_,i)=>i+1);
    const reverse=dates.map((date,i)=>({date,weekday:(new Date(date+'T12:00:00Z').getUTCDay()+6)%7+1,note:String(i)})).reverse();
    assert.equal(JSON.stringify(context.align(reverse,dates,indexes).map(d=>d.date)),JSON.stringify(dates));
    const legacy=indexes.map(dayIndex=>({dayIndex}));
    assert.equal(JSON.stringify(context.align(legacy,dates,indexes).map(d=>d.date)),JSON.stringify(dates));
    batches++;
  }
}
const dates=['2028-02-28','2028-02-29','2028-03-01'];
const indexes=[4,5,6];
assert.equal(context.align([{weekday:6},{weekday:4},{weekday:5}],dates,indexes)[0].date,dates[0]);
for(const invalid of [
  [{date:'2028-02-28'},{date:'2028-02-28'},{date:'2028-03-01'}],
  [{date:'2028-02-30'},{date:'2028-02-29'},{date:'2028-03-01'}],
  [{date:'2028-02-28T00:00:00Z'},{date:dates[1]},{date:dates[2]}],
  [{date:dates[0],dayIndex:6},{date:dates[1]},{date:dates[2]}],
  [{},{},{}], [{weekday:1},{weekday:2},{weekday:3}], [null,null,null], []
])assert.throws(()=>context.align(invalid,dates,indexes));
console.log(`Date alignment passed: ${batches} batches covering five 3-year calendars, leap day, year/DST boundaries, shuffled replies, split indexes and eight invalid mapping cases.`);
