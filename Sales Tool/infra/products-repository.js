function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function mapCloudProductToLocal(row, { roundMoney }) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const id = trimString(row.id);
  const productName = trimString(row.product_name);
  const unitPrice = roundMoney(Number(row.unit_price));

  if (!id || !productName || !Number.isFinite(unitPrice) || unitPrice < 0) {
    return null;
  }

  return {
    id,
    productName,
    unitPrice,
  };
}

export function createProductsRepository({ getAuthContext, roundMoney, normalizeText }) {
  async function fetchProductsFromCloud() {
    const context = getAuthContext();
    if (!context) {
      return [];
    }

    const { client, user } = context;
    const { data, error } = await client
      .from("products")
      .select("id,product_name,unit_price,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return Array.isArray(data)
      ? data.map((item) => mapCloudProductToLocal(item, { roundMoney })).filter((item) => item !== null)
      : [];
  }

  async function insertProductToCloud(payload) {
    const context = getAuthContext();
    if (!context) {
      throw new Error("未检测到登录用户，无法写入产品。");
    }

    const { client, user } = context;
    const product = {
      id: trimString(payload?.id),
      productName: trimString(payload?.productName),
      unitPrice: roundMoney(Number(payload?.unitPrice)),
    };

    if (!product.id || !product.productName || !Number.isFinite(product.unitPrice) || product.unitPrice < 0) {
      throw new Error("产品数据格式不正确。");
    }

    const { data, error } = await client
      .from("products")
      .insert({
        id: product.id,
        user_id: user.id,
        product_name: product.productName,
        unit_price: product.unitPrice,
      })
      .select("id,product_name,unit_price,created_at")
      .single();

    if (error) {
      throw error;
    }

    const mapped = mapCloudProductToLocal(data, { roundMoney });
    if (!mapped) {
      throw new Error("产品写入成功，但返回数据格式异常。");
    }

    return mapped;
  }

  async function updateProductInCloud(productId, payload) {
    const context = getAuthContext();
    const normalizedId = trimString(productId);
    if (!context) {
      throw new Error("未检测到登录用户，无法更新产品。");
    }
    if (!normalizedId) {
      throw new Error("产品 ID 不能为空。");
    }

    const { client, user } = context;
    const nextProductName = trimString(payload?.productName);
    const nextUnitPrice = roundMoney(Number(payload?.unitPrice));
    if (!nextProductName || !Number.isFinite(nextUnitPrice) || nextUnitPrice < 0) {
      throw new Error("产品更新参数不正确。");
    }

    const { data, error } = await client
      .from("products")
      .update({
        product_name: nextProductName,
        unit_price: nextUnitPrice,
      })
      .eq("user_id", user.id)
      .eq("id", normalizedId)
      .select("id,product_name,unit_price,created_at");

    if (error) {
      throw error;
    }

    return { updatedCount: Array.isArray(data) ? data.length : 0 };
  }

  async function deleteProductFromCloud(productId) {
    const context = getAuthContext();
    const normalizedId = trimString(productId);
    if (!context) {
      throw new Error("未检测到登录用户，无法删除产品。");
    }
    if (!normalizedId) {
      return { deletedCount: 0 };
    }

    const { client, user } = context;
    const { data, error } = await client
      .from("products")
      .delete()
      .eq("user_id", user.id)
      .eq("id", normalizedId)
      .select("id");

    if (error) {
      throw error;
    }

    return { deletedCount: Array.isArray(data) ? data.length : 0 };
  }

  async function persistProductsSnapshotToCloud(productsSnapshot) {
    const context = getAuthContext();
    if (!context) {
      throw new Error("未检测到登录用户，无法同步产品。");
    }

    const { client, user } = context;
    const uniqueProducts = new Map();
    for (const item of Array.isArray(productsSnapshot) ? productsSnapshot : []) {
      const id = trimString(item?.id);
      const productName = trimString(item?.productName);
      const unitPrice = roundMoney(Number(item?.unitPrice));
      if (!id || !productName || !Number.isFinite(unitPrice) || unitPrice < 0) {
        continue;
      }
      if (!uniqueProducts.has(id)) {
        uniqueProducts.set(id, { id, productName, unitPrice });
      }
    }

    const payload = Array.from(uniqueProducts.values()).map((product) => ({
      id: product.id,
      user_id: user.id,
      product_name: product.productName,
      unit_price: product.unitPrice,
    }));

    if (payload.length > 0) {
      const { error } = await client.from("products").upsert(payload, { onConflict: "id" });
      if (error) {
        throw error;
      }
    }
  }

  async function checkProductUsageInCloud(productName) {
    const context = getAuthContext();
    const safeProductName = trimString(productName);
    if (!context || !safeProductName) {
      return false;
    }

    const { client, user } = context;
    const { count, error } = await client
      .from("sales_records")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("product_name", safeProductName);
    if (error) {
      throw error;
    }
    return Number(count) > 0;
  }

  async function repriceRecordsByProductName(oldProductName, newUnitPrice) {
    const context = getAuthContext();
    if (!context) {
      throw new Error("未检测到登录用户，无法同步历史记录金额。");
    }

    const { client, user } = context;
    const normalizedName = normalizeText(oldProductName);
    const safeUnitPrice = roundMoney(Number(newUnitPrice));
    if (!normalizedName || !Number.isFinite(safeUnitPrice) || safeUnitPrice < 0) {
      return { updatedCount: 0 };
    }

    const { data, error } = await client
      .from("sales_records")
      .select("id,product_name,purchase_quantity_boxes")
      .eq("user_id", user.id);

    if (error) {
      throw error;
    }

    const targetRows = Array.isArray(data)
      ? data.filter((row) => normalizeText(row?.product_name) === normalizedName)
      : [];

    if (targetRows.length === 0) {
      return { updatedCount: 0 };
    }

    const updateResults = await Promise.all(
      targetRows.map(async (row) => {
        const quantity = Number(row?.purchase_quantity_boxes);
        if (!Number.isInteger(quantity) || quantity === 0) {
          return null;
        }

        const amount = roundMoney(safeUnitPrice * quantity);
        const { data: updatedData, error: updateError } = await client
          .from("sales_records")
          .update({ assessed_amount: amount })
          .eq("user_id", user.id)
          .eq("id", trimString(row.id))
          .select("id");

        if (updateError) {
          throw updateError;
        }

        return Array.isArray(updatedData) ? updatedData.length : 0;
      }),
    );

    const updatedCount = updateResults.reduce((sum, count) => sum + (Number(count) || 0), 0);
    return { updatedCount };
  }

  return {
    fetchProductsFromCloud,
    insertProductToCloud,
    updateProductInCloud,
    deleteProductFromCloud,
    persistProductsSnapshotToCloud,
    checkProductUsageInCloud,
    repriceRecordsByProductName,
  };
}
