/*
Copyright 2020 - 2026, Robin de Gruijter (gruijter@hotmail.com)

This file is part of com.gruijter.facepp.

com.gruijter.facepp is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

com.gruijter.facepp is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with com.gruijter.facepp.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

/* eslint-disable no-await-in-loop */

const timersPromises = require('node:timers/promises');

// accessed as timersPromises.setTimeout(...) at call time, not destructured at module
// load time, so that test-time timer mocking can intercept it

// Self-written replacement for `smart-request-balancer`. Face++'s API only ever needs a
// flat rolling-window rate limit per named rule (this app used 'common': 3req/s and
// 'faceSet': 2req/s, and never exercised smart-request-balancer's overall-queue cap or
// priority system), so this reimplements that: "at most `ratePerSecond` requests
// belonging to a given rule may start within any rolling 1-second window". A rule can
// additionally cap `maxConcurrent` in-flight requests - needed for 'faceSet': Face++
// only allows 1 concurrent request per account for those endpoints, so firing 2/s
// without waiting for the first to finish reliably hits Face++'s own
// CONCURRENCY_LIMIT_EXCEEDED and burns through queueMessage()'s retries. Confirmed live
// (2026-08-22): a faceset resync of 10 faces took ~21s and dozens of retries before this
// was added. `maxConcurrent` defaults to unlimited, so 'common' keeps its original
// rate-only behavior.
class RequestQueue {
  // @param {Object<string, { ratePerSecond: number, maxConcurrent?: number }>} rules
  constructor(rules) {
    this.rules = {};
    Object.keys(rules).forEach((name) => {
      this.rules[name] = {
        ratePerSecond: rules[name].ratePerSecond,
        maxConcurrent: rules[name].maxConcurrent || Infinity,
        pending: [],
        dispatchTimestamps: [],
        active: 0,
        waiters: [], // resolve callbacks parked until a concurrency slot frees up
        draining: false,
      };
    });
  }

  // @param {() => Promise<*>} fn
  // @param {string} ruleName one of the names passed to the constructor
  // @returns {Promise<*>} resolves/rejects with fn()'s own outcome
  enqueue(fn, ruleName) {
    const rule = this.rules[ruleName];
    if (!rule) throw Error(`Unknown request queue rule: ${ruleName}`);
    return new Promise((resolve, reject) => {
      rule.pending.push({ fn, resolve, reject });
      this._drain(rule);
    });
  }

  async _drain(rule) {
    if (rule.draining) return;
    rule.draining = true;
    while (rule.pending.length > 0) {
      if (rule.active >= rule.maxConcurrent) {
        await new Promise((resolve) => rule.waiters.push(resolve)); // eslint-disable-line no-await-in-loop
        continue; // eslint-disable-line no-continue
      }
      const waitMs = this._nextSlotDelayMs(rule);
      if (waitMs > 0) await timersPromises.setTimeout(waitMs);
      const { fn, resolve, reject } = rule.pending.shift();
      rule.dispatchTimestamps.push(Date.now());
      rule.active += 1;
      fn().then(resolve, reject).finally(() => {
        rule.active -= 1;
        const nextWaiter = rule.waiters.shift();
        if (nextWaiter) nextWaiter();
      });
    }
    rule.draining = false;
  }

  _nextSlotDelayMs(rule) {
    const now = Date.now();
    rule.dispatchTimestamps = rule.dispatchTimestamps.filter((t) => now - t < 1000);
    if (rule.dispatchTimestamps.length < rule.ratePerSecond) return 0;
    const oldest = rule.dispatchTimestamps[0];
    return Math.max(0, 1000 - (now - oldest));
  }

}

module.exports = RequestQueue;
