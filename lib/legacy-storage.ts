/* The app's browser-storage keys used to be prefixed "scaa" and are now "elo". Importing this module
   (before the importer's own code runs, as ES imports do) copies any old-prefixed entry to its new name
   when the new one is absent and drops the old one, so drafts, pins and preferences survive the rename.
   Safe to delete once every active browser has visited since the rename. */
const OLD = /^scaa([-:])/;

function migrate(store: Storage) {
  const old: string[] = [];
  for (let index = 0; index < store.length; index++) { const key = store.key(index); if (key && OLD.test(key)) old.push(key); }
  for (const key of old) {
    const next = key.replace(OLD, "elo$1"), value = store.getItem(key);
    if (value !== null && store.getItem(next) === null) store.setItem(next, value);
    store.removeItem(key);
  }
}

if (typeof window !== "undefined") {
  for (const pick of [() => window.localStorage, () => window.sessionStorage]) {
    try { migrate(pick()); } catch { /* storage blocked or full: nothing to carry over */ }
  }
}
export {};
