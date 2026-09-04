import fs from "node:fs";
import path from "node:path";
import express, { type Request, type Response } from "express";
import { adminRequired, authRequired, type AuthedRequest } from "./auth";
import { listAudit, recordAudit } from "./auditStore";

type Apartment = { id: string; number: string; doctor: string; status: string; notes: string; updatedAt: string };
type InventoryItem = { id: string; apartmentId: string; category: string; name: string; quantity: number; condition: string; amount?: number; depreciationRate?: number; notes: string; updatedAt: string };
type AppState = { buildingName: string; apartments: Apartment[]; items: InventoryItem[] };
type Record = { userId: string; state: AppState; updatedAt: string };

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), "server", "data");
const STATE_FILE = path.join(DATA_DIR, "inventory.json");
const emptyState: AppState = { buildingName: "مبنى شقق الأطباء", apartments: [], items: [] };
const read = <T,>(file: string, fallback: T): T => { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return fallback; } };
const write = (file: string, data: unknown) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); };
const cleanState = (state: Partial<AppState>): AppState => ({ buildingName: typeof state.buildingName === "string" ? state.buildingName : emptyState.buildingName, apartments: Array.isArray(state.apartments) ? state.apartments : [], items: Array.isArray(state.items) ? state.items : [] });

export function createInventoryRouter() {
  const router = express.Router();
  router.use(express.json({ limit: "2mb" }));
  router.get("/api/inventory", authRequired, (req: AuthedRequest, res: Response) => { const records = read<Record[]>(STATE_FILE, []); const record = records.find((item) => item.userId === req.user!.id); res.json({ ok: true, state: record?.state ?? emptyState }); });
  router.put("/api/inventory", authRequired, (req: AuthedRequest, res: Response) => { const records = read<Record[]>(STATE_FILE, []); const state = cleanState(req.body?.state ?? {}); const index = records.findIndex((item) => item.userId === req.user!.id); const record = { userId: req.user!.id, state, updatedAt: new Date().toISOString() }; if (index >= 0) records[index] = record; else records.push(record); write(STATE_FILE, records); recordAudit(req, "تحديث الجرد", "inventory", undefined, `الشقق: ${state.apartments.length}، القطع: ${state.items.length}`); res.json({ ok: true, state }); });
  router.get("/api/audit", adminRequired, (_req: AuthedRequest, res: Response) => { res.json({ ok: true, logs: listAudit().slice(0, 500) }); });
  return router;
}

export type { AppState, InventoryItem };
