export const TOOL_NAMES = Object.freeze({
  GET_OVERALL_SUMMARY: "get_overall_summary",
  GET_PRODUCT_SUMMARY: "get_product_summary",
  GET_HOSPITAL_SUMMARY: "get_hospital_summary",
  GET_PRODUCT_HOSPITAL_CONTRIBUTION: "get_product_hospital_contribution",
  GET_TREND_SUMMARY: "get_trend_summary",
  GET_PERIOD_COMPARISON_SUMMARY: "get_period_comparison_summary",
});

function arrayOfStringsSchema(description) {
  return {
    type: "ARRAY",
    description,
    items: {
      type: "STRING",
    },
  };
}

export function buildToolDeclarations() {
  return [
    {
      name: TOOL_NAMES.GET_OVERALL_SUMMARY,
      description: "获取当前报表区间内的整体业绩摘要、关键变化和趋势概览。",
      parameters: {
        type: "OBJECT",
        properties: {
          focus: {
            type: "STRING",
            description: "可选。希望重点关注的主题，例如达成率、销量、变化原因。",
          },
        },
      },
    },
    {
      name: TOOL_NAMES.GET_PRODUCT_SUMMARY,
      description: "获取当前报表区间内的产品表现，可用于命名产品分析或全产品盘点。",
      parameters: {
        type: "OBJECT",
        properties: {
          product_names: arrayOfStringsSchema("可选。需要分析的产品名称列表。"),
          include_all_products: {
            type: "BOOLEAN",
            description: "是否按当前产品目录做全产品盘点。",
          },
          limit: {
            type: "NUMBER",
            description: "可选。希望返回的产品条数上限，后端会按安全上限裁剪。",
          },
        },
      },
    },
    {
      name: TOOL_NAMES.GET_HOSPITAL_SUMMARY,
      description: "获取当前报表区间内的医院表现，可用于命名医院、医院Top列表或逐月医院表现。",
      parameters: {
        type: "OBJECT",
        properties: {
          hospital_names: arrayOfStringsSchema("可选。需要分析的医院名称列表。"),
          include_monthly: {
            type: "BOOLEAN",
            description: "是否需要返回逐月医院表现。",
          },
          limit: {
            type: "NUMBER",
            description: "可选。希望返回的医院条数上限，后端会按安全上限裁剪。",
          },
        },
      },
    },
    {
      name: TOOL_NAMES.GET_PRODUCT_HOSPITAL_CONTRIBUTION,
      description: "获取某个或某组产品在当前报表区间内由哪些医院贡献，以及贡献结构。",
      parameters: {
        type: "OBJECT",
        properties: {
          product_names: {
            type: "ARRAY",
            description: "必填。要分析的产品名称列表。",
            items: {
              type: "STRING",
            },
          },
          hospital_names: arrayOfStringsSchema("可选。需要进一步限定的医院名称列表。"),
          limit: {
            type: "NUMBER",
            description: "可选。希望返回的医院条数上限，后端会按安全上限裁剪。",
          },
        },
        required: ["product_names"],
      },
    },
    {
      name: TOOL_NAMES.GET_TREND_SUMMARY,
      description: "获取当前报表区间内的整体、产品或医院趋势摘要。",
      parameters: {
        type: "OBJECT",
        properties: {
          dimension: {
            type: "STRING",
            description: "趋势维度，只能是 overall、product 或 hospital。",
            enum: ["overall", "product", "hospital"],
          },
          target_names: arrayOfStringsSchema("可选。产品或医院维度下需要分析的对象名称列表。"),
          granularity: {
            type: "STRING",
            description: "趋势粒度，只能是 summary 或 monthly。",
            enum: ["summary", "monthly"],
          },
        },
        required: ["dimension"],
      },
    },
    {
      name: TOOL_NAMES.GET_PERIOD_COMPARISON_SUMMARY,
      description: "获取当前报表区间内两个时间窗口的整体对比摘要，可用于季度对比。",
      parameters: {
        type: "OBJECT",
        properties: {
          primary_start_month: {
            type: "STRING",
            description: "主窗口起始月份，格式 YYYY-MM。",
          },
          primary_end_month: {
            type: "STRING",
            description: "主窗口结束月份，格式 YYYY-MM。",
          },
          comparison_start_month: {
            type: "STRING",
            description: "对比窗口起始月份，格式 YYYY-MM。",
          },
          comparison_end_month: {
            type: "STRING",
            description: "对比窗口结束月份，格式 YYYY-MM。",
          },
          dimension: {
            type: "STRING",
            description: "当前仅支持 overall。",
            enum: ["overall"],
          },
        },
        required: [
          "primary_start_month",
          "primary_end_month",
          "comparison_start_month",
          "comparison_end_month",
          "dimension",
        ],
      },
    },
  ];
}
