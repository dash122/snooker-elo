import test from "node:test";
import assert from "node:assert/strict";
import {A2HS_SNOOZE_DAYS,dismissA2hs,emptyA2hsState,isIosSafari,parseA2hsState,shouldPromptAddToHomeScreen} from "../lib/add-to-home-screen.ts";

const IPHONE_SAFARI="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

test("only iOS Safari gets the walkthrough",()=>{
  assert.equal(isIosSafari({userAgent:IPHONE_SAFARI}),true);
  assert.equal(isIosSafari({userAgent:IPHONE_SAFARI.replace("Safari/604.1","CriOS/126 Safari/604.1")}),false);
  assert.equal(isIosSafari({userAgent:"Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile Safari/537.36"}),false);
  assert.equal(isIosSafari({userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"}),false);
});

test("an iPad reporting itself as a Mac still counts",()=>{
  const userAgent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15";
  assert.equal(isIosSafari({userAgent,platform:"MacIntel",maxTouchPoints:5}),true);
  assert.equal(isIosSafari({userAgent,platform:"MacIntel",maxTouchPoints:0}),false);
});

test("first-time visitors are left alone until they come back",()=>{
  const state=emptyA2hsState();
  assert.equal(shouldPromptAddToHomeScreen({state,visits:1,now:0}),false);
  assert.equal(shouldPromptAddToHomeScreen({state,visits:2,now:0}),true);
});

test("'不用再提醒我' silences the prompt permanently",()=>{
  const state=dismissA2hs(emptyA2hsState(),true,1000);
  assert.equal(shouldPromptAddToHomeScreen({state,visits:99,now:1e12}),false);
});

test("dismissing without opting out snoozes for two weeks",()=>{
  const now=1_700_000_000_000;
  const state=dismissA2hs({visits:3,snoozeUntil:0,never:false},false,now);
  assert.equal(shouldPromptAddToHomeScreen({state,visits:4,now:now+A2HS_SNOOZE_DAYS*864e5-1}),false);
  assert.equal(shouldPromptAddToHomeScreen({state,visits:4,now:now+A2HS_SNOOZE_DAYS*864e5+1}),true);
});

test("corrupt or missing storage falls back to a clean state",()=>{
  assert.deepEqual(parseA2hsState(null),emptyA2hsState());
  assert.deepEqual(parseA2hsState("{oops"),emptyA2hsState());
  assert.deepEqual(parseA2hsState('{"visits":3,"never":true}'),{visits:3,snoozeUntil:0,never:true});
});
