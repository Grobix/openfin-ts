import DatenElementGruppe from './DatenElementGruppe';
import { NullType } from './NULL';

export default class DatenElement {

  constructor(public data: string | NullType | DatenElementGruppe | any[], public desc: number) {}
}