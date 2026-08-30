import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const css=readFileSync(new URL("../app/styles/matchmaking-formation.css",import.meta.url),"utf8");
const component=readFileSync(new URL("../app/MatchmakingFormation.tsx",import.meta.url),"utf8");

test("matchmaking hero is isolated from the app-wide fixed header rule",()=>{
  assert.match(component,/<div className="mf-header">/);
  assert.doesNotMatch(component,/<header className="mf-header">/);
});

test("the mobile day rail reaches both viewport gutters but owns its scrolling",()=>{
  assert.match(css,/\.mf-days\{[^}]*overflow-x:auto/);
  assert.match(css,/@media\(max-width:599px\)\{[^\n]*\.mf-days\{max-width:none;/);
});

test("mobile join actions get their own full-width row",()=>{
  assert.match(css,/\.mf-request-row\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/\.mf-request-row>span\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);width:100%\}/);
});

test("cards and publishing controls may shrink below intrinsic content width",()=>{
  for(const safeguard of [".mf-page{display:grid", ".mf-card-top>*{min-width:0}", ".mf-sheet,.mf-sheet .ds-field", ".mf-sheet select{max-width:100%}"])
    assert.ok(css.includes(safeguard),`missing mobile overflow safeguard: ${safeguard}`);
});
