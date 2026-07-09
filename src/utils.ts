export function getOwnEntries<T extends Record<PropertyKey, unknown>>(
  value: T
): Array<[Extract<keyof T, PropertyKey>, T[Extract<keyof T, PropertyKey>]]> {
  return (
    Reflect.ownKeys(value).filter((key) => Object.prototype.propertyIsEnumerable.call(value, key)) as Array<
      Extract<keyof T, PropertyKey>
    >
  ).map((key) => [key, value[key]])
}
