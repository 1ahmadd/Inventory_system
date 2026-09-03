import { useEffect, useState } from "react";
import { KeyRound, Plus, ShieldCheck, Trash2, UserRound, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { createUser, deleteUser, listUsers, updateUserPassword, type AuthUser, type UserRole } from "../lib/authClient";

const formatCreated = (value: string) => {
  try {
    return new Intl.DateTimeFormat("ar-SA", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
  } catch {
    return "—";
  }
};

export default function UsersView({ currentUser }: { currentUser: AuthUser }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [busy, setBusy] = useState(false);
  const [passwordEdits, setPasswordEdits] = useState<Record<string, string>>({});

  const refresh = async () => {
    try {
      const res = await listUsers();
      setUsers(res.users);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تحميل المستخدمين");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (username.trim().length < 3 || password.length < 8) {
      toast.error("اسم المستخدم 3 خانات على الأقل، وكلمة المرور 8 خانات على الأقل");
      return;
    }
    setBusy(true);
    try {
      await createUser(username.trim(), password, role);
      toast.success("تمت إضافة المستخدم بنجاح");
      setUsername("");
      setPassword("");
      setRole("user");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر إضافة المستخدم");
    } finally {
      setBusy(false);
    }
  };

  const handlePassword = async (id: string) => {
    const next = (passwordEdits[id] || "").trim();
    if (next.length < 8) {
      toast.error("كلمة المرور الجديدة يجب ألا تقل عن 8 خانات");
      return;
    }
    try {
      await updateUserPassword(id, next);
      toast.success("تم تحديث كلمة المرور");
      setPasswordEdits((current) => ({ ...current, [id]: "" }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تحديث كلمة المرور");
    }
  };

  const handleDelete = async (target: AuthUser) => {
    if (!window.confirm(`هل تريد حذف المستخدم «${target.username}» نهائياً؟`)) return;
    try {
      await deleteUser(target.id);
      toast.success("تم حذف المستخدم");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حذف المستخدم");
    }
  };

  return (
    <>
      <div className="page-intro">
        <div>
          <p className="page-lede">الأمان والوصول</p>
          <h2>المستخدمون والصلاحيات</h2>
          <p>إدارة الحسابات مقيدة بحساب المدير. كل مستخدم يدخل باسمه وكلمة مروره، ثم برمز التأكيد المرسل إلى البريد المعتمد.</p>
        </div>
      </div>

      <div className="users-grid">
        <section className="panel users-add-card">
          <div className="panel-heading users-panel-heading">
            <div>
              <span className="eyebrow">حساب جديد</span>
              <h3>إضافة مستخدم</h3>
            </div>
            <UserRound size={20} />
          </div>
          <form className="users-form" onSubmit={handleAdd}>
            <label className="field-label">
              اسم المستخدم
              <input className="text-input" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3 خانات فأكثر" autoComplete="off" />
            </label>
            <label className="field-label">
              كلمة المرور
              <input className="text-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8 خانات فأكثر" autoComplete="new-password" />
            </label>
            <label className="field-label">
              الصلاحية
              <select className="text-input" value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
                <option value="user">مستخدم · تشغيل النظام فقط</option>
                <option value="admin">مدير · إدارة المستخدمين أيضاً</option>
              </select>
            </label>
            <button type="submit" className="button primary" disabled={busy}>
              <Plus size={17} /> إضافة المستخدم
            </button>
          </form>
        </section>

        <section className="panel users-list-card">
          <div className="panel-heading users-panel-heading">
            <div>
              <span className="eyebrow">الحسابات الحالية</span>
              <h3>قائمة المستخدمين</h3>
            </div>
            <UsersIcon size={20} />
          </div>
          {loading ? (
            <p className="field-help">جارِ تحميل المستخدمين…</p>
          ) : (
            <div className="apartments-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>المستخدم</th>
                    <th>الصلاحية</th>
                    <th>تاريخ الإنشاء</th>
                    <th>تغيير كلمة المرور</th>
                    <th>حذف</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <b>{item.username}</b>
                        {item.id === currentUser.id && <span className="role-badge admin users-you-badge">أنت</span>}
                      </td>
                      <td>
                        <span className={`role-badge ${item.role === "admin" ? "admin" : ""}`}>
                          <ShieldCheck size={11} /> {item.role === "admin" ? "مدير" : "مستخدم"}
                        </span>
                      </td>
                      <td>{formatCreated(item.createdAt)}</td>
                      <td>
                        <div className="password-edit">
                          <input
                            className="text-input"
                            type="password"
                            placeholder="كلمة جديدة"
                            autoComplete="new-password"
                            value={passwordEdits[item.id] || ""}
                            onChange={(event) => setPasswordEdits((current) => ({ ...current, [item.id]: event.target.value }))}
                          />
                          <button type="button" className="button outline" onClick={() => void handlePassword(item.id)}>
                            <KeyRound size={15} /> حفظ
                          </button>
                        </div>
                      </td>
                      <td>
                        <button type="button" className="icon-button" aria-label="حذف المستخدم" title="حذف المستخدم" onClick={() => void handleDelete(item)} disabled={item.id === currentUser.id}>
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
