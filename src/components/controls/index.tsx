import { Button } from "@/components/ui/button";

const DISABLED = "disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-100";

export function Controls() {
  return (
    <section
      data-testid="controls-panel"
      className="panel flex items-center gap-3 p-3"
      aria-label="Controls"
    >
      <Button
        disabled
        className={`${DISABLED} disabled:bg-accent/40 disabled:text-white`}
      >
        Break it
      </Button>
      <Button
        variant="outline"
        disabled
        className={`${DISABLED} disabled:border-dashed disabled:bg-transparent disabled:text-muted/70`}
      >
        Fix it
      </Button>
    </section>
  );
}
