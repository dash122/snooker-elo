import assert from "node:assert/strict";
import test from "node:test";
import {nextTabValue} from "../lib/tab-navigation.ts";

const items=[{value:"history"},{value:"calendar",disabled:true},{value:"matrix"},{value:"cup"}];
test("tab arrows wrap and skip disabled panels",()=>{
  assert.equal(nextTabValue(items,"history","ArrowRight"),"matrix");
  assert.equal(nextTabValue(items,"matrix","ArrowLeft"),"history");
  assert.equal(nextTabValue(items,"cup","ArrowRight"),"history");
  assert.equal(nextTabValue(items,"history","ArrowLeft"),"cup");
});
test("Home and End select the first and last enabled tab",()=>{
  assert.equal(nextTabValue(items,"matrix","Home"),"history");
  assert.equal(nextTabValue(items,"history","End"),"cup");
});
test("tab navigation tolerates removed selections and empty groups",()=>{
  assert.equal(nextTabValue(items,"removed","ArrowRight"),"history");
  assert.equal(nextTabValue(items,"calendar","ArrowLeft"),"cup");
  assert.equal(nextTabValue([],"history","Home"),null);
  assert.equal(nextTabValue([{value:"history",disabled:true}],"history","ArrowRight"),null);
  assert.equal(nextTabValue([{value:"history"}],"history","ArrowRight"),"history");
});
test("Tab, Enter and vertical arrows keep their native behaviour",()=>{
  for(const key of ["Tab","Enter"," ","ArrowUp","ArrowDown"])assert.equal(nextTabValue(items,"history",key),null);
});
