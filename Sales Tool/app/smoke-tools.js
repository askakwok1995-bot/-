export async function runReadOnlyRecordsCountCheck({ getAuthContext, logger = console }) {
  const context = getAuthContext();
  if (!context) {
    logger.error("[Sales Tool] Supabase 只读验证失败：未获取到登录用户或 client。");
    return;
  }

  try {
    const { client, user } = context;
    const { count, error } = await client
      .from("sales_records")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (error) {
      logger.error("[Sales Tool] Supabase 只读验证失败：", error);
      return;
    }

    logger.info(`[Sales Tool] Supabase 只读验证成功，当前用户记录数：${count ?? 0}`);
  } catch (error) {
    logger.error("[Sales Tool] Supabase 只读验证异常：", error);
  }
}

export function attachSmokeWriteTool({ getAuthContext, windowRef = window, logger = console }) {
  windowRef.__SALES_TOOL_SUPABASE_SMOKE_WRITE__ = async (options = {}) => {
    const context = getAuthContext();
    if (!context) {
      logger.error("[Sales Tool] Supabase 写入 smoke 失败：未获取到登录用户或 client。");
      return null;
    }

    const safeOptions = options && typeof options === "object" ? options : {};
    const cleanup = safeOptions.cleanup !== false;
    const now = new Date();
    const testDate = now.toISOString().slice(0, 10);
    const testHospital = `SMOKE_${now.getTime()}`;

    try {
      const { client, user } = context;
      const { data: inserted, error: insertError } = await client
        .from("sales_records")
        .insert({
          user_id: user.id,
          record_date: testDate,
          hospital_name: testHospital,
          product_name: "SMOKE_PRODUCT",
          purchase_quantity_boxes: 1,
          assessed_amount: 1,
          actual_amount: null,
          channel: "SMOKE",
          remark: "SMOKE_TEST",
        })
        .select("id,record_date,hospital_name,product_name,purchase_quantity_boxes,assessed_amount,channel,remark,created_at")
        .single();

      if (insertError) {
        logger.error("[Sales Tool] Supabase 写入 smoke 失败（insert）：", insertError);
        return null;
      }

      const { data: readBack, error: readError } = await client
        .from("sales_records")
        .select("id,record_date,hospital_name,product_name,purchase_quantity_boxes,assessed_amount,channel,remark,created_at")
        .eq("id", inserted.id)
        .single();

      if (readError) {
        logger.error("[Sales Tool] Supabase 写入 smoke 失败（read back）：", readError);
        return null;
      }

      logger.info("[Sales Tool] Supabase 写入 smoke 成功（插入并回读）：", readBack);

      if (cleanup) {
        const { error: deleteError } = await client.from("sales_records").delete().eq("id", inserted.id);
        if (deleteError) {
          logger.error("[Sales Tool] Supabase 写入 smoke 清理失败：", deleteError);
        } else {
          logger.info("[Sales Tool] Supabase 写入 smoke 清理完成。");
        }
      }

      return readBack;
    } catch (error) {
      logger.error("[Sales Tool] Supabase 写入 smoke 异常：", error);
      return null;
    }
  };
}
