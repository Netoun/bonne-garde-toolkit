import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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

const paymentColumns = columnHelper.columns([
  columnHelper.accessor("email", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
    enableSorting: true,
    enableColumnFilter: true,
  }),
  columnHelper.accessor("amount", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
    cell: ({ getValue }) => `$${getValue()}`,
    enableSorting: true,
  }),
]);

const samplePayments: Payment[] = [
  { id: "1", email: "m@example.com", amount: 316 },
  { id: "2", email: "a@example.com", amount: 242 },
  { id: "3", email: "z@example.com", amount: 837 },
];

function emailCells(): string[] {
  const body = screen.getAllByRole("rowgroup")[1]!;
  return within(body)
    .getAllByRole("row")
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent?.trim() ?? "");
}

describe("data-table item", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sorts rows ascending then descending when the sortable header is clicked", () => {
    render(<DataTable columns={paymentColumns} data={samplePayments} filterColumn="email" />);

    expect(emailCells()).toEqual(["m@example.com", "a@example.com", "z@example.com"]);

    fireEvent.click(screen.getByRole("button", { name: /email/i }));
    expect(emailCells()).toEqual(["a@example.com", "m@example.com", "z@example.com"]);

    fireEvent.click(screen.getByRole("button", { name: /email/i }));
    expect(emailCells()).toEqual(["z@example.com", "m@example.com", "a@example.com"]);
  });

  it("shows the second page on Next and disables Previous on the first page", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: String(i + 1),
      email: `user${i + 1}@example.com`,
      amount: i,
    }));

    render(<DataTable columns={paymentColumns} data={many} filterColumn="email" pageSize={5} />);

    const next = screen.getByRole("button", { name: /next/i });

    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    fireEvent.click(next);
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous/i })).not.toBeDisabled();
    expect(emailCells()[0]).toBe("user6@example.com");
  });

  it("keeps only rows matching the filter input", () => {
    render(<DataTable columns={paymentColumns} data={samplePayments} filterColumn="email" />);

    fireEvent.change(screen.getByPlaceholderText(/filter/i), { target: { value: "a@example" } });
    expect(emailCells()).toEqual(["a@example.com"]);
  });

  it('shows "No results." when data is empty', () => {
    render(<DataTable columns={paymentColumns} data={[]} filterColumn="email" />);
    expect(screen.getByText("No results.")).toBeInTheDocument();
  });
});
