import test from "node:test";
import assert from "node:assert/strict";
import { BAND_COLUMNS, BAND_START_HOUR, MIN_COLUMNS, TAP_COLUMNS, clampColumn, columnClock,
  columnInstant, density, instantColumn, normaliseWindow, overlapping, peakOf, peakWindow,
  ratingBand, sharedWindow } from "../lib/week-band.ts";

const col = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return ((h < BAND_START_HOUR ? h + 24 : h) * 60 + m - BAND_START_HOUR * 60) / 30;
};
const person = (playerId, ...pairs) =>
  ({ playerId, slots: pairs.map(([f, t]) => ({ from: col(f), to: col(t) })) });

/* --- the grid ------------------------------------------------------------- */

test("the band spans 17:00 to 01:00 in half hours",()=>{
  assert.equal(BAND_COLUMNS,16);
  assert.equal(columnClock(0),"17:00");
  assert.equal(columnClock(6),"20:00");
  assert.equal(columnClock(BAND_COLUMNS),"01:00","past midnight reads as the morning it is");
});

test("columns past midnight resolve onto the next calendar day",()=>{
  assert.match(columnInstant("2026-09-10",0),/^2026-09-10T17:00/);
  assert.match(columnInstant("2026-09-10",14),/^2026-09-11T00:00/,"24:00 is tomorrow, not hour 24");
  assert.match(columnInstant("2026-09-10",BAND_COLUMNS),/^2026-09-11T01:00/);
});

test("an instant maps back to the column it came from",()=>{
  for(const c of [0,3,7,14,16]){
    assert.equal(instantColumn("2026-09-10",columnInstant("2026-09-10",c)),c);
  }
});

test("clamping keeps a drag inside the band",()=>{
  assert.equal(clampColumn(-4),0);
  assert.equal(clampColumn(99),BAND_COLUMNS);
  assert.equal(clampColumn(6.4),6);
});

/* --- what a gesture may produce ------------------------------------------- */

test("a backwards drag is still a window",()=>{
  assert.deepEqual(normaliseWindow({from:10,to:4}),{from:4,to:10});
});

test("a window is never shorter than half an hour",()=>{
  const w=normaliseWindow({from:8,to:8});
  assert.equal(w.to-w.from,MIN_COLUMNS,"a zero-width drag is a mis-tap, not an intention");
});

test("a window pinned at the end of the band stays inside it",()=>{
  const w=normaliseWindow({from:BAND_COLUMNS,to:BAND_COLUMNS});
  assert.ok(w.to<=BAND_COLUMNS);
  assert.ok(w.from<w.to);
});

/* --- density -------------------------------------------------------------- */

test("a column counts only people who span its whole width",()=>{
  /* 19:00-19:30 covers exactly one column; 19:15 would cover none. */
  const columns=density([person("a",["19:00","19:30"])]);
  assert.equal(columns[col("19:00")],1);
  assert.equal(columns[col("19:30")],0);
});

test("one person with two slots is not counted twice in one column",()=>{
  const columns=density([person("a",["19:00","21:00"],["20:00","22:00"])]);
  assert.equal(peakOf(columns),1,"overlapping slots of the same member are still one body");
});

test("people who never share a half hour never make an overlap",()=>{
  const columns=density([person("a",["17:00","19:00"]),person("b",["21:00","23:00"])]);
  assert.equal(peakOf(columns),1);
});

/* --- the default window --------------------------------------------------- */

test("an empty night opens on the club's usual evening",()=>{
  const w=peakWindow(density([]));
  assert.equal(columnClock(w.from),"19:00");
  assert.equal(w.to-w.from,TAP_COLUMNS);
});

test("the default lands on the busiest run, not the first busy column",()=>{
  const columns=density([
    person("a",["18:00","18:30"]),           // a lone early column
    person("b",["20:00","22:00"]),
    person("c",["20:00","22:00"]),
  ]);
  const w=peakWindow(columns);
  assert.equal(columnClock(w.from),"20:00");
  assert.equal(columnClock(w.to),"22:00");
});

test("a one-column peak is widened to something playable, and still contains the peak",()=>{
  const columns=density([person("a",["20:00","20:30"]),person("b",["20:00","20:30"])]);
  const w=peakWindow(columns);
  assert.ok(w.to-w.from>=TAP_COLUMNS,"nobody should be asked to publish twenty minutes");
  assert.ok(w.from<=col("20:00")&&w.to>=col("20:30"),"the busy half hour stays inside the proposal");
});

test("a peak against the end of the band does not push the window outside it",()=>{
  const columns=density([person("a",["00:30","01:00"]),person("b",["00:30","01:00"])]);
  const w=peakWindow(columns);
  assert.ok(w.from>=0&&w.to<=BAND_COLUMNS);
});

/* --- the seam: querying a window nobody has committed to ------------------ */

test("overlap is answered for a window that exists only in the member's finger",()=>{
  const people=[person("a",["19:00","21:00"]),person("b",["22:00","24:00"]),person("c",["20:30","23:00"])];
  const found=overlapping(people,{from:col("20:00"),to:col("21:00")});
  assert.deepEqual(found.map(p=>p.playerId),["a","c"]);
});

test("touching at a single boundary is not an overlap",()=>{
  const people=[person("a",["19:00","20:00"])];
  assert.equal(overlapping(people,{from:col("20:00"),to:col("21:00")}).length,0,
    "one arriving as the other leaves is not a game");
});

test("the invite proposes the widest stretch both are free",()=>{
  const p=person("a",["18:00","19:00"],["20:00","23:00"]);
  const shared=sharedWindow(p,{from:col("18:30"),to:col("22:00")});
  assert.equal(columnClock(shared.from),"20:00");
  assert.equal(columnClock(shared.to),"22:00","the longer of the two intersections wins");
});

test("a brush of less than half an hour proposes nothing rather than an unplayable slot",()=>{
  const p=person("a",["20:00","20:30"]);
  assert.equal(sharedWindow(p,{from:col("20:15"),to:col("20:20")}),null);
});

/* --- what a locked row may say -------------------------------------------- */

test("a gated row shows a band wide enough to hide which member it is",()=>{
  assert.equal(ratingBand(1482),"1450–1500");
  assert.equal(ratingBand(1500),"1500–1550");
  assert.equal(ratingBand(1338),"1300–1350");
});
