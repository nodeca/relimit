relimit architecture
====================

Althogh `relimit` is flexible, it was designed to restrict requests speed
to remote servers. So we use terms "links" / "domains" instead of more generic
"items" / "groups" to simplify understanding. But keep in mind that rate
limiter is universal.

There are 2 major API use cases:

- __Task queue__. Push data and forget (don't wait anything).
- __Async function call__. Push data and wait for complete.

We allow to implement both approaches:

- __.push()__ - place data into processing queue.
- __.wait()__ - Promise, resolving after all pushed data processed (you may do
  `push` + `wait` + `push` + `push`).


## Data flow

[diagram](https://www.draw.io/?lightbox=1&highlight=0000ff&edit=_blank&layers=1&nav=1&title=Relimit.xml#R1VnbbuM2EP0aA9sHLyTqYvtx7U0vwBYomgLdPtISLbOmRIGiYnu%2FvqRESqIoZ5WEbtM8BOLwfmbmzAy9CHb55ScGy%2BOvNEVkAbz0sgg%2BLwBYBYH4LwXXVhB5fivIGE5b0UDwiL8hJfSUtMYpqoyBnFLCcWkKE1oUKOGGDDJGz%2BawAyXmriXMkCV4TCCxpX%2FilB9b6drzevnPCGdHtXOsO%2FYwOWWM1oXabgGCQ%2FPXdudQL6XGV0eY0vNAFDwsgh2jlLdf%2BWWHiERWo9bO%2B%2FFGb3dshgo%2BawJoZzxBUiN95OZg%2FKqxkPcp7YXVXk%2BIcXSZUgrc6xX6mwl7QTRHnF3FODULaPCu%2Bkyqfe6RB6GSHQeo%2B7ESQqXtrFu7v7L4ULeeRiD6PgBCSaX8RBex8TaldXsxXzQaVSO5lCda5yPm6LGEiew%2BC8cQsiPPiRo8gSG4AaINlgJn6U%2BAE0yBs3IATmyBsyNYnh5If46JxGPPxFfGu%2FsNgOMtYgMIKs7oCe0ooUxIClqIkdsDJmQkggRnhWgmYjMk5FuJEBb%2B%2BUl15DhN5TaTmL8JaN0brwyrnAI%2BDmzcAwew%2B2sLd45zxCoL4X%2FP%2FlRvuDZ91bNR8cPQhiV0AAuwYRFUU9U5LjJJ8phIW%2FnPIfK9wMBogs462JxDtLHuj1IR2VSTMn6kGS0geeilIxIboIEumH8dfP8lh3yMZKsQB%2FuqZjSNvu9vxPlVhXRYcypE%2Fb5fKC1vY60OT2uWqNMr9DlkGeKmGciLPasPhgjk%2BMkM6W9C17K%2FfX043MHmXmpygnZMtwxtm4vuZHK%2Bb6Fi22CRfpJZmWR0AqsKJyNDe8acbsJj2MRMk%2FgOHlo223LUDr9R3ATFiwmr1sY4T2kNXE0aZmejdbpgohdarc2FWgishRqVdbeep8XA0uIvHOUi4ngfCC5O1Q8zojtDFf6m0j6pyVIerDlqtF1En18U1wncI7Lt0mmdH%2FQJ9aRlOEtKl95Hf2OAvwyc2MbSN1fVwOsV6OFQoTdrM7S0%2BQXBk7zfvk5Ocn2vZCjFCac2e90x330pscXj2iCeCKZgwpPXLpjNTn%2BdMRuIno2v82Lj2iZCrfn3woTrkf78V1JhNDKEceRyyIQrS%2BuQEJpAjiTWIg%2BvCOXvjw0Z5UJTVE6TFpRiJuiubQuQpa6nrEqb%2BJsJU%2FBlF540twFHjGkmN3eizI0DZ1f%2B7Bn%2BvDISZn8xP8MZOrt2bMPZ52bCfVADa32vDs2Vxah3JIRRRhNEr%2BSDEa8E3jw%2B6Ndxajw6Ao0K9orDvHTDFKKOqtqSyh8QB0EHPkEbXNZY20oEZlEZ%2F9EUXMvQpIjls4b3gveA2FQEmHgmWU2YE3BR7Nr1mCOXne%2BVcz3w%2F%2BVdowLmjtEW2HVHyWiChKaaRx1h1eQdeZADjxkxV4fAwEI293IYuyywsBXFHuoeavVvH%2BBGQuE22Y9GXKLfGo2HswlkNsABNPbvAL%2B3GR%2FJcfOsOH7t%2FiDrJ1kfywrKkwkicVQjvxdLjdahoY9oM8tSX%2FECLpr9b14ti%2FQ%2FKwYP%2FwA%3D)

All data pass through 2 limiting stages:

1. Consuming limiter. Useful to create local static restrictions:
   - max connections per domain
   - max connections per process
2. Rate limiting planner (local or shared):
   - schedule URLs requests to keep desired rate per domain
   - share restrictions between processes if needed

Only rate limits data can be shared. That's a reasonable balance between
simplicity and features for such kind of tasks.

Rate limiter uses well known leaky bucket algorythm. Result is a timestamp, when
URL request is allowed (to keep desired rate). In other words, this module can
say if URL request is allowed right now, or can look forward and say
time when request become possible.

Advantage of this approach:

- No polling required, we may know exactly when to run each request.

Disadvantage:

- We can allocate time slots far forward. But if process crashes, it will be
  impossible to reuse those time slots.

To compensate this problem, we request time slots only until immediate execution
allowed. If planner returns delay, we stop new attemps until this delay pass.
In other words, client reserves only 1 timeslot in forward future. If crash
happens, only 1 timeslot will be lost.


## State mathine

Diagram below is state machine for single domain queue.

[States diagram](https://www.draw.io/?lightbox=1&highlight=0000ff&edit=_blank&layers=1&nav=1&title=Relimit.xml#R1Vpdc%2BI2FP0tffDM9iEZf0MegaUpM5tku5DZ9olRbAGeNRaVRYD%2B%2Bkq2ZCzJBmIMSZJMxr768PXRuUdXFwxnsNzeY7BaPKAQxoZthlvD%2BWrYdte36X9m2OUGr3uXG%2BY4CnOTtTeMo%2F8gN5rcuo5CmEodCUIxiVayMUBJAgMi2QDGaCN3m6FYfuoKzKFmGAcg1q0%2Fo5As%2BGuZ5t7%2BJ4zmC%2F5kXzS8gODXHKN1wh9n2M4s%2B8mbl0BMxfunCxCiTcnkDA1ngBEi%2BdVyO4AxQ1aglo%2F7o6a1cBvDhJw0gI94BfEaCpczx8hOYEFHUNjpTX9BljG1WfSSOr5i7TAJxwQQ1jqL4niAYoSzYY6Z%2FbCuBKNfsNQym%2FEW3VvhDsQEbksm7v09REtI8I524a1O18uH7MRK5Leb%2Fao53LQoLZiwAc6TeTHxHix6wfGqwc7XsBs8PY6fH0aP9wdA3CwiAscrELCWDY0eBdgMLUE6%2Bub9FcQRdQ5iNihK5tyswD302W9LoAp67sSb6qgWtjKsbguw2p4G6%2Ffe8%2FjTg%2Bq%2BJ6Z3Gqa3K4wCmKZffmcyjRKooRus8SsMOYI0zntMV%2BltEIM0jQIZYbiNyN%2Bl63%2BKcdRV1mCKG9Zi3nqHQE3RGgdQpgMBeA5FNx55MJRUvBb6G%2FPWdLq%2BjL%2Brwe9VoC9sGMaARK%2Fy9lC1JNyJ7yiiL1V4YFny6murmr8yH1UWbGUix%2BrKE9nKRDlO2kR08cCu1G3FOqT1Dtum4rBlHvbrcH96kXugjBbuoNkshcRQKV0s5UksF6JeZjlNENL1EmYsZ6b8j2YEIKbCwcDzwZKpRf5fv40pEfovmF7N2RUIMhbkmUd5fNZqFLA1jiMRL5YUL6UIM0sR9oY4EjFTjiMRW6fGkXlrCSXhy3xj6yp2wTDSNiavYRh1lXnUfKClKFKjQvhb55YadUr%2FuigSo%2BV3aCem9AQxQSyTRRjq0RECAi7C%2F4znVXvMwTTyGP9F9nuU%2F%2B%2FEbhGfb94kOvJEHWWeltjt%2Bqq%2Fh9ntepVuVZK7CVVtXf5X63TBtL8VSpptS7I42TZJbd6JkqpQNqVk90KCe5BienfXPsTg8ynpaJQUojlDmSN7Uvr%2FrpFouEmzikiPdrDM1XbfKISWn4imj09TeuZ8HA4mI3r0FHNTt%2FLpfZ6VfOZzk6UsacGkaxycHLdiAc8Rk6LgY0rKku9vx7TFOmezE1z8IMqipmCO1VRZHHmiogR04VxOK62pL6hIp9O2tuh1ksufdkpz6gcdGtBEZjuGVMjAS9aBEZljTHt7fcP7yp4QR%2FOEBQulM6Tq0WfCEAUg7vGGZRSGbHw%2FBi8w7hf1VamemFVYq2KjiF9VborSMffOKNdf62oIVqcjLanbSiTcKFuj3ZVnaCeP14uVM5rCM4y1VW%2B5NFQjeWXBq6sgnZzdC3H7yKmUUgB0m6ZSrnlEOdsSPFXA3CMlICWZEgrfmuB1NAr%2FGP71PBxPpj96k%2BH02%2BhhNNGo%2BqlyHV89%2F1%2BzSOx0NXz5fqIoP8HrViWhKvD3CdE5xePKPKhzoiyINbhqhctTztTFPvtWlfCVirNWKmtJJbwaytb55amlN%2F%2BASlyqUKx%2FHNL72RtNppPRw3A6%2Fvb0yWVEXZOrHpnEHCVweT5BjQna%2FNamdJxQLWxYnBEycebnTpYo8ryPmihbuN20Xu6pOaoqS22pyV31c2r9Uj9XM6%2BvJq5e5Anpsu30xPoLoUKQEnraOrMkeZ0qQlUICOn8IEm1pxaHGm%2BX6un%2BQtulbytJ8pGkWvVLScLPTqpdvcBVqPWFZdqqE%2BmT%2BXl3hkRfh5%2BuJ389yWkswKYy0aUEWOXbkXTO9ZTvI5x36KO3%2By%2B%2F5d333y90hv8D)

Notes:

1. In most of use cases domain queue state depends on itself only (active request
   finished or new sheduled timestamp acheived).
2. The only use case when domain queue has foreign dependency - when we need
   global connections limit per process.

So, in (1) we always have pending signals to move forward. In (2) we can freeze
without pending signals. To avoid locks in (2), when any domain change state,
it tries to kick other domains from "PAUSING_NO_CONNECTIONS" state.

One more thing to consider. Usually, task queue have round-robin distribution.
In URL requests it may be better to increse priority for active domains to reuse
keep-alive connections (especially for SSL sessions cache).
