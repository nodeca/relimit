'use strict';


const Denque    = require('denque');
const events    = require('events');
const util      = require('util');
const Scheduler = require('./scheduler_local');

const STATE_EMPTY              = 0;
const STATE_CONSUMING          = 1;
const STATE_PAUSING            = 2;
const STATE_PAUSING_NO_ACTIVE  = 3;
const STATE_REQUEST_RATE_LIMIT = 4;
const STATE_AWAIT_TIME_SLOT    = 5;


function Relimit(options = {}) {
  if (!(this instanceof Relimit)) return new Relimit(options);

  if (options.consume && typeof options.consume !== 'function') {
    throw new Error('`consume` must be a function');
  }

  if (options.normalize && typeof options.normalize !== 'function') {
    throw new Error('`normalize` must be a function');
  }

  if (typeof options.process !== 'function') {
    throw new Error('`process` must be a function');
  }

  if (typeof options.rate === 'function') {
    this._rate = options.rate;
  } else if (typeof options.rate === 'string') {
    this._rate = () => options.rate;
  } else {
    throw new Error('`rate` must be a function or a string');
  }

  this._scheduler = new Scheduler();

  this._groups = Object.create(null);
  this._stats = {
    pending: 0,
    active: 0,
    scheduled: 0,
    total: 0
  };

  this._consume   = options.consume   || (() => true);
  this._normalize = options.normalize || (() => '');
  this._process   = options.process;

  this._groups_pausing_no_active = new Set();
  this._scheduled_timers = new Set();

  this._shutdown_called = false;
}

util.inherits(Relimit, events.EventEmitter);


// Push a new item into the queue
//
Relimit.prototype.push = function (items) {
  if (!Array.isArray(items)) items = [ items ];

  for (let item of items) {
    let key = this._normalize(item);

    if (!this._groups[key]) {
      let [ rate_count, rate_period ] = this._parse_rate(this._rate(item));

      this._groups[key] = {
        state: STATE_EMPTY,
        rate_count,
        rate_period,
        consume_successes: 0,
        pending: new Denque(),
        stats: {
          pending: 0,
          active: 0,
          scheduled: 0,
          total: 0
        }
      };
    }

    let group = this._groups[key];

    group.pending.push(item);

    group.stats.pending++;
    group.stats.total++;
    this._stats.pending++;
    this._stats.total++;

    if (group.state === STATE_EMPTY) {
      this._set_group_state(key, STATE_CONSUMING);
      this._consume_group_items(key); // async function runs in background
    }
  }
};


// Return stats for a group or global stats
//
Relimit.prototype.stat = function (key) {
  if (key === null || typeof key === 'undefined') {
    // return global stats
    return {
      total:   this._stats.total,
      active:  this._stats.active,
      pending: this._stats.pending + this._stats.scheduled
    };
  }

  let group = this._groups[key];

  if (!group) {
    return { total: 0, active: 0, pending: 0 };
  }

  return {
    total:   group.stats.total,
    active:  group.stats.active,
    pending: group.stats.pending + group.stats.scheduled
  };
};


// Resolves when all items are finished, fails on any error in relimit
//
Relimit.prototype.wait = function () {
  if (this._stats.total === 0 && Object.keys(this._groups).length === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    /* eslint-disable no-use-before-define */
    let on_drain = () => {
      this.removeListener('drain', on_drain);
      this.removeListener('error', on_error);
      resolve();
    };

    let on_error = err => {
      this.removeListener('drain', on_drain);
      this.removeListener('error', on_error);
      reject(err);
    };
    /* eslint-enable no-use-before-define */

    this.on('drain', on_drain);
    this.on('error', on_error);
  });
};


// Explicitly start redis instance. Not required to call, it will be done
// automatically on first redis query.
//
Relimit.prototype.start = function () {
  return this._scheduler.start();
};


// Clear all timers, shutdown redis.
//
Relimit.prototype.shutdown = async function () {
  this._shutdown_called = true;

  for (let timer of this._scheduled_timers) clearTimeout(timer);
  this._scheduled_timers.clear();

  for (let key of Object.keys(this._groups)) {
    let group = this._groups[key];

    group.stats.total -= group.stats.pending;
    group.stats.total -= group.stats.scheduled;
    group.stats.pending = 0;
    group.stats.scheduled = 0;

    group.pending.clear();

    this._set_group_state(key, STATE_EMPTY);

    if (group.stats.total === 0) {
      delete this._groups[key];
    }
  }

  this._stats.total -= this._stats.pending;
  this._stats.total -= this._stats.scheduled;
  this._stats.pending = 0;
  this._stats.scheduled = 0;

  if (this._stats.total === 0 && Object.keys(this._groups).length === 0) {
    this.emit('drain');
  }

  await this._scheduler.shutdown();

  return this.wait();
};


let parse_rate_periods = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000
};

Relimit.prototype._parse_rate = function (str) {
  let m = str.match(/^([1-9]\d*?)\/([1-9]\d*(?:\.\d+)?)?(ms|s|m|h|d)$/);

  if (!m) throw new Error('Invalid rate: ' + str);

  return [
    Number(m[1]),
    Number(m[2] || 1) * parse_rate_periods[m[3]]
  ];
};


// Change group state, update indexes accordingly
//
Relimit.prototype._set_group_state = function (key, new_state) {
  let group = this._groups[key];

  if (group.state === STATE_PAUSING_NO_ACTIVE) {
    this._groups_pausing_no_active.delete(key);
  }

  group.state = new_state;

  if (group.state === STATE_PAUSING_NO_ACTIVE) {
    this._groups_pausing_no_active.add(key);
  }
};


// Schedule items for a group in CONSUMING state
//
Relimit.prototype._consume_group_items = async function (key) {
  try {
    let group = this._groups[key];
    let item = this._groups[key].pending.peekFront();

    let consume_result;

    if (group.consume_successes > 0) {
      consume_result = true;
      group.consume_successes--;
    } else {
      consume_result = this._consume(item);
    }

    if (!consume_result) {
      if (group.stats.active || group.stats.scheduled) {
        this._set_group_state(key, STATE_PAUSING);
      } else {
        this._set_group_state(key, STATE_PAUSING_NO_ACTIVE);
      }
      return;
    }

    this._groups[key].pending.shift();

    this._set_group_state(key, STATE_REQUEST_RATE_LIMIT);

    let time_offset = await this._scheduler.add(key, group.rate_count, group.rate_period);

    // relimit.shutdown was called while we've been waiting on scheduler
    if (this._shutdown_called) return;

    group.stats.pending--;
    group.stats.scheduled++;
    this._stats.pending--;
    this._stats.scheduled++;

    let timer;
    let wrapped_timer = { timer };

    if (time_offset > 0) {
      timer = setTimeout(this._process_item.bind(this), time_offset, item, key, wrapped_timer);
      this._scheduled_timers.add(timer);
    } else {
      process.nextTick(this._process_item.bind(this), item, key, wrapped_timer);
    }

    if (this._groups[key].pending.length === 0) {
      this._set_group_state(key, STATE_EMPTY);
      return;
    }

    if (time_offset > 0) {
      this._set_group_state(key, STATE_AWAIT_TIME_SLOT);
      return;
    }

    this._set_group_state(key, STATE_CONSUMING);

    // recursive call, no await is necessary here
    // async function runs in background
    this._consume_group_items(key);

  } catch (err) {
    this.emit('error', err);
  }
};


// Move group in PAUSED state into CONSUMING state if consume returns true
//
Relimit.prototype._try_unpause = function (key) {
  let group = this._groups[key];

  if (!this._consume(group.pending.peekFront())) return false;

  group.consume_successes++;
  this._set_group_state(key, STATE_CONSUMING);
  this._consume_group_items(key); // async function runs in background

  return true;
};


// Execute a single item, update counters and unpause groups
// after execution as necessary
//
Relimit.prototype._process_item = async function (item, key, wrapped_timer) {
  if (wrapped_timer) {
    this._scheduled_timers.delete(wrapped_timer.timer);
  }

  // setTimeouts get cleared on shutdown, but process.nextTick does not;
  // prevent it from triggering process()
  if (this._shutdown_called) return;

  let group = this._groups[key];

  group.stats.scheduled--;
  group.stats.active++;
  this._stats.scheduled--;
  this._stats.active++;

  try {
    let promise = this._process(item);

    if (group.state === STATE_AWAIT_TIME_SLOT) {
      this._set_group_state(key, STATE_CONSUMING);
      this._consume_group_items(key); // async function runs in background
    }

    await promise;
  } catch (err) {
    this.emit('error', err);
  }

  group.stats.active--;
  group.stats.total--;
  this._stats.active--;
  this._stats.total--;

  if (group.state === STATE_EMPTY && group.stats.total === 0) {
    delete this._groups[key];

    if (this._stats.total === 0 && Object.keys(this._groups).length === 0) {
      this.emit('drain');
    }
  }

  if (group.state === STATE_PAUSING) {
    if (group.stats.active === 0) {
      this._set_group_state(key, STATE_PAUSING_NO_ACTIVE);
    }

    this._try_unpause(key);
  }

  for (let k of this._groups_pausing_no_active) {
    if (!this._try_unpause(k)) break;
  }
};


module.exports = Relimit;
