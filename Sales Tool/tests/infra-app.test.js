import assert from "node:assert/strict";
import test from "node:test";

import { createAppDeps } from "../app/create-app-deps.js";
import { mapCloudProductToLocal } from "../infra/products-repository.js";
import { mapCloudRecordToLocal } from "../infra/records-repository.js";

test("mapCloudProductToLocal maps valid cloud row to local model", () => {
  const mapped = mapCloudProductToLocal(
    {
      id: "p1",
      product_name: "诺和盈1mg",
      unit_price: "123.456",
    },
    {
      roundMoney: (value) => Math.round(value * 100) / 100,
    },
  );

  assert.deepEqual(mapped, {
    id: "p1",
    productName: "诺和盈1mg",
    unitPrice: 123.46,
  });
});

test("mapCloudRecordToLocal resolves productId from injected products", () => {
  const mapped = mapCloudRecordToLocal(
    {
      id: "r1",
      record_date: "2026-03-01",
      hospital_name: "广州华美",
      product_name: "诺和盈1mg",
      purchase_quantity_boxes: 12,
      assessed_amount: 1200,
      channel: "院内",
    },
    {
      products: [{ id: "p1", productName: "诺和盈1mg", unitPrice: 100 }],
      normalizeText: (value) => String(value || "").trim().toLowerCase(),
      roundMoney: (value) => Math.round(value * 100) / 100,
    },
  );

  assert.equal(mapped?.productId, "p1");
  assert.equal(mapped?.productName, "诺和盈1mg");
  assert.equal(mapped?.quantity, 12);
});

test("createAppDeps preserves repository contract and UI wrappers", async () => {
  const calls = [];
  const state = {
    records: [{ id: "r1" }],
    reportRecords: [{ id: "rr1" }],
    targetSyncError: "",
  };
  const dom = { marker: true };
  const repos = {
    fetchProductsFromCloud: async () => [],
    insertProductToCloud: async () => null,
    updateProductInCloud: async () => ({ updatedCount: 0 }),
    deleteProductFromCloud: async () => ({ deletedCount: 0 }),
    checkProductUsageInCloud: async () => false,
    repriceRecordsByProductName: async () => ({ updatedCount: 0 }),
    fetchRecordsPageFromCloud: async () => ({ items: [], total: 0 }),
    fetchAllRecordsFromCloud: async () => [],
    fetchRecordsFromCloud: async () => [],
    insertRecordToCloud: async () => null,
    insertRecordsBatchToCloud: async () => ({ insertedCount: 0 }),
    deleteRecordFromCloud: async () => ({ deletedIds: [] }),
    deleteRecordsFromCloud: async () => ({ deletedIds: [] }),
    deleteAllRecordsFromCloud: async () => undefined,
    updateRecordInCloud: async () => ({ updatedCount: 0 }),
    persistProductsSnapshotToCloud: async () => undefined,
    persistTargetsToCloud: async () => undefined,
  };
  const ui = {
    validateSalesInput: (nextState, data, selectedProduct) => {
      calls.push(["validateSalesInput", nextState === state, data, selectedProduct]);
      return { valid: true };
    },
    renderProductMaster: (nextState, nextDom) => calls.push(["renderProductMaster", nextState === state, nextDom === dom]),
    renderProductSelectOptions: () => calls.push(["renderProductSelectOptions"]),
    updateSalesFormAvailability: () => calls.push(["updateSalesFormAvailability"]),
    updateComputedAmount: () => calls.push(["updateComputedAmount"]),
    renderRecords: () => calls.push(["renderRecords"]),
    renderTargetInputSection: () => calls.push(["renderTargetInputSection"]),
    renderReportSection: (nextState) => calls.push(["renderReportSection", nextState.records.map((item) => item.id).join(",")]),
    getEffectiveMonthlyTargetMap: () => ({ "2026-01": 10 }),
    getProductMonthlyAllocationMap: () => ({ p1: 1 }),
  };
  const shared = {
    TARGET_QUARTERS: ["Q1"],
    createDefaultTargetYear: () => ({}),
    normalizeTargetYearData: () => ({}),
    normalizeTargetNumber: (value) => value,
    buildId: () => "id",
    normalizeText: (value) => String(value || "").trim(),
    roundMoney: (value) => value,
    formatMoney: (value) => value,
    formatDate: (value) => value,
    isValidDateParts: () => true,
    escapeHtml: (value) => value,
    loadSalesDraft: () => null,
    saveSalesDraft: () => undefined,
    saveReportRange: () => undefined,
    saveReportChartPalette: () => undefined,
    saveReportChartDataLabelMode: () => undefined,
    saveReportAmountUnit: () => undefined,
    clearSalesDraft: () => undefined,
  };
  const feedback = {
    showProductError: () => undefined,
    clearProductError: () => undefined,
    showSalesError: () => undefined,
    clearSalesError: () => undefined,
    showSalesTip: () => undefined,
    clearSalesTip: () => undefined,
    showListError: () => undefined,
    clearListError: () => undefined,
    showListStatus: () => undefined,
    clearListStatus: () => undefined,
  };

  const deps = createAppDeps({ state, dom, repos, ui, shared, feedback });

  assert.equal(deps.fetchProductsFromCloud, repos.fetchProductsFromCloud);
  assert.equal(typeof deps.saveTargets, "function");
  assert.equal(typeof deps.renderReports, "function");
  assert.equal(typeof deps.validateSalesInput, "function");

  deps.validateSalesInput({ amount: 100 }, { id: "p1" });
  deps.renderReports();
  await deps.saveTargets(state);

  assert.deepEqual(calls[0], ["validateSalesInput", true, { amount: 100 }, { id: "p1" }]);
  assert.deepEqual(calls[1], ["renderReportSection", "rr1"]);
  assert.equal(state.records[0].id, "r1");
});
