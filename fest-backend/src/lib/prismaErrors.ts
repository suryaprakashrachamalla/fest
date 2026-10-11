// Returns the violated unique constraint/fields for a Prisma P2002 error, or null for other errors.
// With the pg driver adapter the details live under meta.driverAdapterError, not meta.target.
export function uniqueViolation(error: unknown): string | null {
    const value = error as {
        code?: string;
        meta?: {
            target?: string[] | string;
            modelName?: string;
            driverAdapterError?: { cause?: { constraint?: { index?: string; fields?: string[] } } };
        };
    };
    if (value?.code !== "P2002") return null;
    const constraint = value.meta?.driverAdapterError?.cause?.constraint;
    const target = value.meta?.target;
    return [
        constraint?.index,
        ...(constraint?.fields ?? []),
        ...(Array.isArray(target) ? target : target ? [target] : []),
        value.meta?.modelName,
    ]
        .filter(Boolean)
        .join(",");
}
