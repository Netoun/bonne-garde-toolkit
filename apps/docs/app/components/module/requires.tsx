import type { ModuleManifest } from "@bonne-garde/schema";
import { Link } from "react-router";

import { modulePath } from "../../lib/modules";

export function Requires({ peers }: { peers: ModuleManifest["peers"] }) {
  const entries = Object.entries(peers);
  if (entries.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="requires" className="flex flex-col gap-3">
      <h2 id="requires" className="text-xl font-semibold">
        Requires
      </h2>
      <ul className="flex flex-col gap-1 text-sm">
        {entries.map(([category, ids]) => (
          <li key={category}>
            <code className="font-mono">{category}</code>:{" "}
            {ids.length === 0 ? (
              <span className="text-muted-foreground">any module</span>
            ) : (
              ids.map((id, index) => (
                <span key={id}>
                  {index > 0 ? ", " : null}
                  <Link className="underline underline-offset-4" to={modulePath(category, id)}>
                    {id}
                  </Link>
                </span>
              ))
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
