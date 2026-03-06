function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseQuantity(value) {
  const num = Number(value);
  return Number.isInteger(num) && num !== 0 ? num : null;
}

function parseAmount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export const RECORD_SORT_FIELD_COLUMN_MAP = {
  date: "record_date",
  productName: "product_name",
  hospital: "hospital_name",
  quantity: "purchase_quantity_boxes",
  amount: "assessed_amount",
  delivery: "channel",
};

export function mapCloudRecordToListModel(row, { products, normalizeText, roundMoney }) {
  if (!row || typeof row !== "object") {
    return null;
  }

  const id = trimString(row.id);
  const date = trimString(row.record_date);
  const hospital = trimString(row.hospital_name);
  const productName = trimString(row.product_name);
  const quantity = parseQuantity(row.purchase_quantity_boxes);
  const amount = parseAmount(row.assessed_amount);
  const channel = trimString(row.channel);
  const delivery = channel || "未填写";

  if (!id || !date || !hospital || !productName) {
    return null;
  }

  const matchedProduct = (Array.isArray(products) ? products : []).find(
    (item) => normalizeText(item.productName) === normalizeText(productName),
  );

  return {
    id,
    date,
    productId: matchedProduct ? matchedProduct.id : "",
    productName,
    unitPriceSnapshot: matchedProduct ? roundMoney(matchedProduct.unitPrice) : null,
    hospital,
    quantity,
    amount: amount === null ? null : roundMoney(amount),
    delivery,
  };
}

export function mapCloudRecordToAnalyticsModel(row, { products, normalizeText, roundMoney }) {
  const mapped = mapCloudRecordToListModel(row, { products, normalizeText, roundMoney });
  if (!mapped) {
    return null;
  }
  if (!Number.isInteger(mapped.quantity) || mapped.quantity === 0) {
    return null;
  }
  if (!Number.isFinite(mapped.amount)) {
    return null;
  }
  return mapped;
}

export const mapCloudRecordToLocal = mapCloudRecordToAnalyticsModel;

export function createRecordsRepository({
  getAuthContext,
  getProducts,
  normalizeText,
  roundMoney,
  defaultPageSize,
  logger = console,
}) {
  function mapListRow(row) {
    return mapCloudRecordToListModel(row, {
      products: typeof getProducts === "function" ? getProducts() : [],
      normalizeText,
      roundMoney,
    });
  }

  function mapAnalyticsRow(row) {
    return mapCloudRecordToAnalyticsModel(row, {
      products: typeof getProducts === "function" ? getProducts() : [],
      normalizeText,
      roundMoney,
    });
  }

  async function fetchRecordsPageFromCloud(query = {}) {
    const context = getAuthContext();
    if (!context) {
      return { items: [], total: 0 };
    }

    const { client, user } = context;
    const safePage = Number.isInteger(Number(query.page)) && Number(query.page) > 0 ? Number(query.page) : 1;
    const safePageSize =
      Number.isInteger(Number(query.pageSize)) && Number(query.pageSize) > 0 ? Number(query.pageSize) : defaultPageSize;
    const safeSortField = trimString(query.sortField);
    const safeSortDirection = trimString(query.sortDirection) === "asc" ? "asc" : "desc";
    const filters = query && typeof query === "object" && query.filters && typeof query.filters === "object" ? query.filters : {};

    let request = client
      .from("sales_records")
      .select("id,record_date,hospital_name,product_name,purchase_quantity_boxes,assessed_amount,channel,created_at", {
        count: "exact",
      })
      .eq("user_id", user.id);

    const startDate = trimString(filters.startDate);
    const endDate = trimString(filters.endDate);
    const productKeyword = trimString(filters.productKeyword);
    const hospitalKeyword = trimString(filters.hospitalKeyword);

    if (startDate) {
      request = request.gte("record_date", startDate);
    }
    if (endDate) {
      request = request.lte("record_date", endDate);
    }
    if (productKeyword) {
      request = request.ilike("product_name", `%${productKeyword}%`);
    }
    if (hospitalKeyword) {
      request = request.ilike("hospital_name", `%${hospitalKeyword}%`);
    }

    const orderColumn = RECORD_SORT_FIELD_COLUMN_MAP[safeSortField];
    if (orderColumn) {
      request = request.order(orderColumn, { ascending: safeSortDirection === "asc" });
      request = request.order("created_at", { ascending: false });
    } else {
      request = request.order("record_date", { ascending: false });
      request = request.order("created_at", { ascending: false });
    }

    const from = (safePage - 1) * safePageSize;
    const to = from + safePageSize - 1;
    request = request.range(from, to);

    const { data, error, count } = await request;
    if (error) {
      throw error;
    }

    const items = Array.isArray(data) ? data.map((item) => mapListRow(item)).filter((item) => item !== null) : [];
    const total = Number.isInteger(Number(count)) && Number(count) >= 0 ? Number(count) : items.length;
    return { items, total };
  }

  async function fetchAllRecordsFromCloud() {
    const context = getAuthContext();
    if (!context) {
      return [];
    }

    const { client, user } = context;
    const { data, error } = await client
      .from("sales_records")
      .select("id,record_date,hospital_name,product_name,purchase_quantity_boxes,assessed_amount,channel,created_at")
      .eq("user_id", user.id)
      .order("record_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    const sourceRows = Array.isArray(data) ? data : [];
    const listRows = sourceRows.map((item) => mapListRow(item)).filter((item) => item !== null);
    const analyticsRows = sourceRows.map((item) => mapAnalyticsRow(item)).filter((item) => item !== null);

    if (listRows.length > analyticsRows.length) {
      logger.warn(
        `[Sales Tool] 存在无法进入报表分析的历史记录：列表可显示 ${listRows.length} 条，报表可分析 ${analyticsRows.length} 条。`,
      );
    }

    return analyticsRows;
  }

  async function fetchRecordsFromCloud() {
    return fetchAllRecordsFromCloud();
  }

  async function insertRecordToCloud(payload) {
    const context = getAuthContext();
    if (!context) {
      throw new Error("未检测到登录用户，无法写入云端。");
    }

    const { client, user } = context;
    const { data, error } = await client
      .from("sales_records")
      .insert({
        user_id: user.id,
        record_date: payload.date,
        hospital_name: payload.hospital,
        product_name: payload.productName,
        purchase_quantity_boxes: payload.quantity,
        assessed_amount: payload.amount,
        actual_amount: null,
        channel: payload.delivery || null,
        remark: null,
      })
      .select("id,record_date,hospital_name,product_name,purchase_quantity_boxes,assessed_amount,channel,created_at")
      .single();

    if (error) {
      throw error;
    }

    const mapped = mapAnalyticsRow(data);
    if (!mapped) {
      throw new Error("云端写入成功，但返回数据格式异常。");
    }
    return mapped;
  }

  async function insertRecordsBatchToCloud(payloads) {
    const context = getAuthContext();
    if (!context) {
      throw new Error("未检测到登录用户，无法批量写入云端。");
    }

    const { client, user } = context;
    const sourceRows = Array.isArray(payloads) ? payloads : [];
    if (sourceRows.length === 0) {
      return { insertedCount: 0 };
    }

    const rows = sourceRows.map((payload) => ({
      user_id: user.id,
      record_date: payload.date,
      hospital_name: payload.hospital,
      product_name: payload.productName,
      purchase_quantity_boxes: payload.quantity,
      assessed_amount: payload.amount,
      actual_amount: null,
      channel: payload.delivery || null,
      remark: null,
    }));

    const { error } = await client.from("sales_records").insert(rows);
    if (error) {
      throw error;
    }

    return { insertedCount: rows.length };
  }

  async function deleteRecordFromCloud(recordId) {
    const context = getAuthContext();
    const normalizedId = trimString(recordId);
    if (!context) {
      throw new Error("未检测到登录用户，无法删除云端记录。");
    }
    if (!normalizedId) {
      return { deletedIds: [] };
    }

    const { client, user } = context;
    const { data, error } = await client
      .from("sales_records")
      .delete()
      .eq("user_id", user.id)
      .eq("id", normalizedId)
      .select("id");

    if (error) {
      throw error;
    }

    return {
      deletedIds: Array.isArray(data) ? data.map((item) => trimString(item?.id)).filter((id) => id) : [],
    };
  }

  async function deleteRecordsFromCloud(recordIds) {
    const context = getAuthContext();
    if (!context) {
      throw new Error("未检测到登录用户，无法批量删除云端记录。");
    }

    const normalizedIds = Array.from(
      new Set((Array.isArray(recordIds) ? recordIds : []).map((id) => trimString(id)).filter((id) => id)),
    );
    if (normalizedIds.length === 0) {
      return { deletedIds: [] };
    }

    const { client, user } = context;
    const { data, error } = await client
      .from("sales_records")
      .delete()
      .eq("user_id", user.id)
      .in("id", normalizedIds)
      .select("id");

    if (error) {
      throw error;
    }

    return {
      deletedIds: Array.isArray(data) ? data.map((item) => trimString(item?.id)).filter((id) => id) : [],
    };
  }

  async function deleteAllRecordsFromCloud() {
    const context = getAuthContext();
    if (!context) {
      throw new Error("未检测到登录用户，无法清空云端记录。");
    }

    const { client, user } = context;
    const { error } = await client.from("sales_records").delete().eq("user_id", user.id);
    if (error) {
      throw error;
    }
  }

  async function updateRecordInCloud(recordId, payload) {
    const context = getAuthContext();
    const normalizedId = trimString(recordId);
    if (!context) {
      throw new Error("未检测到登录用户，无法更新云端记录。");
    }
    if (!normalizedId) {
      return { updatedCount: 0 };
    }

    const { client, user } = context;
    const { data, error } = await client
      .from("sales_records")
      .update({
        record_date: payload.date,
        hospital_name: payload.hospital,
        product_name: payload.productName,
        purchase_quantity_boxes: payload.quantity,
        assessed_amount: payload.amount,
        channel: payload.delivery || null,
      })
      .eq("user_id", user.id)
      .eq("id", normalizedId)
      .select("id");

    if (error) {
      throw error;
    }

    return { updatedCount: Array.isArray(data) ? data.length : 0 };
  }

  return {
    fetchRecordsPageFromCloud,
    fetchAllRecordsFromCloud,
    fetchRecordsFromCloud,
    insertRecordToCloud,
    insertRecordsBatchToCloud,
    deleteRecordFromCloud,
    deleteRecordsFromCloud,
    deleteAllRecordsFromCloud,
    updateRecordInCloud,
  };
}
