'use strict';


function Scheduler(options = {}) {
  // options are for tests only
  this._intervals = options.intervals || 16;
  this._get_time  = options.time || (() => Date.now());

  this._started = false;

  // TODO: cleanup old storage
  this._storage = Object.create(null);
}

Scheduler.prototype.add = function (key, rate_count, rate_period) {
  // prevent users from submitting different rate periods
  // (longer period will never allocate time slots filled by shorter one)
  key = key + ':' + rate_period;

  let intervals = this._intervals;

  let now = this._get_time();
  let bucket_interval = Math.round(rate_period / intervals);
  let start = Math.floor(now / bucket_interval) - intervals + 1;

  if (!this._storage[key]) {
    this._storage[key] = {
      buckets: new Uint32Array(intervals * 2),
      head:    start
    };
  }

  let { head, buckets } = this._storage[key];

  // 1. `head === start` - nothing to do
  // 2. `head > start` - nothing to do, assume slots are infinitely filled
  // 3. `head < start && head > start - intervals` - fill everything
  //        before start with zeros
  // 4. `head <= start - intervals` - fill everything with zeros
  if (head < start) {
    if (head <= start - intervals) {
      this._storage[key].buckets.fill(0);
    } else {
      let to = start % intervals;

      for (let i = head % intervals; i !== to; i = (i + 1) % intervals) {
        this._storage[key].buckets[i] = 0;
      }
    }

    head = start;
  }

  let count = 0;
  let pos = head;
  let scheduled_bucket;

  for (; pos < head + intervals; pos++) {
    count += buckets[pos % intervals];
  }

  if (count < rate_count) {
    scheduled_bucket = pos - 1;
    buckets[(pos - 1) % intervals]++;
  } else {
    for (; ; pos++) {
      // assert(pos - intervals === head)
      // pos % intervals === head % intervals
      // subtract old value
      let i = pos % intervals;
      count -= buckets[i];

      // advance head (if it doesn't have an effect now, it won't later)
      buckets[i] = 0;
      head++;

      if (count < rate_count) {
        scheduled_bucket = pos;
        buckets[i]++;
        break;
      }
    }
  }

  this._storage[key].head = head;

  let scheduled_time = scheduled_bucket * bucket_interval;

  return Promise.resolve(Math.max(scheduled_time - now, 0));
};

Scheduler.prototype.start = function () {
  return Promise.resolve();
};

Scheduler.prototype.shutdown = function () {
  return Promise.resolve();
};


module.exports = Scheduler;
