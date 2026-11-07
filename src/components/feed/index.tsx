import sample from "@fixtures/sample-feed.json";
import { DataLabel } from "@/components/data-label";

const MEASUREMENT = /(\d+(?:\.\d+)?\s?mm)/g;

function renderText(text: string) {
  return text
    .split(MEASUREMENT)
    .map((part, index) =>
      index % 2 === 1 ? (
        <span key={index} className="mono tracking-tighter">
          {part}
        </span>
      ) : (
        part
      ),
    );
}

export function Feed() {
  return (
    <section
      data-testid="feed-panel"
      className="panel flex min-h-0 flex-1 flex-col p-4"
      aria-label="Agent feed"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Agent feed</h2>
        <DataLabel>{sample.label}</DataLabel>
      </div>
      <ol className="min-h-0 space-y-5 overflow-y-auto">
        {sample.events.map((event) => (
          <li key={event.seq} data-testid="feed-event" className="text-sm">
            <span className="mb-0.5 block text-sm font-medium capitalize text-muted">
              {event.actor}
            </span>
            {renderText(event.text)}
          </li>
        ))}
      </ol>
    </section>
  );
}
