import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@acme/ui/components/table";

import type { EnvRow } from "../../lib/modules";

export function EnvironmentTable({ rows }: { rows: EnvRow[] }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="environment" className="flex flex-col gap-3">
      <h2 id="environment" className="text-xl font-semibold">
        Environment
      </h2>
      <Table aria-labelledby="environment">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Required</TableHead>
            <TableHead>Example</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name}>
              <TableCell className="font-mono">{row.name}</TableCell>
              <TableCell>{row.required ? "yes" : "no"}</TableCell>
              <TableCell className="font-mono">{row.example}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
