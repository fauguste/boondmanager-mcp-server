import { describe, it, expect } from "vitest";
import {
  DEFAULT_BASE_URL,
  CHARACTER_LIMIT,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  API_PATHS,
  ENTITY_TABS,
} from "./constants.js";

describe("constants", () => {
  it("DEFAULT_BASE_URL should be a valid URL", () => {
    expect(() => new URL(DEFAULT_BASE_URL)).not.toThrow();
    expect(DEFAULT_BASE_URL).toContain("boondmanager.com");
  });

  it("CHARACTER_LIMIT should be a positive number", () => {
    expect(CHARACTER_LIMIT).toBeGreaterThan(0);
  });

  it("DEFAULT_PAGE_SIZE should be within range", () => {
    expect(DEFAULT_PAGE_SIZE).toBeGreaterThan(0);
    expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });

  it("MAX_PAGE_SIZE should be a positive number", () => {
    expect(MAX_PAGE_SIZE).toBeGreaterThan(0);
  });

  it("API_PATHS should contain all expected domains", () => {
    expect(API_PATHS).toHaveProperty("candidates");
    expect(API_PATHS).toHaveProperty("resources");
    expect(API_PATHS).toHaveProperty("contacts");
    expect(API_PATHS).toHaveProperty("companies");
    expect(API_PATHS).toHaveProperty("opportunities");
    expect(API_PATHS).toHaveProperty("actions");
    expect(API_PATHS).toHaveProperty("projects");
    expect(API_PATHS).toHaveProperty("invoices");
    expect(API_PATHS).toHaveProperty("orders");
    expect(API_PATHS).toHaveProperty("deliveries");
    expect(API_PATHS).toHaveProperty("absences");
    expect(API_PATHS).toHaveProperty("expenses");
    expect(API_PATHS).toHaveProperty("products");
    expect(API_PATHS).toHaveProperty("positionings");
    expect(API_PATHS).toHaveProperty("payments");
    expect(API_PATHS).toHaveProperty("advantages");
    expect(API_PATHS).toHaveProperty("application");
  });

  it("API_PATHS values should start with /", () => {
    for (const path of Object.values(API_PATHS)) {
      expect(path).toMatch(/^\//);
    }
  });

  it("ENTITY_TABS should have tabs for each domain", () => {
    expect(ENTITY_TABS.candidates).toContain("information");
    expect(ENTITY_TABS.candidates).toContain("technical-data");
    expect(ENTITY_TABS.resources).toContain("information");
    expect(ENTITY_TABS.resources).toContain("technical-data");
    expect(ENTITY_TABS.resources).toContain("administrative");
    expect(ENTITY_TABS.contacts).toContain("information");
    expect(ENTITY_TABS.companies).toContain("information");
    expect(ENTITY_TABS.companies).toContain("contacts");
    expect(ENTITY_TABS.opportunities).toContain("information");
    expect(ENTITY_TABS.opportunities).toContain("positionings");
    expect(ENTITY_TABS.projects).toContain("information");
    expect(ENTITY_TABS.projects).toContain("simulation");
    expect(ENTITY_TABS.invoices).toContain("information");
    expect(ENTITY_TABS.orders).toContain("information");
  });
});
