const sensitiveKeyPattern =
  /(account(number)?|token|secret|orderid|executionid|cookie|authorization)/i;

export function maskSensitiveText(value: string): string {
  return value
    .replace(/\b\d{3,6}-\d{2,6}-\d{2,8}\b/g, "****-****-****")
    .replace(/\b(ord|exec)_[A-Za-z0-9_-]{6,}\b/g, "$1_****")
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "***.***.***");
}

export function maskSensitiveValue(key: string, value: unknown): unknown {
  if (sensitiveKeyPattern.test(key)) {
    return "****";
  }

  if (typeof value === "string") {
    return maskSensitiveText(value);
  }

  return value;
}

export function maskObject<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => maskObject(item)) as T;
  }

  if (value !== null && typeof value === "object") {
    const masked: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      masked[key] = maskSensitiveValue(key, maskObject(nestedValue));
    }

    return masked as T;
  }

  return maskSensitiveValue("", value) as T;
}
