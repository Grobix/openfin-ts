import { Balance } from './Balance';
import { Parser } from './Parser';
import { Transaction } from './Transaction';
import { TransactionRecord } from './TransactionRecord';
import { TransactionType } from './TransactionType';
import { Description } from './Description';

// This Parser parses S.W.I.F.T MTXXX Formats
// http://www.hbci-zka.de/dokumente/spezifikation_deutsch/fintsv3/FinTS_3.0_Messages_Finanzdatenformate_2010-08-06_final_version.pdf

export class MTParser {

  private msgss: string[] = [];

  public parse(txt: string) {
    let curMsg = [];
    const msgs = [];
    const parser = new Parser(txt);

    // SWIFT Protokoll
    // Nachrichten
    // 	enthalten Felder :Zahl:   Trennzeichen
    // Der Kontoauszug kann über mehrere Nachrichten verteilt werden
    //
    // Trennzeichen = \r\n Kompatibilität @@
    // Syntax:
    // Nachrichten Begin:		\r\n-\r\n	oder @@				(optional)
    // Feld						:Zahl: 		(\r\n oder @@)
    // Feld Mehrfach			:Zahl:		(\r\n oder @@)(mehrfach)
    // Nachrichten Ende:		-\r\n	oder (@@ und dann muss direkt wieder @@ als Anfang folgen)
    while (parser.hasNext()) {
      if (parser.gotoNextValidChar(':')) {
        parser.nextPos();
        parser.setMarkerWithCurrentPos('start');
        parser.gotoNextValidChar(':');

        const tag = parser.getTextFromMarkerToCurrentPos('start');
        parser.nextPos();
        parser.setMarkerWithCurrentPos('start');
        parser.gotoNextValidString(['\r\n', '@@']);
        let val = parser.getTextFromMarkerToCurrentPos('start');
        parser.nextPos();
        parser.nextPos();
        // Für Feld Mehrfach
        while (parser.hasNext() && !':-@'.includes(parser.getCurrentChar())) {
          parser.setMarkerWithCurrentPos('start');
          parser.gotoNextValidString(['\r\n', '@@']);
          val += parser.getTextFromMarkerToCurrentPos('start');
          parser.nextPos();
          parser.nextPos();
        }
        curMsg.push([tag, val]);
      }
      // schauen ob die Message zuende ist
      const data = parser.getData();
      if ((parser.getCurPos() + 1 >= data.length || (parser.getCurrentChar() === '@' && data[parser.getCurPos() + 1] === '@')) ||
        (parser.getCurPos() + 2 >= data.length || (parser.getCurrentChar() === '-' && data[parser.getCurPos() + 1] === '\r'
          && data[parser.getCurPos() + 2] === '\n'))) {
        msgs.push(curMsg);
        curMsg = [];
        parser.nextPos();
        parser.nextPos();
        parser.nextPos();
      }
    }
    if (curMsg.length > 0) {
      msgs.push(curMsg);
    }
    // 1. Phase des Parsens beendet
    this.msgss = msgs;
  }

  public getKontoUmsaetzeFromMT940(): Transaction[] {
    return this.msgss.map(msg => {
      const umsatz = new Transaction();
      // Starten
      for (let a = 0; a < msg.length; a += 1) {
        switch (msg[a][0]) {
          case '20':
            umsatz.refnr = msg[a][1];
            break;
          case '21':
            umsatz.bezRefnr = msg[a][1];
            break;
          case '25':
            umsatz.kontoBez = msg[a][1];
            break;
          case '28C':
            umsatz.auszugNr = msg[a][1];
            break;
          case '60F': // Anfangssaldo
          case '60M': // Zwischensaldo
            this.parseMT940_60a(umsatz, msg[a]);
            break;
          case '61': // Loop
            a = this.parseMT940_loop(umsatz, msg, a);
            break;
          case '62F': // Endsaldo
          case '62M': // Zwischensaldo
            this.parseMT940_62a(umsatz, msg[a]);
            break;
        }
      }
      return umsatz;
    });
  }

  public parseMT940_60a(umsatz: Transaction, msg) {
    umsatz.beginningBalance = this.getSaldoFromMessage(msg);
  }

  public parseMT940_62a(umsatz: Transaction, msg) {
    umsatz.closingBalance = this.getSaldoFromMessage(msg);
  }

  public parseMT940_loop(umsatz: Transaction, msg, i) {
    umsatz.records = [];
    let idx = i;
    for (; idx < msg.length && msg[idx][0] === '61'; idx += 1) {
      const satz = new TransactionRecord();
      let pos = 0;
      // 1. 61
      satz.date = this.convertMTDateFormatToJS(msg[idx][1].substr(0, 6));
      if ('0123456789'.includes(msg[idx][1][6])) {
        // optionales feld Buchungstag
        pos = 10;
      } else {
        pos = 6;
      }
      if (msg[idx][1][pos] === 'R') {
        satz.isReversal = true;
        pos += 1;
      } else {
        satz.isReversal = false;
      }
      satz.transactionType = msg[idx][1][pos] === 'C' ? TransactionType.CREDIT : TransactionType.DEBIT;
      pos += 1;
      if (!'0123456789'.includes(msg[idx][1][pos])) {
        // optionales feld Währungsunterscheidung
        pos += 1;
      }
      // Figure
      const startPos = pos;
      let endPos = pos;
      for (let j = startPos; j < msg[idx][1].length; j += 1) {
        if (msg[idx][1][j] === 'N') {
          endPos = j;
          break;
        }
      }
      satz.value = parseFloat(msg[idx][1].substring(startPos, endPos).replace(',', '.'));
      pos = endPos + 1;
      // 2. 86
      idx += 1;
      this.parseMT940_86(satz, msg[idx][1]);
      // TODO hier gibt es auch noch eine weiter bearbeitung
      umsatz.records.push(satz);
    }
    return idx - 1;
  }

  public convertMTDateFormatToJS(date: string) {
    const dtYear = parseInt(`20${date.substr(0, 2)}`, 10);
    const dtMonth = parseInt(date.substr(2, 2), 10) - 1;
    const dtDate = parseInt(date.substr(4, 2), 10);
    return new Date(dtYear, dtMonth, dtDate);
  }

  private parseMT940_86(satz: TransactionRecord, rawVerwendungszweck) {

    satz.isReferenceObject = rawVerwendungszweck.substr(0, 4).includes('?');
    if (satz.isReferenceObject) {
      satz.description = new Description();
      satz.description.text = '';
      const p = new Parser(rawVerwendungszweck);
      p.gotoNextValidChar('?');
      while (p.hasNext()) {
        // Hier sind wir immer auf einem ?
        p.nextPos();
        p.setMarkerWithCurrentPos('start');
        p.nextPos();
        p.nextPos();
        const code = p.getTextFromMarkerToCurrentPos('start');
        p.setMarkerWithCurrentPos('start');
        p.gotoNextValidChar('?');
        const value = p.getTextFromMarkerToCurrentPos('start');
        // Processing
        switch (code) {
          case '00':
            satz.description.buchungstext = value;
            break;
          case '10':
            satz.description.primanotenNr = value;
            break;
          case '20':
          case '21':
          case '22':
          case '23':
          case '24':
          case '25':
          case '26':
          case '27':
          case '28':
          case '29':
          case '60':
          case '61':
          case '62':
          case '63':
            satz.description.text += value;
            break;
          case '30':
            satz.description.bicKontrahent = value;
            break;
          case '31':
            satz.description.ibanKontrahent = value;
            break;
          case '32':
          case '33':
            satz.description.nameKontrahent += value;
            break;
          case '34':
            satz.description.textKeyAddion = value;
            break;
        }
      }
    } else {
      satz.description = new Description();
      satz.description.text = rawVerwendungszweck;
    }
  }

  private getSaldoFromMessage(msg) {
    const string = msg[1];
    const saldo = new Balance();
    saldo.isInterimBalance = msg[0][2] === 'M';
    saldo.transactionType = string[0] === 'C' ? TransactionType.CREDIT : TransactionType.DEBIT;
    saldo.entryDate = this.convertMTDateFormatToJS(string.substr(1, 6));
    saldo.currency = string.substr(7, 3);
    saldo.value = parseFloat(string.substr(10, string.length).replace(',', '.'));
    return saldo;
  }
}
