const fs = require('node:fs');
const path = require('node:path');
const BASE = path.resolve(__dirname, '../dist/build/mp-weixin/pages');
const pages = ['account/login', 'family/onboarding', 'recipes/index', 'imports/submit', 'imports/status', 'recipes/detail', 'planning/index', 'planning/edit'];
for (const page of pages) {
  const wxml = fs.readFileSync(path.join(BASE, page + '.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(BASE, page + '.js'), 'utf8');
  const map = {};
  const tags = wxml.match(/<home-action[^>]*>/g) || [];
  for (const tag of tags) {
    const data = (tag.match(/data-([a-z-]+)=/) || [])[1];
    const bind = (tag.match(/bindclick="\{\{([A-Za-z]+)\}\}"/) || [])[1];
    if (!bind) continue;
    const re = new RegExp(bind + ':\\s*[\\w.$]*o\\([\\s\\S]*?,\\s*"([a-z0-9]+)"\\)');
    const id = (js.match(re) || [])[1];
    if (data && id) map[data] = id;
  }
  const inputs = wxml.match(/<(input|textarea)[^>]*>/g) || [];
  for (const tag of inputs) {
    const idAttr = (tag.match(/id="([^"]+)"/) || [])[1];
    const bind = (tag.match(/bindinput="\{\{([A-Za-z]+)\}\}"/) || [])[1];
    if (!bind) continue;
    const re = new RegExp(bind + ':\\s*[\\w.$]*o\\([\\s\\S]*?,\\s*"([a-z0-9]+)"\\)');
    const hid = (js.match(re) || [])[1];
    if (idAttr && hid) map['input#' + idAttr] = hid;
  }
  console.log(page, JSON.stringify(map));
}