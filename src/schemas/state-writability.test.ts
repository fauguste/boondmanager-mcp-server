import { describe, it, expect } from "vitest";
import {
  AbsenceCreateSchema,
  AbsenceUpdateSchema,
  ExpenseCreateSchema,
  ExpenseUpdateSchema,
  InvoiceCreateSchema,
  InvoiceUpdateSchema,
  OrderCreateSchema,
  OrderUpdateSchema,
  PositioningCreateSchema,
  PositioningUpdateSchema,
  TimesheetCreateSchema,
  TimesheetUpdateSchema,
  DeliveryCreateSchema,
  DeliveryUpdateSchema,
  PaymentCreateSchema,
  PaymentUpdateSchema,
  ProviderInvoiceCreateSchema,
  ProviderInvoiceUpdateSchema,
  PurchaseCreateSchema,
  PurchaseUpdateSchema,
} from "./index.js";

type Shape = { shape: Record<string, unknown> };

/**
 * Truth table for `state` on the write schemas (issue #250).
 *
 * A write schema exposes `state` only where the API persists it. Where the
 * state is moved by the validation workflow the field is absent: exposing it
 * advertised a transition the endpoint does not perform, and the model then
 * reported "absence validée" while nothing had changed.
 *
 * `verified` says how each row was established. Rows marked `read` were
 * checked by reading the live API on 2026-09-25 (the tenant is production,
 * so writes were not exercised): on `/absences-reports` and `/times-reports`
 * `state` is a workflow *string* (`waitingForValidation`, `validated`) —
 * an integer `state` cannot be what the API stores, and the same
 * `validations` workflow covers the three document types. `/expenses-reports`
 * was verified on write in #179. Invoices, orders and positionings carry a
 * dictionary integer (`setting.state.{invoice,order,positioning}`); the
 * positionings RAML documents a `won` state on POST attaching a project, so
 * the field is honoured there; invoices and orders keep it typed as a
 * dictionary id but their write path is not verified.
 */
const TABLE: ReadonlyArray<{
  entity: string;
  create: Shape;
  update: Shape;
  writable: boolean;
  verified: string;
}> = [
  {
    entity: "expensesReport",
    create: ExpenseCreateSchema,
    update: ExpenseUpdateSchema,
    writable: false,
    verified: "write, 2026-08 (#179): accepted then ignored on POST and PUT",
  },
  {
    entity: "absencesReport",
    create: AbsenceCreateSchema,
    update: AbsenceUpdateSchema,
    writable: false,
    verified: "read, 2026-09-25: workflow string `waitingForValidation`, not a dictionary id",
  },
  {
    entity: "timesReport",
    create: TimesheetCreateSchema,
    update: TimesheetUpdateSchema,
    writable: false,
    verified: "read, 2026-09-25: workflow string `validated`",
  },
  {
    entity: "invoice",
    create: InvoiceCreateSchema,
    update: InvoiceUpdateSchema,
    writable: true,
    verified: "read, 2026-09-25: integer of setting.state.invoice — write path NOT verified",
  },
  {
    entity: "order",
    create: OrderCreateSchema,
    update: OrderUpdateSchema,
    writable: true,
    verified: "read, 2026-09-25: integer of setting.state.order — write path NOT verified",
  },
  // Issue #252: the finance / delivery entities keep a dictionary state
  // (`setting.state.{delivery,payment,providerinvoice,purchase}` all exist,
  // read 2026-09-26); `stateField` replaced the bare `z.number()` they had.
  {
    entity: "delivery",
    create: DeliveryCreateSchema,
    update: DeliveryUpdateSchema,
    writable: true,
    verified: "read, 2026-09-26: integer of setting.state.delivery — write path NOT verified",
  },
  {
    entity: "payment",
    create: PaymentCreateSchema,
    update: PaymentUpdateSchema,
    writable: true,
    verified: "read, 2026-09-26: integer of setting.state.payment — write path NOT verified",
  },
  {
    entity: "providerinvoice",
    create: ProviderInvoiceCreateSchema,
    update: ProviderInvoiceUpdateSchema,
    writable: true,
    verified: "read, 2026-09-26: integer of setting.state.providerinvoice — write path NOT verified",
  },
  {
    entity: "purchase",
    create: PurchaseCreateSchema,
    update: PurchaseUpdateSchema,
    writable: true,
    verified: "read, 2026-09-26: integer of setting.state.purchase — write path NOT verified",
  },
  {
    entity: "positioning",
    create: PositioningCreateSchema,
    update: PositioningUpdateSchema,
    writable: true,
    verified: "RAML: POST state `won` attaches a project; integer of setting.state.positioning",
  },
];

describe("`state` on write schemas — truth table (#250)", () => {
  for (const row of TABLE) {
    it(`${row.entity}: state ${row.writable ? "exposed as a dictionary id" : "absent (validation workflow)"} — ${row.verified}`, () => {
      expect("state" in row.create.shape, "create").toBe(row.writable);
      expect("state" in row.update.shape, "update").toBe(row.writable);
      if (row.writable) {
        // Dictionary id: a number (or a label resolved through the overrides), never a bare string.
        const parsed = row.update.shape.state as { safeParse: (v: unknown) => { success: boolean } };
        expect(parsed.safeParse(3).success).toBe(true);
        expect(parsed.safeParse("validated").success).toBe(false);
      }
    });
  }
});
