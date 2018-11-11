import { TanVerfahren } from './TanVerfahren';

export class Tan {
  public oneStepAvailable = true;
  public multipleTan = false;
  public hashType = '0';
  public tanVerfahren: {[index: string]: TanVerfahren} = {
    999: new TanVerfahren(),
  };
}
