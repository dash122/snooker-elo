// Retired matchmaking entry point. Historical storage is retained.
function retired(){return Response.json({error:"舊版約戰已停用，請重新整理頁面使用新版約戰。"},{status:410});}
export const PATCH=retired;
export const DELETE=retired;
