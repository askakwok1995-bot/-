import {
  ASSISTANT_ROLE_DEFINITION,
  CHAT_ERROR_CODES,
  GEMINI_API_BASE,
  GEMINI_UPSTREAM_TIMEOUT_MS,
  INTERNAL_PROCESS_WORDS,
  OUTPUT_POLICY_BOUNDED_ANSWER,
  OUTPUT_POLICY_DIRECT_ANSWER,
  OUTPUT_POLICY_REFUSE,
  QC_ACTIONS,
  QC_BOUNDARY_HINT_WORDS,
  QC_BOUNDED_BOUNDARY_TEXT,
  QC_BUSINESS_EVIDENCE_WORDS,
  QC_HIGH_DUP_SENTENCE_MIN,
  QC_HIGH_DUP_UNIQUE_RATIO_MAX,
  QC_MIN_EFFECTIVE_CHARS,
  QC_NON_SEVERE_FALLBACK_MIN,
  QC_REASON_CODES,
  QC_REFUSE_EXAMPLES_TEXT,
  QC_ROUTE_MISMATCH_SHORT_MAX_CHARS,
  QC_STRONG_REFUSE_WORDS,
  ROUTE_DECISION_CODES,
  buildAssistantRoleSystemInstruction,
  fetchWithTimeout,
  getEnvString,
  normalizeBusinessSnapshot,
  normalizeNumericValue,
  parseJsonSafe,
  sanitizeModelName,
  trimString,
} from "./shared.js";

export function buildOutputContext(finalRouteDecision, finalQuestionJudgment, finalDataAvailability) {
  const routeCode = trimString(finalRouteDecision?.route?.code);
  const primaryDimensionCode = trimString(finalQuestionJudgment?.primary_dimension?.code);
  const granularityCode = trimString(finalQuestionJudgment?.granularity?.code);
  const hospitalMonthlyDetailMode = trimString(finalDataAvailability?.detail_request_mode) === "hospital_monthly";
  const productHospitalDetailMode = trimString(finalDataAvailability?.detail_request_mode) === "product_hospital";
  const hospitalNamedDetailMode = trimString(finalDataAvailability?.detail_request_mode) === "hospital_named";
  const productFullDetailMode = trimString(finalDataAvailability?.detail_request_mode) === "product_full";
  const productNamedDetailMode = trimString(finalDataAvailability?.detail_request_mode) === "product_named";
  return {
    route_code: routeCode,
    primary_dimension_code: primaryDimensionCode,
    granularity_code: granularityCode,
    boundary_needed: routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER,
    refuse_mode: routeCode === ROUTE_DECISION_CODES.REFUSE,
    hospital_monthly_detail_mode: hospitalMonthlyDetailMode,
    product_hospital_detail_mode: productHospitalDetailMode,
    hospital_named_detail_mode: hospitalNamedDetailMode,
    product_full_detail_mode: productFullDetailMode,
    product_named_detail_mode: productNamedDetailMode,
    product_hospital_support_code: trimString(finalDataAvailability?.product_hospital_support),
    product_hospital_hospital_count_value: normalizeNumericValue(finalDataAvailability?.product_hospital_hospital_count_value),
    hospital_named_support_code: trimString(finalDataAvailability?.hospital_named_support),
    product_full_support_code: trimString(finalDataAvailability?.product_full_support),
    product_named_support_code: trimString(finalDataAvailability?.product_named_support),
    dimension_availability_code: trimString(finalDataAvailability?.dimension_availability?.code),
    answer_depth_code: trimString(finalDataAvailability?.answer_depth?.code),
  };
}

export function shouldLogPhase2Trace(env) {
  return getEnvString(env, "DEBUG_TRACE") === "1" || getEnvString(env, "NODE_ENV") !== "production";
}

function toQuestionJudgmentTrace(questionJudgment) {
  return {
    primary_dimension: trimString(questionJudgment?.primary_dimension?.code),
    granularity: trimString(questionJudgment?.granularity?.code),
    relevance: trimString(questionJudgment?.relevance?.code),
  };
}

function toDataAvailabilityTrace(dataAvailability) {
  return {
    has_business_data: trimString(dataAvailability?.has_business_data?.code),
    dimension_availability: trimString(dataAvailability?.dimension_availability?.code),
    answer_depth: trimString(dataAvailability?.answer_depth?.code),
    gap_hint_needed: trimString(dataAvailability?.gap_hint_needed?.code),
    detail_request_mode: trimString(dataAvailability?.detail_request_mode),
    hospital_monthly_support: trimString(dataAvailability?.hospital_monthly_support),
    product_hospital_support: trimString(dataAvailability?.product_hospital_support),
    hospital_named_support: trimString(dataAvailability?.hospital_named_support),
    product_full_support: trimString(dataAvailability?.product_full_support),
    product_named_support: trimString(dataAvailability?.product_named_support),
    product_named_match_mode: trimString(dataAvailability?.product_named_match_mode),
    requested_product_count_value: normalizeNumericValue(dataAvailability?.requested_product_count_value) ?? 0,
  };
}

function toSessionStateTrace(sessionState) {
  return {
    is_followup: Boolean(sessionState?.is_followup),
    inherit_primary_dimension: Boolean(sessionState?.inherit_primary_dimension),
    inherit_scope: Boolean(sessionState?.inherit_scope),
    topic_shift_detected: Boolean(sessionState?.topic_shift_detected),
  };
}

function toRouteDecisionTrace(routeDecision) {
  const reasonCodes = Array.isArray(routeDecision?.reason_codes)
    ? routeDecision.reason_codes.map((item) => trimString(item)).filter((item) => item)
    : [];
  return {
    route_code: trimString(routeDecision?.route?.code),
    reason_codes: reasonCodes,
  };
}

function toRetrievalStateTrace(retrievalState) {
  return {
    triggered: Boolean(retrievalState?.triggered),
    target_dimension: trimString(retrievalState?.target_dimension),
    success: Boolean(retrievalState?.success),
    window_capped: Boolean(retrievalState?.window_capped),
    degraded_to_bounded: Boolean(retrievalState?.degraded_to_bounded),
  };
}

function toOutputContextTrace(outputContext) {
  return {
    route_code: trimString(outputContext?.route_code),
    boundary_needed: Boolean(outputContext?.boundary_needed),
    refuse_mode: Boolean(outputContext?.refuse_mode),
  };
}

function toQcStateTrace(qcState) {
  const reasonCodes = Array.isArray(qcState?.reason_codes)
    ? qcState.reason_codes.map((item) => trimString(item)).filter((item) => item)
    : [];
  return {
    applied: Boolean(qcState?.applied),
    action: trimString(qcState?.action),
    reason_codes: reasonCodes,
  };
}

export function buildPhase2Trace({
  requestId,
  questionJudgment,
  dataAvailability,
  sessionState,
  routeDecision,
  retrievalState,
  outputContext,
  forcedBounded,
  qcState,
}) {
  return {
    requestId: trimString(requestId),
    questionJudgment: toQuestionJudgmentTrace(questionJudgment),
    dataAvailability: toDataAvailabilityTrace(dataAvailability),
    sessionState: toSessionStateTrace(sessionState),
    routeDecision: toRouteDecisionTrace(routeDecision),
    retrievalState: toRetrievalStateTrace(retrievalState),
    outputContext: toOutputContextTrace(outputContext),
    forced_bounded: Boolean(forcedBounded),
    qc: toQcStateTrace(qcState),
  };
}

export function logPhase2Trace(tracePayload, env) {
  if (!shouldLogPhase2Trace(env)) {
    return;
  }
  try {
    console.log("[chat.phase2.trace]", JSON.stringify(tracePayload));
  } catch (_error) {
    // trace logging should never affect primary request flow.
  }
}

function logGeminiCallBreadcrumb(eventName, payload) {
  try {
    console.log(`[gemini.call.${eventName}]`, JSON.stringify(payload));
  } catch (_error) {
    // Gemini breadcrumb logging should never affect primary request flow.
  }
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeQcComparableText(text) {
  return trimString(text)
    .toLocaleLowerCase()
    .replace(/[\s`~!@#$%^&*()\-_=+\[\]{}\\|;:'",.<>/?，。！？；：、（）【】《》“”‘’…—]+/g, "");
}

function getEffectiveCharCount(text) {
  return normalizeQcComparableText(text).length;
}

function splitTextByQcSentenceRule(text) {
  const normalized = trimString(text);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/[\n。！？；]+/g)
    .map((item) => trimString(item))
    .filter((item) => item);
}

function containsAnyKeywordIgnoreCase(text, keywords) {
  const target = trimString(text).toLocaleLowerCase();
  if (!target || !Array.isArray(keywords) || keywords.length === 0) {
    return false;
  }
  return keywords.some((keyword) => {
    const probe = trimString(keyword).toLocaleLowerCase();
    return probe ? target.includes(probe) : false;
  });
}

function hasRefuseExamples(text) {
  if (!text) return false;
  const lowered = text.toLocaleLowerCase();
  const bulletCount = (text.match(/^\s*-\s+/gm) || []).length;
  return lowered.includes("你可以这样问") || lowered.includes("你可以问") || lowered.includes("例如") || /1\).+2\)/.test(text) || bulletCount >= 2;
}

function hasRefuseExamplesForQc(text) {
  if (hasRefuseExamples(text)) {
    return true;
  }
  const normalized = trimString(text);
  if (!normalized) {
    return false;
  }
  const bulletCount = (normalized.match(/^\s*-\s+/gm) || []).length;
  if (bulletCount >= 2) {
    return true;
  }
  const numberedCount = (normalized.match(/\d+[).、]/g) || []).length;
  if (numberedCount >= 2 && (normalized.includes("你可以问") || normalized.includes("例如") || normalized.includes("你可以这样问"))) {
    return true;
  }
  return false;
}

function hasBoundaryHintSentence(text) {
  if (!text) return false;
  return containsAnyKeywordIgnoreCase(text, QC_BOUNDARY_HINT_WORDS);
}

function hasBoundarySentenceForQc(text) {
  return hasBoundaryHintSentence(text) || containsAnyKeywordIgnoreCase(text, QC_BOUNDARY_HINT_WORDS);
}

function containsInternalProcessWords(text) {
  return containsAnyKeywordIgnoreCase(text, INTERNAL_PROCESS_WORDS);
}

function hasHighDuplication(text) {
  const sentences = splitTextByQcSentenceRule(text);
  if (sentences.length < QC_HIGH_DUP_SENTENCE_MIN) {
    return false;
  }
  const normalizedSentences = sentences.map((item) => normalizeQcComparableText(item)).filter((item) => item);
  if (normalizedSentences.length < QC_HIGH_DUP_SENTENCE_MIN) {
    return false;
  }
  const uniqueCount = new Set(normalizedSentences).size;
  const uniqueRatio = uniqueCount / normalizedSentences.length;
  return uniqueRatio <= QC_HIGH_DUP_UNIQUE_RATIO_MAX;
}

function stripRefuseExamplesForMismatch(text) {
  const normalized = trimString(text);
  if (!normalized) {
    return "";
  }
  const lines = normalized
    .split(/\n+/)
    .map((item) => trimString(item))
    .filter((item) => item);
  if (lines.length === 0) {
    return "";
  }

  const cutIndex = lines.findIndex((line) => {
    return line.includes("你可以问") || line.includes("你可以这样问") || line.includes("例如") || /^\s*-\s+/.test(line) || /^\s*\d+[).、]/.test(line);
  });

  if (cutIndex === -1) {
    return normalized;
  }
  return trimString(lines.slice(0, cutIndex).join("\n"));
}

function isStrongRouteMismatch(reply, routeCode) {
  const text = trimString(reply);
  if (!text) {
    return false;
  }
  if (routeCode !== ROUTE_DECISION_CODES.REFUSE) {
    return containsAnyKeywordIgnoreCase(text, QC_STRONG_REFUSE_WORDS) && text.length < QC_ROUTE_MISMATCH_SHORT_MAX_CHARS;
  }
  const refuseMainText = stripRefuseExamplesForMismatch(text);
  if (!refuseMainText) {
    return false;
  }
  const sentenceCount = splitTextByQcSentenceRule(refuseMainText).length;
  return sentenceCount >= 3 && containsAnyKeywordIgnoreCase(refuseMainText, QC_BUSINESS_EVIDENCE_WORDS);
}

function splitQcFindingsBySeverity(findings) {
  const safeFindings = Array.isArray(findings) ? findings : [];
  const severeSet = new Set([QC_REASON_CODES.EMPTY_OR_TOO_SHORT, QC_REASON_CODES.IRRELEVANT_REFUSE_MISMATCH]);
  const severeFindings = safeFindings.filter((code) => severeSet.has(code));
  const nonSevereFindings = safeFindings.filter((code) => !severeSet.has(code));
  return {
    severe_findings: severeFindings,
    non_severe_findings: nonSevereFindings,
  };
}

function evaluateReplyQuality(reply, outputContext, routeDecision) {
  const findings = [];
  const routeCode = trimString(routeDecision?.route?.code) || trimString(outputContext?.route_code);
  const text = trimString(reply);

  if (!text || getEffectiveCharCount(text) < QC_MIN_EFFECTIVE_CHARS) {
    findings.push(QC_REASON_CODES.EMPTY_OR_TOO_SHORT);
  }
  if (containsInternalProcessWords(text)) {
    findings.push(QC_REASON_CODES.CONTAINS_INTERNAL_PROCESS_WORDS);
  }
  if (routeCode === ROUTE_DECISION_CODES.REFUSE && !hasRefuseExamplesForQc(text)) {
    findings.push(QC_REASON_CODES.REFUSE_MISSING_EXAMPLES);
  }
  if (routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER && !hasBoundarySentenceForQc(text)) {
    findings.push(QC_REASON_CODES.BOUNDED_MISSING_BOUNDARY_SENTENCE);
  }
  if (hasHighDuplication(text)) {
    findings.push(QC_REASON_CODES.HIGH_DUPLICATION);
  }
  if (isStrongRouteMismatch(text, routeCode)) {
    findings.push(QC_REASON_CODES.IRRELEVANT_REFUSE_MISMATCH);
  }

  const dedupedFindings = [];
  for (const finding of findings) {
    if (!dedupedFindings.includes(finding)) {
      dedupedFindings.push(finding);
    }
  }
  return {
    findings: dedupedFindings,
    ...splitQcFindingsBySeverity(dedupedFindings),
  };
}

function scrubInternalProcessWords(text) {
  let output = trimString(text);
  for (const keyword of INTERNAL_PROCESS_WORDS) {
    const safeKeyword = trimString(keyword);
    if (!safeKeyword) {
      continue;
    }
    output = output.replace(new RegExp(escapeRegExp(safeKeyword), "gi"), "");
  }
  output = output
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\(\s*\)/g, "")
    .replace(/（\s*）/g, "");
  return trimString(output);
}

function removeTailDuplicatedContent(text) {
  const normalized = trimString(text);
  if (!normalized) {
    return "";
  }

  const lines = normalized
    .split(/\n+/)
    .map((item) => trimString(item))
    .filter((item) => item);
  if (lines.length > 1) {
    while (lines.length > 1) {
      const last = normalizeQcComparableText(lines[lines.length - 1]);
      const previous = new Set(lines.slice(0, -1).map((item) => normalizeQcComparableText(item)));
      if (last && previous.has(last)) {
        lines.pop();
        continue;
      }
      break;
    }
  }

  let output = lines.join("\n");
  const sentences = splitTextByQcSentenceRule(output);
  if (sentences.length > 1) {
    while (sentences.length > 1) {
      const last = normalizeQcComparableText(sentences[sentences.length - 1]);
      const previous = new Set(sentences.slice(0, -1).map((item) => normalizeQcComparableText(item)));
      if (last && previous.has(last)) {
        sentences.pop();
        continue;
      }
      break;
    }
    output = sentences.join("。");
  }
  return trimString(output);
}

function appendRefuseExamplesText(text) {
  const normalized = trimString(text);
  if (!normalized) {
    return QC_REFUSE_EXAMPLES_TEXT;
  }
  if (hasRefuseExamplesForQc(normalized)) {
    return normalized;
  }
  return [normalized, QC_REFUSE_EXAMPLES_TEXT].join("\n");
}

function injectBoundedBoundarySentence(text) {
  const normalized = trimString(text);
  if (!normalized) {
    return QC_BOUNDED_BOUNDARY_TEXT;
  }
  if (hasBoundarySentenceForQc(normalized)) {
    return normalized;
  }
  const lines = normalized.split(/\n+/).map((item) => trimString(item)).filter((item) => item);
  if (lines.length === 0) {
    return QC_BOUNDED_BOUNDARY_TEXT;
  }
  if (lines.length === 1) {
    return [lines[0], QC_BOUNDED_BOUNDARY_TEXT].join("\n\n");
  }
  return [lines[0], QC_BOUNDED_BOUNDARY_TEXT, ...lines.slice(1)].join("\n");
}

function applyMinimalPatch(reply, findings, outputContext) {
  let patched = trimString(reply);
  const routeCode = trimString(outputContext?.route_code);
  const findingSet = new Set(Array.isArray(findings) ? findings : []);

  if (findingSet.has(QC_REASON_CODES.CONTAINS_INTERNAL_PROCESS_WORDS)) {
    patched = scrubInternalProcessWords(patched);
  }
  if (findingSet.has(QC_REASON_CODES.HIGH_DUPLICATION)) {
    patched = removeTailDuplicatedContent(patched);
  }
  if (routeCode === ROUTE_DECISION_CODES.REFUSE && findingSet.has(QC_REASON_CODES.REFUSE_MISSING_EXAMPLES)) {
    patched = appendRefuseExamplesText(patched);
  }
  if (routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER && findingSet.has(QC_REASON_CODES.BOUNDED_MISSING_BOUNDARY_SENTENCE)) {
    patched = injectBoundedBoundarySentence(patched);
  }

  return trimString(patched).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function buildQualityFallbackReply(routeCode, outputContext) {
  const safeRouteCode = trimString(routeCode) || trimString(outputContext?.route_code);
  if (safeRouteCode === ROUTE_DECISION_CODES.REFUSE) {
    return buildRefuseReplyTemplate(outputContext);
  }
  if (safeRouteCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER) {
    return [
      "基于当前可用业务信息，可以先给出方向性判断：当前表现已有可参考信号。",
      QC_BOUNDED_BOUNDARY_TEXT,
      "如果继续深入，建议优先按产品、医院和时间层级逐步细拆。",
    ].join("\n");
  }
  return [
    "基于当前可用业务信息，可以先给出方向性结论：请优先聚焦对业绩影响最大的产品或医院。",
    "依据是现有快照已提供关键业务信号与近期趋势。",
    "下一步建议围绕重点对象制定可执行推进动作，并持续跟踪变化。",
  ].join("\n");
}

export function applyQualityControl(replyDraft, outputContext, routeDecision) {
  const initial = evaluateReplyQuality(replyDraft, outputContext, routeDecision);
  if (initial.findings.length === 0) {
    return {
      finalReplyText: replyDraft,
      qcState: {
        applied: false,
        reason_codes: [],
        action: QC_ACTIONS.PASS_THROUGH,
      },
    };
  }

  if (initial.severe_findings.length > 0) {
    return {
      finalReplyText: buildQualityFallbackReply(trimString(routeDecision?.route?.code), outputContext),
      qcState: {
        applied: true,
        reason_codes: initial.findings,
        action: QC_ACTIONS.SAFE_FALLBACK,
      },
    };
  }

  const patchedReply = applyMinimalPatch(replyDraft, initial.findings, outputContext);
  const rechecked = evaluateReplyQuality(patchedReply, outputContext, routeDecision);
  const shouldFallback =
    rechecked.severe_findings.length > 0 ||
    (initial.non_severe_findings.length >= QC_NON_SEVERE_FALLBACK_MIN && rechecked.findings.length >= 1);
  if (shouldFallback) {
    const reasonCodes = [...initial.findings];
    for (const code of rechecked.findings) {
      if (!reasonCodes.includes(code)) {
        reasonCodes.push(code);
      }
    }
    return {
      finalReplyText: buildQualityFallbackReply(trimString(routeDecision?.route?.code), outputContext),
      qcState: {
        applied: true,
        reason_codes: reasonCodes,
        action: QC_ACTIONS.SAFE_FALLBACK,
      },
    };
  }

  return {
    finalReplyText: patchedReply,
    qcState: {
      applied: true,
      reason_codes: initial.findings,
      action: QC_ACTIONS.MINIMAL_PATCH,
    },
  };
}

export function buildOutputInstructionText(outputContext) {
  const routeCode = trimString(outputContext?.route_code);
  const hospitalMonthlyDetailMode = Boolean(outputContext?.hospital_monthly_detail_mode);
  const productHospitalDetailMode = Boolean(outputContext?.product_hospital_detail_mode);
  const hospitalNamedDetailMode = Boolean(outputContext?.hospital_named_detail_mode);
  const productFullDetailMode = Boolean(outputContext?.product_full_detail_mode);
  const productNamedDetailMode = Boolean(outputContext?.product_named_detail_mode);
  const productHospitalSupportCode = trimString(outputContext?.product_hospital_support_code);
  const productHospitalHospitalCountValue = normalizeNumericValue(outputContext?.product_hospital_hospital_count_value) ?? 0;
  const hospitalNamedSupportCode = trimString(outputContext?.hospital_named_support_code);
  const productFullSupportCode = trimString(outputContext?.product_full_support_code);
  const productNamedSupportCode = trimString(outputContext?.product_named_support_code);
  if (routeCode === ROUTE_DECISION_CODES.DIRECT_ANSWER) {
    if (hospitalMonthlyDetailMode) {
      return `${OUTPUT_POLICY_DIRECT_ANSWER}\n补充约束：当问题要求医院逐月明细时，优先按月份组织医院表现要点，覆盖当前分析区间并突出关键波动。`;
    }
    if (productHospitalDetailMode) {
      const listConstraint =
        productHospitalHospitalCountValue >= 3
          ? "若医院条目不少于3家，至少列出Top3医院贡献点（不要只给Top1）。"
          : "若医院条目不足3家，按实际可见条目逐条说明。";
      return `${OUTPUT_POLICY_DIRECT_ANSWER}\n补充约束：当问题要求“某产品由哪些医院贡献”时，优先给出该产品对应的医院贡献结构与重点医院结论。${listConstraint}`;
    }
    if (hospitalNamedDetailMode) {
      return `${OUTPUT_POLICY_DIRECT_ANSWER}\n补充约束：当问题点名具体医院时，优先逐条覆盖命名医院结论与依据，避免退化为泛医院Top摘要。`;
    }
    if (productFullDetailMode) {
      return `${OUTPUT_POLICY_DIRECT_ANSWER}\n补充约束：当问题要求全产品分析时，优先覆盖当前可见产品范围并明确产品盘点口径。`;
    }
    if (productNamedDetailMode) {
      return `${OUTPUT_POLICY_DIRECT_ANSWER}\n补充约束：当问题点名具体产品时，优先逐条覆盖命名产品的结论与依据；无销售记录产品使用“本期无销售记录/贡献为0”的业务表达。`;
    }
    return OUTPUT_POLICY_DIRECT_ANSWER;
  }

  if (routeCode === ROUTE_DECISION_CODES.BOUNDED_ANSWER) {
    if (hospitalMonthlyDetailMode) {
      return `${OUTPUT_POLICY_BOUNDED_ANSWER}\n补充约束：医院逐月明细场景下，先给逐月可得结论，再用业务口吻说明当前逐月覆盖边界。`;
    }
    if (productHospitalDetailMode) {
      return `${OUTPUT_POLICY_BOUNDED_ANSWER}\n补充约束：产品×医院交叉场景下，先给该产品的医院贡献结论，再说明当前医院覆盖范围（${productHospitalSupportCode || "partial"}）。`;
    }
    if (hospitalNamedDetailMode) {
      return `${OUTPUT_POLICY_BOUNDED_ANSWER}\n补充约束：命名医院场景下，先给可得结论，再说明当前已覆盖命名医院范围（${hospitalNamedSupportCode || "partial"}）。`;
    }
    if (productFullDetailMode) {
      return `${OUTPUT_POLICY_BOUNDED_ANSWER}\n补充约束：全产品分析场景下，先给当前可得产品结论，再说明当前覆盖范围（${productFullSupportCode || "partial"}）。`;
    }
    if (productNamedDetailMode) {
      return `${OUTPUT_POLICY_BOUNDED_ANSWER}\n补充约束：命名产品场景下，先给可得结论，再说明当前已覆盖命名产品范围（${productNamedSupportCode || "partial"}）。`;
    }
    return OUTPUT_POLICY_BOUNDED_ANSWER;
  }

  if (routeCode === ROUTE_DECISION_CODES.REFUSE) {
    return OUTPUT_POLICY_REFUSE;
  }

  return "";
}

export function buildRefuseReplyTemplate(_outputContext) {
  return [
    "这个问题不属于我当前的医药销售业务分析职责范围。",
    "你可以问：",
    "- 本月整体业绩和达成率的核心变化是什么？",
    "- 当前哪个产品最值得优先推进，原因是什么？",
    "- 近三个月医院表现有哪些关键波动，对应风险和机会在哪里？",
  ].join("\n");
}

export function normalizeOutputReply(reply) {
  return trimString(reply).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

export function buildGeminiPayload(message, businessSnapshot, outputContext) {
  const systemInstructionText = buildAssistantRoleSystemInstruction(ASSISTANT_ROLE_DEFINITION);
  const outputInstructionText = buildOutputInstructionText(outputContext);
  const mergedSystemInstructionText = outputInstructionText
    ? `${systemInstructionText}\n\n${outputInstructionText}`
    : systemInstructionText;
  const normalizedSnapshot = normalizeBusinessSnapshot(businessSnapshot);
  const userPromptText = [
    "以下是当前业务快照（business_snapshot），请将其作为本轮回答的事实依据。",
    "如果快照中的数据不足，请明确说明“数据不足”，不要编造。",
    "",
    "business_snapshot:",
    JSON.stringify(normalizedSnapshot, null, 2),
    "",
    `用户问题：${message}`,
  ].join("\n");
  return {
    systemInstruction: {
      parts: [{ text: mergedSystemInstructionText }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPromptText }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  };
}

function extractGeminiReply(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts
      .map((part) => trimString(part?.text))
      .filter((item) => item)
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }
  return "";
}

export async function callGemini(message, businessSnapshot, outputContext, env, requestId = "") {
  const model = sanitizeModelName(getEnvString(env, "GEMINI_MODEL"));
  const apiKey = getEnvString(env, "GEMINI_API_KEY");
  if (!apiKey) {
    logGeminiCallBreadcrumb("result", {
      requestId: trimString(requestId),
      model,
      ok: false,
      status: 500,
      error_code: CHAT_ERROR_CODES.CONFIG_MISSING,
    });
    return {
      ok: false,
      code: CHAT_ERROR_CODES.CONFIG_MISSING,
      message: "服务端未配置 GEMINI_API_KEY。",
      status: 500,
    };
  }

  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  logGeminiCallBreadcrumb("start", {
    requestId: trimString(requestId),
    model,
  });

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(buildGeminiPayload(message, businessSnapshot, outputContext)),
      },
      GEMINI_UPSTREAM_TIMEOUT_MS,
    );

    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        logGeminiCallBreadcrumb("result", {
          requestId: trimString(requestId),
          model,
          ok: false,
          status: response.status,
          error_code: CHAT_ERROR_CODES.UPSTREAM_AUTH_ERROR,
        });
        return {
          ok: false,
          code: CHAT_ERROR_CODES.UPSTREAM_AUTH_ERROR,
          message: "Gemini Key 无效或无权限，请检查服务端密钥配置。",
          status: 502,
        };
      }
      if (response.status === 429) {
        logGeminiCallBreadcrumb("result", {
          requestId: trimString(requestId),
          model,
          ok: false,
          status: response.status,
          error_code: CHAT_ERROR_CODES.UPSTREAM_RATE_LIMIT,
        });
        return {
          ok: false,
          code: CHAT_ERROR_CODES.UPSTREAM_RATE_LIMIT,
          message: "Gemini 请求过于频繁或配额受限，请稍后重试。",
          status: 429,
        };
      }
      const upstreamMessage = trimString(payload?.error?.message);
      logGeminiCallBreadcrumb("result", {
        requestId: trimString(requestId),
        model,
        ok: false,
        status: response.status,
        error_code: CHAT_ERROR_CODES.UPSTREAM_ERROR,
      });
      return {
        ok: false,
        code: CHAT_ERROR_CODES.UPSTREAM_ERROR,
        message: upstreamMessage || `Gemini 服务异常（HTTP ${response.status}）。`,
        status: response.status >= 500 ? 502 : 400,
      };
    }

    const reply = extractGeminiReply(payload);
    if (!reply) {
      logGeminiCallBreadcrumb("result", {
        requestId: trimString(requestId),
        model,
        ok: false,
        status: 502,
        error_code: CHAT_ERROR_CODES.EMPTY_REPLY,
      });
      return {
        ok: false,
        code: CHAT_ERROR_CODES.EMPTY_REPLY,
        message: "Gemini 返回为空，请稍后重试。",
        status: 502,
      };
    }

    logGeminiCallBreadcrumb("result", {
      requestId: trimString(requestId),
      model,
      ok: true,
      status: response.status,
      error_code: "",
    });
    return {
      ok: true,
      reply,
      model,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logGeminiCallBreadcrumb("result", {
        requestId: trimString(requestId),
        model,
        ok: false,
        status: 504,
        error_code: CHAT_ERROR_CODES.UPSTREAM_TIMEOUT,
      });
      return {
        ok: false,
        code: CHAT_ERROR_CODES.UPSTREAM_TIMEOUT,
        message: "Gemini 请求超时，请稍后重试。",
        status: 504,
      };
    }
    logGeminiCallBreadcrumb("result", {
      requestId: trimString(requestId),
      model,
      ok: false,
      status: 502,
      error_code: CHAT_ERROR_CODES.UPSTREAM_NETWORK_ERROR,
    });
    return {
      ok: false,
      code: CHAT_ERROR_CODES.UPSTREAM_NETWORK_ERROR,
      message: `Gemini 网络请求失败：${error instanceof Error ? error.message : "请稍后重试"}`,
      status: 502,
    };
  }
}
