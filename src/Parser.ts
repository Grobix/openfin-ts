export class ParseError {
  constructor(private location: string, private msg: string, private pos: number) {
  }

  public toString(): string {
    return this.msg;
  }
}

export class Parser {
  protected curPos = 0;
  protected marker: { [index: string]: number } = {};

  constructor(protected data: string) {
  }

  public getCurPos() {
    return this.curPos;
  }

  public getData() {
    return this.data;
  }

  public clearMarker() {
    this.marker = {};
  }

  public setMarker(mark: string, pos: number) {
    this.marker[mark] = pos;
  }

  public setMarkerWithCurrentPos(mark: string) {
    this.setMarker(mark, this.curPos);
  }

  public setPosBackToMarker(mark: string) {
    this.curPos = this.marker[mark];
  }

  public getCurrentPos() {
    return this.curPos;
  }

  public setCurrentPos(pos: number) {
    this.curPos = pos;
  }

  public getCurrentChar(): string {
    return this.data[this.curPos];
  }

  public hasNext(): boolean {
    return this.curPos < this.data.length;
  }

  public nextPos(): boolean {
    if (!this.hasNext()) {
      return false;
    }
    this.curPos += 1;
    return true;
  }

  public gotoPos(pos: number): boolean {
    if (pos === -1) {
      this.curPos = this.data.length;
      return false;
    }
    this.curPos = pos;
    return true;
  }

  public getTextFromMarkerToCurrentPos(mark: string): string {
    return this.getTextFromPostoPos(this.marker[mark], this.curPos);
  }

  public getTextFromPostoPos(posFrom: number, posTo: number): string {
    return this.data.substr(posFrom, posTo - posFrom);
  }

  public findNextValidChar(validChars: string): number {
    for (let i = this.curPos; i < this.data.length; i += 1) {
      if (validChars.includes(this.data[i])) {
        return i;
      }
    }
    return -1;
  }

  public gotoNextValidChar(validChars: string) {
    return this.gotoPos(this.findNextValidChar(validChars));
  }

  // This goes to the first char of the string
  public findNextValidString(validStrings: string[]) {
    const origPos = this.curPos;
    let validChars = '';

    validStrings.forEach(s => {
      validChars += s.charAt(0);
    });

    let pos = this.curPos;
    do {
      pos = this.findNextValidChar(validChars);
      if (pos !== -1) {
        for (let i = 0; i !== validStrings.length; i += 1) {
          if (validStrings[i].charAt(0) === this.data[pos]) {
            // prüfen ob voll passt
            const compStr = this.data.substr(pos, validStrings[i].length);
            if (compStr === validStrings[i]) {
              this.curPos = origPos;
              return pos;
            }
          }
        }
        this.curPos = pos + 1;
      }
    } while (pos !== -1);

    this.curPos = origPos;
    return pos;
  }

  public gotoNextValidString(validStrings: string[]) {
    return this.gotoPos(this.findNextValidString(validStrings));
  }

  public gotoNextValidCharButIgnoreWith(validChars: string, demask: string) {
    while (true) {
      const pos = this.findNextValidChar(validChars);
      if (pos === -1) {
        this.curPos = this.data.length;
        return false;
      }

      if (pos === 0) {
        this.curPos = pos;
        return true;
      }

      if (demask.includes(this.data[pos - 1])) {
        if ((pos + 1) >= this.data.length) {
          this.curPos = pos;
          return false;
        }
        this.curPos = pos + 1;
        // retry
      } else {
        this.curPos = pos;
        return true;
      }
    }
  }
}
