import { Button } from "@/components/ui/button";

export function Controls() {
  return (
    <section
      data-testid="controls-panel"
      className="panel flex items-center gap-3 p-3"
      aria-label="Controls"
    >
      <Button disabled>Break it</Button>
      <Button variant="outline" disabled>
        Fix it
      </Button>
    </section>
  );
}
