import { describe, it, expect } from "vitest";
import {
  SearchSchema,
  IdSchema,
  IdTabSchema,
  CandidateCreateSchema,
  CandidateUpdateSchema,
  ResourceCreateSchema,
  ResourceUpdateSchema,
  ContactCreateSchema,
  ContactUpdateSchema,
  CompanyCreateSchema,
  CompanyUpdateSchema,
  OpportunityCreateSchema,
  OpportunityUpdateSchema,
  ActionSearchSchema,
  ActionCreateSchema,
  ResourceTimesheetSchema,
  TimesheetSearchSchema,
  TimesheetGetSchema,
  ProjectCreateSchema,
  ProjectUpdateSchema,
  InvoiceCreateSchema,
  InvoiceUpdateSchema,
  InvoiceSearchSchema,
  OrderCreateSchema,
  OrderUpdateSchema,
  OrderSearchSchema,
  DeliverySearchSchema,
  AbsenceCreateSchema,
  AbsenceUpdateSchema,
  AbsenceSearchSchema,
  ExpenseCreateSchema,
  ExpenseUpdateSchema,
  ExpenseSearchSchema,
  ProductCreateSchema,
  ProductUpdateSchema,
  PositioningCreateSchema,
  PositioningSearchSchema,
  PaymentSearchSchema,
  AdvantageSearchSchema,
  DictionaryGetSchema,
} from "./index.js";

describe("SearchSchema", () => {
  it("should accept valid input with all fields", () => {
    const result = SearchSchema.safeParse({ keywords: "react", page: 2, pageSize: 50 });
    expect(result.success).toBe(true);
  });

  it("should apply defaults for page and pageSize", () => {
    const result = SearchSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(30);
  });

  it("should reject pageSize over max", () => {
    const result = SearchSchema.safeParse({ pageSize: 600 });
    expect(result.success).toBe(false);
  });

  it("should reject page < 1", () => {
    const result = SearchSchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  it("should reject extra fields (strict mode)", () => {
    const result = SearchSchema.safeParse({ keywords: "test", unknownField: "x" });
    expect(result.success).toBe(false);
  });
});

describe("IdSchema", () => {
  it("should accept a valid id", () => {
    const result = IdSchema.safeParse({ id: "12345" });
    expect(result.success).toBe(true);
  });

  it("should reject empty id", () => {
    const result = IdSchema.safeParse({ id: "" });
    expect(result.success).toBe(false);
  });

  it("should reject missing id", () => {
    const result = IdSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("IdTabSchema", () => {
  it("should accept id with tab", () => {
    const result = IdTabSchema.safeParse({ id: "123", tab: "information" });
    expect(result.success).toBe(true);
  });

  it("should accept id without tab", () => {
    const result = IdTabSchema.safeParse({ id: "123" });
    expect(result.success).toBe(true);
  });
});

describe("CandidateCreateSchema", () => {
  it("should accept valid candidate", () => {
    const result = CandidateCreateSchema.safeParse({
      firstName: "Jean",
      lastName: "Dupont",
      email1: "jean@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("should require firstName and lastName", () => {
    expect(CandidateCreateSchema.safeParse({ firstName: "Jean" }).success).toBe(false);
    expect(CandidateCreateSchema.safeParse({ lastName: "Dupont" }).success).toBe(false);
  });

  it("should reject invalid email", () => {
    const result = CandidateCreateSchema.safeParse({
      firstName: "Jean",
      lastName: "Dupont",
      email1: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("should accept all optional fields", () => {
    const result = CandidateCreateSchema.safeParse({
      firstName: "Jean",
      lastName: "Dupont",
      email1: "jean@example.com",
      phone1: "0612345678",
      city: "Paris",
      country: "France",
      title: "Developpeur",
      state: 0,
      mainSkills: "React, TypeScript",
      note: "Bon candidat",
    });
    expect(result.success).toBe(true);
  });

  it("should reject unknown fields", () => {
    const result = CandidateCreateSchema.safeParse({
      firstName: "Jean",
      lastName: "Dupont",
      foo: "bar",
    });
    expect(result.success).toBe(false);
  });
});

describe("CandidateUpdateSchema", () => {
  it("should require id", () => {
    const result = CandidateUpdateSchema.safeParse({ firstName: "Jean" });
    expect(result.success).toBe(false);
  });

  it("should accept id with partial fields", () => {
    const result = CandidateUpdateSchema.safeParse({ id: "123", firstName: "Jean" });
    expect(result.success).toBe(true);
  });
});

describe("ResourceCreateSchema", () => {
  it("should accept valid resource", () => {
    const result = ResourceCreateSchema.safeParse({
      firstName: "Marie",
      lastName: "Martin",
    });
    expect(result.success).toBe(true);
  });

  it("should require firstName and lastName", () => {
    expect(ResourceCreateSchema.safeParse({}).success).toBe(false);
  });
});

describe("ResourceUpdateSchema", () => {
  it("should require id", () => {
    expect(ResourceUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("should accept id with optional fields", () => {
    const result = ResourceUpdateSchema.safeParse({ id: "1", title: "Senior Dev" });
    expect(result.success).toBe(true);
  });
});

describe("ContactCreateSchema", () => {
  it("should accept valid contact", () => {
    const result = ContactCreateSchema.safeParse({
      firstName: "Pierre",
      lastName: "Durand",
      companyId: "456",
    });
    expect(result.success).toBe(true);
  });
});

describe("ContactUpdateSchema", () => {
  it("should require id", () => {
    expect(ContactUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("CompanyCreateSchema", () => {
  it("should accept valid company", () => {
    const result = CompanyCreateSchema.safeParse({ name: "Acme Corp" });
    expect(result.success).toBe(true);
  });

  it("should require name", () => {
    expect(CompanyCreateSchema.safeParse({}).success).toBe(false);
  });
});

describe("CompanyUpdateSchema", () => {
  it("should require id", () => {
    expect(CompanyUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("OpportunityCreateSchema", () => {
  it("should accept valid opportunity", () => {
    const result = OpportunityCreateSchema.safeParse({
      name: "Projet Alpha",
      startDate: "2025-01-01",
    });
    expect(result.success).toBe(true);
  });

  it("should require name", () => {
    expect(OpportunityCreateSchema.safeParse({}).success).toBe(false);
  });
});

describe("OpportunityUpdateSchema", () => {
  it("should require id", () => {
    expect(OpportunityUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("ActionSearchSchema", () => {
  it("should accept empty search", () => {
    const result = ActionSearchSchema.parse({});
    expect(result.page).toBe(1);
  });

  it("should accept filters", () => {
    const result = ActionSearchSchema.safeParse({
      candidateId: "1",
      resourceId: "2",
      contactId: "3",
      companyId: "4",
    });
    expect(result.success).toBe(true);
  });
});

describe("ActionCreateSchema", () => {
  it("should accept valid action", () => {
    const result = ActionCreateSchema.safeParse({
      typeOf: "call",
      subject: "Appel de suivi",
    });
    expect(result.success).toBe(true);
  });

  it("should require typeOf", () => {
    expect(ActionCreateSchema.safeParse({}).success).toBe(false);
  });
});

describe("ResourceTimesheetSchema", () => {
  it("should accept resourceId only", () => {
    const result = ResourceTimesheetSchema.safeParse({ resourceId: "123" });
    expect(result.success).toBe(true);
  });

  it("should accept resourceId with month and year", () => {
    const result = ResourceTimesheetSchema.safeParse({
      resourceId: "123",
      month: 6,
      year: 2025,
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid month", () => {
    expect(ResourceTimesheetSchema.safeParse({ resourceId: "1", month: 0 }).success).toBe(false);
    expect(ResourceTimesheetSchema.safeParse({ resourceId: "1", month: 13 }).success).toBe(false);
  });

  it("should reject year before 2000", () => {
    expect(ResourceTimesheetSchema.safeParse({ resourceId: "1", year: 1999 }).success).toBe(false);
  });
});

describe("TimesheetSearchSchema", () => {
  it("should require startMonth and endMonth", () => {
    // The /times-reports endpoint returns 422 when these are missing, so the
    // schema enforces them at the boundary.
    const result = TimesheetSearchSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should accept a YYYY-MM range and apply pagination defaults", () => {
    const result = TimesheetSearchSchema.parse({
      startMonth: "2025-01",
      endMonth: "2025-12",
    });
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(30);
    expect(result.startMonth).toBe("2025-01");
    expect(result.endMonth).toBe("2025-12");
  });

  it("should reject YYYY-MM-DD form", () => {
    const result = TimesheetSearchSchema.safeParse({
      startMonth: "2025-01-01",
      endMonth: "2025-12-31",
    });
    expect(result.success).toBe(false);
  });
});

describe("TimesheetGetSchema", () => {
  it("should accept valid id", () => {
    const result = TimesheetGetSchema.safeParse({ id: "789" });
    expect(result.success).toBe(true);
  });

  it("should reject empty id", () => {
    expect(TimesheetGetSchema.safeParse({ id: "" }).success).toBe(false);
  });
});

describe("ProjectCreateSchema", () => {
  it("should accept valid project", () => {
    const result = ProjectCreateSchema.safeParse({
      name: "Mission Alpha",
      startDate: "2025-01-01",
    });
    expect(result.success).toBe(true);
  });

  it("should require name", () => {
    expect(ProjectCreateSchema.safeParse({}).success).toBe(false);
  });

  it("should accept all optional fields", () => {
    const result = ProjectCreateSchema.safeParse({
      name: "Mission Alpha",
      companyId: "1",
      contactId: "2",
      opportunityId: "3",
      state: 0,
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      note: "Projet stratégique",
    });
    expect(result.success).toBe(true);
  });

  it("should reject unknown fields", () => {
    expect(ProjectCreateSchema.safeParse({ name: "Test", foo: "bar" }).success).toBe(false);
  });
});

describe("ProjectUpdateSchema", () => {
  it("should require id", () => {
    expect(ProjectUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("should accept id with partial fields", () => {
    const result = ProjectUpdateSchema.safeParse({ id: "1", name: "Renamed" });
    expect(result.success).toBe(true);
  });
});

describe("InvoiceCreateSchema", () => {
  it("should accept valid invoice", () => {
    const result = InvoiceCreateSchema.safeParse({
      reference: "FAC-2025-001",
      amountExcludingTax: 5000,
    });
    expect(result.success).toBe(true);
  });

  it("should accept empty invoice (no required fields besides optionals)", () => {
    const result = InvoiceCreateSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("InvoiceUpdateSchema", () => {
  it("should require id", () => {
    expect(InvoiceUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("InvoiceSearchSchema", () => {
  it("should accept empty search with defaults", () => {
    const result = InvoiceSearchSchema.parse({});
    expect(result.page).toBe(1);
  });

  it("should accept filters", () => {
    const result = InvoiceSearchSchema.safeParse({
      companyId: "1",
      projectId: "2",
      startDate: "2025-01-01",
    });
    expect(result.success).toBe(true);
  });
});

describe("OrderCreateSchema", () => {
  it("should accept valid order", () => {
    const result = OrderCreateSchema.safeParse({
      reference: "BC-2025-001",
      amountExcludingTax: 10000,
    });
    expect(result.success).toBe(true);
  });
});

describe("OrderUpdateSchema", () => {
  it("should require id", () => {
    expect(OrderUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("OrderSearchSchema", () => {
  it("should accept empty search with defaults", () => {
    const result = OrderSearchSchema.parse({});
    expect(result.page).toBe(1);
  });
});

describe("DeliverySearchSchema", () => {
  it("should accept empty search with defaults", () => {
    const result = DeliverySearchSchema.parse({});
    expect(result.page).toBe(1);
  });

  it("should accept filters", () => {
    const result = DeliverySearchSchema.safeParse({
      projectId: "1",
      companyId: "2",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    expect(result.success).toBe(true);
  });
});

describe("AbsenceCreateSchema", () => {
  it("should accept valid absence", () => {
    const result = AbsenceCreateSchema.safeParse({
      resourceId: "123",
      typeOf: "congé payé",
      startDate: "2025-08-01",
      endDate: "2025-08-15",
    });
    expect(result.success).toBe(true);
  });

  it("should require resourceId, typeOf, startDate, endDate", () => {
    expect(AbsenceCreateSchema.safeParse({}).success).toBe(false);
    expect(AbsenceCreateSchema.safeParse({ resourceId: "1" }).success).toBe(false);
    expect(AbsenceCreateSchema.safeParse({ resourceId: "1", typeOf: "RTT" }).success).toBe(false);
  });
});

describe("AbsenceUpdateSchema", () => {
  it("should require id", () => {
    expect(AbsenceUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("should accept partial update", () => {
    const result = AbsenceUpdateSchema.safeParse({ id: "1", state: 1 });
    expect(result.success).toBe(true);
  });
});

describe("AbsenceSearchSchema", () => {
  it("should accept empty search with defaults", () => {
    const result = AbsenceSearchSchema.parse({});
    expect(result.page).toBe(1);
  });
});

describe("ExpenseCreateSchema", () => {
  it("should accept valid expense", () => {
    const result = ExpenseCreateSchema.safeParse({
      resourceId: "123",
      expenseDate: "2025-06-15",
      amount: 45.5,
    });
    expect(result.success).toBe(true);
  });

  it("should require resourceId, expenseDate, amount", () => {
    expect(ExpenseCreateSchema.safeParse({}).success).toBe(false);
    expect(ExpenseCreateSchema.safeParse({ resourceId: "1" }).success).toBe(false);
  });
});

describe("ExpenseUpdateSchema", () => {
  it("should require id", () => {
    expect(ExpenseUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("ExpenseSearchSchema", () => {
  it("should accept empty search with defaults", () => {
    const result = ExpenseSearchSchema.parse({});
    expect(result.page).toBe(1);
  });
});

describe("ProductCreateSchema", () => {
  it("should accept valid product", () => {
    const result = ProductCreateSchema.safeParse({
      name: "Prestation Consulting",
      unitPrice: 800,
    });
    expect(result.success).toBe(true);
  });

  it("should require name", () => {
    expect(ProductCreateSchema.safeParse({}).success).toBe(false);
  });
});

describe("ProductUpdateSchema", () => {
  it("should require id", () => {
    expect(ProductUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("should accept partial update", () => {
    const result = ProductUpdateSchema.safeParse({ id: "1", unitPrice: 900 });
    expect(result.success).toBe(true);
  });
});

describe("PositioningCreateSchema", () => {
  it("should accept valid positioning", () => {
    const result = PositioningCreateSchema.safeParse({
      candidateId: "1",
      opportunityId: "2",
      startDate: "2025-03-01",
    });
    expect(result.success).toBe(true);
  });

  it("should accept empty positioning (all fields optional)", () => {
    const result = PositioningCreateSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("PositioningSearchSchema", () => {
  it("should accept empty search with defaults", () => {
    const result = PositioningSearchSchema.parse({});
    expect(result.page).toBe(1);
  });

  it("should accept all filters", () => {
    const result = PositioningSearchSchema.safeParse({
      candidateId: "1",
      resourceId: "2",
      projectId: "3",
      opportunityId: "4",
    });
    expect(result.success).toBe(true);
  });
});

describe("PaymentSearchSchema", () => {
  it("should accept empty search with defaults", () => {
    const result = PaymentSearchSchema.parse({});
    expect(result.page).toBe(1);
  });

  it("should accept filters", () => {
    const result = PaymentSearchSchema.safeParse({
      invoiceId: "1",
      companyId: "2",
    });
    expect(result.success).toBe(true);
  });
});

describe("AdvantageSearchSchema", () => {
  it("should accept empty search with defaults", () => {
    const result = AdvantageSearchSchema.parse({});
    expect(result.page).toBe(1);
  });

  it("should accept resourceId filter", () => {
    const result = AdvantageSearchSchema.safeParse({ resourceId: "123" });
    expect(result.success).toBe(true);
  });
});

describe("DictionaryGetSchema", () => {
  it("should accept valid dictionary type", () => {
    const result = DictionaryGetSchema.safeParse({ dictionaryType: "typeOf/actions" });
    expect(result.success).toBe(true);
  });

  it("should reject empty dictionary type", () => {
    expect(DictionaryGetSchema.safeParse({ dictionaryType: "" }).success).toBe(false);
  });

  it("should reject missing dictionary type", () => {
    expect(DictionaryGetSchema.safeParse({}).success).toBe(false);
  });
});
