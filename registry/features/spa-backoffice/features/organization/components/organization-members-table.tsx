import {
  useLegacyTable,
  getCoreRowModel,
  getSortedRowModel,
  legacyCreateColumnHelper,
} from "@tanstack/react-table/legacy";
import { flexRender, type SortingState } from "@tanstack/react-table";
import { useState } from "react";
import { User, Trash2, Crown, Shield, UserCircle } from "lucide-react";
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
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { Avatar, AvatarFallback, AvatarImage } from "@acme/ui/components/avatar";
import type { OrganizationMember } from "../hooks/use-organization";

interface OrganizationMembersTableProps {
  members: OrganizationMember[];
  currentUserId: string;
  onRemoveMember: (memberId: string) => void;
  canRemove: boolean;
}

const roleIcons: Record<string, React.ReactNode> = {
  owner: <Crown className="h-4 w-4 text-yellow-500" />,
  admin: <Shield className="h-4 w-4 text-blue-500" />,
  member: <UserCircle className="h-4 w-4 text-gray-500" />,
};

const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const roleVariants: Record<string, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "secondary",
  member: "outline",
};

const columnHelper = legacyCreateColumnHelper<OrganizationMember>();

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function OrganizationMembersTable({
  members,
  currentUserId,
  onRemoveMember,
  canRemove,
}: OrganizationMembersTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = [
    columnHelper.accessor("name", {
      header: "Member",
      cell: (info) => {
        const member = info.row.original;
        return (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={member.image ?? undefined} />
              <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{member.name}</p>
              <p className="text-sm text-muted-foreground">{member.email}</p>
            </div>
          </div>
        );
      },
    }),
    columnHelper.accessor("role", {
      header: "Role",
      cell: (info) => {
        const role = info.getValue();
        return (
          <div className="flex items-center gap-2">
            {roleIcons[role] ?? <User className="h-4 w-4" />}
            <Badge variant={roleVariants[role] ?? "outline"}>{roleLabels[role] ?? role}</Badge>
          </div>
        );
      },
    }),
    columnHelper.accessor("createdAt", {
      header: "Added on",
      cell: (info) => formatDate(info.getValue()),
    }),
    columnHelper.display({
      id: "actions",
      header: "Actions",
      cell: (info) => {
        const member = info.row.original;
        if (!canRemove || member.userId === currentUserId) return null;
        return (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRemoveMember(member.memberId)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        );
      },
    }),
  ];

  const table = useLegacyTable({
    data: members,
    columns: columnHelper.columns(columns),
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (members.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">No members in this organization</div>
    );
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
