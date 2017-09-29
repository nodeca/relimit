relimit
=======

[![Build Status](https://img.shields.io/travis/nodeca/relimit/master.svg?style=flat)](https://travis-ci.org/nodeca/relimit)
[![NPM version](https://img.shields.io/npm/v/relimit.svg?style=flat)](https://www.npmjs.org/package/relimit)
[![Coverage Status](https://coveralls.io/repos/github/nodeca/relimit/badge.svg?branch=master)](https://coveralls.io/github/nodeca/relimit?branch=master)


> Distributed rate limiter with tuneable scheduler.

Imagine, that you need to scan 1M of pages/images/videos. To do it effectively, you may wish:

- limit each domain to 4 scans/sec to avoid bans
- increase limit to 100 scans/sec for well known services like google
- restrict number of parallel connections to each domain
- restrict total outgoing connections from process to control resources
- distribute scans to cluster for miltiple IPs use and speed increase

All this things can be done with `relimit`! Built in redis adapter available
for distributed use.


Install
-------

`node.js` 8+ and `redis` 3.0+ required.

```sh
npm install idoit --save
```


API
---

### new Relimit({ scheduler, rate, normalize, consume, process, ns })

- **scheduler** (String) - optional, redis connection url if shared use needed.
  If not defined - local scheduler will be used.
- **rate(item)** (Function|String) - `"4/s"`, `100/2m` or function(item),
  returning such kind of string. Where `item` is single element of `relimit`
  input.
- **normalize(item)** (Function) - return grouping key for incoming item. For
  example, if input items are URLs, you may return domain name.
- **consume(item)** - consumer strategy, return `true` to allocate execution
  slot immediately, or `false` to postpone attempt. Default - return `true`.
- **process(item)** (AsyncFunction) - function to process incoming item, when
  time come.
- **ns** (String) - data namespace, currently used as redis keys prefix,
   "relimit:" by default.

Note on `consume(item)`. Imagine, that you run distributed limiter, and some
process can crash. If you allocate execution time for all incoming items
immediately, then after crash all such slots will be lost (will not be used).
Better idea will be to allocate slots only until available, and retry with the
rest of items later. Also, you may use internal stats about domain or total
active connections from local `relimit` instance to restrivt those.

Note on `rate(item)`. You may wish return different rates for different domains.
But value MUST be the same for the same domain (normalized item), that's
important.

Note on `process(item)`. This function is shceduled to do necessary actions on
incoming items. IT SHOULD NOT FAIL. Failure state is NOT `relimit` duty. You
may store result to retry later, readd new item to queue and so on. If you
return error, it will be forwarded to logger, but item will be marked as
processed.


### .push([ items ])

Place Array[item] or single item to incoming queue.


### .wait() -> Promise

Resolve when `relimit` idle (all job done).


### .stat(key) -> { total, active, pending }

Return statistics about specific items group or global one if `key` not set.
`key` is result of `normalize(item)` (for example, link -> domain).



### ? .start()

### ? .shutdown()

### ? .ready()

### ? .on('eventName', handler)


Why one more limiter?
---------------------

We needed customizeable rates and more convenient API for our needs. This one
is focused on massive URL requests use cases.

Note. Don't try to use this package for CPU management (reinventing system
scheduler for job queue). Use [idoit](https://github.com/nodeca/idoit) instead.

Other rate limiters:

- https://github.com/eventEmitter/leaky-bucket
- https://github.com/jesucarr/tokenbucket
- https://github.com/andyburke/tokenpipe
- https://github.com/tj/node-ratelimiter
- https://github.com/TabDigital/redis-rate-limiter
- https://github.com/classdojo/rolling-rate-limiter
