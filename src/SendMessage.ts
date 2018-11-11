import { Segment } from './Segment';

export class SendMessage {
  public action: any;
  public aufsetzpunkt: any = null;
  public aufsetzpunktLoc: any;
  public collectedMessages: any[] = [];
  public collectedSegments: Segment[] = [];
  public finished: boolean = false;
  public segment: Segment;
  public version: any;
}
