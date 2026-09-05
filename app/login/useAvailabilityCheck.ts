"use client";

import { useEffect, useRef, useState } from "react";

const CHECK_DEBOUNCE_MS = 200;

// Checks one field (username or email) against /api/auth/check independently
// of the other, so each shows "taken" as soon as it's filled in rather than
// waiting on both fields together.
export function useAvailabilityCheck(field: "username" | "email", value: string, isValid: boolean) {
  const [taken, setTaken] = useState(false);
  const [checking, setChecking] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isValid) {
      requestId.current++;
      return;
    }
    setChecking(true);
    const myRequestId = ++requestId.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/check?${field}=${encodeURIComponent(value.trim())}`);
        if (myRequestId !== requestId.current) return;
        if (!res.ok) { setChecking(false); return; }
        const data = await res.json();
        setTaken(!!data[field === "username" ? "usernameTaken" : "emailTaken"]);
      } catch {
        // Silently skip — the server-side check on submit still catches it.
      } finally {
        if (myRequestId === requestId.current) setChecking(false);
      }
    }, CHECK_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [field, value, isValid]);

  return { taken: isValid && taken, checking: isValid && checking };
}
