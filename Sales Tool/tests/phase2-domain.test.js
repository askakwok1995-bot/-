import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProductFamilyKey } from '../domain/entity-matchers.js';
import { createEmptyBusinessSnapshot, QUESTION_JUDGMENT_CODES } from '../functions/chat/shared.js';
import { buildQuestionJudgment, buildEffectiveQuestionJudgment } from '../functions/chat/judgment.js';
import { buildDataAvailability } from '../functions/chat/availability.js';
import { buildRouteDecision } from '../functions/chat/routing.js';
import { resolveHospitalNamedRequestContext } from '../functions/chat/retrieval.js';

test('product family key collapses规格后缀', () => {
  assert.equal(normalizeProductFamilyKey('Botox50'), 'botox');
  assert.equal(normalizeProductFamilyKey('Botox100'), 'botox');
  assert.equal(normalizeProductFamilyKey('诺和盈1mg'), '诺和盈');
});

test('effective question judgment gives product_hospital precedence over product_named', () => {
  const questionJudgment = buildQuestionJudgment('诺和盈1mg在哪些医院贡献最多');
  const effectiveQuestionJudgment = buildEffectiveQuestionJudgment(questionJudgment, {
    productFullRequested: false,
    productHospitalRequested: true,
    productNamedRequested: true,
    hospitalNamedRequested: false,
  });

  assert.equal(questionJudgment.primary_dimension.code, QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL);
  assert.equal(effectiveQuestionJudgment.primary_dimension.code, QUESTION_JUDGMENT_CODES.primary_dimension.HOSPITAL);
});

test('product_hospital full support stays direct even when product_named support is none', () => {
  const snapshot = createEmptyBusinessSnapshot();
  snapshot.performance_overview.product_hospital_support_code = 'full';
  snapshot.performance_overview.product_hospital_hospital_count_value = 3;
  snapshot.hospital_performance = [
    { hospital_name: '医院A', sales_amount: '10.00万元' },
    { hospital_name: '医院B', sales_amount: '8.00万元' },
    { hospital_name: '医院C', sales_amount: '6.00万元' },
  ];

  const questionJudgment = buildQuestionJudgment('诺和盈1mg在哪些医院贡献最多');
  const dataAvailability = buildDataAvailability(snapshot, questionJudgment, {
    productHospitalRequested: true,
    productNamedRequested: true,
    requestedProducts: [{ product_id: 'p1', product_name: '诺和盈1mg', lookup_key: '诺和盈1mg' }],
    productNamedMatchMode: 'exact',
  });
  const routeDecision = buildRouteDecision(questionJudgment, dataAvailability, {
    productHospitalRequested: true,
    productNamedRequested: true,
  });

  assert.equal(dataAvailability.detail_request_mode, 'product_hospital');
  assert.equal(dataAvailability.product_hospital_support, 'full');
  assert.equal(dataAvailability.product_named_support, 'none');
  assert.equal(routeDecision.route.code, 'direct_answer');
});

test('product named request without snapshot support enters need_more_data', () => {
  const snapshot = createEmptyBusinessSnapshot();
  const questionJudgment = buildEffectiveQuestionJudgment(buildQuestionJudgment('诺和盈1mg怎么样'), {
    productNamedRequested: true,
  });
  const dataAvailability = buildDataAvailability(snapshot, questionJudgment, {
    productNamedRequested: true,
    requestedProducts: [{ product_id: 'p1', product_name: '诺和盈1mg', lookup_key: '诺和盈1mg' }],
    productNamedMatchMode: 'exact',
  });
  const routeDecision = buildRouteDecision(questionJudgment, dataAvailability, {
    productNamedRequested: true,
  });

  assert.equal(dataAvailability.detail_request_mode, 'product_named');
  assert.equal(routeDecision.route.code, 'need_more_data');
  assert.ok(routeDecision.reason_codes.includes('product_named_scope_insufficient'));
});

test('hospital named request context no longer throws when message uses hospital-like wording', () => {
  const questionJudgment = buildQuestionJudgment('华美这家机构近三个月怎么样');
  const result = resolveHospitalNamedRequestContext({
    message: '华美这家机构近三个月怎么样',
    questionJudgment,
    productFullRequested: false,
    productNamedRequested: false,
  });

  assert.equal(result.hospitalNamedRequested, true);
  assert.ok(Array.isArray(result.requestedHospitals));
  assert.ok(result.requestedHospitals.length >= 1);
});

test('hospital named request context can use hospital trigger keywords even when primary dimension is not hospital', () => {
  const result = resolveHospitalNamedRequestContext({
    message: '华美机构最近如何',
    questionJudgment: {
      relevance: { code: QUESTION_JUDGMENT_CODES.relevance.RELEVANT },
      primary_dimension: { code: QUESTION_JUDGMENT_CODES.primary_dimension.OVERALL },
    },
    productFullRequested: false,
    productNamedRequested: false,
  });

  assert.equal(result.hospitalNamedRequested, true);
  assert.ok(Array.isArray(result.requestedHospitals));
  assert.ok(result.requestedHospitals.length >= 1);
});
