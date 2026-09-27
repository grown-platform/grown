import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FunctionWizard, fieldsFor, valuesFor } from "./FunctionWizard";
import { findFunction } from "./functionCatalog";

describe("FunctionWizard", () => {
  it("searches, fills arguments, shows the live result and inserts", async () => {
    const evaluate = vi.fn(async (f: string) => (f === "=PMT(0.05/12,60,10000)" ? "-188.71" : "…"));
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(<FunctionWizard open onClose={onClose} evaluate={evaluate} onInsert={onInsert} />);
    fireEvent.change(screen.getByLabelText("Search functions"), { target: { value: "pmt" } });
    fireEvent.click(screen.getByRole("option", { name: "PMT" }));
    expect(screen.getByTestId("function-wizard-syntax")).toHaveTextContent("PMT(rate, nper, pv, [fv], [type])");
    fireEvent.change(screen.getByLabelText("rate"), { target: { value: "0.05/12" } });
    fireEvent.focus(screen.getByLabelText("nper"));
    expect(screen.getByTestId("function-wizard-arg-help")).toHaveTextContent("number of payment periods");
    fireEvent.change(screen.getByLabelText("nper"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("pv"), { target: { value: "10000" } });
    expect(screen.getByTestId("function-wizard-formula")).toHaveTextContent("=PMT(0.05/12,60,10000)");
    await waitFor(() => expect(screen.getByTestId("function-wizard-result")).toHaveTextContent("-188.71"));
    expect(evaluate).toHaveBeenLastCalledWith("=PMT(0.05/12,60,10000)");
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(onInsert).toHaveBeenCalledWith("=PMT(0.05/12,60,10000)");
    expect(onClose).toHaveBeenCalled();
  });

  it("opens on the active cell's call and grows repeated arguments", () => {
    render(<FunctionWizard open onClose={() => {}} initialFormula="=SUM(A1,B2)" evaluate={async () => "3"} onInsert={() => {}} />);
    expect(screen.getByLabelText("number1")).toHaveValue("A1");
    expect(screen.getByLabelText("number2")).toHaveValue("B2");
    fireEvent.change(screen.getByLabelText("number3"), { target: { value: "C3" } });
    expect(screen.getByLabelText("number4")).toHaveValue("");
    expect(screen.getByTestId("function-wizard-formula")).toHaveTextContent("=SUM(A1,B2,C3)");
  });

  it("picks the first match with Enter and filters by category", () => {
    render(<FunctionWizard open onClose={() => {}} evaluate={async () => ""} onInsert={() => {}} />);
    fireEvent.change(screen.getByLabelText("Function category"), { target: { value: "Database" } });
    expect(within(screen.getByRole("listbox", { name: "Functions" })).getAllByRole("option").every((o) => o.textContent?.startsWith("D"))).toBe(true);
    fireEvent.change(screen.getByLabelText("Search functions"), { target: { value: "dsum" } });
    fireEvent.keyDown(screen.getByLabelText("Search functions"), { key: "Enter" });
    expect(screen.getByTestId("function-wizard-syntax")).toHaveTextContent("DSUM(database, field, criteria)");
  });

  it("keeps arguments after a repeating group last", () => {
    const lambda = findFunction("LAMBDA")!;
    const vals = valuesFor(lambda, ["x", "y", "x+y"]);
    expect(vals).toEqual({ parameter1: "x", parameter2: "y", calculation: "x+y" });
    const fields = fieldsFor(lambda, vals);
    expect(fields.map((f) => f.label)).toEqual(["parameter1", "parameter2", "parameter3", "calculation"]);
    expect(fields.filter((f) => f.spare).map((f) => f.label)).toEqual(["parameter3"]);
    const sumifs = findFunction("SUMIFS")!;
    expect(fieldsFor(sumifs, valuesFor(sumifs, ["A:A", "B:B", ">1", "C:C", "x"])).map((f) => f.label)).toEqual([
      "sum_range", "criteria_range1", "criteria1", "criteria_range2", "criteria2", "criteria_range3", "criteria3",
    ]);
  });
});
