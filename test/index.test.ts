import FinTSClient from '../src/FinTSClient';
import TestServer from './TestServer';
import { Exceptions } from '../src/Exceptions';

let testServer: TestServer;
const bankenliste = {
  12345678: {
    blz: 12345678,
    url: 'http://TOBESET/cgi-bin/hbciservlet',
  },
};

function makeCallback(done, body) {
  return (...args) => {
    if (args[0] instanceof Error) {
      done.fail(args[0] as Error);
      return;
    }
    try {
      body(...args);
    } catch (error) {
      done.fail(error);
    }
  };
}

describe('The FinTSClient', () => {

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
    testServer.start(done);
  });

  afterAll(() => {
    testServer.stop();
  });

  it('initializes a dialog', (done) => {
    const client = new FinTSClient('12345678', 'test1', '1234', bankenliste);
    client.msgInitDialog(makeCallback(done, (error, recvMsg, hasNewUrl) => {
      expectClientState(client);
      expect(client.konten[0].sepaData).toBe(null);
      done();
    }));
  });

  it('throws an error for a wrong user', (done) => {
    const client = new FinTSClient('12345678', 'test2', '1234', bankenliste);
    client.msgInitDialog((error) => {
      expect(error).toBeDefined();
      done();
    });
  });

  it('throws an error for a wrong pin', (done) => {
    const client = new FinTSClient('12345678', 'test1', '12341', bankenliste);
    client.msgInitDialog((error) => {
      expect(error).toBeDefined();
      done();
    });
  });

  it('ends the dialog', (done) => {
    const client = new FinTSClient('12345678', 'test1', '1234', bankenliste);
    client.msgInitDialog(makeCallback(done, () => {
      client.msgEndDialog(makeCallback(done, () => {
        done();
      }));
    }));
  });

  it('requests account information', (done) => {
    const client = new FinTSClient('12345678', 'test1', '1234', bankenliste);
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
    const client = new FinTSClient('12345678', 'test1', '1234', bankenliste);
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
  });

  it('establishes a connection', (done) => {
    const client = new FinTSClient('12345678', 'test1', '1234', bankenliste);
    client.establishConnection(makeCallback(done, () => {
      expectClientState(client);
      expect(client.konten[0].sepaData).not.toBeNull();
      expect(client.konten[0].sepaData.iban).toBe('DE111234567800000001');
      expect(client.konten[0].sepaData.bic).toBe('GENODE00TES');
      done();
    }));
  });

  it('fails connecting with wrong user', (done) => {
    const client = new FinTSClient('12345678', 'test1_wrong_user', '1234', bankenliste);
    client.establishConnection((error) => {
      expect(error).toBeDefined();
      done();
    });
  });

  it('fails connecting with wrong password', (done) => {
    const client = new FinTSClient('12345678', 'test1', '123d', bankenliste);
    client.establishConnection((error) => {
      expect(error).toBeDefined();
      done();
    });
  });

  it('retrieves transactions', (done) => {
    const client = new FinTSClient('12345678', 'test1', '1234', bankenliste);
    client.establishConnection(makeCallback(done, () => {
      expect(client.konten[0].sepaData).not.toBeNull();
      client.msgGetKontoUmsaetze(client.konten[0].sepaData, null, null, makeCallback(done, (error2, rMsg, data) => {
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

});
