import { UmsatzTyp } from './UmsatzTyp';
import { Verwendungszweck } from './Verwendungszweck';

export class Satz {
  public datum: Date;
  public isStorno: boolean;
  public sollHaben: UmsatzTyp;
  public value: number;
  public isVerwendungszweckObject: boolean = false;
  public verwendungszweck: Verwendungszweck | string;
}
