"use client";
import { useEffect, useRef } from "react";
export function PackageVisit({ token }: { token: string }) {
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    void fetch(`/api/packages/${token}`).catch(() => undefined);
  }, [token]);
  return null;
}
