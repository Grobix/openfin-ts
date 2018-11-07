import Helper from './Helper';
import { NULL } from './NULL';
import { ParseError, Parser } from './Parser';
import Segment from './Segment';
import SignInfo from './SignInfo';

export default class Nachricht {

  public segments: Segment[] = [];
  public segmentsCounter = 0;
  public signIt: SignInfo = null;
  public hnvsk: Segment = null;
  public messageNumber = 0;

  constructor(public protoVersion) {
  }

  public sign = function (signInfo: SignInfo) { // sign_obj = {'pin':pin,'tan':tan,'sysId':0}// Tan bitte null setzen wenn nicht benötigt
    this.signIt = signInfo;
  };

  public init(dialogId, ongoingNumber, blz, kundenId) {
    // this is called wenn es ein outgoing message ist
    this.messageNumber = ongoingNumber;
    const seg = new Segment();
    seg.init('HNHBK', 1, 3, 0);
    this.addSeg(seg);
    seg.store.addDE(Helper.getNrWithLeadingNulls(0, 12)); // Länge
    seg.store.addDE(this.protoVersion + ''); // Version
    seg.store.addDE(dialogId); // Dialog-ID, bei 0 beginnend wird von KI bekannt gegeben
    seg.store.addDE(this.messageNumber); // Nachrichten-Nr. streng monoton von 1 ab steigen
    if (this.signIt) { // NUr für das Pin/Tan Verfahren 1 Schritt!
      // Infos hierzu: http://www.hbci-zka.de/dokumente/spezifikation_deutsch/fintsv3/FinTS_3.0_Security_Sicherheitsverfahren_HBCI_Rel_20130718_final_version.pdf Punkt B5.1
      // http://www.hbci-zka.de/dokumente/spezifikation_deutsch/fintsv3/FinTS_3.0_Security_Sicherheitsverfahren_PINTAN_Rel_20101027_final_version.pdf B8.4
      // Sicherheitsprofil ["PIN",1] = PIN und 1 Schrittverfahren
      // Sicherheitsfunktion: 999 - 1 SChrittverfahren / 2Schritt siehe BPD
      // Sicherheitskontrollreferenz: 1 // Muss mit Signaturabschluss übereinstimmen
      // Bereich der Sicherheitsapplikation,kodiert: 1 // 1: Signaturkopf und HBCI-Nutzdaten (SHM)
      // Rolle des Sicherheitslieferanten,kodiert: 1 // 1: Der Unterzeichner ist Herausgeber der signierten Nachricht, z.B. Erfasser oder Erstsignatur (ISS)
      // Sicherheitsidentifikation, Details: [1,null,0]
      // 		Bezeichner Sicherheitspartei	1		1: Message Sender (MS), wenn ein Kunde etwas an sein Kreditinstitut sendet
      // 		CID nur Chipkarte				null
      // 		Id der Partei nur Software		0		Code, welcher die (Kommunikations-)Partei identifiziert. Dieses Feld muss eine gültige, zuvor vom Banksystem angeforderte Kundensystem-ID enthalten (analog zum RSA-Verfahren). Dies gilt auch fürZweit-und Drittsignaturen.
      // 			beim Erstmal noch 0, dann auf Antwort von Bank in HISYN warten und das verwenden!
      // 	Sicherheitsreferenznummer: 1 Verhinderung der Doppeleinreichung Bei softwarebasierten Verfahren wird die Sicherheitsreferenznummer auf Basis des DE Kundensystem-ID und des DE Benutzerkennung der DEG Schlüsselnamen verwaltet.
      // 							bei Pin/Tan kann das auch einfach bei 1 beibehalten werden :), sonst müsste man das aber eigtl. incrementieren
      // 	Sicherheitsdatum und -uhrzeit [1,"20141210","003515"], 1: Bedeutung = Sicherheitszeitstempel (STS)
      // 	Hashalgorithmus: [1,999,1]
      // 		Verwendung des Hashalgorithmus,kodiert	1: Owner Hashing (OHA) (nur)
      // 		Hashalgorithmus,kodiert					999: Gegenseitig vereinbart (ZZZ); hier: RIPEMD-160 ( gibt noch andere Werte 1-6 vorallem SHAxxx
      // 		Bezeichner für Hashalgorithmusparameter	1: IVC (Initialization value, clear text)
      // 	Signaturalgorithmus: [6,10,16]
      // 		Verwendung des Signaturalgorithmus, kodiert 6: Owner Signing (OSG)
      // 		10: RSA-Algorithmus (bei RAH und RDH)
      // 		Operationsmodus, kodiert	16:	ISO 9796-1 (bei RDH)
      // 	Schlüsselname	[280,blz,kunden_id,"S",0,0]
      // 		Kreditinstitutskennung	280,blz
      // 		Benutzerkennung 		kunden_id
      // 		Schlüsselart			S	S: Signierschlüsse
      // 		Schlüsselnummer			0
      // 		Schlüsselversion		0
      const signatureId = (this.signIt.sysId + '') === '0' ? 1 : this.signIt.sigId;
      this.signIt.blz = blz;
      this.signIt.kundenId = kundenId;

      if (this.protoVersion === 300) {
        this.signIt.server === undefined
          ? this.addSeg(Helper.newSegFromArray('HNSHK', 4, [
            ['PIN', this.signIt.pinVersion === '999' ? 1 : 2], this.signIt.pinVersion, 1, 1, 1, [1, NULL, this.signIt.sysId], signatureId, [1, Helper.convertDateToDFormat(new Date()), Helper.convertDateToTFormat(new Date())],
            [1, 999, 1],
            [6, 10, 16],
            [280, blz, kundenId, 'S', 0, 0],
          ]))
          : this.addSeg(Helper.newSegFromArray('HNSHK', 4, [
            ['PIN', this.signIt.pinVersion === '999' ? 1 : 2], this.signIt.pinVersion, 1, 1, 1, [2, NULL, this.signIt.sysId], signatureId, [1, Helper.convertDateToDFormat(new Date()), Helper.convertDateToTFormat(new Date())],
            [1, 999, 1],
            [6, 10, 16],
            [280, blz, kundenId, 'S', 0, 0],
          ]));
      } else {
        this.signIt.server === undefined
          ? this.addSeg(Helper.newSegFromArray('HNSHK', 3, [this.signIt.pinVersion, 1, 1, 1, [1, NULL, this.signIt.sysId], signatureId, [1, Helper.convertDateToDFormat(new Date()), Helper.convertDateToTFormat(new Date())],
            [1, 999, 1],
            [6, 10, 16],
            [280, blz, kundenId, 'S', 0, 0],
          ]))
          : this.addSeg(Helper.newSegFromArray('HNSHK', 3, [this.signIt.pinVersion, 1, 1, 1, [2, NULL, this.signIt.sysId], signatureId, [1, Helper.convertDateToDFormat(new Date()), Helper.convertDateToTFormat(new Date())],
            [1, 999, 1],
            [6, 10, 16],
            [280, blz, kundenId, 'S', 0, 0],
          ]));
      }
    }
  }

  public parse(txt: string) {
    const parser = new Parser(txt);
    while (parser.hasNext()) {
      const segm = new Segment();
      segm.parse(parser);
      this.segments.push(segm);
      parser.nextPos();
    }

    // prüfen ob verschlüsselt war
    if (this.segments.length === 4 && this.segments[1].name === 'HNVSK' && this.segments[2].name === 'HNVSD') {
      const first = this.segments[0];
      this.hnvsk = this.segments[1];
      const segHNVSD = this.segments[2];
      const last = this.segments[3];
      // Neue Segmente hinzufügen
      this.segments = [];
      this.segments.push(first);
      if ((this.hnvsk.version === '3' && this.hnvsk.getEl(1).data.getEl(1) === 'PIN') || (this.hnvsk.version === '2' && this.hnvsk.getElString(1) === '998')) {
        const parser2 = new Parser(segHNVSD.getEl(1).data);
        while (parser2.hasNext()) {
          const segm2 = new Segment();
          segm2.parse(parser2);
          this.segments.push(segm2);
          parser2.nextPos();
        }
      } else {
        throw new ParseError('Msg', 'Nicht unterstützte Verschlüsselungsmethode!', 0);
      }
      this.segments.push(last);
    }
  }

  public transformForSend() {
    let top = this.segments[0].transformForSend();
    let body = '';

    // Signatur abschluss
    if (this.signIt) {
      // Signaturabschluss
      // Sicherheitskontrollreferenz 1 muss mit signaturkopf übereinstimmen
      // Validierungsresultat null, bleibt bei PinTan leer
      // Benutzerdefinierte Signatur [Pin,Tan], die Tan nur dann wenn durch den Geschäftsvorfall erforderlich
      if (this.signIt.server === undefined) {
        if (this.signIt.tan === NULL) {
          this.addSeg(Helper.newSegFromArray('HNSHA', this.protoVersion === 300 ? 2 : 1, [1, NULL, [this.signIt.pin]]));
        } else {
          this.addSeg(Helper.newSegFromArray('HNSHA', this.protoVersion === 300 ? 2 : 1, [1, NULL, [this.signIt.pin, this.signIt.tan]]));
        }
      } else {
        this.addSeg(Helper.newSegFromArray('HNSHA', 2, [2]));
      }
    }

    for (let i = 1; i !== this.segments.length; i += 1) {
      body += this.segments[i].transformForSend();
    }

    // Letztes segment erstellen
    if (this.signIt) {
      // in body ist der eigentliche body der dann aber jetzt neu erstellt wird
      // Verschlüsselung
      // 1. HNVSK                                     HNVSK:998:3
      // Sicherheitsprofil                            [PIN:1]
      // Sicherheitsfunktion, kodiert                 998 // bleibt immer so unabhängig von der der tatsächlichen Funktion
      // Rolle des Sicherheits-lieferanten, kodiert   1
      // Sicherheitsidentifikation, Details           [1.null.0]
      // Sicherheitsdatum und -uhrzeit                [1,20141216,205751]
      // Verschlüsselungs-algorithmus                 [2,2,13,@8@,5,1]
      // Schlüsselname                                [280:12345678:max:V:0:0]
      //      Ctry Code                               280 (hier fest)
      //      BLZ
      //      benutzer
      //      Schlüsselart                            V Chiffrierschlüssel
      //      Schlüsselnummer                         0
      //      Schlüsselversion                        0
      // Komprimierungsfunktion                       0
      // Zertifikat                                   leer hier
      // +998+1+1::0+1:20141216:205751+2:2:13:@8@:5:1+280:12345678:max:V:0:0+0'
      if (this.protoVersion === 300) {
        this.hnvsk = Helper.newSegFromArray('HNVSK', 3, [
          ['PIN', this.signIt.pinVersion === '999' ? 1 : 2], 998, 1, [1, NULL, this.signIt.sysId],
          [1, Helper.convertDateToDFormat(new Date()), Helper.convertDateToTFormat(new Date())],
          [2, 2, 13, Helper.byte('\0\0\0\0\0\0\0\0'), 5, 1],
          [280, this.signIt.blz, this.signIt.kundenId, 'V', 0, 0], 0,
        ]);
      } else {
        this.hnvsk = Helper.newSegFromArray('HNVSK', 2, [998, 1, [1, NULL, this.signIt.sysId],
          [1, Helper.convertDateToDFormat(new Date()), Helper.convertDateToTFormat(new Date())],
          [2, 2, 13, Helper.byte('\0\0\0\0\0\0\0\0'), 5, 1],
          [280, this.signIt.blz, this.signIt.kundenId, 'V', 0, 0], 0,
        ]);
      }
      this.hnvsk.nr = 998;
      const segHNVSD = Helper.newSegFromArray('HNVSD', 1, [Helper.byte(body)]);
      segHNVSD.nr = 999;
      body = this.hnvsk.transformForSend();
      body += segHNVSD.transformForSend();
    }

    // Abschließen
    const seg = Helper.newSegFromArray('HNHBS', 1, [this.messageNumber]);
    this.addSeg(seg);
    body += seg.transformForSend();
    const llength = top.length + body.length;
    this.segments[0].store.data[0].data = Helper.getNrWithLeadingNulls(llength, 12);
    top = this.segments[0].transformForSend();
    return top + body;
  }

  public addSeg(seg: Segment) {
    seg.nr = this.segmentsCounter + 1;
    this.segments[this.segmentsCounter] = seg;
    this.segmentsCounter += 1;
    return seg.nr;
  }

  public isSigned = function () {
    return this.selectSegByName('HNSHK').length === 1;
  };

  public selectSegByName = function (name) {
    return this.segments.filter(segment => segment.name === name);
  };

  public selectSegByBelongTo = function (belongTo) {
    return this.segments.filter(segment => segment.bez === belongTo + '');
  };

  public selectSegByNameAndBelongTo = function (name, belongTo) {
    return this.segments.filter(segment => segment.name === name && segment.bez === belongTo + '');
  };

  public createDebugJS = function () {
    const top = 'var sendMsg = new FinTSClient().testReturnMessageClass();\n\r';
    let sig = '\n\r';
    let body = '';

    this.segments.forEach(segment => {
      if (segment.name === 'HNHBK' ||
        segment.name === 'HNHBS' ||
        segment.name === 'HNSHA') {
        // auslassen
      } else if (segment.name === 'HNSHK') {
        // Signatur
        sig = "sendMsg.sign({'pin':'pin1234','tan':null,'sysId':'" + segment.getEl(6).getEl(3) + "'});\n\r";
      } else {
        // generate array structure out of segment
        const segArray = [];

        segment.store.data.forEach(dataElement => {
          if (dataElement.desc === 1) { // DE
            segArray.push(dataElement.data);
          } else if (dataElement.desc === 2) { // DEG
            // DEG durchforsten
            const degArray = [];

            dataElement.data.data.forEach(groupElement => {
              if (groupElement.desc === 1) { // DE
                degArray.push(groupElement.data);
              } else if (groupElement.desc === 2) { // DEG
                // sollte hier garnicht auftreten
                throw new Error('FEHLER DEG erhalten wo dies nicht passieren sollte');
              } else if (groupElement.desc === 3) { // BINARY
                degArray.push('BYTE' + groupElement.data);
              }
            });

            segArray.push(degArray);
          } else if (dataElement.desc === 3) { // BINARY
            segArray.push('BYTE' + dataElement.data);
          }
        });
        if (segment.bez === 0) {
          body += "sendMsg.addSeg(Helper.newSegFromArray('" + segment.name + "', " + segment.vers + ', ' + JSON.stringify(segArray) + '));\n\r';
        } else {
          body += "sendMsg.addSeg(Helper.newSegFromArrayWithBez('" + segment.name + "', " + segment.vers + ',' + segment.bez + ',' + JSON.stringify(segArray) + '));\n\r';
        }
      }
    });

    return top + sig + body;
  };
}
