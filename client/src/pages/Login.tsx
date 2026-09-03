import { useState } from "react";
import { KeyRound, LogIn, MailCheck, ShieldCheck } from "lucide-react";
import { loginRequest, verifyOtpRequest, type AuthUser } from "../lib/authClient";

const logoUrl = "/assets/logo.png";

export default function Login({ onSuccess }: { onSuccess: (token: string, user: AuthUser) => void }) {
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [otpInfo, setOtpInfo] = useState<{ email: string; emailSent: boolean; debugCode?: string } | null>(null);

  const submitCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("أدخل اسم المستخدم وكلمة المرور");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await loginRequest(username.trim(), password);
      setOtpInfo({ email: res.otpSentTo, emailSent: res.emailSent, debugCode: res.debugCode });
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await verifyOtpRequest(username.trim(), code);
      onSuccess(res.token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تأكيد الرمز");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <section className="login-card">
        <div className="login-brand">
          <img src={logoUrl} alt="شعار سجل الميدان" />
          <div>
            <h1>سجل الميدان</h1>
            <span>جرد شقق الأطباء · دخول آمن</span>
          </div>
        </div>

        {step === "credentials" ? (
          <form className="login-form" onSubmit={submitCredentials}>
            <label className="field-label">
              اسم المستخدم
              <input className="text-input" autoFocus autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="اسم المستخدم" />
            </label>
            <label className="field-label">
              كلمة المرور
              <input className="text-input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="كلمة المرور" />
            </label>
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="button primary" disabled={busy}>
              <LogIn size={17} /> {busy ? "جارِ التحقق…" : "متابعة"}
            </button>
            <p className="login-hint">
              <ShieldCheck size={14} /> بعد إدخال البيانات الصحيحة سيُرسل رمز تأكيد إلى البريد المعتمد لإتمام الدخول.
            </p>
          </form>
        ) : (
          <form className="login-form" onSubmit={submitOtp}>
            <p className="login-hint">
              <MailCheck size={14} />{" "}
              {otpInfo?.emailSent
                ? `تم إرسال رمز التأكيد إلى ${otpInfo.email} — الرمز صالح لمدة 10 دقائق.`
                : "لم يتم إعداد خدمة البريد بعد على الخادم (SMTP). أدخل الرمز الظاهر أدناه لإتمام الدخول."}
            </p>
            {otpInfo?.debugCode && (
              <div className="debug-code-box">
                وضع التجربة — الرمز: <b>{otpInfo.debugCode}</b>
              </div>
            )}
            <label className="field-label">
              رمز التأكيد
              <input
                className="text-input otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
              />
            </label>
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="button primary" disabled={busy || code.length !== 6}>
              <KeyRound size={17} /> {busy ? "جارِ التأكيد…" : "تأكيد الدخول"}
            </button>
            <button
              type="button"
              className="button outline"
              onClick={() => {
                setStep("credentials");
                setCode("");
                setError("");
              }}
            >
              رجوع
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
