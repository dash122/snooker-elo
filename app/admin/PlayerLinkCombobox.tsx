"use client";

import { useEffect, useState } from "react";
import { PlayerCombobox } from "../UiBits";

type Player = { id: string; name: string };

export default function PlayerLinkCombobox({ players, initialValue, name, placeholder, clearLabel }: { players: Player[]; initialValue: string; name: string; placeholder: string; clearLabel: string }) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    const form = document.querySelector(`[data-player-link-form="${name}"]`);
    if (!form) return;
    const reset = () => setValue(initialValue);
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [initialValue, name]);
  return <>
    <PlayerCombobox players={players} value={value} onChange={setValue} placeholder={placeholder} ariaLabel={placeholder} allowClear clearLabel={clearLabel} />
    <input type="hidden" name={name} value={value} />
  </>;
}