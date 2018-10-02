import {Saldo} from './Saldo';
import Satz from './Satz';

export class Umsatz {
  public refnr: string;
  public bezRefnr: string;
  public kontoBez: string;
  public auszugNr: string;
  public anfangssaldo: Saldo;
  public schlusssaldo: Saldo;
  public saetze: Satz[];
}
