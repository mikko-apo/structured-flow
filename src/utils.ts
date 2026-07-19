export function getOwnEntries<T extends Record<PropertyKey, unknown>>(
  value: T
): Array<[Extract<keyof T, PropertyKey>, T[Extract<keyof T, PropertyKey>]]> {
  return (
    Reflect.ownKeys(value).filter((key) => Object.prototype.propertyIsEnumerable.call(value, key)) as Array<
      Extract<keyof T, PropertyKey>
    >
  ).map((key) => [key, value[key]])
}

export function isPromise<T>(value: object): value is Promise<T> {
  return value != null && typeof value === 'object' && 'then' in value && typeof value.then === 'function'
}
