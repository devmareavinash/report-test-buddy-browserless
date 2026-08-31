import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const KEY = "rtb.orchestrateConcurrency";
const OPTIONS = [1, 2, 3, 5, 8];

export function readOrchestrateConcurrency(): number {
  if (typeof localStorage === "undefined") return 3;
  const n = Number(localStorage.getItem(KEY) || 3);
  return Number.isFinite(n) && n >= 1 ? Math.min(10, Math.floor(n)) : 3;
}

export function useOrchestrateConcurrency() {
  const [concurrency, setConcurrency] = useState(readOrchestrateConcurrency);
  return {
    concurrency,
    setConcurrency: (n: number) => {
      const next = Number.isFinite(n) && n >= 1 ? Math.min(10, Math.floor(n)) : 3;
      localStorage.setItem(KEY, String(next));
      setConcurrency(next);
    },
  };
}

export function ConcurrencySelect({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))} disabled={disabled}>
      <SelectTrigger className="w-[7.5rem] h-9" title="How many scenarios scrape at once">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((n) => (
          <SelectItem key={n} value={String(n)}>
            {n} parallel screens
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
