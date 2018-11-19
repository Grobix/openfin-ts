export class Account {
  public iban: string = '';
  public accountNumber: string = '';
  public countryCode: string = '';
  public blz: string = '';
  public customerId: string = '';
  public accountType: string = '';
  public currency: string = '';
  public customerName: string = '';
  public productName: string = '';
  public subAccount: any;
  public sepaData: any;
  public isSepa: boolean;
  public bic: string;
}
