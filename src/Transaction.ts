import { Balance } from './Balance';
import { TransactionRecord } from './TransactionRecord';

export class Transaction {
  public refnr: string;
  public bezRefnr: string;
  public kontoBez: string;
  public auszugNr: string;
  public beginningBalance: Balance;
  public closingBalance: Balance;
  public records: TransactionRecord[];
}
