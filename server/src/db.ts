import { PrismaClient } from "@prisma/client";
import "./env";

/**
 * Single shared Prisma client for the process. Reads DATABASE_URL lazily
 * (at construction, which happens at import time here) - test/setupEnv.ts
 * makes sure that's already on process.env before this module is ever
 * imported by a test file.
 */
export const prisma = new PrismaClient();
