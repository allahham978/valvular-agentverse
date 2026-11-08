import type { Design, Summary } from "@/contracts";

const MIN_MM = 19;
const MAX_MM = 31;

const TOTALS = [
  { key: "fit", label: "Fit", testId: "judge-total-fit" },
  { key: "risk", label: "Risk", testId: "judge-total-risk" },
  { key: "noFit", label: "No fit", testId: "judge-total-nofit" },
] as const;

export function Sliders({
  design,
  summary,
  error,
  onChange,
}: {
  design: Design;
  summary: Summary | null;
  error: string | null;
  onChange(index: number, nominalMm: number): void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {design.sizes.map((size, index) => (
        <label key={index} className="flex items-center gap-3 text-sm">
          <span className="w-16 text-muted">Size {index + 1}</span>
          <input
            type="range"
            min={MIN_MM}
            max={MAX_MM}
            step={1}
            value={size.nominalMm}
            onChange={(event) => onChange(index, Number(event.target.value))}
            className="min-w-0 flex-1 accent-accent"
          />
          <span className="mono w-14 text-right">{size.nominalMm} mm</span>
        </label>
      ))}
      <dl className="mono flex gap-4 text-sm">
        {TOTALS.map(({ key, label, testId }) => (
          <div key={key} className="flex gap-1.5">
            <dt className="text-muted">{label}</dt>
            <dd data-testid={testId}>{summary ? summary[key] : "-"}</dd>
          </div>
        ))}
      </dl>
      {error && <p className="text-xs text-muted">{error}</p>}
    </div>
  );
}
