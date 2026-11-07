import sample from "@fixtures/sample-feed.json";
import { DataLabel } from "@/components/data-label";

export function Feed() {
  return (
    <section
      data-testid="feed-panel"
      className="panel flex min-h-0 flex-col p-4"
      aria-label="Agent feed"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Agent feed</h2>
        <DataLabel>{sample.label}</DataLabel>
      </div>
      <ol className="min-h-0 space-y-3 overflow-y-auto">
        {sample.events.map((event) => (
          <li
            key={event.seq}
            data-testid="feed-event"
            className="border-l-2 border-accent/40 pl-3 text-sm"
          >
            <span className="block text-[13px] font-medium capitalize text-muted">
              {event.actor}
            </span>
            {event.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
