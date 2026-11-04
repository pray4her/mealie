// Generated; change cloud-policies, never this file.
const upstream = require('./upstream/entry');
const { createEntry } = require('./policy.cjs');
const { createRequireIdentity, createUniIdPorts, createRequestLimiter, now } = require('home-kernel');
const limiter = createRequestLimiter({now, windowMs:60000, maxPerWindow:10, maxKeys:1024});
module.exports = createEntry({ upstream, limiter, requireIdentity: (token, info, options) => createRequireIdentity({...createUniIdPorts(info),now})(token,info,options) });
