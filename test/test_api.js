'use strict';

const assert  = require('assert');
const Relimit = require('../');


describe('relimit', function () {
  it('rate', async function () {
    let runs = [];

    let relimit = new Relimit({
      rate: '3/80ms',
      process(item) {
        runs.push({ item, time: Date.now() });
      }
    });

    let start_time = Date.now();

    relimit.push([ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]);

    let error;

    relimit.on('error', err => {
      error = err;
    });

    await relimit.wait();

    if (error) throw error;

    let times = runs.map(r => r.time - start_time);

    assert(times[0] < 20 && times[1] < 20 && times[2] < 20);
    assert(times[3] > 20 && times[4] > 20 && times[5] > 20);
    assert(times[3] < 100 && times[4] < 100 && times[5] < 100);
    assert(times[6] > 100 && times[7] > 100 && times[8] > 100);
    assert(times[6] < 200 && times[7] < 200 && times[8] < 200);
    assert(times[9] > 150);
  });


  it('stats', async function () {
    let relimit = new Relimit({
      rate: '1000/1s',
      process() {},
      normalize(item) { return item % 2; }
    });

    assert.deepEqual(relimit.stat(), { active: 0, pending: 0, total: 0 });
    assert.deepEqual(relimit.stat('non-existent'), { active: 0, pending: 0, total: 0 });

    relimit.push([ 1, 2, 3, 4, 5 ]);

    assert.deepEqual(relimit.stat(), { active: 2, pending: 3, total: 5 });
    assert.deepEqual(relimit.stat(0), { active: 1, pending: 1, total: 2 });
    assert.deepEqual(relimit.stat(1), { active: 1, pending: 2, total: 3 });
    assert.deepEqual(relimit.stat(1234), { active: 0, pending: 0, total: 0 });

    await relimit.wait();

    assert.deepEqual(relimit.stat(), { active: 0, pending: 0, total: 0 });
    assert.deepEqual(relimit.stat(0), { active: 0, pending: 0, total: 0 });
  });


  it('consume should be able to limit active items based on stats', async function () {
    let max_global = 3;
    let max_group = 2;

    let active_count = { '': 0, 1: 0, 2: 0 };
    let group_limit_reached = 0;
    let global_limit_reached = 0;

    let relimit = new Relimit({
      rate: '1000/1s',
      consume(item) {
        if (this.stat().active >= max_global ||
            this.stat(item).active >= max_group) {

          return false;
        }

        return true;
      },
      async process(item) {
        active_count['']++;
        active_count[item]++;

        assert(active_count[''] <= max_global);
        assert(active_count[item] <= max_group);

        if (active_count[''] === max_global) global_limit_reached++;
        if (active_count[item] === max_group) group_limit_reached++;

        await new Promise(resolve => setTimeout(resolve, 10));

        assert(active_count[''] <= max_global);
        assert(active_count[item] <= max_group);

        active_count['']--;
        active_count[item]--;
      },
      normalize(item) { return item; }
    });

    relimit.push([ 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2  ]);

    await relimit.wait();

    assert(group_limit_reached);
    assert(global_limit_reached);
  });


  it('wait should return immediately if no tasks are pushed', async function () {
    let relimit = new Relimit({
      rate: '1000/1s',
      process() {}
    });

    await relimit.wait();
  });


  it('shutdown should abort pending tasks', async function () {
    let process_state = 0;

    let relimit = new Relimit({
      rate: '1/h',
      async process() {
        process_state++;
        await new Promise(resolve => setTimeout(resolve, 50));
        process_state++;
      }
    });

    relimit.push([ 1, 2, 3 ]);

    await new Promise(resolve => setTimeout(resolve, 5));

    assert.equal(process_state, 1);

    // waits until 1 finishes, does not execute 2 and 3
    await relimit.shutdown();

    assert.equal(process_state, 2);
  });


  // using callback to handle errors after test succeeds
  it('shutdown should prevent future process executions', function (callback) {
    let relimit = new Relimit({
      rate: '1/40ms',
      process() {
        // never resolves
        callback(new Error('process should never be called'));
      }
    });

    relimit.push(1);

    relimit.shutdown().then(callback, callback);
  });
});
