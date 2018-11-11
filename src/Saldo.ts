import { Betrag } from './Betrag';
import { UmsatzTyp } from './UmsatzTyp';

export class Saldo {
  public isZwischensaldo: boolean;
  public sollHaben: UmsatzTyp;
  public buchungsdatum: Date;
  public betrag: Betrag = new Betrag();

  get currency() {
    return this.betrag.currency;
  }

  set currency(currency) {
    this.betrag.currency = currency;
  }

  get value() {
    return this.betrag.value;
  }

  set value(value) {
    this.betrag.value = value;
  }
}
