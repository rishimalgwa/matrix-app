import { INTEGRATIONS } from "@/integrations";
import type { Integration } from "@/integrations/types";
import { Badge } from "@/components/ui";

function Card({ integration: i }: { integration: Integration }) {
  const status = i.useStatus?.();
  return (
    <section className="panel p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-panel-3">{i.icon}</span>
          <div>
            <h2 className="font-semibold">{i.name}</h2>
            <p className="text-sm text-muted">{i.description}</p>
          </div>
        </div>
        {status && <Badge tone={status.tone}>{status.label}</Badge>}
      </header>
      <i.Panel />
    </section>
  );
}

export function ConnectView() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      {INTEGRATIONS.map((i) => <Card key={i.id} integration={i} />)}
    </div>
  );
}
