import fs from "node:fs";
import path from "node:path";
import type { AuthedRequest } from "./auth";

export type Audit = { id: string; userId: string; username: string; action: string; entity: string; entityId?: string; details?: string; createdAt: string };
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), "server", "data");
const AUDIT_FILE = path.join(DATA_DIR, "audit.json");
const read = () => { try { return JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8")) as Audit[]; } catch { return []; } };
export function recordAudit(req: AuthedRequest, action: string, entity: string, entityId?: string, details?: string) { const logs = read(); logs.unshift({ id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, userId: req.user!.id, username: req.user!.username, action, entity, entityId, details, createdAt: new Date().toISOString() }); fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(AUDIT_FILE, JSON.stringify(logs.slice(0, 5000), null, 2), "utf8"); }
export const listAudit = () => read();
