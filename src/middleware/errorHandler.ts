import type { Request, Response, NextFunction } from "express";

export function errorHandler(
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
) {
    const value = error as {
        status?: number;
        code?: string;
        message?: string;
        type?: string;
        name?: string;
    };
    const status =
        value.status ??
        (value.type === "entity.too.large" || value.code === "LIMIT_FILE_SIZE"
            ? 413
            : value.name === "MulterError"
              ? 400
              : 500);
    const code =
        status === 400
            ? "VALIDATION_ERROR"
            : status === 401
              ? "UNAUTHENTICATED"
              : status === 403
                ? "FORBIDDEN"
                : status === 404
                  ? "NOT_FOUND"
                  : status === 409
                    ? "CONFLICT"
                    : status === 413
                      ? "UPLOAD_TOO_LARGE"
                      : "INTERNAL_ERROR";
    const message =
        status >= 500
            ? "An unexpected server error occurred"
            : (value.message ?? "Request failed");
    if (status >= 500) console.error("Request failed:", error);
    res.status(status).json({ success: false, error: { code, message } });
}
