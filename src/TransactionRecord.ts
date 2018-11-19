import { Description } from './Description';
import { TransactionType } from './TransactionType';

export class TransactionRecord {
  public date: Date;
  public isReversal: boolean;
  public transactionType: TransactionType;
  public value: number;
  public isReferenceObject: boolean = false;
  public description: Description;
}
