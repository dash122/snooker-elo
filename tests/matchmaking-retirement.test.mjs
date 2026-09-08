import test from "node:test";
import assert from "node:assert/strict";

const endpoints=[
  ["open-board/route.ts",["GET","POST"]],
  ["open-board/[id]/route.ts",["POST","PATCH","DELETE"]],
  ["open-board/[id]/cancel/route.ts",["POST"]],
  ["open-board/venues/route.ts",["POST"]],
  ["matchmaking/formation/route.ts",["GET","POST"]],
  ["matchmaking/formation/sessions/route.ts",["POST"]],
  ["matchmaking/formation/sessions/[id]/route.ts",["PATCH","DELETE"]],
  ["matchmaking/formation/availability/[id]/route.ts",["DELETE"]],
];

for(const [path,methods] of endpoints){
  test(`retired ${path} rejects stale clients without database access`,async()=>{
    const route=await import(`../app/api/${path}`);
    for(const method of methods){
      const response=await route[method](new Request("http://localhost/api/retired",{method}));
      assert.equal(response.status,410);
      assert.match((await response.json()).error,/舊版約戰已停用/);
    }
  });
}
