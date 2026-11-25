import {
  createDataTableColumnHelper,
  DataTable,
  DataTableColumnHeader,
} from "@acme/ui/components/data-table";

type Payment = {
  id: string;
  email: string;
  amount: number;
};

const columnHelper = createDataTableColumnHelper<Payment>();

const columns = columnHelper.columns([
  columnHelper.accessor("email", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
    enableSorting: true,
    enableColumnFilter: true,
  }),
  columnHelper.accessor("amount", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
    cell: ({ getValue }) => {
      const formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(getValue());
      return <div className="text-right font-medium">{formatted}</div>;
    },
    enableSorting: true,
  }),
]);

const data: Payment[] = [
  { id: "728ed52f", email: "m@example.com", amount: 316 },
  { id: "489e1d42", email: "a@example.com", amount: 242 },
  { id: "b2c4e8f1", email: "c@example.com", amount: 120 },
  { id: "e91a3f07", email: "d@example.com", amount: 892 },
  { id: "f0b5d612", email: "e@example.com", amount: 451 },
];

export default function DataTableDemo() {
  return <DataTable columns={columns} data={data} filterColumn="email" pageSize={5} />;
}
