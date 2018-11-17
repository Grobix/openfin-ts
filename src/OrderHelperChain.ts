import { Order } from './Order';

export class OrderHelperChain {
  private returner = {};

  constructor(private order: Order) {
  }

  public vers(v: number[], cb) {
    v.forEach(i => this.returner[i] = cb);
    return this;
  }

  public done() {
    return this.returner;
  }
}
