export const TOOL_NAMES = Object.freeze({
  GET_OVERALL_SUMMARY: "get_overall_summary",
  GET_PRODUCT_SUMMARY: "get_product_summary",
  GET_HOSPITAL_SUMMARY: "get_hospital_summary",
  GET_PRODUCT_HOSPITAL_CONTRIBUTION: "get_product_hospital_contribution",
  GET_TREND_SUMMARY: "get_trend_summary",
  GET_PERIOD_COMPARISON_SUMMARY: "get_period_comparison_summary",
  GET_PRODUCT_TREND: "get_product_trend",
  GET_HOSPITAL_TREND: "get_hospital_trend",
  GET_ENTITY_RANKING: "get_entity_ranking",
  GET_SHARE_BREAKDOWN: "get_share_breakdown",
  GET_ANOMALY_INSIGHTS: "get_anomaly_insights",
  GET_RISK_OPPORTUNITY_SUMMARY: "get_risk_opportunity_summary",
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

function stringEnumSchema(description, values) {
  return {
    type: "STRING",
    description,
    enum: values,
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
    {
      name: TOOL_NAMES.GET_PRODUCT_TREND,
      description: "获取当前报表区间内产品趋势，可用于命名产品或多产品的逐月变化分析。",
      parameters: {
        type: "OBJECT",
        properties: {
          product_names: arrayOfStringsSchema("可选。要分析趋势的产品名称列表。"),
          granularity: stringEnumSchema("趋势粒度，只能是 summary 或 monthly。", ["summary", "monthly"]),
        },
      },
    },
    {
      name: TOOL_NAMES.GET_HOSPITAL_TREND,
      description: "获取当前报表区间内医院趋势，可用于命名医院或多医院的逐月变化分析。",
      parameters: {
        type: "OBJECT",
        properties: {
          hospital_names: arrayOfStringsSchema("可选。要分析趋势的医院名称列表。"),
          granularity: stringEnumSchema("趋势粒度，只能是 summary 或 monthly。", ["summary", "monthly"]),
        },
      },
    },
    {
      name: TOOL_NAMES.GET_ENTITY_RANKING,
      description: "获取产品或医院的 Top/Bottom 排行，用于找贡献最高、最低或表现靠后对象。",
      parameters: {
        type: "OBJECT",
        properties: {
          dimension: stringEnumSchema("排行维度，只能是 product 或 hospital。", ["product", "hospital"]),
          ranking: stringEnumSchema("排行方向，只能是 top 或 bottom。", ["top", "bottom"]),
          metric: stringEnumSchema("排序指标，只能是 sales_amount、sales_volume 或 sales_share。", [
            "sales_amount",
            "sales_volume",
            "sales_share",
          ]),
          target_names: arrayOfStringsSchema("可选。只在指定产品或医院集合内做排行。"),
          limit: {
            type: "NUMBER",
            description: "可选。希望返回的对象条数上限，后端会按安全上限裁剪。",
          },
        },
        required: ["dimension"],
      },
    },
    {
      name: TOOL_NAMES.GET_SHARE_BREAKDOWN,
      description: "获取产品或医院的份额结构，用于查看贡献占比和结构集中度。",
      parameters: {
        type: "OBJECT",
        properties: {
          dimension: stringEnumSchema("结构维度，只能是 product 或 hospital。", ["product", "hospital"]),
          target_names: arrayOfStringsSchema("可选。指定对象后返回该集合的份额结构。"),
          limit: {
            type: "NUMBER",
            description: "可选。希望返回的对象条数上限，后端会按安全上限裁剪。",
          },
        },
        required: ["dimension"],
      },
    },
    {
      name: TOOL_NAMES.GET_ANOMALY_INSIGHTS,
      description: "获取当前报表区间内的异动月份或异常波动点，用于识别波动最大的时间点。",
      parameters: {
        type: "OBJECT",
        properties: {
          dimension: stringEnumSchema("异动维度，只能是 overall、product 或 hospital。", [
            "overall",
            "product",
            "hospital",
          ]),
          target_names: arrayOfStringsSchema("可选。产品或医院维度下要分析的对象名称列表。"),
          limit: {
            type: "NUMBER",
            description: "可选。希望返回的异动条数上限，后端会按安全上限裁剪。",
          },
        },
      },
    },
    {
      name: TOOL_NAMES.GET_RISK_OPPORTUNITY_SUMMARY,
      description: "获取当前报表区间内的风险与机会提示，用于辅助诊断波动和结构风险。",
      parameters: {
        type: "OBJECT",
        properties: {
          dimension: stringEnumSchema("分析维度，只能是 overall、product 或 hospital。", [
            "overall",
            "product",
            "hospital",
          ]),
          target_names: arrayOfStringsSchema("可选。产品或医院维度下要分析的对象名称列表。"),
        },
      },
    },
  ];
}
