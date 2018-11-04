import Order from './Order';

export default class OrderHelperChain {
  private returner = {};

  constructor(private order: Order) {
  }

  public vers(v, cb) {
    if (v instanceof Array) {
      for (const i in v) {
        this.returner[v[i]] = cb;
      }
    } else if (v) {
      this.returner[v] = cb;
    } else {
      throw new Error('Development Error ' + v + ' not defined');
    }
    return this;
  }

  public done() {
    return this.returner;
  }
}
