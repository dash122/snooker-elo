/* Postgres' wire protocol allows at most 65535 bind parameters in one
   statement, and postgres.js rejects anything larger before it reaches the
   server. A single bulk insert per table is fine for a young club, but the
   match table carries ~41 columns per row, so a club crosses the cap at
   roughly 1,600 recorded matches — after which *every* save fails with
   "MAX_PARAMETERS_EXCEEDED" (most visibly: recording a new match). Split each
   bulk insert into as many statements as the cap requires; they all run inside
   the same transaction, so the write stays atomic. */
export const MAX_BIND_PARAMETERS = 65534;
export function insertChunks<T extends Record<string, unknown>>(rows: T[]): T[][] {
  if (!rows.length) return [];
  const columns = Math.max(1, Object.keys(rows[0]).length);
  const perStatement = Math.max(1, Math.floor(MAX_BIND_PARAMETERS / columns));
  if (rows.length <= perStatement) return [rows];
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += perStatement) chunks.push(rows.slice(index, index + perStatement));
  return chunks;
}
