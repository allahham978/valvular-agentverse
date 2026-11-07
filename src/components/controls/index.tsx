import { Button } from "@/components/ui/button";

const DISABLED =
  "disabled:border disabled:border-panel-border disabled:bg-panel disabled:text-muted disabled:opacity-100";

export function Controls() {
  return (
    <section
      data-testid="controls-panel"
      className="panel flex items-center gap-3 p-3"
      aria-label="Controls"
    >
      <Button disabled className={DISABLED}>
        Break it
      </Button>
      <Button variant="outline" disabled className={DISABLED}>
        Fix it
      </Button>
    </section>
  );
}
