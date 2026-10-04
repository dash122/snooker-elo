// Vite resolves `?worker&url` to the URL of a bundled worker chunk (the worker and its imports in one file).
declare module "*?worker&url" {
  const url: string;
  export default url;
}
