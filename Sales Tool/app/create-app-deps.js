export function createAppDeps({ state, dom, repos, ui, shared, feedback }) {
  const deps = {
    ...shared,
    saveProducts: async (targetState = state) => {
      if (state.isWorkspaceReadOnly) {
        return;
      }
      await repos.persistProductsSnapshotToCloud(targetState.products);
    },
    saveRecords: () => {},
    saveTargets: (targetState = state) => {
      if (state.isWorkspaceReadOnly) {
        return;
      }
      void repos
        .persistTargetsToCloud(targetState)
        .then(() => {
          if (!state.targetSyncError) {
            return;
          }
          state.targetSyncError = "";
          if (typeof deps.renderTargets === "function") {
            deps.renderTargets();
          }
        })
        .catch((error) => {
          const message = error instanceof Error && error.message ? error.message : "请稍后重试";
          const nextError = `指标保存失败：${message}`;
          if (state.targetSyncError !== nextError) {
            state.targetSyncError = nextError;
            if (typeof deps.renderTargets === "function") {
              deps.renderTargets();
            }
          }
          console.error("[Sales Tool] 指标保存失败。", error);
        });
    },
    fetchProductsFromCloud: repos.fetchProductsFromCloud,
    insertProductToCloud: repos.insertProductToCloud,
    updateProductInCloud: repos.updateProductInCloud,
    deleteProductFromCloud: repos.deleteProductFromCloud,
    checkProductUsageInCloud: repos.checkProductUsageInCloud,
    repriceRecordsByProductName: repos.repriceRecordsByProductName,
    fetchRecordsPageFromCloud: repos.fetchRecordsPageFromCloud,
    fetchAllRecordsFromCloud: repos.fetchAllRecordsFromCloud,
    fetchRecordsFromCloud: repos.fetchRecordsFromCloud,
    insertRecordToCloud: repos.insertRecordToCloud,
    insertRecordsBatchToCloud: repos.insertRecordsBatchToCloud,
    deleteRecordFromCloud: repos.deleteRecordFromCloud,
    deleteRecordsFromCloud: repos.deleteRecordsFromCloud,
    deleteAllRecordsFromCloud: repos.deleteAllRecordsFromCloud,
    updateRecordInCloud: repos.updateRecordInCloud,
    ...feedback,
  };

  deps.getEffectiveMonthlyTargetMap = (year, metric) => ui.getEffectiveMonthlyTargetMap(state, year, deps, metric);
  deps.getProductMonthlyAllocationMap = (year, metric) => ui.getProductMonthlyAllocationMap(state, year, deps, metric);
  deps.validateSalesInput = (data, selectedProduct) => ui.validateSalesInput(state, data, selectedProduct);
  deps.renderProductMaster = () => ui.renderProductMaster(state, dom, deps);
  deps.renderProductSelectOptions = () => ui.renderProductSelectOptions(state, dom, deps);
  deps.updateSalesFormAvailability = () => ui.updateSalesFormAvailability(state, dom);
  deps.updateComputedAmount = () => ui.updateComputedAmount(state, dom, deps);
  deps.renderRecords = () => ui.renderRecords(state, dom, deps);
  deps.renderTargets = () => ui.renderTargetInputSection(state, dom, deps);
  deps.renderReports = () => {
    const originalRecords = state.records;
    state.records = Array.isArray(state.reportRecords) ? state.reportRecords : [];
    try {
      ui.renderReportSection(state, dom, deps);
    } finally {
      state.records = originalRecords;
    }
  };

  return deps;
}
