import DatenElement from './DatenElement';
import { NULL } from './NULL';
import { ParseError, Parser } from './Parser';

export default class DatenElementGruppe {

  public data: DatenElement[] = [];

  public addDE(val) {
    this.data.push(new DatenElement(val, 1));
  }

  public addDEG(grup) {
    this.data.push(new DatenElement(grup, 2));
  }

  public addDEbin = function (val) {
    this.data.push(new DatenElement(val, 3));
  };

  public parse(parser: Parser) {
    let startPos: number;
    let first = false;
    while (!first || (parser.getCurrentChar() === ':' && parser.hasNext())) {
      if (!first) {
        first = true;
      } else {
        parser.nextPos();
      }
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
        this.addDEbin(parser.getTextFromMarkerToCurrentPos('start'));
        parser.nextPos();
      } else if (parser.gotoNextValidCharButIgnoreWith("+:'", '?')) {
        // Normales datenelement
        this.addDE(parser.getTextFromMarkerToCurrentPos('start'));
        // Datengruppe können nicht bestandteil einer datengruppe sein
      } else {
        throw new ParseError('Seg', 'Unerwartetes ENDE!', startPos);
      }
    }
  }

  public transformForSend() {
    let result = '';
    for (let i = 0; i !== this.data.length; i += 1) {
      if (this.data[i].data !== NULL) {
        if (this.data[i].desc === 1) {
          const deData = this.data[i].data as string;
          result += (i !== 0 ? ':' : '') + deData; // DE
        } else if (this.data[i].desc === 2) { // kommt nicht vor
          const degData = this.data[i].data as DatenElementGruppe;
          result += (i !== 0 ? ':' : '') + degData.transformForSend(); // DEG
        } else if (this.data[i].desc === 3) {
          const deBinData = this.data[i].data as any[];
          result += (i !== 0 ? ':' : '') + '@' + deBinData.length + '@' + deBinData; // BIN DAT
        }
      } else {
        // leer
        result += (i !== 0 ? ':' : '');
      }
    }
    return result;
  }

  public getEl(i) {
    return this.data[i - 1].data;
  }

  public getElasDEG(i): DatenElementGruppe {
    return this.data[i - 1].data as DatenElementGruppe;
  }

  public getElasDE(i): DatenElement {
    return this.data[i - 1].data as DatenElement;
  }

  public getElString(i): string {
    if (this.data[i - 1] instanceof DatenElement) {
      return this.data[i - 1].data as string;
    }
  }
}
