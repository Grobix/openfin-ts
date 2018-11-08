import * as textBody from 'body';
import * as express from 'express';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as FinTSServer from '../dev/FinTSServer';

export default class TestServer {

  private server: http.Server;

  constructor(private bankenliste: any) {
  }

  public start(done: () => void) {
    let myFINTSServer = null;

    // Start the Server
    const ipaddr: string = process.env.IP || '127.0.0.1'; // process.env.IP;
    const port: number = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000; // process.env.PORT;
    const app = express();
    myFINTSServer = new FinTSServer();
    myFINTSServer.my_debug_log = false;
    app.get('/', (req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.send('Test FinTS Server - at /cgi-bin/hbciservlet und BLZ = 12345678');
    });

    app.post('/cgi-bin/hbciservlet', (req, res) => {
      textBody(req, res, (err, body) => {
        // err probably means invalid HTTP protocol or some shiz.
        if (err) {
          res.statusCode = 500;
          return res.end('NO U');
        }
        res.setHeader('Content-Type', 'text/plain');
        res.send(myFINTSServer.handleIncomeMessage(body));
      });
    });

    this.server = http.createServer(app);
    console.log('Listening at IP ' + ipaddr + ' on port ' + port);
    this.server.listen(port, ipaddr, () => {
      const addr = this.server.address() as AddressInfo;
      console.log('FinTS server running at:', addr.address + ':' + addr.port + '/cgi-bin/hbciservlet');
      this.bankenliste['12345678'].url = 'http://' + addr.address + ':' + addr.port + '/cgi-bin/hbciservlet';
      myFINTSServer.my_url = this.bankenliste['12345678'].url;
      myFINTSServer.my_host = addr.address + ':' + addr.port;
      done();
    });
  }

  public stop() {
    if (this.server) {
      this.server.close();
    }
  }
}
