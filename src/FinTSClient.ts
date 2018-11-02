/*
 *  Copyright 2015-2016 Jens Schyma jeschyma@gmail.com
 *
 *  This File is a Part of the source of Open-Fin-TS-JS-Client.
 *
 *
 *
 *  This file is licensed to you under the Apache License, Version 2.0 (the
 *  "License"); you may not use this file except in compliance
 *  with the License.  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *  or in the LICENSE File contained in this project.
 *
 *
 *  Unless required by applicable law or agreed to in writing,
 *  software distributed under the License is distributed on an
 *  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 *  KIND, either express or implied.  See the License for the
 *  specific language governing permissions and limitations
 *  under the License.
 *
 *
 *
 *  See the NOTICE file distributed with this work for additional information
 *  regarding copyright ownership.
 *
 *
 */
import * as bunyan from 'bunyan';
import * as encoding from 'encoding';
import { ClientRequest } from 'http';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import Bank from './Bank';
import BPD from './BPD';
import DatenElementGruppe from './DatenElementGruppe';
import { Exceptions } from './Exceptions';
import Helper from './Helper';
import Konto from './Konto';
import Logger from './Logger';
import MTParser from './MTParser';
import Nachricht from './Nachricht';
import { NULL } from './NULL';
import Order from './Order';
import Segment from './Segment';
import SignInfo from './SignInfo';
import TanVerfahren from './TanVerfahren';
import UPD from './UPD';

export default class FinTSClient {

  public dialogId = 0;
  public nextMsgNr = 1;
  public sysId = 0;
  public protoVersion = 300;
  public bpd: BPD = new BPD();
  public upd: UPD = new UPD();

  private bankenliste: { [index: string]: Bank };
  private log = Logger.getLogger('main');
  private conLog = Logger.getLogger('con');
  private conEstLog = Logger.getLogger('conest');
  private gvLog = Logger.getLogger(('gv'));
  private ctry = 280;
  private tan = NULL;
  private debugMode = false;

  private clientName = 'Open-FinTS-JS-Client';
  private clientVersion = 4;
  private inConnection = false;

  private lastSignaturId = 1;
  private konten: Konto[] = [];

  constructor(public blz: string, public kundenId: string,
              public pin: string, public bankenList: any) {
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

    try {
      this.bpd.url = this.bankenList === undefined ? this.bankenliste['' + this.blz].url : this.bankenList['' + this.blz].url;
    } catch (e) {
      throw new Exceptions.MissingBankConnectionDataException(this.blz);
    }

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

    this.sendMsgToDestination(msg, (error, recvMsg) => {
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
        let HIRMG: Segment = null;
        try {
          HIRMG = recvMsg.selectSegByName('HIRMG')[0];
        } catch (e) {
          // nothing
        }
        if (HIRMG !== null && (HIRMG.getEl(1).data.getElString(1) === '0010' || HIRMG.getEl(1).data.getElString(1) === '3060')) {
          if (Helper.checkMsgsWithBelongToForId(recvMsg, HKVVB.nr, '0020')) {
            try {
              // 1. Dialog ID zuweisen
              this.dialogId = recvMsg.selectSegByName('HNHBK')[0].getEl(3).data;
              // 2. System Id
              if (!this.isAnonymous() && this.sysId === 0) {
                this.sysId = recvMsg.selectSegByNameAndBelongTo('HISYN', syn)[0].getEl(1).data;
              }
              // 3. Möglicherweise neue kommunikationsdaten
              let HIKOM = recvMsg.selectSegByName('HIKOM');
              HIKOM = HIKOM.length > 0 ? HIKOM[0] : null;
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
                const kontoList = recvMsg.selectSegByName('HIUPD');
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
                const HIBPA = recvMsg.selectSegByName('HIBPA')[0];
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
                  const pinData = recvMsg.selectSegByName('HIPINS')[0].getEl(4);
                  this.bpd.pin.minLength = pinData.getEl(1);
                  this.bpd.pin.maxLength = pinData.getEl(2);
                  this.bpd.pin.maxTanLength = pinData.getEl(3);
                  this.bpd.pin.txtBenutzerkennung = pinData.getEl(4);
                  this.bpd.pin.txtKundenId = pinData.getEl(5);
                  // 5.3.2 Tanerforderlichkeit für die Geschäftsvorfälle
                  this.bpd.pin.availableSeg = {}; // true and false für ob Tan erforderlich
                  for (let i = 5; i < pinData.data.length; i += 1) {
                    this.bpd.pin.availableSeg[pinData.data[i]] = pinData.data[i + 1].toUpperCase() === 'J';
                    i += 1;
                  }
                } catch (ee) {
                  this.gvLog.error(ee, {
                    gv: 'HIPINS',
                  }, 'Error while analyse HIPINS');
                }
              } else {
                let pinDataSpk = recvMsg.selectSegByName('DIPINS');
                if (pinDataSpk.length > 0) {
                  try {
                    // 5.3 Pins
                    pinDataSpk = pinDataSpk[0];
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
                const HITANS = recvMsg.selectSegByName('HITANS')[0];
                if (HITANS.vers === 5) {
                  const tanData = HITANS.getEl(4);
                  this.bpd.tan.oneStepAvailable = tanData.getEl(1).toUpperCase() === 'J';
                  this.bpd.tan.multipleTan = tanData.getEl(2).toUpperCase() === 'J';
                  this.bpd.tan.hashType = tanData.getEl(3);
                  this.bpd.tan.tanVerfahren = {};
                  for (let i = 3; i < tanData.data.length; i += 1) {
                    const tanVerfahren = new TanVerfahren();
                    tanVerfahren.code = tanData.data[i];
                    tanVerfahren.oneTwoStepVers = tanData.data[i + 1]; // "1": Einschrittverfahren, "2": Zweischritt
                    tanVerfahren.techId = tanData.data[i + 2];
                    tanVerfahren.zkaTanVerfahren = tanData.data[i + 3];
                    tanVerfahren.versZkaTanVerfahren = tanData.data[i + 4];
                    tanVerfahren.desc = tanData.data[i + 5];
                    tanVerfahren.maxLenTan = tanData.data[i + 6];
                    tanVerfahren.tanAlphanum = tanData.data[i + 7] === '2';
                    tanVerfahren.txtRueckwert = tanData.data[i + 8];
                    tanVerfahren.maxLenRueckwert = tanData.data[i + 9];
                    tanVerfahren.anzTanlist = tanData.data[i + 10];
                    tanVerfahren.multiTan = tanData.data[i + 11].toUpperCase() === 'J';
                    tanVerfahren.tanZeitDiaBez = tanData.data[i + 12];
                    tanVerfahren.tanListNrReq = tanData.data[i + 13];
                    tanVerfahren.auftragsstorno = tanData.data[i + 14].toUpperCase() === 'J';
                    tanVerfahren.smsAbuKontoReq = tanData.data[i + 15];
                    tanVerfahren.auftragKonto = tanData.data[i + 16];
                    tanVerfahren.challengeClassReq = tanData.data[i + 17].toUpperCase() === 'J';
                    tanVerfahren.challengeStructured = tanData.data[i + 18].toUpperCase() === 'J';
                    tanVerfahren.initialisierungsMod = tanData.data[i + 19];
                    tanVerfahren.bezTanMedReq = tanData.data[i + 20];
                    tanVerfahren.anzSupportedTanVers = tanData.data[i + 21];

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
                const HIUPA = recvMsg.selectSegByName('HIUPA')[0];
                this.upd.versUpd = HIUPA.getEl(3).data;
                this.upd.geschaeftsVorgGesp = HIUPA.getEl(4).data === '0'; // UPD-Verwendung
              } catch (ee) {
                this.gvLog.error(ee, {
                  gv: 'HIUPA',
                }, 'Error while analyse UPD');
              }
              // 7. Analysiere Verfügbare Tan Verfahren
              try {
                const hirmsForTanV: Segment = recvMsg.selectSegByNameAndBelongTo('HIRMS', HKVVB.nr)[0];
                for (let i = 0; i !== hirmsForTanV.store.data.length; i += 1) {
                  if (hirmsForTanV.store.data[i].data.getEl(1) === '3920') {
                    this.upd.availableTanVerfahren = [];
                    for (let a = 3; a < hirmsForTanV.store.data[i].data.length; a += 1) {
                      this.upd.availableTanVerfahren.push(hirmsForTanV.store.data[i].data[a]);
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
                  if (recvMsg.segments[i].nathis.length >= 6 && recvMsg.segments[i].nathis.charAt(5) === 'S') {
                    const gv = recvMsg.segments[i].nathis.substring(0, 5);
                    if (!(gv in this.bpd.gvParameters)) {
                      this.bpd.gvParameters[gv] = {};
                    }
                    this.bpd.gvParameters[gv][recvMsg.segments[i].vers] = recvMsg.segments[i];
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

  public msgEndDialog = (cb) => {
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
      }
      try {
        cb(error, recvMsg);
      } catch (cbError) {
        this.gvLog.error(cbError, {
          gv: 'HKEND',
        }, 'Unhandled callback Error in HKEND');
      }
    }, true);
  }

  private beautifyBPD(bpd: BPD) {
    const cbpd = bpd.clone();
    cbpd.gvParameters = '...';
    return cbpd;
  }

  private msgCheckAndEndDialog = (recvMsg, cb) => {
    const hirmgS = recvMsg.selectSegByName('HIRMG');
    for (const k in hirmgS) {
      for (const i in (hirmgS[k].store.data)) {
        const ermsg = hirmgS[k].store.data[i].getEl(1);
        if (ermsg === '9800') {
          try {
            cb(null, null);
          } catch (cbError) {
            this.gvLog.error(cbError, {
              gv: 'HKEND',
            }, 'Unhandled callback Error in HKEND');
          }
          return;
        }
      }
    }
    this.msgEndDialog(cb);
  }

  // SEPA kontoverbindung anfordern HKSPA, HISPA ist die antwort
  private msgRequestSepa = (forKonto, cb) => {
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
                const verb = HISPA.getEl(i + 1) as DatenElementGruppe;
                const o = new Konto();
                o.isSepa = verb.getEl(1).data === 'J';
                o.iban = verb.getEl(2).data;
                o.bic = verb.getEl(3).data;
                o.kontoNr = verb.getEl(4).data;
                o.unterKonto = verb.getEl(5).data;
                o.countryCode = verb.getEl(6).data;
                o.blz = verb.getEl(7).data;
                sepaList.push(o);
              }
              try {
                cb(null, recvMsg, sepaList);
              } catch (cbError) {
                this.gvLog.error(cbError, {
                  gv: 'HKSPA',
                }, 'Unhandled callback Error in HKSPA');
              }
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
          try {
            cb(e, null, null);
          } catch (cbError) {
            this.gvLog.error(cbError, {
              gv: 'HKSPA',
            }, 'Unhandled callback Error in HKSPA');
          }
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
        try {
          cb(error, recvMsg, null);
        } catch (cbError) {
          this.gvLog.error(cbError, {
            gv: 'HKSPA',
          }, 'Unhandled callback Error in HKSPA');
        }
      } else if (!processed) {
        const ex = new Exceptions.InternalError('HKSPA response was not analysied');
        this.gvLog.error(ex, {
          recvMsg,
          gv: 'HKSPA',
        }, 'HKSPA response was not analysied');
        try {
          cb(ex, recvMsg, null);
        } catch (cbError) {
          this.gvLog.error(cbError, {
            gv: 'HKSPA',
          }, 'Unhandled callback Error in HKSPA');
        }
      }
    });
  }

  /*
    konto = {iban,bic,konto_nr,unter_konto,ctry_code,blz}
    from_date
    to_date		können null sein
    cb
  */
  private msgGetKontoUmsaetze(konto, fromDate, toDate, cb) {
    let processed = false;
    let v7 = null;
    let v5 = null;
    if (fromDate === null && toDate === null) {
      v5 = [
        [konto.konto_nr, konto.unter_konto, konto.ctry_code, konto.blz], 'N',
      ];
      v7 = [
        [konto.iban, konto.bic, konto.konto_nr, konto.unter_konto, konto.ctry_code, konto.blz], 'N',
      ];
    } else {
      v5 = [
        [konto.konto_nr, konto.unter_konto, konto.ctry_code, konto.blz], 'N', fromDate !== null ? Helper.convertDateToDFormat(fromDate) : '', toDate !== null ? Helper.convertDateToDFormat(toDate) : '',
      ];
      v7 = [
        [konto.iban, konto.bic, konto.konto_nr, konto.unter_konto, konto.ctry_code, konto.blz], 'N', fromDate !== null ? Helper.convertDateToDFormat(fromDate) : '', toDate !== null ? Helper.convertDateToDFormat(toDate) : '',
      ];
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
              txt += HIKAZ.getEl(1);
            }
          }
          const mtparse = new MTParser();
          mtparse.parse(txt);
          const umsatze = mtparse.getKontoUmsaetzeFromMT940();
          // Callback
          try {
            cb(null, recvMsg, umsatze);
          } catch (cbError) {
            this.gvLog.error(cbError, {
              gv: 'HKKAZ',
            }, 'Unhandled callback Error in HKKAZ');
          }
        }
      } catch (ee) {
        this.gvLog.error(ee, {
          gv: 'HKKAZ',
          resp_msg: recvMsg,
        }, 'Exception while parsing HKKAZ response');
        // Callback
        try {
          cb(ee, recvMsg, null);
        } catch (cbError) {
          this.gvLog.error(cbError, {
            gv: 'HKKAZ',
          }, 'Unhandled callback Error in HKKAZ');
        }
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
        // Callback
        try {
          cb(error, recvMsg, null);
        } catch (cbError) {
          this.gvLog.error(cbError, {
            gv: 'HKKAZ',
          }, 'Unhandled callback Error in HKKAZ');
        }
      } else if (!processed) {
        const ex = new Exceptions.InternalError('HKKAZ response was not analysied');
        this.gvLog.error(ex, {
          recvMsg,
          gv: 'HKKAZ',
        }, 'HKKAZ response was not analysied');
        // Callback
        try {
          cb(ex, recvMsg, null);
        } catch (cbError) {
          this.gvLog.error(cbError, {
            gv: 'HKKAZ',
          }, 'Unhandled callback Error in HKKAZ');
        }
      }
    });
  }

  private convertUmsatzeArrayToListofAllTransactions = (umsaetze) => {
    const result = [];
    for (let i = 0; i !== umsaetze.length; i += 1) {
      for (let a = 0; a !== umsaetze[i].saetze.length; a += 1) {
        result.push(umsaetze[i].saetze[a]);
      }
    }
    return result;
  }

  /*
    konto = {iban,bic,konto_nr,unter_konto,ctry_code,blz}
    cb
  */
  private msgGetSaldo(konto: Konto, cb) {
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
              try {
                const result = {
                  desc: reqSaldo.getElFromSeg(HISAL, 2, null),
                  cur: reqSaldo.getElFromSeg(HISAL, 3, null),
                  saldo: Helper.getSaldo(HISAL, 4, false),
                  saldo_vorgemerkt: Helper.getSaldo(HISAL, 5, false),
                  credit_line: Helper.getBetrag(HISAL, 6),
                  avail_amount: Helper.getBetrag(HISAL, 7),
                  used_amount: Helper.getBetrag(HISAL, 8),
                  overdraft: null,
                  booking_date: null,
                  faelligkeit_date: Helper.getJSDateFromSeg(HISAL, 11),
                };
                if (segVers === 5) {
                  result.booking_date = Helper.getJSDateFromSeg(HISAL, 9, 10);
                } else {
                  result.booking_date = Helper.getJSDateFromSegTSP(HISAL, 11);
                  result.overdraft = Helper.getBetrag(HISAL, 9);
                }
                cb(null, recvMsg, result);
              } catch (cbError) {
                this.gvLog.error(cbError, {
                  gv: 'HKSAL',
                }, 'Unhandeled callback Error in HKSAL');
              }
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
          try {
            cb(e, null, null);
          } catch (cbError) {
            this.gvLog.error(cbError, {
              gv: 'HKSAL',
            }, 'Unhandeled callback Error in HKSAL');
          }
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
        try {
          cb(error, recvMsg, null);
        } catch (cbError) {
          this.gvLog.error(cbError, {
            gv: 'HKSAL',
          }, 'Unhandeled callback Error in HKSAL');
        }
      } else if (!processed) {
        const ex = new Exceptions.InternalError('HKSAL response was not analysed');
        this.gvLog.error(ex, {
          recvMsg,
          gv: 'HKSAL',
        }, 'HKSAL response was not analysed');
        try {
          cb(ex, recvMsg, null);
        } catch (cbError) {
          this.gvLog.error(cbError, {
            gv: 'HKSAL',
          }, 'Unhandled callback Error in HKSAL');
        }
      }
    });
  }

  private establishConnection = (cb) => {
    let protocolSwitch = false;
    let versStep = 1;
    const originalBpd = this.bpd.clone();
    originalBpd.clone = this.bpd.clone;
    const originalUpd = this.upd.clone();
    originalUpd.clone = this.upd.clone;
    // 1. Normale Verbindung herstellen um BPD zu bekommen und evtl. wechselnde URL ( 1.versVersuch FinTS 2. versVersuch HBCI2.2 )
    // 2. Verbindung mit richtiger URL um auf jeden Fall (auch bei geänderter URL) die richtigen BPD zu laden + Tan Verfahren herauszufinden
    // 3. Abschließende Verbindung aufbauen
    const performStep = (step) => {
      this.msgInitDialog((error, recvMsg, hastNeuUrl) => {
        if (error) {
          this.msgCheckAndEndDialog(recvMsg, (error2, recvMsg2) => {
            if (error2) {
              this.conEstLog.error({
                step,
                error: error2,
              }, 'Connection close failed.');
            } else {
              this.conEstLog.debug({
                step,
              }, 'Connection closed okay.');
            }
          });
          // Wurde Version 300 zuerst probiert, kann noch auf Version 220 gewechselt werden, dazu:
          // Prüfen ob aus der Anfrage Nachricht im Nachrichtenheader(=HNHBK) die Version nicht akzeptiert wurde
          // HNHBK ist immer Segment Nr. 1
          // Version steht in Datenelement Nr. 3
          // ==> Ist ein HIRMS welches auf HNHBK mit Nr. 1 referenziert vorhanden ?
          // ==> Hat es den Fehlercode 9120 = "nicht erwartet" ?
          // ==> Bezieht es sich auf das DE Nr. 3 ?
          const HIRMS = recvMsg.selectSegByNameAndBelongTo('HIRMS', 1)[0];
          if (this.protoVersion === 300 && HIRMS && HIRMS.getEl(1).getEl(1) === '9120' && HIRMS.getEl(1).getEl(2) === '3') {
            // ==> Version wird wohl nicht unterstützt, daher neu probieren mit HBCI2 Version
            this.conEstLog.debug({
              step,
              hirms: HIRMS,
            }, 'Version 300 nicht unterstützt, Switch Version from FinTS to HBCI2.2');
            this.protoVersion = 220;
            versStep = 2;
            protocolSwitch = true;
            this.clear();
            performStep(1);
          } else {
            // Anderer Fehler
            this.conEstLog.error({
              step,
              error,
            }, 'Init Dialog failed: ' + error);
            try {
              cb(error);
            } catch (cbError) {
              this.conEstLog.error(cbError, {
                step,
              }, 'Unhandled callback Error in EstablishConnection');
            }
          }
        } else {
          // Erfolgreich Init Msg verschickt
          this.conEstLog.debug({
            step,
            bpd: this.beautifyBPD(this.bpd),
            upd: this.upd,
            url: this.bpd.url,
            new_sig_method: this.upd.availableTanVerfahren[0],
          }, 'Init Dialog successful.');
          if (step === 1 || step === 2) {
            // Im Step 1 und 2 bleiben keine Verbindungen erhalten
            // Diese Verbindung auf jeden Fall beenden
            const neuUrl = this.bpd.url;
            const neuSigMethod = this.upd.availableTanVerfahren[0];
            this.bpd = originalBpd.clone();
            this.upd = originalUpd.clone();
            const origSysId = this.sysId;
            const origLastSig = this.lastSignaturId;
            this.msgCheckAndEndDialog(recvMsg, (error2, recvMsg2) => {
              if (error2) {
                this.conEstLog.error({
                  step,
                  error: error2,
                }, 'Connection close failed.');
              } else {
                this.conEstLog.debug({
                  step,
                }, 'Connection closed okay.');
              }
            });
            this.clear();
            this.bpd.url = neuUrl;
            this.upd.availableTanVerfahren[0] = neuSigMethod;
            this.sysId = origSysId;
            this.lastSignaturId = origLastSig;
            originalBpd.url = this.bpd.url;
            originalUpd.availible_tan_verfahren[0] = neuSigMethod;
          }

          if (hastNeuUrl) {
            if (step === 1) {
              // Im Step 1 ist das eingeplant, dass sich die URL ändert
              this.conEstLog.debug({
                step: 2,
              }, 'Start Connection in Step 2');
              performStep(2);
            } else {
              // Wir unterstützen keine mehrfach Ändernden URLs
              if (step === 3) {
                this.bpd = originalBpd.clone();
                this.upd = originalUpd.clone();
                this.msgCheckAndEndDialog(recvMsg, (error2, recvMsg2) => {
                  if (error2) {
                    this.conEstLog.error({
                      step,
                      error: error2,
                    }, 'Connection close failed.');
                  } else {
                    this.conEstLog.debug({
                      step,
                    }, 'Connection closed okay.');
                  }
                });
              }
              this.conEstLog.error({
                step,
              }, 'Multiple URL changes are not supported!');
              // Callback
              try {
                cb('Mehrfachänderung der URL ist nicht unterstützt!');
              } catch (cbError) {
                this.conEstLog.error(cbError, {
                  step,
                }, 'Unhandled callback Error in EstablishConnection');
              }
            }
          } else if (step === 1 || step === 2) {
            // 3: eigentliche Verbindung aufbauen
            this.conEstLog.debug({
              step: 3,
            }, 'Start Connection in Step 3');
            performStep(3);
          } else {
            // Ende Schritt 3 = Verbindung Ready
            this.conEstLog.debug({
              step,
            }, 'Connection entirely established. Now get the available accounts.');
            // 4. Bekomme noch mehr Details zu den Konten über HKSPA
            this.msgRequestSepa(null, (error4, recvMsg2, sepaList: Konto[]) => {
              if (error4) {
                this.conEstLog.error({
                  step,
                }, 'Error getting the available accounts.');
                this.msgCheckAndEndDialog(recvMsg, (error3) => {
                  if (error3) {
                    this.conEstLog.error({
                      step,
                      error: error3,
                    }, 'Connection close failed.');
                  } else {
                    this.conEstLog.debug({
                      step,
                    }, 'Connection closed okay.');
                  }
                });
                // Callback
                try {
                  cb(error4);
                } catch (cbError) {
                  this.conEstLog.error(cbError, {
                    step,
                  }, 'Unhandled callback Error in EstablishConnection');
                }
              } else {
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
                // Fertig
                this.conEstLog.debug({
                  step,
                  recv_sepa_list: sepaList,
                }, 'Connection entirely established and got available accounts. Return.');
                // Callback
                try {
                  cb(null);
                } catch (cbError) {
                  this.conEstLog.error(cbError, {
                    step,
                  }, 'Unhandled callback Error in EstablishConnection');
                }
              }
            });
          }
        }
      });
    };
    this.conEstLog.debug({
      step: 1,
    }, 'Start First Connection');
    performStep(1);
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
