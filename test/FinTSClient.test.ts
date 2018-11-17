import { Konto } from '../src';
import { Exceptions } from '../src/Exceptions';
import { FinTSClient } from '../src/FinTSClient';
import { Saldo } from '../src/Saldo';
import { TotalResult } from '../src/TotalResult';
import { Umsatz } from '../src/Umsatz';
import { makeCallback } from './TestHelpers';
import TestServer from './TestServer';

let testServer: TestServer;
const bankenliste = {
  12345678: {
    blz: 12345678,
    url: 'http://TOBESET/cgi-bin/hbciservlet',
  },
};
const testBlz = '12345678';
let testBankUrl = '';
const testKundenId = 'test1';
const testPin = '1234';

const expectClientState = (client: FinTSClient) => {
  expect(client.bpd).toHaveProperty('versBpd', '78');
  expect(client.upd).toHaveProperty('versUpd', '3');
  expect(client.sysId).toBe('DDDA10000000000000000000000A');
  expect(Array.isArray(client.konten)).toBe(true);
  expect(client.konten).toHaveLength(2);
  expect(client.konten[0].iban).toBe('DE111234567800000001');
};

beforeAll(async (done) => {
  testServer = new TestServer(bankenliste);
  testServer.start(() => {
    testBankUrl = bankenliste[testBlz].url;
    done();
  });
});

afterAll(() => {
  testServer.stop();
});

describe('The FinTSClient', () => {

  it('initializes a dialog', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    client.msgInitDialog(makeCallback(done, (error, recvMsg, hasNewUrl) => {
      expectClientState(client);
      expect(client.konten[0].sepaData).toBe(null);
      done();
    }));
  });

  it('throws an error for a wrong user', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, 'test2', testPin);
    client.msgInitDialog((error) => {
      expect(error).toBeDefined();
      done();
    });
  });

  it('throws an error for a wrong pin', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, '12341');
    client.msgInitDialog((error) => {
      expect(error).toBeDefined();
      done();
    });
  });

  it('ends the dialog, closes secure', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    client.msgInitDialog(makeCallback(done, async () => {
      await client.close();
      client.closeSecure();
      expect(client.bpd).toBeNull();
      expect(client.upd).toBeNull();
      expect(client.konten).toBeNull();
      expect(client.pin).toBeNull();
      expect(client.tan).toBeNull();
      expect(client.sysId).toBeNull();
      done();
    }));
  });

  it('requests account information', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    client.msgInitDialog(makeCallback(done, async (err) => {
      expectClientState(client);
      expect(client.konten[0].sepaData).toBe(null);
      const sepaList = await client.getSepa(null);
      expect(Array.isArray(client.konten)).toBe(true);
      expect(sepaList[0].iban).toBe('DE111234567800000001');
      expect(sepaList[0].bic).toBe('GENODE00TES');
      done();
    }));
  });

  it('reports error on failed connection', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    client.msgInitDialog(makeCallback(done, async (error) => {
      expectClientState(client);
      expect(client.konten[0].sepaData).toBe(null);
      client.bpd.url = 'http://thiswillnotworkurl';
      try {
        const sepaList = await client.getSepa(null);
        done.fail('Should fail with wrong url');
      } catch (err) {
        expect(err).not.toBeNull();
        expect(err).toBeInstanceOf(Exceptions.ConnectionFailedException);
        done();
      }
    }));
  }, 60000);

  it('establishes a connection', async (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    try {
      await client.connect();
      expectClientState(client);
      expect(client.konten[0].sepaData).not.toBeNull();
      expect(client.konten[0].sepaData.iban).toBe('DE111234567800000001');
      expect(client.konten[0].sepaData.bic).toBe('GENODE00TES');
      done();
    } catch (err) {
      done.fail(err);
    }
  });

  it('fails connecting with wrong user', async (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, 'test2', testPin);
    try {
      await client.connect();
      done.fail('Should fail with wrong user');
    } catch (err) {
      expect(err).toBeDefined();
      done();
    }
  });

  it('fails connecting with wrong password', async (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, '123d');
    try {
      await client.connect();
      done.fail('Should fail with wrong password');
    } catch (err) {
      expect(err).toBeDefined();
      done();
    }
  });

  it('retrieves transactions', async (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    try {
      await client.connect();
      expect(client.konten[0].sepaData).not.toBeNull();
      client.msgGetKontoUmsaetze(client.konten[0].sepaData, null, null, makeCallback(done, (error2, rMsg, data: Umsatz[]) => {
        // Alles gut
        expect(data).not.toBeNull();
        expect(Array.isArray(data)).toBe(true);
        expect(data[0]).not.toBeNull();
        expect(data[1]).not.toBeNull();
        expect(data[0].schlusssaldo.value).toBe(1223.57);
        expect(data[1].schlusssaldo.value).toBe(1423.6);
        // Test converter
        const transActions = client.convertUmsatzeArrayToListofAllTransactions(data);
        expect(transActions).not.toBeNull();
        expect(Array.isArray(transActions)).toBe(true);
        expect(transActions[0]).toBeDefined();
        expect(transActions[1]).toBeDefined();
        expect(transActions[2]).toBeDefined();
        expect(transActions[3]).toBeUndefined();

        expect(transActions[0].value).toBe(182.34);
        expect(transActions[1].value).toBe(100.03);
        expect(transActions[2].value).toBe(100.00);
        // Testcase erweitern
        done();
      }));
    } catch (err) {
      done.fail(err);
    }
  });

  it('retrieves totals', async (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    try {
      await client.connect();
      expect(client.konten[0].sepaData).not.toBeNull();
      const data = await client.getTotal(client.konten[0].sepaData);
      expect(data.total).toBeDefined();
      expect(data.total).not.toBeNull();

      const total = data.total as Saldo;
      expect(total.betrag).toEqual({ value: 4.36, currency: 'EUR' });
      expect(total.currency).toBe('EUR');
      expect(total.sollHaben).toBe('H');

      await client.close();
      done();
    } catch (err) {
      done.fail(err);
    }
  });

  it('checks the correct sequence of messages', async (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    try {
      await client.connect();
      let errorChecked = false;
      expect(client.konten[0].sepaData).not.toBeNull();
      client.msgGetKontoUmsaetze(client.konten[0].sepaData, null, null, makeCallback(done, (error2, rMsg, data) => {
        expect(data).not.toBeNull();
        expect(Array.isArray(data)).toBe(true);
        expect(data[0]).not.toBeNull();
        expect(data[1]).not.toBeNull();
        expect(data[0].schlusssaldo.value).toBe(1223.57);
        expect(data[1].schlusssaldo.value).toBe(1423.6);

        expect(errorChecked).toBe(true);
        done();
      }));
      // das ist der eigentliche Test
      try {
        client.msgGetKontoUmsaetze(client.konten[0].sepaData, null, null, makeCallback(done, (error2, rMsg, data) => {
        }));
      } catch (errorToCheck) {
        expect(errorToCheck).not.toBeNull();
        expect(errorToCheck).toBeInstanceOf(Exceptions.OutofSequenceMessageException);
        expect(errorToCheck.toString()).not.toBeNull();
        errorChecked = true;
      }
    } catch (err) {
      done.fail(err);
    }
  });

});

describe('The FinTSClient with offset', () => {
  beforeAll(() => {
    testServer.setHikas2Mode(true);
  });

  it('retrieves transactions', async (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    try {
      await client.connect();
      expect(client.konten[0].sepaData).not.toBeNull();
      client.msgGetKontoUmsaetze(client.konten[0].sepaData, null, null, makeCallback(done, (error2, rMsg, data: Umsatz[]) => {
        expect(data).not.toBeNull();
        expect(Array.isArray(data)).toBe(true);
        expect(data[0]).not.toBeNull();
        expect(data[1]).not.toBeNull();
        expect(data[0].schlusssaldo.value).toBe(1223.57);
        expect(data[1].schlusssaldo.value).toBe(1423.6);
        // Testcase erweitern
        done();
      }));
    } catch (err) {
      done.fail(err);
    }
  });

  afterAll(() => {
    testServer.setHikas2Mode(false);
  });
});

describe('The FinTSClient with HBCI 2.2 protocol', () => {
  let oldProtocolVersion: number;
  beforeAll(() => {
    oldProtocolVersion = testServer.getProtocolVersion();
    testServer.setProtocolVersion(220);
  });

  it('establishes connection', async (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    try {
      await client.connect();
      expectClientState(client);
      expect(client.konten[0].sepaData).not.toBeNull();
      expect(client.konten[0].sepaData.iban).toBe('DE111234567800000001');
      expect(client.konten[0].sepaData.bic).toBe('GENODE00TES');
      done();
    } catch (err) {
      done.fail(err);
    }
  });

  afterAll(() => {
    testServer.setProtocolVersion(oldProtocolVersion);
  });
});
