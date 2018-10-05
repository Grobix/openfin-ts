import * as bunyan from 'bunyan';

export default class Logger {

  public static getLogger(area: string) {
    if (area === 'main') {
      return this.main;
    }
    let logger = this.loggerMap[area];
    if (logger) {
      return logger;
    }
    logger = this.main.child({ area });
    this.loggerMap[area] = logger;
    return logger;
  }

  private static main = bunyan.createLogger({
    name: 'open-fin-ts-js-client',
    streams: [],
  });

  private static loggerMap: {[area: string]: any};
}
