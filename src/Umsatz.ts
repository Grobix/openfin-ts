import {Saldo} from './Saldo';

export class Umsatz {
  public refnr: string;
  public bezRefnr: string;
  public kontoBez: string;
  public auszugNr: string;
  public anfangssaldo: Saldo;
  public schlusssaldo: Saldo;
}
