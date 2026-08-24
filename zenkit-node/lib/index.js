'use strict';

const path = require('node:path');
const addon = require('node-gyp-build')(path.join(__dirname, '..'));

module.exports = addon;
