export class NullType {
  public length = 0;
  constructor(public id: number) {}
}

export const NULL = new NullType(1234)
