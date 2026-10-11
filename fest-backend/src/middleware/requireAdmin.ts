import type { Request, Response, NextFunction } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (req.user?.role !== "ADMIN") {
        res.status(403).json({
            success: false,
            error: { code: "FORBIDDEN", message: "Administrator access required" },
        });
        return;
    }
    next();
}
