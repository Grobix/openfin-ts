import Pin from './Pin';
import Tan from './Tan';

export class BPD {
  public versBpd = '0';
  public bankName = '';
  public supportedVers: any[] = ['300'];
  public url = '';
  public pin = new Pin();
  public tan = new Tan();
  public gvParameters = {};

  public clone(): BPD {
    return JSON.parse(JSON.stringify(this));
  }
}
