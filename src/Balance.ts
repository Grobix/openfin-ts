import { Figure } from './Figure';
import { TransactionType } from './TransactionType';

export class Balance {
  public isInterimBalance: boolean;
  public transactionType: TransactionType;
  public entryDate: Date;
  public figure: Figure = new Figure();

  get currency() {
    return this.figure.currency;
  }

  set currency(currency) {
    this.figure.currency = currency;
  }

  get value() {
    return this.figure.value;
  }

  set value(value) {
    this.figure.value = value;
  }
}
