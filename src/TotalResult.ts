import { Betrag } from './Betrag';
import { Saldo } from './Saldo';

export class TotalResult {
  public desc: string;
  public currency: string;
  public total: Saldo;
  public totalReserved: Saldo;
  public creditLine: Betrag;
  public availableAmount: Betrag;
  public usedAmount: Betrag;
  public overdraft: Betrag;
  public bookingDate: Date;
  public dueDate: Date;
}
