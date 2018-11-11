import Order from './Order';

export class OrderHelperChain {
  private returner = {};

  constructor(private order: Order) {
  }

  public vers(v, cb) {
    if (v instanceof Array) {
      for (const i in v) {
        this.returner[v[i]] = cb;
      }
    }
    return this;
  }

  public done() {
    return this.returner;
  }
}
