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
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import Bank from './Bank';
import BPD from './BPD';
import { Exceptions } from './Exceptions';
import Helper from './Helper';
import Konto from './Konto';
import Logger from './Logger';
import Nachricht from './Nachricht';
import { NULL } from './NULL';
import SignInfo from './SignInfo';
import UPD from './UPD';

export default class FinTSClient {

  private bankenliste: { [index: string]: Bank };
  private log = Logger.getLogger('main');
  private conLog = Logger.getLogger('con');
  private conEstLog = Logger.getLogger('conest');
  private gvLog = Logger.getLogger(('gv'));
  private ctry = 280;
  private tan = NULL;
  private debugMode = false;

  private dialogId = 0;
  private nextMsgNr = 1;
  private clientName = 'Open-FinTS-JS-Client';
  private clientVersion = 4;
  private protoVersion = 300;
  private inConnection = false;

  private sysId = 0;
  private lastSignaturId = 1;
  private bpd: BPD = new BPD();
  private upd: UPD = new UPD();
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
    const HKVVB = Helper.newSegFromArray('HKVVB', 3, [this.bpd. versBpd, this.upd. versUpd, 0, this.clientName, this.clientVersion]);
    msg.addSeg(HKVVB);

    if (!this.isAnonymous() && this.sysId === 0) const syn = msg.addSeg(Helper.newSegFromArray('HKSYN', this.protoVersion === 220 ? 2 : 3, [0])); // Synchronisierung starten
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
          this.log.gv.error(cbError, {
            gv: 'HKVVB',
          }, 'Unhandled callback Error in HKVVB,HKIDN');
        }
      } else {
        // Prüfen ob Erfolgreich
        let HIRMG = null;
        try {
          HIRMG = recvMsg.selectSegByName('HIRMG')[0];
        } catch (e) {
          // nothing
        }
        if (HIRMG !== null && (HIRMG.getEl(1).getEl(1) === '0010' || HIRMG.getEl(1).getEl(1) === '3060')) {
          if (Helper.checkMsgsWithBelongToForId(recvMsg, HKVVB.nr, '0020')) {
            try {
              // 1. Dialog ID zuweisen
              this.dialogId = recvMsg.selectSegByName('HNHBK')[0].getEl(3);
              // 2. System Id
              if (!this.isAnonymous() && this.sysId === 0) {
                this.sysId = recvMsg.selectSegByNameAndBelongTo('HISYN', syn)[0].getEl(1);
              }
              // 3. Möglicherweise neue kommunikationsdaten
              let HIKOM = recvMsg.selectSegByName('HIKOM');
              HIKOM = HIKOM.length > 0 ? HIKOM[0] : null;
              let newUrl = this.bpd.url;
              if (HIKOM) {
                for (let i = 2; i < HIKOM.store.data.length; i++) {
                  // There can be up to 9 Kommunikationsparameter
                  //  however we check only if the first one which is HTTP (3)
                  // 	is different to the one we used before, according to the spec we should try reconnecting all 9
                  if (HIKOM.store.data[i].getEl(1) === '3') {
                    newUrl = (Helper.convertFromToJSText(HIKOM.store.data[i].getEl(2)));
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
                  konto.iban = kontodata.getEl(2);
                  konto.kontoNr = kontodata.getEl(1).getEl(1);
                  konto.unterKonto = kontodata.getEl(1).getEl(2);
                  konto.countryCode = kontodata.getEl(1).getEl(3);
                  konto.blz = kontodata.getEl(1).getEl(4);
                  konto.kundenId = kontodata.getEl(3);
                  konto.kontoart = kontodata.getEl(4);
                  konto.currency = kontodata.getEl(5);
                  konto.kunde1Name = kontodata.getEl(6);
                  konto.productName = kontodata.getEl(8);
                  konto.sepaData = null;
                  this.konten.push(konto);
                });
              }
              // 5. Analysiere BPD
              try {
                // 5.1 Vers
                const HIBPA = recvMsg.selectSegByName('HIBPA')[0];
                this.bpd.versBpd = HIBPA.getEl(1);
                // 5.2 sonst
                this.bpd.bankName = HIBPA.getEl(3);
                this.bpd.supportedVers = Helper.convertIntoArray(HIBPA.getEl(6));
                this.bpd.url = newUrl;
              } catch (ee) {
                this.log.gv.error(ee, {
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
                  const tan_data = HITANS.getEl(4);
                  this.bpd.tan.one_step_availible = tan_data.getEl(1).toUpperCase() === 'J';
                  this.bpd.tan.multiple_tan = tan_data.getEl(2).toUpperCase() === 'J';
                  this.bpd.tan.hash_type = tan_data.getEl(3);
                  this.bpd.tan.tan_verfahren = {};
                  for (let i = 3; i < tan_data.data.length; i++) {
                    const sicherheitsfunktion = {};
                    sicherheitsfunktion.code = tan_data.data[i];
                    sicherheitsfunktion.one_two_step_vers = tan_data.data[i + 1]; // "1": Einschrittverfahren, "2": Zweischritt
                    sicherheitsfunktion.tech_id = tan_data.data[i + 2];
                    sicherheitsfunktion.zka_tan_verfahren = tan_data.data[i + 3];
                    sicherheitsfunktion.vers_zka_tan_verf = tan_data.data[i + 4];
                    sicherheitsfunktion.desc = tan_data.data[i + 5];
                    sicherheitsfunktion.max_len_tan = tan_data.data[i + 6];
                    sicherheitsfunktion.tan_alphanum = tan_data.data[i + 7] === '2';
                    sicherheitsfunktion.txt_rueckwert = tan_data.data[i + 8];
                    sicherheitsfunktion.max_len_rueckwert = tan_data.data[i + 9];
                    sicherheitsfunktion.anz_tanlist = tan_data.data[i + 10];
                    sicherheitsfunktion.multi_tan = tan_data.data[i + 11].toUpperCase() === 'J';
                    sicherheitsfunktion.tan_zeit_diabez = tan_data.data[i + 12];
                    sicherheitsfunktion.tan_list_nr_req = tan_data.data[i + 13];
                    sicherheitsfunktion.auftragsstorno = tan_data.data[i + 14].toUpperCase() === 'J';
                    sicherheitsfunktion.sms_abu_konto_req = tan_data.data[i + 15];
                    sicherheitsfunktion.auftrag_konto = tan_data.data[i + 16];
                    sicherheitsfunktion.challange_class_req = tan_data.data[i + 17].toUpperCase() === 'J';
                    sicherheitsfunktion.challange_structured = tan_data.data[i + 18].toUpperCase() === 'J';
                    sicherheitsfunktion.initialisierungs_mod = tan_data.data[i + 19];
                    sicherheitsfunktion.bez_tan_med_req = tan_data.data[i + 20];
                    sicherheitsfunktion.anz_supported_tan_vers = tan_data.data[i + 21];
                    
                    // sicherheitsfunktion.challange_value_req = tan_data.data[i+14].toUpperCase()=="J";
                    this.bpd.tan.tan_verfahren[sicherheitsfunktion.code] = sicherheitsfunktion;
                    i += 21;
                  }
                }
              } catch (ee) {
                this.log.gv.error(ee, {
                  gv: 'HITANS',
                }, 'Error while analyse HITANS');
              }
              // 6. Analysiere UPD
              try {
                const HIUPA = recvMsg.selectSegByName('HIUPA')[0];
                this.upd. versUpd = HIUPA.getEl(3);
                this.upd.geschaeftsVorgGesp = HIUPA.getEl(4) === '0'; // UPD-Verwendung
              } catch (ee) {
                this.log.gv.error(ee, {
                  gv: 'HIUPA',
                }, 'Error while analyse UPD');
              }
              // 7. Analysiere Verfügbare Tan Verfahren
              try {
                const HIRMS_for_tanv = recvMsg.selectSegByNameAndBelongTo('HIRMS', HKVVB.nr)[0];
                for (let i = 0; i !== HIRMS_for_tanv.store.data.length; i++) {
                  if (HIRMS_for_tanv.store.data[i].getEl(1) === '3920') {
                    this.upd.availible_tan_verfahren = [];
                    for (let a = 3; a < HIRMS_for_tanv.store.data[i].data.length; a++) {
                      this.upd.availible_tan_verfahren.push(HIRMS_for_tanv.store.data[i].data[a]);
                    }
                    if (this.upd.availible_tan_verfahren.length > 0) {
                      this.log.gv.info({
                        gv: 'HKVVB',
                      }, 'Update to use Tan procedure: ' + this.upd.availible_tan_verfahren[0]);
                    }
                    break;
                  }
                }
              } catch (ee) {
                this.log.gv.error(ee, {
                  gv: 'HKVVB',
                }, 'Error while analyse HKVVB result Tan Verfahren');
              }
              // 8. Analysiere Geschäftsvorfallparameter
              try {
                for (const i in recvMsg.segments) {
                  if (recvMsg.segments[i].nathis.length >= 6 && recvMsg.segments[i].nathis.charAt(5) === 'S') {
                    const gv = recvMsg.segments[i].nathis.substring(0, 5);
                    if (!(gv in this.bpd.gv_parameters)) {
                      this.bpd.gv_parameters[gv] = {};
                    }
                    this.bpd.gv_parameters[gv][recvMsg.segments[i].vers] = recvMsg.segments[i];
                  }
                }
              } catch (ee) {
                this.log.gv.error(ee, {
                  gv: 'HKVVB',
                }, 'Error while analyse HKVVB result Tan Verfahren');
              }
              try {
                cb(error, recvMsg, hasNewUrl);
              } catch (cb_error) {
                this.log.gv.error(cb_error, {
                  gv: 'HKVVB',
                }, 'Unhandled callback Error in HKVVB,HKIDN');
              }
            } catch (e) {
              this.log.gv.error(e, {
                gv: 'HKVVB',
              }, 'Error while analyse HKVVB Response');
              try {
                cb(e.toString(), null, false);
              } catch (cb_error) {
                this.log.gv.error(cb_error, {
                  gv: 'HKVVB',
                }, 'Unhandled callback Error in HKVVB,HKIDN');
              }
            }
          } else {
            this.log.gv.error({
              gv: 'HKVVB',
            }, 'Error while analyse HKVVB Response No Init Successful recv.');
            try {
              cb('Keine Initialisierung Erfolgreich Nachricht erhalten!', recvMsg, false);
            } catch (cb_error) {
              this.log.gv.error(cb_error, {
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
               this.log.gv.error({gv:"HKVVB",hirmsg:HIRMG},"User not known or wrong pin");
               throw new Exceptions.WrongUserOrPinError();
             }catch(er_thrown){
               try{
                 cb(er_thrown,recvMsg,false);
               }catch(cb_error){
                 this.log.gv.error(cb_error,{gv:"HKVVB"},"Unhandled callback Error in HKVVB,HKIDN");
               }
             }
          }else{ */

          // anderer Fehler
        this.log.gv.error({
            gv: 'HKVVB',
            hirmsg: HIRMG,
          }, 'Error while analyse HKVVB Response Wrong HIRMG response code');
        try {
            cb('Fehlerhafter Rückmeldungscode: ' + (HIRMG === null ? 'keiner' : HIRMG.getEl(1).getEl(3)), recvMsg, false);
          } catch (cb_error) {
            this.log.gv.error(cb_error, {
              gv: 'HKVVB',
            }, 'Unhandled callback Error in HKVVB,HKIDN');
          }
          // }
      }
      }
    });
  }
  private beautifyBPD(bpd: BPD) {
    const cbpd = bpd.clone();
    cbpd.gvParameters = '...';
    return cbpd;
  }

this.MsgCheckAndEndDialog = function (recvMsg, cb) {
  const HIRMGs = recvMsg.selectSegByName('HIRMG');
  for (const k in HIRMGs) {
    for (const i in (HIRMGs[k].store.data)) {
      const ermsg = HIRMGs[k].store.data[i].getEl(1);
      if (ermsg === '9800') {
        try {
            cb(null, null);
          } catch (cb_error) {
            this.log.gv.error(cb_error, {
              gv: 'HKEND',
            }, 'Unhandled callback Error in HKEND');
          }
        return;
      }
    }
  }
  this.MsgEndDialog(cb);
};

this.MsgEndDialog = function (cb) {
  const msg = new Nachricht(this.protoVersion);
  if (this.kundenId !== 9999999999) {
    msg.sign({
      pin: this.pin,
      tan: NULL,
      sysId: this.sysId,
      pin_vers: this.upd.availible_tan_verfahren[0],
      sig_id: this.getNewSigId(),
    });
  }
  msg.init(this.dialogId, this.nextMsgNr, this.blz, this.kundenId);
  this.nextMsgNr++;
  msg.addSeg(Helper.newSegFromArray('HKEND', 1, [this.dialogId]));
  this.SendMsgToDestination(msg, function (error, recvMsg) {
    if (error) {
      this.log.gv.error(error, {
        gv: 'HKEND',
        msg,
      }, 'HKEND could not be send');
    }
    try {
      cb(error, recvMsg);
    } catch (cb_error) {
      this.log.gv.error(cb_error, {
        gv: 'HKEND',
      }, 'Unhandled callback Error in HKEND');
    }
  }, true);
};

  // SEPA kontoverbindung anfordern HKSPA, HISPA ist die antwort
this.MsgRequestSepa = function (for_konto, cb) {
    // Vars
  let processed = false;
  let v1 = null;
  let aufsetzpunkt_loc = 0;
  const sepa_list = new Array();
    // Create Segment
  if (for_konto) {
    v1 = [
        [280, for_konto],
    ];
    aufsetzpunkt_loc = 2;
  } else {
    v1 = [];
    aufsetzpunkt_loc = 1;
  }
    // Start
  const req_sepa = new Order(me);
  req_sepa.msg({
    type: 'HKSPA',
    ki_type: 'HISPA',
    aufsetzpunkt_loc: [aufsetzpunkt_loc],
    send_msg: {
      1: v1,
      2: v1,
      3: v1,
    },
    recv_msg: req_sepa.Helper().vers([1, 2, 3], function (seg_vers, relatedRespSegments, relatedRespMsgs, recvMsg) {
      try {
        if (req_sepa.checkMessagesOkay(relatedRespMsgs, true)) {
            const HISPA = req_sepa.getSegByName(relatedRespSegments, 'HISPA');
            if (HISPA !== null) {
              for (let i = 0; i !== HISPA.store.data.length; i++) {
                const verb = HISPA.getEl(i + 1);
                const o = {};
                o.is_sepa = verb.getEl(1) === 'J';
                o.iban = verb.getEl(2);
                o.bic = verb.getEl(3);
                o.konto_nr = verb.getEl(4);
                o.unter_konto = verb.getEl(5);
                o.ctry_code = verb.getEl(6);
                o.blz = verb.getEl(7);
                sepa_list.push(o);
              }
              try {
                cb(null, recvMsg, sepa_list);
              } catch (cb_error) {
                this.log.gv.error(cb_error, {
                  gv: 'HKSPA',
                }, 'Unhandled callback Error in HKSPA');
              }
            } else {
              throw new Error('TODO ausführlicherer Error');
            }
          }
      } catch (e) {
        this.log.gv.error(e, {
            gv: 'HKSPA',
            msgs: relatedRespMsgs,
            segments: relatedRespSegments,
          }, 'Exception while parsing HKSPA response');
        try {
            cb(e, null, null);
          } catch (cb_error) {
            this.log.gv.error(cb_error, {
              gv: 'HKSPA',
            }, 'Unhandled callback Error in HKSPA');
          }
      }
      processed = true;
    }).done(),
  });
  req_sepa.done(function (error, order, recvMsg) {
    if (error && !processed) {
      this.log.gv.error(error, {
        gv: 'HKSPA',
        recvMsg,
      }, 'Exception while parsing HKSPA');
      try {
        cb(error, recvMsg, null);
      } catch (cb_error) {
        this.log.gv.error(cb_error, {
            gv: 'HKSPA',
          }, 'Unhandled callback Error in HKSPA');
      }
    } else if (!processed) {
      error = new Exceptions.InternalError('HKSPA response was not analysied');
      this.log.gv.error(error, {
          gv: 'HKSPA',
          recvMsg,
        }, 'HKSPA response was not analysied');
      try {
          cb(error, recvMsg, null);
        } catch (cb_error) {
          this.log.gv.error(cb_error, {
            gv: 'HKSPA',
          }, 'Unhandled callback Error in HKSPA');
        }
    }
  });
};

  /*
    konto = {iban,bic,konto_nr,unter_konto,ctry_code,blz}
    from_date
    to_date		können null sein
    cb
  */
this.MsgGetKontoUmsaetze = function (konto, from_date, to_date, cb) {
  let processed = false;
  let v7 = null;
  let v5 = null;
  if (from_date === null && to_date === null) {
    v5 = [
        [konto.konto_nr, konto.unter_konto, konto.ctry_code, konto.blz], 'N',
    ];
    v7 = [
        [konto.iban, konto.bic, konto.konto_nr, konto.unter_konto, konto.ctry_code, konto.blz], 'N',
    ];
  } else {
    v5 = [
        [konto.konto_nr, konto.unter_konto, konto.ctry_code, konto.blz], 'N', from_date !== null ? Helper.convertDateToDFormat(from_date) : '', to_date !== null ? Helper.convertDateToDFormat(to_date) : '',
    ];
    v7 = [
        [konto.iban, konto.bic, konto.konto_nr, konto.unter_konto, konto.ctry_code, konto.blz], 'N', from_date !== null ? Helper.convertDateToDFormat(from_date) : '', to_date !== null ? Helper.convertDateToDFormat(to_date) : '',
    ];
  }
    // Start
  const req_umsaetze = new Order(me);
  const recv = function (seg_vers, relatedRespSegments, relatedRespMsgs, recvMsg) {
    try {
      if (req_umsaetze.checkMessagesOkay(relatedRespMsgs, true)) {
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
          } catch (cb_error) {
            this.log.gv.error(cb_error, {
              gv: 'HKKAZ',
            }, 'Unhandled callback Error in HKKAZ');
          }
      }
    } catch (ee) {
      this.log.gv.error(ee, {
        gv: 'HKKAZ',
        resp_msg: recvMsg,
      }, 'Exception while parsing HKKAZ response');
        // Callback
      try {
        cb(ee, recvMsg, null);
      } catch (cb_error) {
        this.log.gv.error(cb_error, {
            gv: 'HKKAZ',
          }, 'Unhandled callback Error in HKKAZ');
      }
    }
    processed = true;
  };
    // TODO check if we can do the old or the new version HKCAZ
  req_umsaetze.msg({
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
  req_umsaetze.done(function (error, order, recvMsg) {
    if (error && !processed) {
      this.log.gv.error(error, {
        gv: 'HKKAZ',
        recvMsg,
      }, 'HKKAZ could not be send');
        // Callback
      try {
        cb(error, recvMsg, null);
      } catch (cb_error) {
        this.log.gv.error(cb_error, {
            gv: 'HKKAZ',
          }, 'Unhandled callback Error in HKKAZ');
      }
    } else if (!processed) {
      error = new Exceptions.InternalError('HKKAZ response was not analysied');
      this.log.gv.error(error, {
          gv: 'HKKAZ',
          recvMsg,
        }, 'HKKAZ response was not analysied');
        // Callback
      try {
          cb(error, recvMsg, null);
        } catch (cb_error) {
          this.log.gv.error(cb_error, {
            gv: 'HKKAZ',
          }, 'Unhandled callback Error in HKKAZ');
        }
    }
  });
};

this.ConvertUmsatzeArrayToListofAllTransactions = function (umsaetze) {
  const result = new Array();
  for (let i = 0; i !== umsaetze.length; i++) {
    for (let a = 0; a !== umsaetze[i].saetze.length; a++) {
      result.push(umsaetze[i].saetze[a]);
    }
  }
  return result;
};

  /*
    konto = {iban,bic,konto_nr,unter_konto,ctry_code,blz}
    cb
  */
this.MsgGetSaldo = function (konto, cb) {
  const req_saldo = new Order(me);
  let processed = false;
  let v5 = null;
  let v7 = null;
  const avail_send_msg = {};
  if ('iban' in konto && 'bic' in konto && req_saldo.checkKITypeAvailible('HISAL', [7])) {
    const konto_verb_int = [konto.iban, konto.bic, konto.konto_nr, konto.unter_konto, konto.ctry_code, konto.blz];
    v7 = [konto_verb_int, 'N'];
    avail_send_msg[7] = v7;
  } else {
    const konto_verb = [konto.konto_nr, konto.unter_konto, konto.ctry_code, konto.blz];
    v5 = [konto_verb, 'N'];
    avail_send_msg[5] = v5;
    avail_send_msg[6] = v5;
  }
    // Start
  req_saldo.msg({
    type: 'HKSAL',
    ki_type: 'HISAL',
    send_msg: avail_send_msg,
    recv_msg: req_saldo.Helper().vers([5, 6, 7], function (seg_vers, relatedRespSegments, relatedRespMsgs, recvMsg) {
      try {
        if (req_saldo.checkMessagesOkay(relatedRespMsgs, true)) {
            const HISAL = req_saldo.getSegByName(relatedRespSegments, 'HISAL');
            if (HISAL !== null) {
              try {
                const result = {
                  desc: req_saldo.getElFromSeg(HISAL, 2, null),
                  cur: req_saldo.getElFromSeg(HISAL, 3, null),
                  saldo: Helper.getSaldo(HISAL, 4, false),
                  saldo_vorgemerkt: Helper.getSaldo(HISAL, 5, false),
                  credit_line: Helper.getBetrag(HISAL, 6),
                  avail_amount: Helper.getBetrag(HISAL, 7),
                  used_amount: Helper.getBetrag(HISAL, 8),
                  overdraft: null,
                  booking_date: null,
                  faelligkeit_date: Helper.getJSDateFromSeg(HISAL, 11),
                };
                if (seg_vers === 5) {
                  result.booking_date = Helper.getJSDateFromSeg(HISAL, 9, 10);
                } else {
                  result.booking_date = Helper.getJSDateFromSegTSP(HISAL, 11);
                  result.overdraft = Helper.getBetrag(HISAL, 9);
                }
                cb(null, recvMsg, result);
              } catch (cb_error) {
                this.log.gv.error(cb_error, {
                  gv: 'HKSAL',
                }, 'Unhandeled callback Error in HKSAL');
              }
            } else {
              throw new Error('TODO ausführlicherer Error');
            }
          }
      } catch (e) {
        this.log.gv.error(e, {
            gv: 'HKSAL',
            msgs: relatedRespMsgs,
            segments: relatedRespSegments,
          }, 'Exception while parsing HKSAL response');
        try {
            cb(e, null, null);
          } catch (cb_error) {
            this.log.gv.error(cb_error, {
              gv: 'HKSAL',
            }, 'Unhandeled callback Error in HKSAL');
          }
      }
      processed = true;
    }).done(),
  });
  req_saldo.done(function (error, order, recvMsg) {
    if (error && !processed) {
      this.log.gv.error(error, {
        gv: 'HKSAL',
        recvMsg,
      }, 'Exception while parsing HKSAL');
      try {
        cb(error, recvMsg, null);
      } catch (cb_error) {
        this.log.gv.error(cb_error, {
            gv: 'HKSAL',
          }, 'Unhandeled callback Error in HKSAL');
      }
    } else if (!processed) {
      error = new Exceptions.InternalError('HKSAL response was not analysed');
      this.log.gv.error(error, {
          gv: 'HKSAL',
          recvMsg,
        }, 'HKSAL response was not analysed');
      try {
          cb(error, recvMsg, null);
        } catch (cb_error) {
          this.log.gv.error(cb_error, {
            gv: 'HKSAL',
          }, 'Unhandled callback Error in HKSAL');
        }
    }
  });
};

this.EstablishConnection = function (cb) {
  let protocol_switch = false;
  let vers_step = 1;
  const original_bpd = this.bpd.clone();
  original_bpd.clone = this.bpd.clone;
  const original_upd = this.upd.clone();
  original_upd.clone = this.upd.clone;
    // 1. Normale Verbindung herstellen um BPD zu bekommen und evtl. wechselnde URL ( 1.versVersuch FinTS 2. versVersuch HBCI2.2 )
    // 2. Verbindung mit richtiger URL um auf jeden Fall (auch bei geänderter URL) die richtigen BPD zu laden + Tan Verfahren herauszufinden
    // 3. Abschließende Verbindung aufbauen
  const perform_step = function (step) {
    this.MsgInitDialog(function (error, recvMsg, has_neu_url) {
      if (error) {
        this.MsgCheckAndEndDialog(recvMsg, function (error2, recvMsg2) {
            if (error2) {
              this.log.conest.error({
                step,
                error: error2,
              }, 'Connection close failed.');
            } else {
              this.log.conest.debug({
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
            this.log.conest.debug({
              step,
              hirms: HIRMS,
            }, 'Version 300 nicht unterstützt, Switch Version from FinTS to HBCI2.2');
            this.protoVersion = 220;
            vers_step = 2;
            protocol_switch = true;
            this.clear();
            perform_step(1);
          } else {
            // Anderer Fehler
            this.log.conest.error({
              step,
              error,
            }, 'Init Dialog failed: ' + error);
            try {
              cb(error);
            } catch (cb_error) {
              this.log.conest.error(cb_error, {
                step,
              }, 'Unhandled callback Error in EstablishConnection');
            }
          }
      } else {
          // Erfolgreich Init Msg verschickt
        this.log.conest.debug({
            step,
            bpd: beautifyBPD(this.bpd),
            upd: this.upd,
            url: this.bpd.url,
            new_sig_method: this.upd.availible_tan_verfahren[0],
          }, 'Init Dialog successful.');
        if (step === 1 || step === 2) {
            // Im Step 1 und 2 bleiben keine Verbindungen erhalten
            // Diese Verbindung auf jeden Fall beenden
            const neu_url = this.bpd.url;
            const neu_sig_method = this.upd.availible_tan_verfahren[0];
            this.bpd = original_bpd.clone();
            this.upd = original_upd.clone();
            const orig_sysId = this.sysId;
            const orig_last_sig = this.lastSignaturId;
            this.MsgCheckAndEndDialog(recvMsg, function (error2, recvMsg2) {
              if (error2) {
                this.log.conest.error({
                  step,
                  error: error2,
                }, 'Connection close failed.');
              } else {
                this.log.conest.debug({
                  step,
                }, 'Connection closed okay.');
              }
            });
            this.clear();
            this.bpd.url = neu_url;
            this.upd.availible_tan_verfahren[0] = neu_sig_method;
            this.sysId = orig_sysId;
            this.lastSignaturId = orig_last_sig;
            original_bpd.url = this.bpd.url;
            original_upd.availible_tan_verfahren[0] = neu_sig_method;
          }

        if (has_neu_url) {
            if (step === 1) {
              // Im Step 1 ist das eingeplant, dass sich die URL ändert
              this.log.conest.debug({
                step: 2,
              }, 'Start Connection in Step 2');
              perform_step(2);
            } else {
              // Wir unterstützen keine mehrfach Ändernden URLs
              if (step === 3) {
                this.bpd = original_bpd.clone();
                this.upd = original_upd.clone();
                this.MsgCheckAndEndDialog(recvMsg, function (error2, recvMsg2) {
                  if (error2) {
                    this.log.conest.error({
                      step,
                      error: error2,
                    }, 'Connection close failed.');
                  } else {
                    this.log.conest.debug({
                      step,
                    }, 'Connection closed okay.');
                  }
                });
              }
              this.log.conest.error({
                step,
              }, 'Multiple URL changes are not supported!');
              // Callback
              try {
                cb('Mehrfachänderung der URL ist nicht unterstützt!');
              } catch (cb_error) {
                this.log.conest.error(cb_error, {
                  step,
                }, 'Unhandled callback Error in EstablishConnection');
              }
            }
          } else if (step === 1 || step === 2) {
            // 3: eigentliche Verbindung aufbauen
            this.log.conest.debug({
              step: 3,
            }, 'Start Connection in Step 3');
            perform_step(3);
          } else {
            // Ende Schritt 3 = Verbindung Ready
            this.log.conest.debug({
              step,
            }, 'Connection entirely established. Now get the available accounts.');
            // 4. Bekomme noch mehr Details zu den Konten über HKSPA
            this.MsgRequestSepa(null, function (error, recvMsg2, sepa_list) {
              if (error) {
                this.log.conest.error({
                  step,
                }, 'Error getting the available accounts.');
                this.MsgCheckAndEndDialog(recvMsg, function (error3, recvMsg2) {
                  if (error3) {
                    this.log.conest.error({
                      step,
                      error: error2,
                    }, 'Connection close failed.');
                  } else {
                    this.log.conest.debug({
                      step,
                    }, 'Connection closed okay.');
                  }
                });
                // Callback
                try {
                  cb(error);
                } catch (cb_error) {
                  this.log.conest.error(cb_error, {
                    step,
                  }, 'Unhandled callback Error in EstablishConnection');
                }
              } else {
                // Erfolgreich die Kontendaten geladen, diese jetzt noch in konto mergen und Fertig!
                for (let i = 0; i !== sepa_list.length; i++) {
                  for (let j = 0; j !== this.konten.length; j++) {
                    if (this.konten[j].konto_nr === sepa_list[i].konto_nr &&
                      this.konten[j].unter_konto === sepa_list[i].unter_konto) {
                      this.konten[j].sepa_data = sepa_list[i];
                      break;
                    }
                  }
                }
                // Fertig
                this.log.conest.debug({
                  step,
                  recv_sepa_list: sepa_list,
                }, 'Connection entirely established and got available accounts. Return.');
                // Callback
                try {
                  cb(null);
                } catch (cb_error) {
                  this.log.conest.error(cb_error, {
                    step,
                  }, 'Unhandled callback Error in EstablishConnection');
                }
              }
            });
          }
      }
    });
  };
  this.log.conest.debug({
    step: 1,
  }, 'Start First Connection');
  perform_step(1);
};

  //
this.SendMsgToDestination = function (msg, callback, in_finishing) { // Parameter für den Callback sind error,data
    // Ensure the sequence of messages!
  if (!in_finishing) {
    if (this.inConnection) {
      throw new Exceptions.OutofSequenceMessageException();
    }
    this.inConnection = true;
  }
  const int_callback = function (param_1, param_2) {
    if (!in_finishing) {
      this.inConnection = false;
    }
    callback(param_1, param_2);
  };
  const txt = msg.transformForSend();
  this.debugLogMsg(txt, true);
  const post_data = new Buffer(txt).toString('base64');
  const u = url.parse(this.bpd.url);
  const options = {
    hostname: u.hostname,
    port: u.port,
    path: u.path,
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Content-Length': post_data.length,
    },
  };
  let data = '';
  const prot = u.protocol === 'http:' ? http : https;
  this.log.con.debug({
    host: u.hostname,
    port: u.port,
    path: u.path,
  }, 'Connect to Host');
  const req = prot.request(options, function (res) { // https.request(options, function(res) {
    res.on('data', function (chunk) {
      data += chunk;
    });
    res.on('end', function () {
        // Hir wird dann weiter gemacht :)
      this.log.con.debug({
        host: u.hostname,
        port: u.port,
        path: u.path,
      }, 'Request finished');
      const clear_txt = encoding.convert(new Buffer(data, 'base64'), 'UTF-8', 'ISO-8859-1').toString('utf8'); // TODO: this only applies for HBCI? can we dynamically figure out the charset?

      this.debugLogMsg(clear_txt, false);
      try {
        const MsgRecv = new Nachricht(this.protoVersion);
        MsgRecv.parse(clear_txt);
        int_callback(null, MsgRecv);
      } catch (e) {
        this.log.con.error(e, 'Could not parse received Message');
        int_callback(e.toString(), null);
      }
    });
  });

  req.on('error', function () {
      // Hier wird dann weiter gemacht :)
    this.log.con.error({
      host: u.hostname,
      port: u.port,
      path: u.path,
    }, 'Could not connect to ' + options.hostname);
    int_callback(new Exceptions.ConnectionFailedException(u.hostname, u.port, u.path), null);
  });
  req.write(post_data);
  req.end();
};

this.debugLogMsg = function (txt, send) {
  this.log.con.trace({
    raw_data: txt,
    send_or_recv: send ? 'send' : 'recv',
  }, 'Connection Data Trace');
  if (this.debugMode) {
    console.log((send ? 'Send: ' : 'Recv: ') + txt);
  }
};
}

module.exports = FinTSClient;
