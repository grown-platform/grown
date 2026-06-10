/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet workbook model is loosely typed. */

export interface SheetTemplate {
  id: string;
  name: string;
  subtitle: string;
  build: () => any[];
}

// Build FortuneSheet celldata from a 2D array; the first row is bolded as a header.
function cells(rows: (string | number)[][]): any[] {
  const out: any[] = [];
  rows.forEach((row, r) =>
    row.forEach((val, c) => {
      if (val === "" || val == null) return;
      const cell: any = { v: val, m: String(val) };
      if (r === 0) cell.bl = 1;
      out.push({ r, c, v: cell });
    }),
  );
  return out;
}

function workbook(rows: (string | number)[][]): any[] {
  return [
    {
      name: "Sheet1",
      id: "sheet1",
      order: 0,
      row: Math.max(100, rows.length + 20),
      column: Math.max(26, (rows[0]?.length || 0) + 4),
      celldata: cells(rows),
    },
  ];
}

const BLANK = [
  {
    name: "Sheet1",
    id: "sheet1",
    order: 0,
    row: 100,
    column: 26,
    celldata: [],
  },
];

export const SHEET_TEMPLATES: SheetTemplate[] = [
  { id: "blank", name: "Blank spreadsheet", subtitle: "", build: () => BLANK },
  {
    id: "budget",
    name: "Monthly budget",
    subtitle: "Planner",
    build: () =>
      workbook([
        ["Category", "Budgeted", "Actual", "Difference"],
        ["Rent", 1200, 1200, 0],
        ["Groceries", 400, 0, 0],
        ["Utilities", 150, 0, 0],
        ["Transport", 120, 0, 0],
        ["Total", "=SUM(B2:B5)", "=SUM(C2:C5)", "=SUM(D2:D5)"],
      ]),
  },
  {
    id: "todo",
    name: "To-do list",
    subtitle: "Tasks",
    build: () =>
      workbook([
        ["Task", "Owner", "Due", "Status"],
        ["Example task", "Me", "", "Not started"],
      ]),
  },
  {
    id: "schedule",
    name: "Weekly schedule",
    subtitle: "Calendar",
    build: () =>
      workbook([
        ["Time", "Mon", "Tue", "Wed", "Thu", "Fri"],
        ["9:00", "", "", "", "", ""],
        ["10:00", "", "", "", "", ""],
        ["11:00", "", "", "", "", ""],
      ]),
  },
  {
    id: "expense",
    name: "Expense tracker",
    subtitle: "Finance",
    build: () =>
      workbook([
        ["Date", "Description", "Category", "Amount"],
        ["", "", "", 0],
        ["", "", "Total", "=SUM(D2:D2)"],
      ]),
  },
];
