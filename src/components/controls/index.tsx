import { Button } from "@/components/ui/button";

export function Controls() {
  return (
    <section
      data-testid="controls-panel"
      className="panel flex items-center gap-3 p-3"
      aria-label="Controls"
    >
      <Button disabled className="disabled:bg-muted/15 disabled:text-muted disabled:opacity-100">
        Break it
      </Button>
      <Button variant="outline" disabled className="text-muted">
        Fix it
      </Button>
    </section>
  );
}
