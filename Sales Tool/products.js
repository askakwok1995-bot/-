export function validateProductInput(state, deps, productName, unitPriceRaw, excludeId = "") {
  if (!productName) return "请填写产品/规格。";
  if (!unitPriceRaw) return "请填写单盒考核价。";

  const unitPriceNum = Number(unitPriceRaw);
  if (!Number.isFinite(unitPriceNum)) return "单盒考核价必须是数字。";
  if (unitPriceNum < 0) return "单盒考核价不能小于 0。";

  const exists = state.products.some(
    (item) => item.id !== excludeId && deps.normalizeText(item.productName) === deps.normalizeText(productName),
  );
  if (exists) return "产品/规格已存在，请勿重复添加。";

  return "";
}

function renderReportsIfAvailable(deps) {
  if (typeof deps.renderReports === "function") {
    deps.renderReports();
  }
}

function renderTargetsIfAvailable(deps) {
  if (typeof deps.renderTargets === "function") {
    deps.renderTargets();
  }
}

export function validateSalesInput(state, data, selectedProduct) {
  if (state.products.length === 0) return "请先维护产品配置。";
  if (!data.date) return "请填写日期。";
  if (!data.productId) return "请选择产品/规格。";
  if (!selectedProduct) return "所选产品不存在，请重新选择。";
  if (!data.hospital) return "请填写医院。";
  if (!data.delivery) return "请填写配送信息。";

  if (!data.quantity) return "请填写采购数量（盒）。";
  const quantityNum = Number(data.quantity);
  if (!Number.isFinite(quantityNum)) return "采购数量必须是数字。";
  if (!Number.isInteger(quantityNum)) return "采购数量必须是整数。";
  if (quantityNum === 0) return "采购数量不能为 0，可填写正负整数。";

  const amount = selectedProduct.unitPrice * quantityNum;
  if (!Number.isFinite(amount)) return "考核金额计算失败，请检查输入。";

  return "";
}

export function renderProductMaster(state, dom, deps) {
  if (state.products.length === 0) {
    state.editingProductId = "";
    dom.productMasterBody.innerHTML = `
      <tr>
        <td colspan="3" class="empty">暂无产品配置</td>
      </tr>
    `;
    return;
  }

  dom.productMasterBody.innerHTML = state.products
    .map((product) => {
      if (product.id === state.editingProductId) {
        return `
        <tr data-editing="true">
          <td>
            <input class="row-edit-input product-edit-name" data-field="productName" type="text" value="${deps.escapeHtml(
              product.productName,
            )}" />
          </td>
          <td>
            <input class="row-edit-input product-edit-price" data-field="unitPrice" type="text" inputmode="decimal" value="${deps.escapeHtml(
              deps.formatMoney(product.unitPrice),
            )}" />
          </td>
          <td>
            <div class="action-group">
              <button class="save-btn save-product-btn" type="button" data-id="${deps.escapeHtml(product.id)}">保存</button>
              <button class="cancel-btn cancel-product-btn" type="button" data-id="${deps.escapeHtml(product.id)}">取消</button>
            </div>
          </td>
        </tr>
      `;
      }

      return `
      <tr>
        <td>${deps.escapeHtml(product.productName)}</td>
        <td>${deps.escapeHtml(deps.formatMoney(product.unitPrice))}</td>
        <td>
          <div class="action-group">
            <button class="edit-btn edit-product-btn" type="button" data-id="${deps.escapeHtml(product.id)}">编辑</button>
            <button class="delete-btn delete-product-btn" type="button" data-id="${deps.escapeHtml(product.id)}">删除</button>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");
}

export function renderProductSelectOptions(state, dom, deps) {
  const current = dom.productSelect.value;
  const options = ['<option value="">请选择产品/规格</option>'].concat(
    state.products.map((product) => `<option value="${deps.escapeHtml(product.id)}">${deps.escapeHtml(product.productName)}</option>`),
  );

  dom.productSelect.innerHTML = options.join("");
  if (current && state.products.some((item) => item.id === current)) {
    dom.productSelect.value = current;
  }
}

export function saveProductInlineEdit(state, dom, deps, id, trigger) {
  const row = trigger.closest("tr");
  if (!(row instanceof HTMLTableRowElement)) return;

  const productName = getProductRowFieldValue(row, "productName");
  const unitPriceRaw = getProductRowFieldValue(row, "unitPrice");
  const validationError = validateProductInput(state, deps, productName, unitPriceRaw, id);
  if (validationError) {
    deps.showProductError(validationError);
    return;
  }

  const targetProduct = state.products.find((item) => item.id === id);
  if (!targetProduct) {
    deps.showProductError("产品不存在，请刷新后重试。");
    return;
  }

  const oldProductName = targetProduct.productName;
  const oldUnitPrice = deps.roundMoney(targetProduct.unitPrice);
  const nextUnitPrice = deps.roundMoney(Number(unitPriceRaw));

  state.products = state.products.map((item) => {
    if (item.id !== id) return item;
    return {
      ...item,
      productName,
      unitPrice: nextUnitPrice,
    };
  });

  let hasRecordUpdates = false;
  if (nextUnitPrice !== oldUnitPrice) {
    state.records = state.records.map((record) => {
      const isLinkedById = record.productId === id;
      const isLegacyLinkedByName =
        !String(record.productId || "").trim() && deps.normalizeText(record.productName) === deps.normalizeText(oldProductName);

      if (!isLinkedById && !isLegacyLinkedByName) {
        return record;
      }

      hasRecordUpdates = true;
      return {
        ...record,
        unitPriceSnapshot: nextUnitPrice,
        amount: deps.roundMoney(nextUnitPrice * record.quantity),
      };
    });
  }

  state.editingProductId = "";
  deps.saveProducts(state);
  if (hasRecordUpdates) {
    deps.saveRecords(state);
  }

  deps.clearProductError();
  deps.clearListError();
  renderProductMaster(state, dom, deps);
  renderProductSelectOptions(state, dom, deps);
  updateSalesFormAvailability(state, dom);
  updateComputedAmount(state, dom, deps);
  deps.renderRecords();
  renderReportsIfAvailable(deps);
  renderTargetsIfAvailable(deps);
}

export function getProductRowFieldValue(row, fieldName) {
  const field = row.querySelector(`[data-field="${fieldName}"]`);
  if (!(field instanceof HTMLInputElement)) return "";
  return String(field.value || "").trim();
}

export function updateSalesFormAvailability(state, dom) {
  const hasProducts = state.products.length > 0;
  dom.productSelect.disabled = !hasProducts;
  dom.salesSubmitBtn.disabled = !hasProducts;
  dom.salesTipEl.textContent = hasProducts ? "" : "请先在上方维护产品规格和单盒考核价。";
}

export function updateComputedAmount(state, dom, deps) {
  const selectedProduct = state.products.find((item) => item.id === dom.productSelect.value);
  const quantityNum = Number(String(dom.quantityInput.value || "").trim());

  if (!selectedProduct || !Number.isInteger(quantityNum) || quantityNum === 0) {
    dom.amountInput.value = "";
    return;
  }

  dom.amountInput.value = deps.formatMoney(deps.roundMoney(selectedProduct.unitPrice * quantityNum));
}

export function bindProductEvents(state, dom, deps) {
  dom.productForm.addEventListener("submit", (event) => {
    event.preventDefault();
    deps.clearProductError();

    const productName = String(dom.productNameInput.value || "").trim();
    const unitPriceRaw = String(dom.unitPriceInput.value || "").trim();

    const validationError = validateProductInput(state, deps, productName, unitPriceRaw);
    if (validationError) {
      deps.showProductError(validationError);
      return;
    }

    const newProduct = {
      id: deps.buildId(),
      productName,
      unitPrice: deps.roundMoney(Number(unitPriceRaw)),
    };

    state.products.unshift(newProduct);
    deps.saveProducts(state);
    renderProductMaster(state, dom, deps);
    renderProductSelectOptions(state, dom, deps);
    updateSalesFormAvailability(state, dom);
    updateComputedAmount(state, dom, deps);
    dom.productForm.reset();
    deps.clearListError();
    deps.renderRecords();
    renderTargetsIfAvailable(deps);
  });

  dom.productMasterBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const id = target.dataset.id;
    if (!id) return;

    deps.clearProductError();

    if (target.classList.contains("edit-product-btn")) {
      state.editingProductId = id;
      state.editingRowId = "";
      renderProductMaster(state, dom, deps);
      deps.renderRecords();
      return;
    }

    if (target.classList.contains("cancel-product-btn")) {
      state.editingProductId = "";
      renderProductMaster(state, dom, deps);
      return;
    }

    if (target.classList.contains("save-product-btn")) {
      saveProductInlineEdit(state, dom, deps, id, target);
      return;
    }

    if (!target.classList.contains("delete-product-btn")) return;
    if (state.editingProductId === id) {
      state.editingProductId = "";
    }

    const usedByRecords = state.records.some((record) => record.productId === id);
    if (usedByRecords) {
      deps.showProductError("已有记录使用该产品，不能删除。");
      return;
    }

    state.products = state.products.filter((item) => item.id !== id);
    deps.saveProducts(state);
    renderProductMaster(state, dom, deps);
    renderProductSelectOptions(state, dom, deps);
    updateSalesFormAvailability(state, dom);
    updateComputedAmount(state, dom, deps);
    deps.clearListError();

    if (state.editingRowId) {
      const editingRecord = state.records.find((item) => item.id === state.editingRowId);
      if (!editingRecord || !state.products.some((item) => item.id === editingRecord.productId)) {
        state.editingRowId = "";
      }
      deps.renderRecords();
    }

    renderTargetsIfAvailable(deps);
  });

  dom.productMasterBody.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;

    const row = target.closest('tr[data-editing="true"]');
    if (!(row instanceof HTMLTableRowElement)) return;

    if (event.key === "Enter") {
      event.preventDefault();
      const saveBtn = row.querySelector(".save-product-btn");
      if (!(saveBtn instanceof HTMLElement)) return;

      const id = saveBtn.dataset.id;
      if (!id) return;

      saveProductInlineEdit(state, dom, deps, id, saveBtn);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      state.editingProductId = "";
      deps.clearProductError();
      renderProductMaster(state, dom, deps);
    }
  });
}
