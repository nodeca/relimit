'use strict';


const assert    = require('assert');
const Scheduler = require('../lib/scheduler_local');


describe('scheduler_local', function () {
  it('should schedule item with a new key immediately', async function () {
    let now;
    let sch = new Scheduler({ intervals: 5, time: () => now });

    now = 1234010;

    let timeout = await sch.add('key', 10, 1000);

    assert.equal(timeout, 0);
  });


  it('should rate limit runs', async function () {
    let now;
    let sch = new Scheduler({ intervals: 4, time: () => now });

    sch._get_time = () => now;

    now = 1234010;

    let timeouts = [];

    for (let i = 0; i < 10; i++) {
      timeouts.push(await sch.add('key', 3, 1000));
    }

    assert.deepEqual(timeouts, [
      0, 0, 0,
      990, 990, 990,
      1990, 1990, 1990,
      2990
    ]);
  });


  it('regression test for updating bucket start', async function () {
    let now;
    let sch = new Scheduler({ time: () => now, intervals: 8 });
    let result = [];

    let times = [
      1507736110897,
      1507736110899,
      1507736110900,
      1507736110900,
      1507736110902,
      1507736110951,
      1507736110952,
      1507736110953,
      1507736110953,
      1507736110954
    ];

    for (let ts of times) {
      now = ts;

      result.push(await sch.add('key', 3, 80) + ts - times[0]);
    }

    assert.deepEqual(result, [ 0, 2, 3, 73, 73, 83, 153, 153, 163, 233 ]);
  });
});
