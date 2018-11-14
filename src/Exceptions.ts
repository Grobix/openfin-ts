import { DatenElementGruppe } from './DatenElementGruppe';

export namespace Exceptions {

  export class OpenFinTSClientException extends Error {
    constructor(message: string) {
      super(message);
      Object.setPrototypeOf(this, OpenFinTSClientException.prototype);
    }
    public toString() {
      return this.message ? this.message : 'OpenFinTSClientException';
    }
  }

  export class GVNotSupportedByKI extends OpenFinTSClientException {

    public spVers: any;

    constructor(gvType: any, avail: any) {
      super('There is no version of ' + gvType + ' which is supported by both, the client and the server.');
      this.spVers = avail ? [] : Object.keys(avail);
      Object.setPrototypeOf(this, GVNotSupportedByKI.prototype);
    }
  }

  export class MalformedMessageFormat extends OpenFinTSClientException {
    constructor(message: string) {
      super('MalformedMessageFormat: ' + message);
      Object.setPrototypeOf(this, MalformedMessageFormat.prototype);
    }
  }

  export class OrderFailedException extends OpenFinTSClientException {
    public msgDetail;
    constructor(msg: DatenElementGruppe) {
      super('Failed to perform Order, got error Message from Server.:' + msg.getEl(3));
      this.msgDetail = msg;
      Object.setPrototypeOf(this, OrderFailedException.prototype);
    }
  }

  export class InternalError extends OpenFinTSClientException {
    constructor(message: string) {
      super(message);
      Object.setPrototypeOf(this, InternalError.prototype);
    }
  }

  export class GVFailedAtKI extends OpenFinTSClientException {

    public data: any;

    constructor(msg) {
      super('GVFailed because Msg: ' + msg.data[0].data + ' - ' + msg.data[2].data);
      this.data = msg;
      Object.setPrototypeOf(this, GVFailedAtKI.prototype);
    }
  }

  export class ConnectionFailedException extends OpenFinTSClientException {
    public host;
    constructor(hostname: string, port?: string, path?: string) {
      super(hostname);
      this.host = hostname;
      Object.setPrototypeOf(this, ConnectionFailedException.prototype);
    }
    public toString() {
      return 'Connection to ' + this.host + ' failed.';
    }
  }

  export class MissingBankConnectionDataException extends OpenFinTSClientException {
    public blz;
    constructor(blz: string) {
      super(blz);
      this.blz = blz;
      Object.setPrototypeOf(this, MissingBankConnectionDataException.prototype);
    }
    public toString() {
      return 'No connection Url in Bankenliste found to connect to blz: ' + this.blz + '.';
    }
  }

  export class OutofSequenceMessageException extends OpenFinTSClientException {
    public blz;
    constructor(blz?: string) {
      super(blz);
      this.blz = blz;
      Object.setPrototypeOf(this, OutofSequenceMessageException.prototype);
    }
    public toString() {
      return 'You have to ensure that only one message at a time is send to the server, use libraries like async or promisses. You can send a new message as soon as the callback returns.';
    }
  }

}
