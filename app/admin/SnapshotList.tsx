"use client";

export type Snapshot = { id: number; savedAt: string };

export default function SnapshotList({ snapshots, restoreLabel, confirmMessage }: { snapshots: Snapshot[]; restoreLabel: string; confirmMessage: string }) {
  return <ul className="admin-player-list">{snapshots.map(snapshot =>
    <li key={snapshot.id}>
      <b>{new Date(snapshot.savedAt).toLocaleString("zh-HK", { dateStyle: "medium", timeStyle: "short" })}</b>
      <form action="/api/admin/snapshots" method="post" onSubmit={(event) => { if (!confirm(confirmMessage)) event.preventDefault(); }}>
        <input type="hidden" name="id" value={snapshot.id} />
        <button className="more" type="submit">{restoreLabel}</button>
      </form>
    </li>)}
  </ul>;
}
