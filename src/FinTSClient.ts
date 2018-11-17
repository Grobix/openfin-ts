import * as encoding from 'encoding';
import { ClientRequest } from 'http';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import { BPD } from './BPD';
import { DatenElementGruppe } from './DatenElementGruppe';
import { Exceptions } from './Exceptions';
import { Helper } from './Helper';
import { Konto } from './Konto';
import { Logger } from './Logger';
import { MTParser } from './MTParser';
import { Nachricht } from './Nachricht';
import { NULL } from './NULL';
import { Order } from './Order';
import { ReturnCode } from './ReturnCode';
import { Segment } from './Segment';
import { SegmentName } from './SegmentName';
import { SignInfo } from './SignInfo';
import { TanVerfahren } from './TanVerfahren';
import { TotalResult } from './TotalResult';
import { Umsatz } from './Umsatz';
import { UPD } from './UPD';

export class FinTSClient {

  public dialogId = 0;
  public nextMsgNr = 1;
  public sysId = 0;
  public protoVersion = 300;
  public bpd: BPD = new BPD();
  public log = Logger.getLogger('main');
  public conLog = Logger.getLogger('con');
  public conEstLog = Logger.getLogger('conest');
  public gvLog = Logger.getLogger(('gv'));
  public tan = NULL;

  public upd: UPD = new UPD();
  public konten: Konto[] = [];
  private ctry = 280;

  private debugMode = false;
  private clientName = 'Open-FinTS-JS-Client';
  private clientVersion = 4;

  private inConnection = false;
  private lastSignaturId = 1;

  constructor(public blz: string, public bankUrl: string, public kundenId: string,
              public pin: string) {
    this.kundenId = Helper.escapeUserString(kundenId);
    this.pin = Helper.escapeUserString(pin);
    this.clear();
  }

  public clear() {
    this.dialogId = 0;
    this.nextMsgNr = 1;
    this.sysId = 0;
    this.lastSignaturId = 1;
    this.bpd = new BPD();
    this.bpd.url = this.bankUrl;
    this.upd = new UPD();
    this.konten = [];
  }

  public closeSecure() {
    this.bpd = null;
    this.upd = null;
    this.konten = null;
    this.pin = null;
    this.tan = null;
    this.sysId = null;
  }

  public getNewSigId() {
    const next = (new Date()).getTime();
    if (next > this.lastSignaturId) {
      this.lastSignaturId = next;
      return this.lastSignaturId;
    }
    this.lastSignaturId += 1;
    return this.lastSignaturId;
  }

  public isAnonymous() {
    return this.kundenId === '9999999999';
  }

  public sendMsgToDestination = (msg, callback, inFinishing?) => { // Parameter für den Callback sind error,data
    // Ensure the sequence of messages!
    if (!inFinishing) {
      if (this.inConnection) {
        throw new Exceptions.OutofSequenceMessageException();
      }
      this.inConnection = true;
    }
    const intCallback = (param1, param2) => {
      if (!inFinishing) {
        this.inConnection = false;
      }
      callback(param1, param2);
    };
    const txt = msg.transformForSend();
    this.debugLogMsg(txt, true);
    const postData = new Buffer(txt).toString('base64');
    const u = url.parse(this.bpd.url);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.path,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': postData.length,
      },
    };
    let data = '';
    const prot = u.protocol === 'http:' ? http : https;
    this.conLog.debug({
      host: u.hostname,
      port: u.port,
      path: u.path,
    }, 'Connect to Host');

    const connectionCallback = (res) => { // https.request(options, function(res) {
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        // Hir wird dann weiter gemacht :)
        this.conLog.debug({
          host: u.hostname,
          port: u.port,
          path: u.path,
        }, 'Request finished');
        const clearTxt = encoding.convert(new Buffer(data, 'base64'), 'UTF-8', 'ISO-8859-1').toString('utf8'); // TODO: this only applies for HBCI? can we dynamically figure out the charset?

        this.debugLogMsg(clearTxt, false);
        try {
          const msgRecV = new Nachricht(this.protoVersion);
          msgRecV.parse(clearTxt);
          intCallback(null, msgRecV);
        } catch (e) {
          this.conLog.error(e, 'Could not parse received Message');
          intCallback(e.toString(), null);
        }
      });
    };

    const req: ClientRequest = u.protocol === 'http:' ?
      http.request(options, connectionCallback) :
      https.request(options, connectionCallback);

    req.on('error', () => {
      // Hier wird dann weiter gemacht :)
      this.conLog.error({
        host: u.hostname,
        port: u.port,
        path: u.path,
      }, 'Could not connect to ' + options.hostname);
      intCallback(new Exceptions.ConnectionFailedException(u.hostname, u.port, u.path), null);
    });
    req.write(postData);
    req.end();
  }

  public msgInitDialog(cb) {
    const msg: Nachricht = new Nachricht(this.protoVersion);
    if (!this.isAnonymous()) {
      const signInfo = new SignInfo();
      signInfo.pin = this.pin;
      signInfo.tan = NULL;
      signInfo.sysId = this.sysId;
      signInfo.pinVersion = this.upd.availableTanVerfahren[0];
      signInfo.sigId = this.getNewSigId();
      msg.sign(signInfo);
    }
    msg.init(this.dialogId, this.nextMsgNr, this.blz, this.kundenId);

    this.nextMsgNr += 1;
    //  Kundensystem-ID  = 0; Kundensystemssatus = 0
    msg.addSeg(Helper.newSegFromArray('HKIDN', 2, [
      [this.ctry, this.blz], this.kundenId, this.sysId, 1],
    ));
    // BPD Vers = 0; UPD Vers = 0; Dialogspr. = 0
    const HKVVB = Helper.newSegFromArray('HKVVB', 3, [this.bpd.versBpd, this.upd.versUpd, 0, this.clientName, this.clientVersion]);
    msg.addSeg(HKVVB);

    let syn: number;
    if (!this.isAnonymous() && this.sysId === 0) {
      syn = msg.addSeg(Helper.newSegFromArray('HKSYN', this.protoVersion === 220 ? 2 : 3, [0]));
    } // Synchronisierung starten
    this.gvLog.debug({
      gv: 'HKVVB',
    }, 'Send HKVVB,HKIDN');

    this.sendMsgToDestination(msg, (error, recvMsg: Nachricht) => {
      if (error) {
        this.gvLog.error(error, {
          gv: 'HKVVB',
        }, 'Could not send HKVVB,HKIDN');
        try {
          cb(error, recvMsg, false);
        } catch (cbError) {
          this.gvLog.error(cbError, {
            gv: 'HKVVB',
          }, 'Unhandled callback Error in HKVVB,HKIDN');
        }
      } else {
        // Prüfen ob Erfolgreich
        const HIRMG = recvMsg.getSegmentByName(SegmentName.RETURN_STATUS_MESSAGE);
        if (HIRMG && (HIRMG.getEl(1).data.getElString(1) === '0010' || HIRMG.getEl(1).data.getElString(1) === '3060')) {
          if (Helper.checkMsgsWithBelongToForId(recvMsg, HKVVB.nr, '0020')) {
            try {
              // 1. Dialog ID zuweisen
              this.dialogId = recvMsg.getSegmentByName(SegmentName.MESSAGE_HEADER).getEl(3).data;
              // 2. System Id
              if (!this.isAnonymous() && this.sysId === 0) {
                this.sysId = recvMsg.getSegmentByNameAndReference('HISYN', syn).getEl(1).data;
              }
              // 3. Möglicherweise neue kommunikationsdaten
              const HIKOMS = recvMsg.getSegmentsByName('HIKOM');
              const HIKOM = HIKOMS.length > 0 ? HIKOMS[0] : null;
              let newUrl = this.bpd.url;
              if (HIKOM) {
                for (let i = 2; i < HIKOM.store.data.length; i += 1) {
                  // There can be up to 9 Kommunikationsparameter
                  //  however we check only if the first one which is HTTP (3)
                  // 	is different to the one we used before, according to the spec we should try reconnecting all 9
                  if (HIKOM.getEl(i + 1).data.getEl(1) === '3') {
                    newUrl = (Helper.convertFromToJSText(HIKOM.getEl(i + 1).data.getEl(2)));
                    if (newUrl.indexOf('http') !== 0) {
                      newUrl = 'https://' + newUrl;
                    }
                    break;
                  }
                }
              }
              let hasNewUrl = false;
              if (newUrl !== this.bpd.url) {
                hasNewUrl = true;
              }
              // 4. Mögliche KontoInformationen
              if (this.konten.length === 0) {
                const kontoList = recvMsg.getSegmentsByName('HIUPD');
                kontoList.forEach(kontodata => {
                  const konto = new Konto();
                  konto.iban = kontodata.getEl(2).data;
                  konto.kontoNr = kontodata.getEl(1).data.getEl(1);
                  konto.unterKonto = kontodata.getEl(1).data.getEl(2);
                  konto.countryCode = kontodata.getEl(1).data.getEl(3);
                  konto.blz = kontodata.getEl(1).data.getEl(4);
                  konto.kundenId = kontodata.getEl(3).data;
                  konto.kontoart = kontodata.getEl(4).data;
                  konto.currency = kontodata.getEl(5).data;
                  konto.kunde1Name = kontodata.getEl(6).data;
                  konto.productName = kontodata.getEl(8).data;
                  konto.sepaData = null;
                  this.konten.push(konto);
                });
              }
              // 5. Analysiere BPD
              try {
                // 5.1 Vers
                const HIBPA = recvMsg.getSegmentsByName('HIBPA')[0];
                this.bpd.versBpd = HIBPA.getEl(1).data;
                // 5.2 sonst
                this.bpd.bankName = HIBPA.getEl(3).data;
                this.bpd.supportedVers = Helper.convertIntoArray(HIBPA.getEl(6).data);
                this.bpd.url = newUrl;
              } catch (ee) {
                this.gvLog.error(ee, {
                  gv: 'HIBPA',
                }, 'Error while analyse BPD');
              }
              if (this.protoVersion === 300) {
                try {
                  // 5.3 Pins
                  const pinData = recvMsg.getSegmentsByName('HIPINS')[0].getEl(4).data;
                  this.bpd.pin.minLength = pinData.getEl(1);
                  this.bpd.pin.maxLength = pinData.getEl(2);
                  this.bpd.pin.maxTanLength = pinData.getEl(3);
                  this.bpd.pin.txtBenutzerkennung = pinData.getEl(4);
                  this.bpd.pin.txtKundenId = pinData.getEl(5);
                  // 5.3.2 Tanerforderlichkeit für die Geschäftsvorfälle
                  this.bpd.pin.availableSeg = {}; // true and false für ob Tan erforderlich
                  for (let i = 5; i < pinData.data.length; i += 1) {
                    this.bpd.pin.availableSeg[pinData.data[i].data] = pinData.data[i + 1].data.toUpperCase() === 'J';
                    i += 1;
                  }
                } catch (ee) {
                  this.gvLog.error(ee, {
                    gv: 'HIPINS',
                  }, 'Error while analyse HIPINS');
                }
              } else {
                const pinDataSpks = recvMsg.getSegmentsByName('DIPINS');
                if (pinDataSpks.length > 0) {
                  try {
                    // 5.3 Pins
                    const pinDataSpk = pinDataSpks[0];
                    /* this.bpd.pin.minLength 		= ;
                    this.bpd.pin.maxLength 			= ;
                    this.bpd.pin.maxTanLength 		= ;
                    this.bpd.pin.txtBenutzerkennung  = ;
                    this.bpd.pin.txtKundenId 		= ; */
                    // 5.3.2 Tanerforderlichkeit für die Geschäftsvorfälle
                    this.bpd.pin.availableSeg = {}; // true and false für ob Tan erforderlich
                    const pinTanSpkData = pinDataSpk.getEl(3).data;
                    for (let i = 0; i < pinTanSpkData.length; i += 1) {
                      this.bpd.pin.availableSeg[pinTanSpkData[i]] = pinTanSpkData[i + 1].toUpperCase() === 'J';
                      i += 1;
                    }
                  } catch (ee) {
                    this.gvLog.error(ee, {
                      gv: 'DIPINS',
                    }, 'Error while analyse HIPINS');
                  }
                } else {
                  this.gvLog.warning({
                    gv: 'HIPINS',
                  }, 'Becuase it is 2.2 no HIPINS and no DIPINS.');
                }
              }
              try {
                // 5.4 Tan
                const HITANS = recvMsg.getSegmentsByName('HITANS')[0];
                if (HITANS.version === '5') {
                  const tanData = HITANS.getEl(4).data as DatenElementGruppe;
                  this.bpd.tan.oneStepAvailable = tanData.getEl(1).toUpperCase() === 'J';
                  this.bpd.tan.multipleTan = tanData.getEl(2).toUpperCase() === 'J';
                  this.bpd.tan.hashType = tanData.getEl(3);
                  this.bpd.tan.tanVerfahren = {};
                  for (let i = 4; i <= tanData.data.length; i += 1) {
                    const tanVerfahren = new TanVerfahren();
                    tanVerfahren.code = tanData.getEl(i);
                    tanVerfahren.oneTwoStepVers = tanData.getEl(i + 1); // "1": Einschrittverfahren, "2": Zweischritt
                    tanVerfahren.techId = tanData.getEl(i + 2);
                    tanVerfahren.zkaTanVerfahren = tanData.getEl(i + 3);
                    tanVerfahren.versZkaTanVerfahren = tanData.getEl(i + 4);
                    tanVerfahren.desc = tanData.getEl(i + 5);
                    tanVerfahren.maxLenTan = tanData.getEl(i + 6);
                    tanVerfahren.tanAlphanum = tanData.getEl(i + 7) === '2';
                    tanVerfahren.txtRueckwert = tanData.getEl(i + 8);
                    tanVerfahren.maxLenRueckwert = tanData.getEl(i + 9);
                    tanVerfahren.anzTanlist = tanData.getEl(i + 10);
                    tanVerfahren.multiTan = tanData.getEl(i + 11).toUpperCase() === 'J';
                    tanVerfahren.tanZeitDiaBez = tanData.getEl(i + 12);
                    tanVerfahren.tanListNrReq = tanData.getEl(i + 13);
                    tanVerfahren.auftragsstorno = tanData.getEl(i + 14).toUpperCase() === 'J';
                    tanVerfahren.smsAbuKontoReq = tanData.getEl(i + 15);
                    tanVerfahren.auftragKonto = tanData.getEl(i + 16);
                    tanVerfahren.challengeClassReq = tanData.getEl(i + 17).toUpperCase() === 'J';
                    tanVerfahren.challengeStructured = tanData.getEl(i + 18).toUpperCase() === 'J';
                    tanVerfahren.initialisierungsMod = tanData.getEl(i + 19);
                    tanVerfahren.bezTanMedReq = tanData.getEl(i + 20);
                    tanVerfahren.anzSupportedTanVers = tanData.getEl(i + 21);

                    // tanVerfahren.challange_value_req = tanData.data[i+14].toUpperCase()=="J";
                    this.bpd.tan.tanVerfahren[tanVerfahren.code] = tanVerfahren;
                    i += 21;
                  }
                }
              } catch (ee) {
                this.gvLog.error(ee, {
                  gv: 'HITANS',
                }, 'Error while analyse HITANS');
              }
              // 6. Analysiere UPD
              try {
                const HIUPA = recvMsg.getSegmentByName(SegmentName.GENERAL_USER_PARAMS);
                this.upd.versUpd = HIUPA.getEl(3).data;
                this.upd.geschaeftsVorgGesp = (HIUPA.getEl(4) && HIUPA.getEl(4).data === '0'); // UPD-Verwendung
              } catch (ee) {
                this.gvLog.error(ee, {
                  gv: 'HIUPA',
                }, 'Error while analyse UPD');
              }
              // 7. Analysiere Verfügbare Tan Verfahren
              try {
                const hirmsForTanV: Segment = recvMsg.getSegmentByNameAndReference(SegmentName.RETURN_STATUS_SEGMENTS, HKVVB.nr);
                for (let i = 0; i !== hirmsForTanV.store.data.length; i += 1) {
                  if (hirmsForTanV.store.data[i].data.getEl(1) === ReturnCode.WARN_AVAILABLE_TAN_MODES) {
                    this.upd.availableTanVerfahren = [];
                    for (let a = 3; a < hirmsForTanV.store.data[i].data.data.length; a += 1) {
                      this.upd.availableTanVerfahren.push(hirmsForTanV.store.data[i].data.data[a].data);
                    }
                    if (this.upd.availableTanVerfahren.length > 0) {
                      this.gvLog.info({
                        gv: 'HKVVB',
                      }, 'Update to use Tan procedure: ' + this.upd.availableTanVerfahren[0]);
                    }
                    break;
                  }
                }
              } catch (ee) {
                this.gvLog.error(ee, {
                  gv: 'HKVVB',
                }, 'Error while analyse HKVVB result Tan Verfahren');
              }
              // 8. Analysiere Geschäftsvorfallparameter
              try {
                for (const i in recvMsg.segments) {
                  if (recvMsg.segments[i].name.length >= 6 && recvMsg.segments[i].name.charAt(5) === 'S') {
                    const gv = recvMsg.segments[i].name.substring(0, 5);
                    if (!(gv in this.bpd.gvParameters)) {
                      this.bpd.gvParameters[gv] = {};
                    }
                    this.bpd.gvParameters[gv][recvMsg.segments[i].version] = recvMsg.segments[i];
                  }
                }
              } catch (ee) {
                this.gvLog.error(ee, {
                  gv: 'HKVVB',
                }, 'Error while analyse HKVVB result Tan Verfahren');
              }
              try {
                cb(error, recvMsg, hasNewUrl);
              } catch (cbError) {
                this.gvLog.error(cbError, {
                  gv: 'HKVVB',
                }, 'Unhandled callback Error in HKVVB,HKIDN');
              }
            } catch (e) {
              this.gvLog.error(e, {
                gv: 'HKVVB',
              }, 'Error while analyse HKVVB Response');
              try {
                cb(e.toString(), null, false);
              } catch (cbError) {
                this.gvLog.error(cbError, {
                  gv: 'HKVVB',
                }, 'Unhandled callback Error in HKVVB,HKIDN');
              }
            }
          } else {
            this.gvLog.error({
              gv: 'HKVVB',
            }, 'Error while analyse HKVVB Response No Init Successful recv.');
            try {
              cb('Keine Initialisierung Erfolgreich Nachricht erhalten!', recvMsg, false);
            } catch (cbError) {
              this.gvLog.error(cbError, {
                gv: 'HKVVB',
              }, 'Unhandled callback Error in HKVVB,HKIDN');
            }
          }
        } else {
          // Fehler schauen ob einer der Standardfehler, die gesondert behandelt werden
          // hier gibt es diverse fehlercode varianten, verhalten sich nicht nach doku
          // genaue identifikation des benutzer/pin falsch scheitert and zu vielen varianten + codes werden auch anderweitig genutzt
          /* if(Helper.checkMsgsWithBelongToForId(recvMsg,HKVVB.nr,"9931")||
             Helper.checkMsgsWithBelongToForId(recvMsg,HKVVB.nr,"9010")||
             Helper.checkMsgsWithBelongToForId(recvMsg,HNSHK.nr,"9210")||
             Helper.checkMsgsWithBelongToForId(recvMsg,HKIDN.nr,"9210")||
             Helper.checkMsgsWithBelongToForId(recvMsg,HKIDN.nr,"9010")){
             try{
               // 1. Benutzer nicht bekannt bzw. Pin falsch
               this.gvLog.error({gv:"HKVVB",hirmsg:HIRMG},"User not known or wrong pin");
               throw new Exceptions.WrongUserOrPinError();
             }catch(er_thrown){
               try{
                 cb(er_thrown,recvMsg,false);
               }catch(cbError){
                 this.gvLog.error(cbError,{gv:"HKVVB"},"Unhandled callback Error in HKVVB,HKIDN");
               }
             }
          }else{ */

          // anderer Fehler
          this.gvLog.error({
            gv: 'HKVVB',
            hirmsg: HIRMG,
          }, 'Error while analyse HKVVB Response Wrong HIRMG response code');
          try {
            cb('Fehlerhafter Rückmeldungscode: ' + (HIRMG === null ? 'keiner' : HIRMG.getEl(1).data.getEl(3)), recvMsg, false);
          } catch (cbError) {
            this.gvLog.error(cbError, {
              gv: 'HKVVB',
            }, 'Unhandled callback Error in HKVVB,HKIDN');
          }
          // }
        }
      }
    });
  }

  public close(): Promise<Nachricht> {
    return new Promise<Nachricht>((resolve, reject) => {
      const msg = new Nachricht(this.protoVersion);
      if (this.kundenId !== '9999999999') {
        const signInfo = new SignInfo();
        signInfo.pin = this.pin;
        signInfo.tan = NULL;
        signInfo.sysId = this.sysId;
        signInfo.pinVersion = this.upd.availableTanVerfahren[0];
        signInfo.sigId = this.getNewSigId();
        msg.sign(signInfo);
      }
      msg.init(this.dialogId, this.nextMsgNr, this.blz, this.kundenId);
      this.nextMsgNr += 1;
      msg.addSeg(Helper.newSegFromArray('HKEND', 1, [this.dialogId]));
      this.sendMsgToDestination(msg, (error, recvMsg) => {
        if (error) {
          this.gvLog.error(error, {
            msg,
            gv: 'HKEND',
          }, 'HKEND could not be send');
          reject(error);
        } else {
          resolve(recvMsg);
        }
      }, true);
    });
  }

  public async connect(): Promise<void> {
    const originalBpd = this.bpd.clone();
    originalBpd.clone = this.bpd.clone;
    const originalUpd = this.upd.clone();
    originalUpd.clone = this.upd.clone;
    return new Promise<void>((resolve, reject) => {
      this.prepareConnection(resolve, reject, originalBpd, originalUpd);
    });
  }

  public convertUmsatzeArrayToListofAllTransactions(umsaetze) {
    const result = [];
    for (let i = 0; i !== umsaetze.length; i += 1) {
      for (let a = 0; a !== umsaetze[i].saetze.length; a += 1) {
        result.push(umsaetze[i].saetze[a]);
      }
    }
    return result;
  }

  // SEPA kontoverbindung anfordern HKSPA, HISPA ist die antwort
  public getSepa(forKonto): Promise<Konto[]> {
    return new Promise<Konto[]>((resolve, reject) => {
      // Vars
      let processed = false;
      let v1 = null;
      let aufsetzpunktLoc = 0;
      const sepaList = [];
      // Create Segment
      if (forKonto) {
        v1 = [
          [280, forKonto],
        ];
        aufsetzpunktLoc = 2;
      } else {
        v1 = [];
        aufsetzpunktLoc = 1;
      }
      // Start
      const reqSepaOrder = new Order(this);
      reqSepaOrder.msg({
        type: 'HKSPA',
        ki_type: 'HISPA',
        aufsetzpunkt_loc: [aufsetzpunktLoc],
        send_msg: {
          1: v1,
          2: v1,
          3: v1,
        },
        recv_msg: reqSepaOrder.helper().vers([1, 2, 3], (segVers, relatedRespSegments, relatedRespMsgs, recvMsg) => {
          try {
            if (reqSepaOrder.checkMessagesOkay(relatedRespMsgs, true)) {
              const HISPA = reqSepaOrder.getSegByName(relatedRespSegments, 'HISPA');
              if (HISPA !== null) {
                for (let i = 0; i !== HISPA.store.data.length; i += 1) {
                  const verb = HISPA.getEl(i + 1).data as DatenElementGruppe;
                  const o = new Konto();
                  o.isSepa = verb.getEl(1) === 'J';
                  o.iban = verb.getEl(2);
                  o.bic = verb.getEl(3);
                  o.kontoNr = verb.getEl(4);
                  o.unterKonto = verb.getEl(5);
                  o.countryCode = verb.getEl(6);
                  o.blz = verb.getEl(7);
                  sepaList.push(o);
                }
                resolve(sepaList);
              } else {
                throw new Error('TODO ausführlicherer Error');
              }
            }
          } catch (e) {
            this.gvLog.error(e, {
              gv: 'HKSPA',
              msgs: relatedRespMsgs,
              segments: relatedRespSegments,
            }, 'Exception while parsing HKSPA response');
            reject(e);
          }
          processed = true;
        }).done(),
      });
      reqSepaOrder.done((error, order, recvMsg) => {
        if (error && !processed) {
          this.gvLog.error(error, {
            recvMsg,
            gv: 'HKSPA',
          }, 'Exception while parsing HKSPA');
          reject(error);
        } else if (!processed) {
          const ex = new Exceptions.InternalError('HKSPA response was not analysied');
          this.gvLog.error(ex, {
            recvMsg,
            gv: 'HKSPA',
          }, 'HKSPA response was not analysied');
          reject(ex);
        }
      });
    });
  }

  /*
    konto = {iban,bic,konto_nr,unter_konto,ctry_code,blz}
    from_date
    to_date		können null sein
    cb
  */
  public getTransactions(konto: Konto, fromDate, toDate): Promise<Umsatz[]> {
    return new Promise<Umsatz[]>((resolve, reject) => {
      let processed = false;
      let v5 = [[konto.kontoNr, konto.unterKonto, konto.countryCode, konto.blz], 'N'];
      let v7 = [[konto.iban, konto.bic, konto.kontoNr, konto.unterKonto, konto.countryCode, konto.blz], 'N'];
      if (fromDate !== null || toDate !== null) {
        const dates = [fromDate !== null ? Helper.convertDateToDFormat(fromDate) : '', toDate !== null ? Helper.convertDateToDFormat(toDate) : ''];
        v5 = v5.concat(dates);
        v7 = v7.concat(dates);
      }
      // Start
      const reqUmsatz = new Order(this);
      const recv = (segVers, relatedRespSegments, relatedRespMsgs, recvMsg) => {
        try {
          if (reqUmsatz.checkMessagesOkay(relatedRespMsgs, true)) {
            // Erfolgreich Meldung
            let txt = '';
            for (const i in relatedRespSegments) {
              if (relatedRespSegments[i].name === 'HIKAZ') {
                const HIKAZ = relatedRespSegments[i];
                txt += HIKAZ.getEl(1).data;
              }
            }
            const mtparse = new MTParser();
            mtparse.parse(txt);
            const umsatze = mtparse.getKontoUmsaetzeFromMT940();
            // Callback
            resolve(umsatze);
          }
        } catch (ee) {
          this.gvLog.error(ee, {
            gv: 'HKKAZ',
            resp_msg: recvMsg,
          }, 'Exception while parsing HKKAZ response');
          reject(ee);
        }
        processed = true;
      };
      // TODO check if we can do the old or the new version HKCAZ
      reqUmsatz.msg({
        type: 'HKKAZ',
        ki_type: 'HIKAZ',
        aufsetzpunkt_loc: [6],
        send_msg: {
          7: v7,
          5: v5,
        },
        recv_msg: {
          7: recv,
          5: recv,
        },
      });
      reqUmsatz.done((error, order, recvMsg) => {
        if (error && !processed) {
          this.gvLog.error(error, {
            recvMsg,
            gv: 'HKKAZ',
          }, 'HKKAZ could not be send');
          reject(error);
        } else if (!processed) {
          const ex = new Exceptions.InternalError('HKKAZ response was not analysied');
          this.gvLog.error(ex, {
            recvMsg,
            gv: 'HKKAZ',
          }, 'HKKAZ response was not analysied');
          reject(ex);
        }
      });
    });

  }

  /*
    konto = {iban,bic,konto_nr,unter_konto,ctry_code,blz}
    cb
  */
  public getTotal(konto: Konto): Promise<TotalResult> {
    return new Promise<TotalResult>((resolve, reject) => {
      const reqSaldo = new Order(this);
      let processed = false;
      let v5 = null;
      let v7 = null;
      const availSendMsg = {};
      if ('iban' in konto && 'bic' in konto && reqSaldo.checkKITypeAvailible('HISAL', [7])) {
        const kontoVerbInt = [konto.iban, konto.bic, konto.kontoNr, konto.unterKonto, konto.countryCode, konto.blz];
        v7 = [kontoVerbInt, 'N'];
        availSendMsg[7] = v7;
      } else {
        const kontoVerb = [konto.kontoNr, konto.unterKonto, konto.countryCode, konto.blz];
        v5 = [kontoVerb, 'N'];
        availSendMsg[5] = v5;
        availSendMsg[6] = v5;
      }
      // Start
      reqSaldo.msg({
        type: 'HKSAL',
        ki_type: 'HISAL',
        send_msg: availSendMsg,
        recv_msg: reqSaldo.helper().vers([5, 6, 7], (segVers, relatedRespSegments, relatedRespMsgs, recvMsg) => {
          try {
            if (reqSaldo.checkMessagesOkay(relatedRespMsgs, true)) {
              const HISAL = reqSaldo.getSegByName(relatedRespSegments, 'HISAL');
              if (HISAL !== null) {
                const result = new TotalResult();
                result.desc = reqSaldo.getElFromSeg(HISAL, 2, null);
                result.currency = reqSaldo.getElFromSeg(HISAL, 3, null);
                result.total = Helper.getSaldo(HISAL, 4, false);
                result.totalReserved = Helper.getSaldo(HISAL, 5, false);
                result.creditLine = Helper.getBetrag(HISAL, 6);
                result.availableAmount = Helper.getBetrag(HISAL, 7);
                result.usedAmount = Helper.getBetrag(HISAL, 8);
                result.overdraft = null;
                result.bookingDate = null;
                result.dueDate = Helper.getJSDateFromSeg(HISAL, 11);

                if (segVers === 5) {
                  result.bookingDate = Helper.getJSDateFromSeg(HISAL, 9, 10);
                } else {
                  result.bookingDate = Helper.getJSDateFromSegTSP(HISAL, 11);
                  result.overdraft = Helper.getBetrag(HISAL, 9);
                }
                resolve(result);
              } else {
                throw new Error('TODO ausführlicherer Error');
              }
            }
          } catch (e) {
            this.gvLog.error(e, {
              gv: 'HKSAL',
              msgs: relatedRespMsgs,
              segments: relatedRespSegments,
            }, 'Exception while parsing HKSAL response');
            reject(e);
          }
          processed = true;
        }).done(),
      });
      reqSaldo.done((error, order, recvMsg) => {
        if (error && !processed) {
          this.gvLog.error(error, {
            recvMsg,
            gv: 'HKSAL',
          }, 'Exception while parsing HKSAL');
          reject(error);
        } else if (!processed) {
          const ex = new Exceptions.InternalError('HKSAL response was not analysed');
          this.gvLog.error(ex, {
            recvMsg,
            gv: 'HKSAL',
          }, 'HKSAL response was not analysed');
          reject(ex);
        }
      });
    });

  }

  private logSuccessfullInit(step) {
    // Erfolgreich Init Msg verschickt
    this.conEstLog.debug({
      step: 1,
      bpd: this.beautifyBPD(this.bpd),
      upd: this.upd,
      url: this.bpd.url,
      new_sig_method: this.upd.availableTanVerfahren[0],
    }, 'Init Dialog successful.');
  }

  private prepareConnection(resolve, reject, originalBpd, originalUpd, allowUrlChange: boolean = true) {
    this.msgInitDialog((error, recvMsg, hasNewUrl) => {
      if (error) {
        this.endDialogIfNotCanceled(recvMsg);
        const HIRMS = recvMsg.getSegmentByNameAndReference(SegmentName.RETURN_STATUS_SEGMENTS, 1);
        if (this.protoVersion === 300 && HIRMS && HIRMS.getEl(1).data.getEl(1) === ReturnCode.ERROR_UNEXPECTED && HIRMS.getEl(1).data.getEl(2) === '3') {
          // ==> Version wird wohl nicht unterstützt, daher neu probieren mit HBCI2 Version
          this.conEstLog.debug({
            step: 1,
            hirms: HIRMS,
          }, 'Version 300 nicht unterstützt, Switch Version from FinTS to HBCI2.2');
          this.protoVersion = 220;
          this.clear();
          this.prepareConnection(resolve, reject, originalBpd, originalUpd, true);
        } else {
          // Anderer Fehler
          this.conEstLog.error({
            error,
            step: 1,
          }, 'Init Dialog failed: ' + error);
          reject(error);
        }
        return;
      }

      this.logSuccessfullInit(1);
      this.resetConnection(originalBpd, originalUpd, recvMsg);

      if (hasNewUrl) {
        if (!allowUrlChange) {
          this.conEstLog.error({
            step: 2,
          }, 'Multiple URL changes are not supported!');
          // Callback
          reject('Mehrfachänderung der URL ist nicht unterstützt!');
          return;
        }
        this.prepareConnection(resolve, reject, originalBpd, originalUpd, false);
        return;
      }
      // 3: eigentliche Verbindung aufbauen
      this.conEstLog.debug({
        step: 3,
      }, 'Start Connection in Step 3');
      this.completeConnection(resolve, reject, originalBpd, originalUpd);
    });
  }

  private completeConnection(resolve, reject, originalBpd, originalUpd) {
    this.msgInitDialog(async (error, recvMsg, hasNewUrl) => {
      if (error) {
        this.endDialogIfNotCanceled(recvMsg);
        reject(error);
        return;
      }
      if (hasNewUrl) {
        // Wir unterstützen keine mehrfach Ändernden URLs
        this.bpd = originalBpd.clone();
        this.upd = originalUpd.clone();
        this.endDialogIfNotCanceled(recvMsg);
        this.conEstLog.error({
          step: 3,
        }, 'Multiple URL changes are not supported!');
        // Callback
        reject('Mehrfachänderung der URL ist nicht unterstützt!');
        return;
      }
      // Ende Schritt 3 = Verbindung Ready
      this.conEstLog.debug({
        step: 3,
      }, 'Connection entirely established. Now get the available accounts.');
      try {
        const sepaList = await this.getSepa(null);
        // Erfolgreich die Kontendaten geladen, diese jetzt noch in konto mergen und Fertig!
        for (let i = 0; i !== sepaList.length; i += 1) {
          for (let j = 0; j !== this.konten.length; j += 1) {
            if (this.konten[j].kontoNr === sepaList[i].kontoNr &&
              this.konten[j].unterKonto === sepaList[i].unterKonto) {
              this.konten[j].sepaData = sepaList[i];
              break;
            }
          }
        }
        this.conEstLog.debug({
          step: 3,
          recv_sepa_list: sepaList,
        }, 'Connection entirely established and got available accounts. Return.');
        resolve();
      } catch (err) {
        this.conEstLog.error({
          step: 3,
        }, 'Error getting the available accounts.');
        this.endDialogIfNotCanceled(recvMsg);
        reject(err);
      }
    });
  }

  private beautifyBPD(bpd: BPD) {
    const cbpd = bpd.clone();
    cbpd.gvParameters = '...';
    return cbpd;
  }

  private endDialogIfNotCanceled(message: Nachricht): Promise<Nachricht> {
    const promise: Promise<Nachricht> = new Promise(async (resolve, reject) => {
      if (message.wasCanceled()) {
        resolve();
      } else {
        await this.close();
        resolve();
      }
    });

    return promise.then((promiseMessage: Nachricht) => {
      this.conEstLog.debug('Connection closed okay.');
      return promiseMessage;
    }).catch(err => {
      this.conEstLog.error({
        error: err,
      }, 'Connection close failed.');
      throw err;
    });
  }

  private resetConnection(originalBpd, originalUpd, recvMsg) {
    const neuUrl = this.bpd.url;
    const neuSigMethod = this.upd.availableTanVerfahren[0];
    this.bpd = originalBpd.clone();
    this.upd = originalUpd.clone();
    const origSysId = this.sysId;
    const origLastSig = this.lastSignaturId;
    this.endDialogIfNotCanceled(recvMsg);
    this.clear();
    this.bpd.url = neuUrl;
    this.upd.availableTanVerfahren[0] = neuSigMethod;
    this.sysId = origSysId;
    this.lastSignaturId = origLastSig;
    originalBpd.url = this.bpd.url;
    originalUpd.availableTanVerfahren[0] = neuSigMethod;
  }

  private debugLogMsg = (txt, send) => {
    this.conLog.trace({
      raw_data: txt,
      send_or_recv: send ? 'send' : 'recv',
    }, 'Connection Data Trace');
    if (this.debugMode) {
      console.log((send ? 'Send: ' : 'Recv: ') + txt);
    }
  }
}
