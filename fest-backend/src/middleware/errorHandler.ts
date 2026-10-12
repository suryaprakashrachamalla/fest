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
        // Set on errors whose message was written to be shown, even for a 5xx (e.g. "Couldn't read the
        // Google Sheet right now"); other server errors never reveal their message.
        expose?: boolean;
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
                      : status === 503
                        ? "SERVICE_UNAVAILABLE"
                        : "INTERNAL_ERROR";
    const message =
        status >= 500 && value.expose !== true
            ? "An unexpected server error occurred"
            : (value.message ?? "Request failed");
    if (status >= 500) console.error("Request failed:", error);
    res.status(status).json({ success: false, error: { code, message } });
}
