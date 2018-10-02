import { UmsatzTyp } from './UmsatzTyp';

export class Saldo {
  public isZwischensaldo: boolean;
  public sollHaben: UmsatzTyp;
  public buchungsdatum: Date;
  public currency: string;
  public value: number;
}