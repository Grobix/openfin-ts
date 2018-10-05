import Betrag from './Betrag';
import ByteVal from './ByteVal';
import DatenElement from './DatenElement';
import DatenElementGruppe from './DatenElementGruppe';
import Nachricht from './Nachricht';
import { Saldo } from './Saldo';
import Segment from './Segment';
import { UmsatzTyp } from './UmsatzTyp';

export default class Helper {

  public static checkMsgsWithBelongToForId(msg: Nachricht, bez: any, id) {
    const array = msg.selectSegByNameAndBelongTo('HIRMS', bez);
    if (array.length <= 0) {
      return null;
    }

    for (let i = 0; i !== array.length; i += 1) {
      for (let a = 0; a !== array[i].store.data.length; a += 1) {
        const d = array[i].store.data[a];
        if (d.getEl(1) === id) {
          return d;
        }
      }
    }

    return null;
  }

  public static getNrWithLeadingNulls(nr, len) {
    const stxt = nr + '';
    let ltxt = '';
    const neu = len - stxt.length;
    for (let i = 0; i !== neu; i += 1) {
      ltxt += '0';
    }
    ltxt += stxt;
    return ltxt;
  }

  public static newSegFromArrayWithBez = function (name, vers, bez, ar) {
    const seg = this.newSegFromArray(name, vers, ar);
    seg.bez = bez;
    return seg;
  };

  public static newSegFromArray(name, vers, ar): Segment {
    const seg = new Segment();
    seg.init(name, 0, vers, 0);
    for (let i = 0; i !== ar.length; i += 1) {
      if (ar[i] instanceof Array) {
        const neu = new DatenElementGruppe();
        for (let j = 0; j !== ar[i].length; j += 1) {
          if (ar[i][j] instanceof ByteVal) {
            neu.addDEbin(ar[i][j].data);
          } else {
            neu.addDE(ar[i][j]);
          }
        }
        seg.store.addDEG(neu);
      } else if (ar[i] instanceof ByteVal) {
        seg.store.addDEbin(ar[i].data);
      } else {
        // normales datenelement
        seg.store.addDE(ar[i]);
      }
    }
    return seg;
  }

  public static convertIntoArray(deOrDeg): [DatenElement] {
    if (deOrDeg instanceof DatenElementGruppe) {
      return deOrDeg.data;
    }
    return [deOrDeg];
  }

  public static convertDateToDFormat(date) {
    const yyyy = date.getFullYear() + '';
    const mm = ((date.getMonth() + 1) <= 9) ? ('0' + (date.getMonth() + 1)) : ((date.getMonth() + 1) + '');
    const dd = (date.getDate() <= 9) ? ('0' + date.getDate()) : (date.getDate() + '');
    return yyyy + mm + dd;
  }

  public static convertDateToTFormat(date) {
    const hh = ((date.getHours() <= 9) ? '0' : '') + date.getHours();
    const mm = ((date.getMinutes() <= 9) ? '0' : '') + date.getMinutes();
    const ss = ((date.getSeconds() <= 9) ? '0' : '') + date.getSeconds();
    return hh + mm + ss;
  }

  public static convertFromToJSText(ftxt) {
    let jstxt = '';
    const re = /\?([^\?])/g;
    jstxt = ftxt.replace(re, '$1');
    return jstxt;
  }

  public static convertJSTextTo(jstxt) {
    let ftxt = '';
    const re = /([:\+\?'\@])/g;
    ftxt = jstxt.replace(re, '?$&');
    return ftxt;
  }

  public static byte(data) {
    return new ByteVal(data);
  }

  public static getSaldo(seg: Segment, nr, hbciVer3) {
    if (!seg) {
      return null;
    }

    try {
      const base = seg.getEl(nr).data;
      const result = new Saldo();

      result.sollHaben = base.getEl(1) === 'C' ? UmsatzTyp.HABEN : UmsatzTyp.SOLL;
      result.currency = hbciVer3 ? 'EUR' : base.getEl(3);
      result.value = parseFloat(base.getEl(2).replace(',', '.'));
      result.buchungsdatum = this.getJSDateFromSeg(base, hbciVer3 ? 3 : 4, hbciVer3 ? 4 : 5);
      return result;
    } catch (ee) {
      return null;
    }
  }

  public static getBetrag(seg, nr): Betrag {
    if (!seg) {
      return null;
    }

    try {
      const base = seg.getEl(nr).data;
      const result = new Betrag();
      result.currency = base.getEl(2);
      result.value = parseFloat(base.getEl(1).replace(',', '.'));
      return result;
    } catch (ee) {
      return null;
    }
  }

  public static getJSDateFromSegTSP(seg: Segment, nr) {
    try {
      const base = seg.getEl(nr).data;
      return this.getJSDateFromSeg(base, 1, 2);
    } catch (e) {
      return null;
    }
  }

  public static getJSDateFromSeg(seg, dateNr, timeNr) {
    if (!seg) {
      return null;
    }

    try {
      const date = seg.getEl(dateNr);
      let time = '000000';
      try {
        if (timeNr) time = seg.getEl(timeNr);
      } catch (eee) {
        // do nothing
      }
      const result = new Date();
      result.setTime(0);
      result.setFullYear(parseInt(date.substr(0, 4), 10));
      result.setMonth(parseInt(date.substr(4, 2), 10) - 1);
      result.setDate(parseInt(date.substr(6, 2), 10));
      result.setHours(parseInt(time.substr(0, 2), 10));
      result.setMinutes(parseInt(time.substr(2, 2), 10));
      result.setSeconds(parseInt(time.substr(4, 2), 10));
      return result;
    } catch (ee) {
      return null;
    }
  }

  public static escapeUserString(str) {
    // escapes special characters with a '?'
    // use this when forwarding user defined input (such as username/password) to a server
    //
    // SOURCE: http://linuxwiki.de/HBCI/F%C3%BCrEntwickler
    // TODO: find better/official source
    return str.replace(/[?+:]/g, '?$&');
  }
}
