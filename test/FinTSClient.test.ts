import { Exceptions } from '../src/Exceptions';
import { FinTSClient } from '../src/FinTSClient';
import { Saldo } from '../src/Saldo';
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
    client.msgInitDialog(makeCallback(done, () => {
      client.msgEndDialog(makeCallback(done, () => {
        client.closeSecure();
        expect(client.bpd).toBeNull();
        expect(client.upd).toBeNull();
        expect(client.konten).toBeNull();
        expect(client.pin).toBeNull();
        expect(client.tan).toBeNull();
        expect(client.sysId).toBeNull();
        done();
      }));
    }));
  });

  it('requests account information', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    client.msgInitDialog(makeCallback(done, (err) => {
      expectClientState(client);
      expect(client.konten[0].sepaData).toBe(null);
      client.msgRequestSepa(null, makeCallback(done, (error3, recvMsg3, sepaList) => {
        expect(Array.isArray(client.konten)).toBe(true);
        expect(sepaList[0].iban).toBe('DE111234567800000001');
        expect(sepaList[0].bic).toBe('GENODE00TES');
        done();
      }));
    }));
  });

  it('reports error on failed connection', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    client.msgInitDialog(makeCallback(done, (error) => {
      expectClientState(client);
      expect(client.konten[0].sepaData).toBe(null);
      client.bpd.url = 'http://thiswillnotworkurl';
      client.msgRequestSepa(null, (error3) => {
        expect(error3).not.toBeNull();
        expect(error3).toBeInstanceOf(Exceptions.ConnectionFailedException);
        done();
      });
    }));
  }, 60000);

  it('establishes a connection', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    client.establishConnection(makeCallback(done, () => {
      expectClientState(client);
      expect(client.konten[0].sepaData).not.toBeNull();
      expect(client.konten[0].sepaData.iban).toBe('DE111234567800000001');
      expect(client.konten[0].sepaData.bic).toBe('GENODE00TES');
      done();
    }));
  });

  it('fails connecting with wrong user', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, 'test2', testPin);
    client.establishConnection((error) => {
      expect(error).toBeDefined();
      done();
    });
  });

  it('fails connecting with wrong password', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, '123d');
    client.establishConnection((error) => {
      expect(error).toBeDefined();
      done();
    });
  });

  it('retrieves transactions', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    client.establishConnection(makeCallback(done, () => {
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
    }));
  });

  it('retrieves totals', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    client.establishConnection(makeCallback(done, (error) => {
      expect(client.konten[0].sepaData).not.toBeNull();
      client.msgGetSaldo(client.konten[0].sepaData, makeCallback(done, (error2, rMsg, data) => {
        expect(data.saldo).toBeDefined();
        expect(data.saldo).not.toBeNull();

        const saldo = data.saldo as Saldo;
        expect(saldo.betrag).toEqual({value: 4.36, currency: 'EUR'});
        expect(saldo.currency).toBe('EUR');
        expect(saldo.sollHaben).toBe('H');

        client.msgEndDialog(makeCallback(done, (errorEnd, recvMsg2) => {
          done();
        }));
      }));
    }));
  });

  it('checks the correct sequence of messages', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    client.establishConnection(makeCallback(done, (error) => {
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
    }));
  });

});

describe('The FinTSClient with offset', () => {
  beforeAll(() => {
    testServer.setHikas2Mode(true);
  });

  it('retrieves transactions', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    client.establishConnection(makeCallback(done, (error) => {
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
    }));
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

  it('establishes connection', (done) => {
    const client = new FinTSClient(testBlz, testBankUrl, testKundenId, testPin);
    client.establishConnection(makeCallback(done, (error) => {
      expectClientState(client);
      expect(client.konten[0].sepaData).not.toBeNull();
      expect(client.konten[0].sepaData.iban).toBe('DE111234567800000001');
      expect(client.konten[0].sepaData.bic).toBe('GENODE00TES');
      done();
    }));
  });

  afterAll(() => {
    testServer.setProtocolVersion(oldProtocolVersion);
  });
});
