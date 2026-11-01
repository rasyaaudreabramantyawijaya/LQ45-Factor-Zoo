'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/factor-presets.js');
const axes = global.FactorAxes;

test('ranking direction flips only ranking values, not plotted natural DER', () => {
  const issuer = {
    components: { debt_to_equity: { status: 'AVAILABLE', z_score: -1.2 } },
    scores: { quality: { status: 'AVAILABLE', score: 0.3 } }
  };
  const plotted = axes.axisValue(issuer, 'debt_to_equity');
  assert.equal(plotted, 1.2);
  assert.equal(axes.rankScore(plotted, 'higher'), 1.2);
  assert.equal(axes.rankScore(plotted, 'lower'), -1.2);
  assert.equal(axes.axisValue(issuer, 'debt_to_equity'), 1.2);
  assert.equal(axes.axisValue(issuer, 'factor:quality'), 0.3);
});

test('default directions preserve already oriented factors and use beta context', () => {
  assert.equal(axes.defaultRankDirection('factor:quality'), 'higher');
  assert.equal(axes.defaultRankDirection('beta_ihsg'), 'higher');
  assert.equal(axes.defaultRankDirection('debt_to_equity'), 'lower');
  assert.equal(axes.defaultRankDirection('idiosyncratic_volatility'), 'lower');
  assert.equal(axes.rankScore(null, 'lower'), null);
  assert.equal(axes.rankScore(0, 'lower'), 0);
});

test('missing axis excludes an issuer while unavailable color stays missing', () => {
  const score = value => ({ status: 'AVAILABLE', score: value });
  const record = { ticker: 'AAA', scores: { value: score(1), momentum: score(2), quality: score(3) } };
  const missing = { ticker: 'BBB', scores: { value: score(1), momentum: score(2) } };
  const plotted = axes.mapPoints([record, missing], axes.PRESETS.classic);
  assert.equal(plotted.length, 1);
  assert.equal(plotted[0].record.ticker, 'AAA');
  assert.equal(plotted[0].low, null);
});
