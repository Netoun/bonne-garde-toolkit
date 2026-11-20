import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@acme/ui/components/table";
import type { ModuleVariant } from "@bonne-garde/schema";

export function VariantsTable({ variants }: { variants: ModuleVariant[] }) {
  return (
    <section aria-labelledby="variants" className="flex flex-col gap-3">
      <h2 id="variants" className="text-xl font-semibold">
        Variants
      </h2>
      <Table aria-labelledby="variants">
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Match</TableHead>
            <TableHead>Workspace</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {variants.map((variant) => (
            <TableRow key={variant.key}>
              <TableCell className="font-mono">{variant.key}</TableCell>
              <TableCell className="font-mono">
                {Object.entries(variant.match)
                  .map(([category, id]) => `${category}=${id}`)
                  .join(", ")}
              </TableCell>
              <TableCell className="font-mono">{variant.workspace?.path ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
