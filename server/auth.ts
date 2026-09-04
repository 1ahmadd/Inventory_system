import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { listAudit, recordAudit } from "./auditStore";

// =============================================================================
// نظام المصادقة: مستخدم/كلمة مرور + رمز تأكيد يُرسل إلى بريد Gmail معتمد
// =============================================================================

type Role = "admin" | "user";

type StoredUser = {
  id: string;
  username: string;
  role: Role;
  salt: string;
  passwordHash: string;
  createdAt: string;
};

type Session = { token: string; userId: string; createdAt: string; expiresAt: number };
type OtpChallenge = { codeHash: string; expiresAt: number; attempts: number };

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), "server", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_TARGET_EMAIL = process.env.OTP_EMAIL || "a77ahmadd@gmail.com";
const DEFAULT_ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Ahmed@2026";
const DEBUG_OTP_ALLOWED = process.env.ALLOW_DEBUG_OTP !== "false";

const otpChallenges = new Map<string, OtpChallenge>();

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

const loadUsers = () => readJson<StoredUser[]>(USERS_FILE, []);
const saveUsers = (users: StoredUser[]) => writeJson(USERS_FILE, users);
const loadSessions = () => readJson<Session[]>(SESSIONS_FILE, []);
const saveSessions = (sessions: Session[]) => writeJson(SESSIONS_FILE, sessions);

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password: string, salt: string, expectedHex: string) {
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");
const makeId = (prefix: string) => `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}`;

function publicUser(user: StoredUser) {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

function ensureDefaultAdmin() {
  const users = loadUsers();
  if (users.length > 0) return;
  const salt = randomBytes(16).toString("hex");
  users.push({
    id: makeId("usr"),
    username: DEFAULT_ADMIN_USERNAME,
    role: "admin",
    salt,
    passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD, salt),
    createdAt: new Date().toISOString(),
  });
  saveUsers(users);
  console.log(`[auth] تم إنشاء حساب المدير الافتراضي → username: ${DEFAULT_ADMIN_USERNAME}`);
}

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  const visible = name.slice(0, 3);
  return `${visible}${"*".repeat(Math.max(2, name.length - 3))}@${domain}`;
}

async function sendOtpEmail(code: string, username: string): Promise<boolean> {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) return false;
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: smtpUser, pass: smtpPass } });
  await transporter.sendMail({
    from: `"سجل الميدان · نظام الجرد" <${smtpUser}>`,
    to: OTP_TARGET_EMAIL,
    subject: "رمز تأكيد تسجيل الدخول - سجل الميدان",
    text: `مرحباً،\n\nطلب تسجيل دخول جديد للمستخدم «${username}».\nرمز التأكيد: ${code}\n\nالرمز صالح لمدة 10 دقائق. إذا لم تطلب هذا الرمز فتجاهل الرسالة.`,
    html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;background:#f4efe6;padding:24px"><div style="max-width:420px;margin:auto;background:#fffdfa;border:1px solid #e7ded0;border-radius:12px;padding:24px"><h2 style="color:#153b52;margin:0 0 8px">رمز تأكيد الدخول</h2><p style="color:#466276;margin:0 0 16px">طلب دخول جديد للمستخدم <b>${username}</b></p><div style="font-size:30px;letter-spacing:8px;text-align:center;background:#e0f0ed;color:#153b52;border-radius:10px;padding:14px;font-weight:bold">${code}</div><p style="color:#72808a;font-size:12px;margin:16px 0 0">الرمز صالح لمدة 10 دقائق. إذا لم تطلب هذا الرمز فتجاهل الرسالة.</p></div></div>`,
  });
  return true;
}

export type AuthedRequest = Request & { user?: StoredUser; token?: string };

function attachUser(req: AuthedRequest): StoredUser | null {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const session = loadSessions().find((item) => item.token === token);
  if (!session || session.expiresAt < Date.now()) return null;
  const user = loadUsers().find((item) => item.id === session.userId);
  if (!user) return null;
  req.user = user;
  req.token = token;
  return user;
}

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!attachUser(req)) {
    res.status(401).json({ error: "الجلسة غير صالحة، سجّل الدخول من جديد" });
    return;
  }
  next();
}

export function adminRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  const user = attachUser(req);
  if (!user) {
    res.status(401).json({ error: "الجلسة غير صالحة، سجّل الدخول من جديد" });
    return;
  }
  if (user.role !== "admin") {
    res.status(403).json({ error: "هذه الصلاحية خاصة بحساب المدير فقط" });
    return;
  }
  next();
}

function createSession(userId: string) {
  const sessions = loadSessions().filter((item) => item.expiresAt > Date.now());
  const token = randomBytes(32).toString("hex");
  sessions.push({ token, userId, createdAt: new Date().toISOString(), expiresAt: Date.now() + SESSION_TTL_MS });
  saveSessions(sessions);
  return token;
}

export function createAuthRouter() {
  ensureDefaultAdmin();
  const router = express.Router();
  router.use(express.json());

  // تسجيل الدخول: التحقق من المستخدم/كلمة المرور ثم إرسال رمز التأكيد
  router.post("/api/auth/login", async (req: Request, res: Response) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    const cleanUsername = String(username ?? "").trim();
    const user = loadUsers().find((item) => item.username === cleanUsername);
    if (!user || !password || !verifyPassword(String(password), user.salt, user.passwordHash)) {
      res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
      return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    otpChallenges.set(user.username, { codeHash: hashCode(code), expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });

    let emailSent = false;
    try {
      emailSent = await sendOtpEmail(code, user.username);
    } catch (error) {
      console.error("[auth] فشل إرسال بريد التأكيد:", error);
    }

    res.json({
      ok: true,
      otpSentTo: maskEmail(OTP_TARGET_EMAIL),
      emailSent,
      emailConfigured: Boolean(process.env.SMTP_USER && process.env.SMTP_PASS),
      ...(emailSent || !DEBUG_OTP_ALLOWED ? {} : { debugCode: code }),
    });
  });

  // التحقق من رمز التأكيد وإصدار جلسة
  router.post("/api/auth/verify-otp", (req: Request, res: Response) => {
    const { username, code } = (req.body ?? {}) as { username?: string; code?: string };
    const cleanUsername = String(username ?? "").trim();
    const challenge = otpChallenges.get(cleanUsername);
    if (!challenge || challenge.expiresAt < Date.now()) {
      res.status(410).json({ error: "انتهت صلاحية الرمز، أعد تسجيل الدخول" });
      return;
    }
    challenge.attempts += 1;
    if (challenge.attempts > OTP_MAX_ATTEMPTS) {
      otpChallenges.delete(cleanUsername);
      res.status(429).json({ error: "محاولات كثيرة، أعد تسجيل الدخول" });
      return;
    }
    if (hashCode(String(code ?? "").trim()) !== challenge.codeHash) {
      res.status(401).json({ error: "رمز التأكيد غير صحيح" });
      return;
    }
    const user = loadUsers().find((item) => item.username === cleanUsername);
    if (!user) {
      res.status(401).json({ error: "المستخدم غير موجود" });
      return;
    }
    otpChallenges.delete(cleanUsername);
    const token = createSession(user.id);
    res.json({ ok: true, token, user: publicUser(user) });
  });

  router.get("/api/auth/me", authRequired, (req: AuthedRequest, res: Response) => {
    res.json({ ok: true, user: publicUser(req.user!) });
  });

  router.post("/api/auth/logout", (req: Request, res: Response) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token) saveSessions(loadSessions().filter((item) => item.token !== token));
    res.json({ ok: true });
  });

  // إدارة المستخدمين (مدير فقط)
  router.get("/api/users", adminRequired, (_req: AuthedRequest, res: Response) => {
    res.json({ ok: true, users: loadUsers().map(publicUser) });
  });

  router.post("/api/users", adminRequired, (req: AuthedRequest, res: Response) => {
    const { username, password, role } = (req.body ?? {}) as { username?: string; password?: string; role?: Role };
    const cleanUsername = String(username ?? "").trim();
    const cleanPassword = String(password ?? "");
    if (cleanUsername.length < 3 || cleanUsername.length > 32) {
      res.status(400).json({ error: "اسم المستخدم يجب أن يكون بين 3 و32 خانة" });
      return;
    }
    if (cleanPassword.length < 8) {
      res.status(400).json({ error: "كلمة المرور يجب ألا تقل عن 8 خانات" });
      return;
    }
    const users = loadUsers();
    if (users.some((item) => item.username === cleanUsername)) {
      res.status(409).json({ error: "اسم المستخدم موجود مسبقاً" });
      return;
    }
    const salt = randomBytes(16).toString("hex");
    const newUser: StoredUser = {
      id: makeId("usr"),
      username: cleanUsername,
      role: role === "admin" ? "admin" : "user",
      salt,
      passwordHash: hashPassword(cleanPassword, salt),
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    saveUsers(users);
    recordAudit(req, "إضافة مستخدم", "user", newUser.id, `الحساب: ${newUser.username}`);
    res.status(201).json({ ok: true, user: publicUser(newUser) });
  });

  // تغيير كلمة المرور: المدير لأي مستخدم، أو المستخدم لنفسه
  router.patch("/api/users/:id/password", authRequired, (req: AuthedRequest, res: Response) => {
    const targetId = String(req.params.id);
    const newPassword = String((req.body ?? {}).password ?? "");
    const isSelf = req.user!.id === targetId;
    if (!isSelf && req.user!.role !== "admin") {
      res.status(403).json({ error: "تغيير كلمات المرور للآخرين خاص بالمدير فقط" });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: "كلمة المرور يجب ألا تقل عن 8 خانات" });
      return;
    }
    const users = loadUsers();
    const target = users.find((item) => item.id === targetId);
    if (!target) {
      res.status(404).json({ error: "المستخدم غير موجود" });
      return;
    }
    target.salt = randomBytes(16).toString("hex");
    target.passwordHash = hashPassword(newPassword, target.salt);
    saveUsers(users);
    recordAudit(req, "تغيير كلمة مرور", "user", target.id, `الحساب: ${target.username}`);
    // إبطال كل جلسات المستخدم المعدّل (مع إبقاء جلسة المدير الحالية إن عدّل نفسه)
    saveSessions(loadSessions().filter((item) => item.userId !== targetId || (isSelf && item.token === req.token)));
    res.json({ ok: true });
  });

  router.delete("/api/users/:id", adminRequired, (req: AuthedRequest, res: Response) => {
    const targetId = String(req.params.id);
    const users = loadUsers();
    const target = users.find((item) => item.id === targetId);
    if (!target) {
      res.status(404).json({ error: "المستخدم غير موجود" });
      return;
    }
    if (target.id === req.user!.id) {
      res.status(400).json({ error: "لا يمكنك حذف حسابك الحالي" });
      return;
    }
    if (target.role === "admin" && users.filter((item) => item.role === "admin").length === 1) {
      res.status(400).json({ error: "لا يمكن حذف آخر حساب مدير" });
      return;
    }
    saveUsers(users.filter((item) => item.id !== targetId));
    saveSessions(loadSessions().filter((item) => item.userId !== targetId));
    recordAudit(req, "حذف مستخدم", "user", target.id, `الحساب: ${target.username}`);
    res.json({ ok: true });
  });

  return router;
}
