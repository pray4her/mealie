/* global __dirname: readonly */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('../node_modules/jsdom');

async function verify() {
  const errors = [];
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), {
    runScripts: 'dangerously', url: 'http://localhost/#recipes', pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLElement.prototype.scrollTo = function () {};
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
      window.addEventListener('error', event => errors.push(event.error));
    },
  });
  const { window } = dom;
  const document = window.document;
  const click = selector => {
    const element = document.querySelector(selector);
    assert.ok(element, `Missing control: ${selector}`);
    element.click();
  };
  const input = (selector, value) => {
    const element = document.querySelector(selector);
    element.value = value;
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const navigate = async hash => {
    window.location.hash = hash;
    await new Promise(resolve => window.setTimeout(resolve, 10));
  };

  assert.equal(document.querySelectorAll('.recipe-card').length, 6);
  input('#recipe-search', '鲜虾');
  assert.equal(document.querySelectorAll('.recipe-card').length, 2);
  input('#recipe-search', '<img src=x onerror=alert(1)>');
  assert.equal(document.querySelectorAll('.recipe-card').length, 0);
  assert.equal(document.querySelector('#recipe-results img'), null);
  input('#recipe-search', '');
  click('[data-action="filter"][data-value="favorites"]');
  assert.equal(document.querySelectorAll('.recipe-card').length, 2);
  const favorite = document.querySelector('.recipe-card [data-action="favorite"]');
  favorite.click();
  assert.equal(document.querySelectorAll('.recipe-card').length, 1);
  click('[data-action="filter"][data-value="all"]');

  await navigate('detail/1');
  assert.equal(document.querySelector('#detail-title').textContent, '鲜虾溏心蛋汤面');
  click('[data-action="servings"][data-value="1"]');
  assert.equal(document.querySelector('#servings-count').textContent, '3');
  click('[data-action="plan-recipe"]');
  assert.ok(document.querySelector('#sheet').open);
  click('[data-action="confirm-plan"]');
  assert.ok(!document.querySelector('#sheet').open);
  await navigate('plan');
  assert.match(document.querySelector('#plan-content').textContent, /鲜虾溏心蛋汤面/);

  await navigate('shopping');
  const checkedBefore = document.querySelectorAll('.shopping-row.is-checked').length;
  click('.shopping-row input');
  assert.equal(document.querySelectorAll('.shopping-row.is-checked').length, checkedBefore + 1);
  click('[data-action="add-item"]');
  input('#new-item', '<b>牛奶</b>');
  document.querySelector('#item-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.match(document.querySelector('#shopping-content').textContent, /<b>牛奶<\/b>/);
  assert.equal(document.querySelector('#shopping-content b'), null);

  await navigate('family');
  assert.match(document.querySelector('#family-page').textContent, /林家的厨房/);
  click('[data-action="invite"]');
  assert.match(document.querySelector('#sheet-body').textContent, /演示/);
  click('[data-action="close-sheet"]');

  await navigate('recipes');
  click('[data-action="add-recipe"]');
  click('[data-action="open-import"]');
  input('#import-text', '家常蒸蛋\n鸡蛋两只，加温水蒸熟。');
  document.querySelector('#import-consent').checked = true;
  document.querySelector('#import-consent').dispatchEvent(new window.Event('change', { bubbles: true }));
  click('[data-action="submit-import"]');
  click('[data-action="cancel-import"]');
  await new Promise(resolve => window.setTimeout(resolve, 1400));
  assert.match(document.querySelector('#sheet-body').textContent, /已取消/);
  assert.equal(document.querySelectorAll('.recipe-card').length, 6);
  assert.deepEqual(errors, []);
  dom.window.close();
  console.log('PASS: search, safe text rendering, favorites, detail, servings, planning, shopping, family, import cancellation.');
}

verify().catch(error => { console.error(error); process.exitCode = 1; });
