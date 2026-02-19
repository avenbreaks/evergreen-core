const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const serializeBigInt = <T>(value: T): T => {
  if (typeof value === "bigint") {
    return value.toString() as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeBigInt(entry)) as T;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(([key, entry]) => [key, serializeBigInt(entry)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
};
