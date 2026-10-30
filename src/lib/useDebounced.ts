'use client';

import { useEffect, useState } from 'react';

/** The value, settled for `delayMs` — keeps filter inputs from firing a request per keystroke. */
export function useDebounced<T>(value: T, delayMs = 400): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
