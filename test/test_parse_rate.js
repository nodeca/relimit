'use strict';

const assert  = require('assert');
const Relimit = require('../');


describe('parse_rate', function () {
  let relimit = new Relimit({
    rate() {},
    process() {}
  });

  let parse = relimit._parse_rate;

  it('should parse rate limit', function () {
    assert.deepEqual(parse('2/3s'), [ 2, 3000 ]);
    assert.deepEqual(parse('123/456ms'), [ 123, 456 ]);
  });

  it('should default rate period number to 1', function () {
    assert.deepEqual(parse('4/s'), [ 4, 1000 ]);
  });

  it('should accept float values for rate', function () {
    assert.deepEqual(parse('5/1.5h'), [ 5, 1.5 * 60 * 60 * 1000 ]);
  });

  it('should not accept zero values for count or rate', function () {
    assert.throws(() => parse('10/0s'));
    assert.throws(() => parse('0/10s'));
  });
});
