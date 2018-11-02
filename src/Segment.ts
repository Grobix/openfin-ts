import DatenElementGruppe from './DatenElementGruppe';
import { NULL } from './NULL';
import { ParseError, Parser } from './Parser';
import DatenElement from './DatenElement';

export default class Segment {

  public store = new DatenElementGruppe();
  public name: string = null;
  public nr: number | string;
  public version: number | string;
  public bez: number | string = null;

  public init(name: string, nr: number | string, version: number | string, bez: number | string) {
    this.name = name;
    this.nr = nr;
    this.version = version;
    this.bez = bez;
  }

  public transformForSend(): string {
    let result = '';
    result += this.name; // Nr. 1 Segmentkennung an ..6 M 1
    result += ':' + this.nr; // Nr. 2 Segmentnummer num ..3 M 1 >=1
    result += ':' + this.version; // Nr. 3 Segmentversion GD num ..3 M 1
    if (this.bez !== null) result += ':' + this.bez;
    for (let i = 0; i !== this.store.data.length; i += 1) {
      if (this.store.data[i].data !== NULL) {
        if (this.store.data[i].desc === 1) {
          result += '+' + this.store.data[i].data; // DE
        } else if (this.store.data[i].desc === 2) {
          const degData = this.store.data[i].data as DatenElementGruppe;
          result += '+' + degData.transformForSend(); // DEG
        } else if (this.store.data[i].desc === 3) {
          const binData = this.store.data[i].data as any[];
          result += '+@' + binData.length + '@' + binData; // BIN DAT
        }
      } else {
        // leer
        result += '+';
      }
    }
    result += "'";
    return result;
  }

  public parse(parser: Parser) {
    let startPos = parser.getCurrentPos();
    // 1. Segmentkopf
    // Nr. 1 Segmentkennung an ..6 M 1
    parser.setMarkerWithCurrentPos('start');
    if (parser.gotoNextValidChar(':')) {
      this.name = parser.getTextFromMarkerToCurrentPos('start');
    } else {

      throw new ParseError('Seg', 'Segmentkennung Fehlt!', startPos);
    }

    // Nr. 2 Segmentnummer num ..3 M 1 >=1
    parser.nextPos();
    startPos = parser.getCurrentPos();
    parser.setMarkerWithCurrentPos('start');
    if (parser.gotoNextValidChar(':')) {
      this.nr = parser.getTextFromMarkerToCurrentPos('start');
    } else {
      throw new ParseError('Seg', 'Segmentnummer fehlt!', startPos);
    }

    // Nr. 3 Segmentversion GD num ..3 M 1
    parser.nextPos();
    startPos = parser.getCurrentPos();
    parser.setMarkerWithCurrentPos('start');
    if (parser.gotoNextValidChar(":+'")) {
      this.version = parser.getTextFromMarkerToCurrentPos('start');
    } else {
      throw new ParseError('Seg', 'Segmentversion fehlt!', startPos);
    }

    // Nr. 4 Bezugssegment GD num ..3 K 1 >=1
    if (parser.getCurrentChar() === ':') {
      parser.nextPos();
      startPos = parser.getCurrentPos();
      parser.setMarkerWithCurrentPos('start');
      if (parser.gotoNextValidChar('+')) {
        this.bez = parser.getTextFromMarkerToCurrentPos('start');
      } else {
        throw new ParseError('Seg', 'Unerwartetes ENDE!', startPos);
      }
    }

    // jetzt kommen datenlemente oder datenelementgruppen
    while (parser.getCurrentChar() !== "'" && parser.hasNext()) {
      parser.nextPos();
      startPos = parser.getCurrentPos();
      parser.setMarkerWithCurrentPos('start');
      if (parser.getCurrentChar() === '@') {
        // binary
        parser.nextPos();
        parser.setMarkerWithCurrentPos('start');
        if (!parser.gotoNextValidChar('@')) throw new ParseError('Seg', 'Error binary!', startPos);
        const len = parseInt(parser.getTextFromMarkerToCurrentPos('start'), 10);
        parser.nextPos();
        parser.setMarkerWithCurrentPos('start');
        parser.setCurrentPos(parser.getCurrentPos() + len);
        if ("+:'".indexOf(parser.getCurrentChar()) === -1) throw new ParseError('Seg', 'Error binary, Wrong Length!' + len, startPos);
        this.store.addDEbin(parser.getTextFromMarkerToCurrentPos('start'));
      } else if (parser.gotoNextValidCharButIgnoreWith("+:'", '?')) {
        if (parser.getCurrentChar() === '+' || parser.getCurrentChar() === "'") {
          // Normales datenelement
          this.store.addDE(parser.getTextFromMarkerToCurrentPos('start'));
        } else {
          // Datengruppe
          parser.setPosBackToMarker('start');
          const neuDeg = new DatenElementGruppe();
          neuDeg.parse(parser);
          this.store.addDEG(neuDeg);
        }
      } else {
        throw new ParseError('Seg', 'Unerwartetes ENDE!', startPos);
      }
    }
  }

  public getEl(nr: number): DatenElement | DatenElementGruppe {
    return this.store.data[nr - 1];
  }

  public getElString(nr: number): string {
    return this.store.data[nr - 1].data as string;
  }
}
