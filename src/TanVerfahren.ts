export default class TanVerfahren {
  public code = '999';
  public oneTwoStepVers = '1';
  public techId = 'PIN';
  public desc =  'Einfaches Pin-Verfahren';
  public maxLenTan = 100;
  public tanAlphanum = true;
  public txtRueckwert = 'Rückgabewert';
  public maxLenRueckwert = 100;
  public anzTanlist = '2';
  public multiTan = true;
  public tanZeitDiaBez = '';
  public tanListNrReq = '';
  public auftragsstorno = false;
  public challengeClassReq = false;
  public challengeValueReq = false;
  public zkaTanVerfahren: string;
  public versZkaTanVerfahren: string;
  public smsAbuKontoReq: string;
  public auftragKonto: string;
  public challengeStructured: boolean;
  public initialisierungsMod: string;
  public bezTanMedReq: string;
  public anzSupportedTanVers: string;
}
