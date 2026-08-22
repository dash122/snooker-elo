"use client";

import { useRef, useState } from "react";
import { Button } from "../components/ui/Primitives";
import { ConfirmDialog } from "../components/ui/Overlay";

export type Snapshot = { id: number; savedAt: string };

export default function SnapshotList({ snapshots, restoreLabel, confirmMessage }: { snapshots: Snapshot[]; restoreLabel: string; confirmMessage: string }) {
  const [pendingForm, setPendingForm] = useState<HTMLFormElement | null>(null);
  const skipConfirm = useRef(false);
  return <>
    <ul className="admin-player-list">{snapshots.map(snapshot =>
      <li key={snapshot.id}>
        <b>{new Date(snapshot.savedAt).toLocaleString("zh-HK", { dateStyle: "medium", timeStyle: "short" })}</b>
        <form action="/api/admin/snapshots" method="post" onSubmit={(event) => {
          if (skipConfirm.current) { skipConfirm.current = false; return; }
          event.preventDefault();
          setPendingForm(event.currentTarget);
        }}>
          <input type="hidden" name="id" value={snapshot.id} />
          <Button variant="quiet" type="submit">{restoreLabel}</Button>
        </form>
      </li>)}
    </ul>
    {pendingForm && <ConfirmDialog kicker="還原快照" titleId="restore-snapshot-title" title={confirmMessage} description="還原後，目前的資料會被取代。" onClose={() => setPendingForm(null)}>
      <Button variant="secondary" onClick={() => setPendingForm(null)}>取消</Button>
      <Button variant="danger" onClick={() => { const form = pendingForm; setPendingForm(null); skipConfirm.current = true; form.requestSubmit(); }}>確定還原</Button>
    </ConfirmDialog>}
  </>;
}
