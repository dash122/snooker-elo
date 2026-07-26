"use client";

import { useEffect, useState } from "react";
import { PlayerCombobox } from "../UiBits";

type Player = { id: string; name: string };

/**
 * The admin forms are plain HTML posts, so the combobox keeps its selection in
 * a hidden input. `formId` is the owning form's `data-player-link-form` value —
 * it has to be separate from `name`, which is the posted field and is the same
 * string ("statePlayerId") on every form on the page.
 */
export default function PlayerLinkCombobox({ players, initialValue, name, formId, placeholder, clearLabel }: { players: Player[]; initialValue: string; name: string; formId: string; placeholder: string; clearLabel: string }) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => setValue(initialValue), [initialValue]);
  useEffect(() => {
    const form = document.querySelector(`[data-player-link-form="${CSS.escape(formId)}"]`);
    if (!form) return;
    const reset = () => setValue(initialValue);
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [initialValue, formId]);
  return <>
    <PlayerCombobox players={players} value={value} onChange={setValue} placeholder={placeholder} ariaLabel={placeholder} allowClear clearLabel={clearLabel} />
    <input type="hidden" name={name} value={value} />
  </>;
}
