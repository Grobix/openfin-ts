export default class UPD {
  public availableTanVerfahren: ['999'];
  public geschaeftsVorgGesp: true;
  public versUpd: '0';
  public clone () {
    return JSON.parse(JSON.stringify(this));
  }
}
