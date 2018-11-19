import { Balance } from './Balance';
import { Figure } from './Figure';

export class TotalResult {
  public desc: string;
  public currency: string;
  public total: Balance;
  public totalReserved: Balance;
  public creditLine: Figure;
  public availableAmount: Figure;
  public usedAmount: Figure;
  public overdraft: Figure;
  public bookingDate: Date;
  public dueDate: Date;
}
