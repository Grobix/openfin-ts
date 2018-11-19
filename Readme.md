# openfin-ts

[![Build Status](https://travis-ci.org/ckosmowski/openfin-ts.svg?branch=master)](https://travis-ci.org/ckosmowski/openfin-ts) [![Coverage Status](https://coveralls.io/repos/github/ckosmowski/openfin-ts/badge.svg?branch=master)](https://coveralls.io/github/ckosmowski/openfin-ts?branch=master)

Typescript compatible fints implementation

## Install

```sh
//npm
npm install --save openfin-ts
//yarn
yarn add openfin-ts
```

## Example
```typescript
import { FinTSClient } from 'openfin-ts';

const client = new FinTSClient("12345",
    "http://testbank.com/hbci",
    "customerId",
    "1234pin");

try {
  await client.connect();
  const transactions = await client.getTransactions(client.konten[0].sepaData, null, null);
  transactions.forEach(transaction => {
        //Do things with transactions
  });
  await client.close();
} catch (err) {
  //handle errors
}
```

For more examples see the tests in `/test`