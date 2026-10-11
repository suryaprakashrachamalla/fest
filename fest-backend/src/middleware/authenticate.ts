import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.ts";
import { verifyToken } from "../UserService.ts";

declare global {
    namespace Express {
        interface Request {
            user?: { id: string; name: string; email: string; role: "USER" | "ADMIN" };
        }
    }
}

export async function optionalAuthenticate(
    req: Request,
    res: Response,
    next: NextFunction,
) {
    try {
        const header = req.header("authorization");
        if (!header) {
            next();
            return;
        }
        if (!header.startsWith("Bearer ")) {
            res.status(401).json({
                success: false,
                error: { code: "UNAUTHENTICATED", message: "Invalid authentication" },
            });
            return;
        }
        const claims = verifyToken(header.slice(7));
        const user = await prisma.user.findUnique({
            where: { id: claims.sub },
            select: { id: true, name: true, email: true, role: true },
        });
        if (!user) {
            res.status(401).json({
                success: false,
                error: { code: "UNAUTHENTICATED", message: "Invalid authentication" },
            });
            return;
        }
        req.user = user;
        next();
    } catch {
        res.status(401).json({
            success: false,
            error: { code: "UNAUTHENTICATED", message: "Invalid or expired token" },
        });
    }
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
    if (!req.header("authorization")) {
        res.status(401).json({
            success: false,
            error: { code: "UNAUTHENTICATED", message: "Authentication required" },
        });
        return;
    }
    await optionalAuthenticate(req, res, next);
}
