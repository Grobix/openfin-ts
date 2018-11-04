export default class UPD {
  public availableTanVerfahren: any[] = ['999'];
  public geschaeftsVorgGesp: boolean = true;
  public versUpd: '0';
  public clone (): UPD {
    return JSON.parse(JSON.stringify(this));
  }
}
