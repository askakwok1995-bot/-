import { buildReportSnapshot } from "../domain/report-snapshot.js";

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createEmptyBusinessSnapshot() {
  return {
    analysis_range: {
      start_month: "",
      end_month: "",
      period: "",
    },
    performance_overview: {
      sales_amount: "--",
      sales_amount_value: null,
      amount_achievement: "--",
      amount_achievement_ratio: null,
      latest_key_change: "--",
      latest_key_change_ratio: null,
      latest_key_change_code: "unknown",
      sales_volume: "--",
      sales_volume_value: null,
    },
    key_business_signals: [],
    product_performance: [],
    hospital_performance: [],
    recent_trends: [],
    risk_alerts: [],
    opportunity_hints: [],
  };
}


function isValidYm(value) {
  const matched = trimString(value).match(/^(\d{4})-(\d{2})$/);
  if (!matched) return false;
  const month = Number(matched[2]);
  return Number.isInteger(month) && month >= 1 && month <= 12;
}

function normalizeNumericValue(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatAmountWanText(value) {
  const amount = normalizeNumericValue(value);
  if (amount === null) return "--";
  return `${(amount / 10000).toFixed(2)}万元`;
}

function formatPercentText(ratio) {
  const value = normalizeNumericValue(ratio);
  if (value === null) return "--";
  return `${(value * 100).toFixed(2)}%`;
}

function formatDeltaPercentText(ratio) {
  const value = normalizeNumericValue(ratio);
  if (value === null) return "--";
  const percentText = `${(Math.abs(value) * 100).toFixed(2)}%`;
  if (value > 0) return `+${percentText}`;
  if (value < 0) return `-${percentText}`;
  return "0.00%";
}

function formatQuantityBoxText(value, deps) {
  const quantity = normalizeNumericValue(value);
  if (quantity === null) return "--";
  return `${deps.formatMoney(deps.roundMoney(quantity))}盒`;
}

function calcGrowthRatio(current, baseline) {
  const currentValue = Number(current);
  const baselineValue = Number(baseline);
  if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue) || baselineValue === 0) {
    return null;
  }
  return Math.round((((currentValue - baselineValue) / Math.abs(baselineValue)) + Number.EPSILON) * 10000) / 10000;
}

function parseProductCodeFromKey(productKey) {
  const key = trimString(productKey);
  return key.startsWith("id:") ? trimString(key.slice(3)) : "";
}

function buildSnapshotProductKey(record, deps) {
  const productId = trimString(record?.productId);
  if (productId) return `id:${productId}`;
  return `name:${deps.normalizeText(record?.productName)}`;
}

function parseYmFromRecordDate(rawDate, deps) {
  const value = trimString(rawDate);
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return "";
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (!deps.isValidDateParts(year, month, day)) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function buildProductAmountMomRatioMap(records, latestYm, previousYm, deps) {
  const ratioMap = new Map();
  if (!Array.isArray(records) || records.length === 0) return ratioMap;
  if (!isValidYm(latestYm) || !isValidYm(previousYm)) return ratioMap;

  const totalsMap = new Map();
  records.forEach((record) => {
    const ym = parseYmFromRecordDate(record?.date, deps);
    if (ym !== latestYm && ym !== previousYm) return;

    const amount = normalizeNumericValue(record?.amount);
    if (amount === null) return;

    const productKey = buildSnapshotProductKey(record, deps);
    if (!productKey) return;

    const previous = totalsMap.get(productKey) || { latestAmount: 0, previousAmount: 0 };
    if (ym === latestYm) {
      previous.latestAmount += amount;
    } else {
      previous.previousAmount += amount;
    }
    totalsMap.set(productKey, previous);
  });

  totalsMap.forEach((totals, productKey) => {
    const latestAmount = deps.roundMoney(totals.latestAmount);
    const previousAmount = deps.roundMoney(totals.previousAmount);
    ratioMap.set(productKey, calcGrowthRatio(latestAmount, previousAmount));
  });

  return ratioMap;
}

function resolveProductChangeMeta(row, productMomRatioMap) {
  const yoyRatio = normalizeNumericValue(row?.amountYoy);
  if (yoyRatio !== null) {
    return {
      changeMetric: "金额同比",
      changeMetricCode: "amount_yoy",
      changeValue: formatDeltaPercentText(yoyRatio),
      changeValueRatio: yoyRatio,
    };
  }

  const productKey = trimString(row?.productKey);
  const momRatio = productKey ? normalizeNumericValue(productMomRatioMap.get(productKey)) : null;
  if (momRatio !== null) {
    return {
      changeMetric: "金额环比",
      changeMetricCode: "amount_mom",
      changeValue: formatDeltaPercentText(momRatio),
      changeValueRatio: momRatio,
    };
  }

  return {
    changeMetric: "变化值",
    changeMetricCode: "unknown",
    changeValue: "--",
    changeValueRatio: null,
  };
}

export function buildBusinessSnapshotPayload(state, deps) {
  const snapshot = createEmptyBusinessSnapshot();
  const startYm = trimString(state?.reportStartYm);
  const endYm = trimString(state?.reportEndYm);
  const hasValidRange = isValidYm(startYm) && isValidYm(endYm) && startYm <= endYm;

  snapshot.analysis_range = {
    start_month: startYm,
    end_month: endYm,
    period: hasValidRange ? `${startYm}~${endYm}` : "--",
  };

  if (!hasValidRange) {
    return snapshot;
  }

  const reportRecords = Array.isArray(state?.reportRecords) ? state.reportRecords : [];
  const reportSnapshot = buildReportSnapshot({ records: reportRecords }, deps, { startYm, endYm });
  const monthRows = Array.isArray(reportSnapshot?.monthRows) ? reportSnapshot.monthRows : [];
  const productRows = Array.isArray(reportSnapshot?.productRows) ? reportSnapshot.productRows : [];

  let totalAmount = 0;
  let totalQuantity = 0;
  let targetAmountSum = 0;
  let hasMissingTarget = false;

  monthRows.forEach((row) => {
    const amount = Number(row?.amount);
    const quantity = Number(row?.quantity);
    const targetAmount = Number(row?.targetAmount);
    if (Number.isFinite(amount)) totalAmount += amount;
    if (Number.isFinite(quantity)) totalQuantity += quantity;
    if (Number.isFinite(targetAmount)) {
      targetAmountSum += targetAmount;
    } else {
      hasMissingTarget = true;
    }
  });

  totalAmount = deps.roundMoney(totalAmount);
  totalQuantity = deps.roundMoney(totalQuantity);
  targetAmountSum = deps.roundMoney(targetAmountSum);

  const latestMonthRow = monthRows.length > 0 ? monthRows[monthRows.length - 1] : null;
  let latestKeyChange = "--";
  let latestKeyChangeCode = "unknown";
  let latestKeyChangeRatio = null;
  if (latestMonthRow && Number.isFinite(Number(latestMonthRow.amountMom))) {
    latestKeyChangeCode = "amount_mom";
    latestKeyChangeRatio = Number(latestMonthRow.amountMom);
    latestKeyChange = `最近月金额环比 ${formatDeltaPercentText(latestKeyChangeRatio)}`;
  } else if (latestMonthRow && Number.isFinite(Number(latestMonthRow.amountYoy))) {
    latestKeyChangeCode = "amount_yoy";
    latestKeyChangeRatio = Number(latestMonthRow.amountYoy);
    latestKeyChange = `最近月金额同比 ${formatDeltaPercentText(latestKeyChangeRatio)}`;
  }

  const achievementRatio = !hasMissingTarget && targetAmountSum > 0 ? totalAmount / targetAmountSum : null;
  snapshot.performance_overview = {
    sales_amount: formatAmountWanText(totalAmount),
    sales_amount_value: totalAmount,
    amount_achievement: achievementRatio === null ? "--" : formatPercentText(achievementRatio),
    amount_achievement_ratio: achievementRatio,
    latest_key_change: latestKeyChange,
    latest_key_change_ratio: latestKeyChangeRatio,
    latest_key_change_code: latestKeyChangeCode,
    sales_volume: formatQuantityBoxText(totalQuantity, deps),
    sales_volume_value: totalQuantity,
  };

  const keySignals = [];
  if (latestMonthRow) {
    const latestPeriod = trimString(latestMonthRow.ym) || "最近月";
    if (Number.isFinite(Number(latestMonthRow.amountMom))) {
      const mom = Number(latestMonthRow.amountMom);
      const trend = mom > 0 ? "上升" : mom < 0 ? "下降" : "持平";
      keySignals.push(`最近月（${latestPeriod}）销售额较上月${trend}，变动${formatDeltaPercentText(mom)}。`);
    } else if (Number.isFinite(Number(latestMonthRow.amountYoy))) {
      const yoy = Number(latestMonthRow.amountYoy);
      const trend = yoy > 0 ? "上升" : yoy < 0 ? "下降" : "持平";
      keySignals.push(`最近月（${latestPeriod}）销售额同比${trend}，变动${formatDeltaPercentText(yoy)}。`);
    }
  }

  const topProduct = productRows.length > 0 ? productRows[0] : null;
  if (topProduct) {
    const topProductName = trimString(topProduct.productName) || "未命名产品";
    keySignals.push(
      `Top1产品${topProductName}贡献销售额${formatAmountWanText(topProduct.amount)}，占比${formatPercentText(topProduct.amountShare)}。`,
    );
  }
  snapshot.key_business_signals = keySignals.slice(0, 2);

  const latestTrendPeriod = trimString(monthRows[monthRows.length - 1]?.ym);
  const previousTrendPeriod = trimString(monthRows[monthRows.length - 2]?.ym);
  const productMomRatioMap = buildProductAmountMomRatioMap(reportRecords, latestTrendPeriod, previousTrendPeriod, deps);
  snapshot.product_performance = productRows.slice(0, 2).map((row) => {
    const changeMeta = resolveProductChangeMeta(row, productMomRatioMap);
    const salesAmountValue = normalizeNumericValue(row?.amount);
    const salesShareRatio = normalizeNumericValue(row?.amountShare);
    return {
      product_name: trimString(row?.productName) || "未命名产品",
      product_code: parseProductCodeFromKey(row?.productKey),
      sales_amount: formatAmountWanText(salesAmountValue),
      sales_amount_value: salesAmountValue,
      sales_share: formatPercentText(salesShareRatio),
      sales_share_ratio: salesShareRatio,
      change_metric: changeMeta.changeMetric,
      change_metric_code: changeMeta.changeMetricCode,
      change_value: changeMeta.changeValue,
      change_value_ratio: changeMeta.changeValueRatio,
    };
  });

  const productCatalogCount = Array.isArray(state?.products) ? state.products.length : 0;
  const productSnapshotCount = snapshot.product_performance.length;
  let productCoverageCode = "none";
  if (productCatalogCount > 0 && productSnapshotCount >= productCatalogCount) {
    productCoverageCode = "full";
  } else if (productSnapshotCount > 0) {
    productCoverageCode = "partial";
  }
  snapshot.performance_overview.product_catalog_count_value = productCatalogCount;
  snapshot.performance_overview.product_snapshot_count_value = productSnapshotCount;
  snapshot.performance_overview.product_coverage_code = productCoverageCode;

  snapshot.recent_trends = monthRows.slice(-3).map((row) => ({
    period: trimString(row?.ym),
    sales_amount: formatAmountWanText(row?.amount),
    sales_amount_value: normalizeNumericValue(row?.amount),
    amount_mom: formatDeltaPercentText(row?.amountMom),
    amount_mom_ratio: normalizeNumericValue(row?.amountMom),
    sales_volume: formatQuantityBoxText(row?.quantity, deps),
    sales_volume_value: normalizeNumericValue(row?.quantity),
  }));

  return snapshot;
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

function normalizeChatApiError(response, payload) {
  const status = Number(response?.status);
  const serverMessage = trimString(payload?.error?.message);
  if (serverMessage) return serverMessage;
  if (status === 401) return "登录状态已失效，请重新登录后再试。";
  if (status === 404) return "未找到 /api/chat。请确认已部署 Cloudflare Pages Functions。";
  if (status === 429) return "聊天请求过于频繁，请稍后重试。";
  if (Number.isFinite(status) && status >= 500) return "聊天服务暂时不可用，请稍后重试。";
  return "聊天请求失败，请稍后重试。";
}

export function createChatReplyRequester({ getAccessToken, getBusinessSnapshot, fetchImpl = globalThis.fetch } = {}) {
  return async function requestAiChatReply(message, options = {}) {
    const safeMessage = trimString(message);
    if (!safeMessage) {
      throw new Error("消息不能为空。");
    }

    const accessToken = typeof getAccessToken === "function" ? await getAccessToken() : "";
    if (!accessToken) {
      throw new Error("登录状态已失效，请重新登录后再试。");
    }

    const requestBody = {
      message: safeMessage,
      history: Array.isArray(options?.history) ? options.history : [],
      business_snapshot: typeof getBusinessSnapshot === "function" ? getBusinessSnapshot() : createEmptyBusinessSnapshot(),
      conversation_state:
        options?.conversationState && typeof options.conversationState === "object" ? options.conversationState : null,
    };

    let response;
    try {
      response = await fetchImpl("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      throw new Error(`无法连接 /api/chat：${error instanceof Error ? error.message : "请稍后重试"}`);
    }

    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw new Error(normalizeChatApiError(response, payload));
    }

    const reply = trimString(payload?.reply || payload?.surfaceReply);
    if (!reply) {
      throw new Error("聊天服务未返回有效回复，请稍后重试。");
    }

    return {
      reply,
      surfaceReply: reply,
      responseAction: trimString(payload?.responseAction) || "natural_answer",
      businessIntent: trimString(payload?.businessIntent) || "chat",
      mode: trimString(payload?.mode) || "auto",
      format: trimString(payload?.format),
      structured: payload?.structured && typeof payload.structured === "object" ? payload.structured : null,
      answer: payload?.answer && typeof payload.answer === "object" ? payload.answer : null,
      model: trimString(payload?.model),
      requestId: trimString(payload?.requestId || response.headers.get("x-request-id")),
    };
  };
}
