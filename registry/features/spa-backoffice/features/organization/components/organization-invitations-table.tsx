import {
  useLegacyTable,
  getCoreRowModel,
  getSortedRowModel,
  legacyCreateColumnHelper,
} from "@tanstack/react-table/legacy";
import { flexRender, type SortingState } from "@tanstack/react-table";
import { useState } from "react";
import { Mail, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@acme/ui/components/table";
import { Button } from "@acme/ui/components/button";
import { Badge } from "@acme/ui/components/badge";
import type { OrganizationInvitation, OrganizationRole } from "../hooks/use-organization";

interface OrganizationInvitationsTableProps {
  invitations: OrganizationInvitation[];
  canCancel: boolean;
  onCancelInvitation: (invitationId: string) => void;
  cancelingId?: string | null;
}

const roleLabels: Record<OrganizationRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const columnHelper = legacyCreateColumnHelper<OrganizationInvitation>();

function formatExpiry(isoDate: string) {
  return new Date(isoDate).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function OrganizationInvitationsTable({
  invitations,
  canCancel,
  onCancelInvitation,
  cancelingId,
}: OrganizationInvitationsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = [
    columnHelper.accessor("email", {
      header: "Email",
      cell: (info) => (
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <span>{info.getValue()}</span>
        </div>
      ),
    }),
    columnHelper.accessor("role", {
      header: "Role",
      cell: (info) => <Badge variant="outline">{roleLabels[info.getValue()]}</Badge>,
    }),
    columnHelper.accessor("expiresAt", {
      header: "Expires",
      cell: (info) => formatExpiry(info.getValue()),
    }),
    columnHelper.display({
      id: "actions",
      header: "Actions",
      cell: (info) => {
        const invitation = info.row.original;
        if (!canCancel) return null;
        return (
          <Button
            variant="ghost"
            size="sm"
            disabled={cancelingId === invitation.id}
            onClick={() => onCancelInvitation(invitation.id)}
            aria-label={`Cancel invitation for ${invitation.email}`}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Cancel
          </Button>
        );
      },
    }),
  ];

  const table = useLegacyTable({
    data: invitations,
    columns: columnHelper.columns(columns),
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (invitations.length === 0) {
    return null;
  }

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead key={header.id}>
                {header.isPlaceholder ? null : (
                  <>{flexRender(header.column.columnDef.header, header.getContext())}</>
                )}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                <>{flexRender(cell.column.columnDef.cell, cell.getContext())}</>
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
