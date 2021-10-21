export class Utils {
  static isString(object: unknown): object is string {
    return typeof object === "string";
  }

  static isArray<T>(object: unknown): object is Array<T> {
    return object instanceof Array;
  }
}
