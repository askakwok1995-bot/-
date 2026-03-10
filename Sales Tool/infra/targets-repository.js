export function createTargetsRepository({ getAuthContext, createDefaultTargetsPayload, normalizeTargetYearData }) {
  async function fetchTargetsFromCloud() {
    const context = getAuthContext();
    if (!context) {
      return createDefaultTargetsPayload();
    }

    const { client, user } = context;
    const { data, error } = await client
      .from("sales_targets")
      .select("target_year,version,metric_type,year_data,updated_at")
      .eq("user_id", user.id)
      .order("target_year", { ascending: false });

    if (error) {
      throw error;
    }

    const payload = createDefaultTargetsPayload();
    if (!Array.isArray(data)) {
      return payload;
    }

    for (const row of data) {
      const year = Number(row?.target_year);
      if (!Number.isInteger(year)) {
        continue;
      }

      const normalizedYearData = normalizeTargetYearData(
        year,
        row?.year_data && typeof row.year_data === "object" ? row.year_data : {},
      );
      if (typeof row?.updated_at === "string" && !Number.isNaN(Date.parse(row.updated_at))) {
        normalizedYearData.updatedAt = row.updated_at;
      }

      payload.years[String(year)] = normalizedYearData;

      const rowVersion = Number(row?.version);
      if (Number.isInteger(rowVersion) && rowVersion > 0) {
        payload.version = rowVersion;
      }

      const rowMetricType = String(row?.metric_type || "").trim();
      if (rowMetricType) {
        payload.metricType = rowMetricType;
      }
    }

    return payload;
  }

  async function persistTargetsToCloud(targetState) {
    const context = getAuthContext();
    if (!context) {
      throw new Error("未检测到登录用户，无法保存指标。");
    }

    const { client, user } = context;
    const sourceTargets =
      targetState?.targets && typeof targetState.targets === "object"
        ? targetState.targets
        : createDefaultTargetsPayload();

    const sourceYears = sourceTargets.years && typeof sourceTargets.years === "object" ? sourceTargets.years : {};
    const rawVersion = Number(sourceTargets.version);
    const safeVersion = Number.isInteger(rawVersion) && rawVersion > 0 ? rawVersion : 1;
    const safeMetricType = String(createDefaultTargetsPayload().metricType || "dual").trim() || "dual";

    const rows = [];
    for (const [yearKey, yearData] of Object.entries(sourceYears)) {
      const year = Number(yearKey);
      if (!Number.isInteger(year)) {
        continue;
      }

      rows.push({
        user_id: user.id,
        target_year: year,
        version: safeVersion,
        metric_type: safeMetricType,
        year_data: normalizeTargetYearData(year, yearData),
      });
    }

    if (rows.length === 0) {
      return;
    }

    const { error } = await client.from("sales_targets").upsert(rows, { onConflict: "user_id,target_year" });
    if (error) {
      throw error;
    }
  }

  return {
    fetchTargetsFromCloud,
    persistTargetsToCloud,
  };
}
