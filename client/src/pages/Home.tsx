import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  BellRing,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  FileDown,
  Filter,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  Users as UsersIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";
import UsersView, { AuditView } from "./Users";
import { fetchInventory, saveInventory, type AuthUser } from "../lib/authClient";

type ApartmentStatus = "شاغرة" | "مسكونة" | "قيد الصيانة";
type ItemCondition = "ممتاز" | "جيد" | "يحتاج صيانة" | "تالف" | "مفقود";

type Apartment = {
  id: string;
  number: string;
  doctor: string;
  status: ApartmentStatus;
  notes: string;
  updatedAt: string;
};

type InventoryItem = {
  id: string;
  apartmentId: string;
  category: string;
  name: string;
  quantity: number;
  condition: ItemCondition;
  amount?: number;
  depreciationRate?: number;
  notes: string;
  updatedAt: string;
};

type AppState = {
  buildingName: string;
  apartments: Apartment[];
  items: InventoryItem[];
};

type View = "dashboard" | "apartments" | "inventory" | "users" | "audit" | "settings";

const STORAGE_KEY = "doctor-apartment-inventory-v1";
const logoUrl = "/assets/logo.png";
const emptyStateUrl = "/assets/empty-state.png";
const categories = ["أجهزة كهربائية", "أثاث", "مفروشات", "أدوات مطبخ", "صحيات", "إلكترونيات", "أخرى"];
const apartmentStatuses: ApartmentStatus[] = ["شاغرة", "مسكونة", "قيد الصيانة"];
const itemConditions: ItemCondition[] = ["ممتاز", "جيد", "يحتاج صيانة", "تالف", "مفقود"];

const nowIso = () => new Date().toISOString();
const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const defaultState: AppState = { buildingName: "مبنى شقق الأطباء", apartments: [], items: [] };

// تجميع القطع حسب الفئة بالترتيب المعتمد (الواجهة والطباعة)
function groupByCategory(items: InventoryItem[]) {
  const rank = (category: string) => {
    const index = categories.indexOf(category);
    return index === -1 ? categories.length : index;
  };
  const groups = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const key = item.category || "أخرى";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return Array.from(groups.entries())
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([category, itemsInCategory]) => ({
      category,
      items: itemsInCategory,
      totalQuantity: itemsInCategory.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    }));
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      buildingName: typeof parsed.buildingName === "string" ? parsed.buildingName : defaultState.buildingName,
      apartments: Array.isArray(parsed.apartments) ? parsed.apartments : [],
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return defaultState;
  }
}

function formatDate(value: string) {
  if (!value) return "غير محدد";
  return new Intl.DateTimeFormat("ar-SA", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function statusTone(status: ApartmentStatus) {
  if (status === "مسكونة") return "positive";
  if (status === "قيد الصيانة") return "danger";
  return "neutral";
}

function conditionTone(condition: ItemCondition) {
  if (condition === "ممتاز" || condition === "جيد") return "positive";
  if (condition === "يحتاج صيانة") return "warning";
  return "danger";
}

function IconButton({ label, children, onClick, className = "" }: { label: string; children: React.ReactNode; onClick: () => void; className?: string }) {
  return (
    <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

function Modal({ title, eyebrow, children, onClose }: { title: string; eyebrow: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id="modal-title">{title}</h2>
          </div>
          <IconButton label="إغلاق" onClick={onClose}><X size={19} /></IconButton>
        </div>
        {children}
      </section>
    </div>
  );
}

const viewEyebrow: Record<View, string> = {
  dashboard: "نظرة عامة",
  apartments: "إدارة الوحدات",
  inventory: "سجل العهد والمحتويات",
  users: "الأمان والوصول",
  audit: "المراجعة والامتثال",
  settings: "مساحة العمل",
};

const viewTitle: Record<View, string> = {
  dashboard: "جولة اليوم تبدأ من هنا",
  apartments: "الشقق والوحدات",
  inventory: "سجل القطع والموجودات",
  users: "المستخدمون والصلاحيات",
  audit: "سجل عمليات النظام",
  settings: "الإعدادات والنسخ الاحتياطي",
};

export default function Home({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [state, setState] = useState<AppState>(() => loadState());
  const [serverLoaded, setServerLoaded] = useState(false);
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [selectedApartmentId, setSelectedApartmentId] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [conditionFilter, setConditionFilter] = useState<"الكل" | ItemCondition>("الكل");
  const [categoryFilter, setCategoryFilter] = useState("الكل");
  const [modal, setModal] = useState<"apartment" | "item" | null>(null);
  const [editingApartment, setEditingApartment] = useState<Apartment | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [printTargetId, setPrintTargetId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (serverLoaded) void saveInventory(state as never).catch(() => toast.error("تعذر حفظ التعديلات على الخادم"));
  }, [serverLoaded, state]);

  useEffect(() => {
    void fetchInventory().then(({ state: remote }) => {
      const hasRemoteData = (remote.apartments?.length || 0) > 0 || (remote.items?.length || 0) > 0;
      if (hasRemoteData || (state.apartments.length === 0 && state.items.length === 0)) setState({ buildingName: remote.buildingName, apartments: (remote.apartments || []) as Apartment[], items: (remote.items || []) as InventoryItem[] });
    }).catch(() => toast.error("تعذر تحميل السجل المركزي")).finally(() => setServerLoaded(true));
  }, []);

  const selectedApartment = state.apartments.find((apartment) => apartment.id === selectedApartmentId) ?? state.apartments[0];
  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return state.items.filter((item) => {
      const matchesApartment = !selectedApartmentId || item.apartmentId === selectedApartmentId;
      const matchesSearch = !query || `${item.name} ${item.category} ${item.notes}`.toLowerCase().includes(query);
      const matchesCondition = conditionFilter === "الكل" || item.condition === conditionFilter;
      const matchesCategory = categoryFilter === "الكل" || item.category === categoryFilter;
      return matchesApartment && matchesSearch && matchesCondition && matchesCategory;
    });
  }, [categoryFilter, conditionFilter, searchTerm, selectedApartmentId, state.items]);

  const attentionItems = state.items.filter((item) => item.condition === "يحتاج صيانة" || item.condition === "تالف" || item.condition === "مفقود");
  const occupiedCount = state.apartments.filter((apartment) => apartment.status === "مسكونة").length;
  const maintenanceCount = state.apartments.filter((apartment) => apartment.status === "قيد الصيانة").length;
  const totalQuantity = state.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  const openApartmentModal = (apartment?: Apartment) => {
    setEditingApartment(apartment ?? null);
    setModal("apartment");
  };

  const openItemModal = (item?: InventoryItem) => {
    if (!item && state.apartments.length === 0) {
      toast.error("أضف شقة أولاً قبل تسجيل القطع");
      setActiveView("apartments");
      return;
    }
    setEditingItem(item ?? null);
    setModal("item");
  };

  const saveApartment = (payload: Omit<Apartment, "id" | "updatedAt">) => {
    setState((current) => {
      if (editingApartment) {
        return {
          ...current,
          apartments: current.apartments.map((apartment) => apartment.id === editingApartment.id ? { ...apartment, ...payload, updatedAt: nowIso() } : apartment),
        };
      }
      const newApartment = { ...payload, id: makeId("apt"), updatedAt: nowIso() };
      setSelectedApartmentId(newApartment.id);
      return { ...current, apartments: [newApartment, ...current.apartments] };
    });
    setModal(null);
    toast.success(editingApartment ? "تم تحديث بيانات الشقة" : "تمت إضافة الشقة");
  };

  const saveItem = (payload: Omit<InventoryItem, "id" | "updatedAt">) => {
    setState((current) => {
      if (editingItem) {
        return {
          ...current,
          items: current.items.map((item) => item.id === editingItem.id ? { ...item, ...payload, updatedAt: nowIso() } : item),
        };
      }
      const newItem = { ...payload, id: makeId("item"), updatedAt: nowIso() };
      setSelectedApartmentId(payload.apartmentId);
      return { ...current, items: [newItem, ...current.items] };
    });
    setModal(null);
    toast.success(editingItem ? "تم تحديث بيانات القطعة" : "تمت إضافة القطعة للسجل");
  };

  const deleteApartment = (id: string) => {
    if (!window.confirm("سيتم حذف الشقة وكل القطع المرتبطة بها. هل تريد المتابعة؟")) return;
    setState((current) => ({ ...current, apartments: current.apartments.filter((apartment) => apartment.id !== id), items: current.items.filter((item) => item.apartmentId !== id) }));
    if (selectedApartmentId === id) setSelectedApartmentId("");
    toast.success("تم حذف الشقة والسجل المرتبط بها");
  };

  const deleteItem = (id: string) => {
    if (!window.confirm("هل تريد حذف هذه القطعة من السجل؟")) return;
    setState((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
    toast.success("تم حذف القطعة");
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ ...state, exportedAt: nowIso() }, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `جرد-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير نسخة JSON من السجل");
  };

  const importJson = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<AppState>;
        if (!Array.isArray(parsed.apartments) || !Array.isArray(parsed.items)) throw new Error("invalid");
        setState({ buildingName: parsed.buildingName || defaultState.buildingName, apartments: parsed.apartments, items: parsed.items });
        setSelectedApartmentId(parsed.apartments[0]?.id ?? "");
        toast.success("تم استيراد البيانات بنجاح");
      } catch {
        toast.error("ملف JSON غير صالح أو لا يطابق نظام الجرد");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  const printApartment = (id?: string) => {
    const target = id || selectedApartment?.id || state.apartments[0]?.id;
    if (!target) {
      toast.error("أضف شقة أولاً حتى تتمكن من الطباعة");
      return;
    }
    setPrintTargetId(target);
    window.setTimeout(() => window.print(), 120);
  };

  const navigate = (view: View) => {
    setActiveView(view);
    setMobileNavOpen(false);
  };

  return (
    <div className="app-shell" dir="rtl">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <img src={logoUrl} alt="شعار سجل الجرد" className="brand-mark" />
          <div>
            <div className="brand-name">سجل الميدان</div>
            <div className="brand-subtitle">جرد شقق الأطباء</div>
          </div>
        </div>
        <div className="sidebar-building">
          <Building2 size={16} />
          <span>{state.buildingName}</span>
          <span className="online-dot" aria-label="الحفظ المحلي مفعل" />
        </div>
        <nav className="nav-list" aria-label="التنقل الرئيسي">
          <NavItem active={activeView === "dashboard"} icon={<LayoutDashboard size={18} />} label="لوحة المتابعة" onClick={() => navigate("dashboard")} />
          <NavItem active={activeView === "apartments"} icon={<Building2 size={18} />} label="الشقق" count={state.apartments.length} onClick={() => navigate("apartments")} />
          <NavItem active={activeView === "inventory"} icon={<ClipboardList size={18} />} label="سجل القطع" count={state.items.length} onClick={() => navigate("inventory")} />
          {user.role === "admin" && <NavItem active={activeView === "users"} icon={<UsersIcon size={18} />} label="المستخدمون" onClick={() => navigate("users")} />}
          {user.role === "admin" && <NavItem active={activeView === "audit"} icon={<ClipboardList size={18} />} label="سجل العمليات" onClick={() => navigate("audit")} />}
          <NavItem active={activeView === "settings"} icon={<Settings2 size={18} />} label="الإعدادات والنسخ" onClick={() => navigate("settings")} />
        </nav>
        <button type="button" className="nav-item" onClick={onLogout} aria-label="تسجيل الخروج">
          <LogOut size={18} />
          <span>تسجيل الخروج</span>
        </button>
        <div className="sidebar-note">
          <Sparkles size={17} />
          <div>
            <strong>حفظ تلقائي</strong>
            <span>بياناتك تبقى على هذا الجهاز</span>
          </div>
        </div>
      </aside>

      {mobileNavOpen && <button className="sidebar-scrim" aria-label="إغلاق القائمة" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-start">
            <IconButton label="فتح القائمة" className="mobile-only" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></IconButton>
            <div>
              <span className="eyebrow">{viewEyebrow[activeView]}</span>
              <h1>{viewTitle[activeView]}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="user-chip" title={`${user.username} · ${user.role === "admin" ? "مدير" : "مستخدم"}`}>
              <UserRound size={14} />
              <span>{user.username}</span>
            </div>
            <div className="save-indicator"><span className="online-dot" /> يحفظ تلقائياً</div>
            <IconButton label="مساعدة" onClick={() => toast.info("أضف شقة أولاً، ثم أضف القطع المرتبطة بها. يمكنك التصفية والطباعة من سجل القطع.")}><CircleHelp size={19} /></IconButton>
            <IconButton label="تسجيل الخروج" onClick={onLogout}><LogOut size={19} /></IconButton>
          </div>
        </header>

        <div className="content-wrap">
          {activeView === "dashboard" && (
            <DashboardView
              state={state}
              occupiedCount={occupiedCount}
              maintenanceCount={maintenanceCount}
              totalQuantity={totalQuantity}
              attentionItems={attentionItems}
              onAddApartment={() => openApartmentModal()}
              onAddItem={() => openItemModal()}
              onNavigate={navigate}
              onPrint={() => printApartment()}
              onSelectApartment={(id) => { setSelectedApartmentId(id); navigate("inventory"); }}
            />
          )}
          {activeView === "apartments" && (
            <ApartmentsView
              apartments={state.apartments}
              items={state.items}
              onAdd={() => openApartmentModal()}
              onEdit={openApartmentModal}
              onDelete={deleteApartment}
              onSelect={(id) => { setSelectedApartmentId(id); navigate("inventory"); }}
              onPrint={printApartment}
            />
          )}
          {activeView === "inventory" && (
            <InventoryView
              apartments={state.apartments}
              items={filteredItems}
              selectedApartmentId={selectedApartmentId}
              setSelectedApartmentId={setSelectedApartmentId}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              conditionFilter={conditionFilter}
              setConditionFilter={setConditionFilter}
              onAdd={() => openItemModal()}
              onEdit={openItemModal}
              onDelete={deleteItem}
              onPrint={() => printApartment()}
            />
          )}
          {activeView === "users" && user.role === "admin" && <UsersView currentUser={user} />}
          {activeView === "audit" && user.role === "admin" && <AuditView />}
          {activeView === "settings" && (
            <SettingsView
              buildingName={state.buildingName}
              onBuildingNameChange={(buildingName) => setState((current) => ({ ...current, buildingName }))}
              onExport={exportJson}
              onImport={() => fileInputRef.current?.click()}
              onPrint={() => printApartment()}
            />
          )}
        </div>
      </main>

      <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden-input" onChange={importJson} />
      {modal === "apartment" && <ApartmentModal initial={editingApartment} onClose={() => setModal(null)} onSave={saveApartment} />}
      {modal === "item" && <ItemModal initial={editingItem} apartments={state.apartments} defaultApartmentId={selectedApartmentId || state.apartments[0]?.id || ""} onClose={() => setModal(null)} onSave={saveItem} />}
      <PrintSheet state={state} apartmentId={printTargetId || selectedApartment?.id || ""} />
    </div>
  );
}

function NavItem({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button type="button" className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span>{typeof count === "number" && <b>{count}</b>}</button>;
}

function DashboardView({ state, occupiedCount, maintenanceCount, totalQuantity, attentionItems, onAddApartment, onAddItem, onNavigate, onPrint, onSelectApartment }: { state: AppState; occupiedCount: number; maintenanceCount: number; totalQuantity: number; attentionItems: InventoryItem[]; onAddApartment: () => void; onAddItem: () => void; onNavigate: (view: View) => void; onPrint: () => void; onSelectApartment: (id: string) => void }) {
  const latestApartments = state.apartments.slice(0, 4);
  const categorySummaries = groupByCategory(state.items);
  return <>
    <section className="hero-card">
      <div className="hero-copy">
        <span className="hero-kicker"><span className="kicker-dot" /> إصدار آمن · دخول بالمستخدم ورمز التأكيد</span>
        <h2>كل شقة لها قصة،<br /><em>سجّلها بوضوح.</em></h2>
        <p>أضف الشقق وقطع الأثاث والأجهزة يدوياً، واحفظ الجولة كاملة على جهازك مع إمكانية طباعة نموذج A4 في أي وقت.</p>
        <div className="hero-actions"><button type="button" className="button primary" onClick={onAddApartment}><Plus size={17} /> إضافة شقة</button><button type="button" className="button ghost-light" onClick={onAddItem}><ClipboardList size={17} /> إضافة قطعة</button></div>
      </div>
      <div className="hero-visual"><div className="hero-stamp">سجل<br /><span>الميدان</span></div><div className="hero-rule" /><div className="hero-quote">«سجل اليوم<br />يحمي قرار الغد»</div></div>
    </section>

    <section className="stats-grid" aria-label="إحصائيات الجرد">
      <StatCard label="إجمالي الشقق" value={state.apartments.length} hint="وحدة مسجلة" icon={<Building2 size={19} />} tone="ink" />
      <StatCard label="الشقق المسكونة" value={occupiedCount} hint={state.apartments.length ? `${Math.round((occupiedCount / state.apartments.length) * 100)}% من الوحدات` : "بانتظار البيانات"} icon={<UserRound size={19} />} tone="teal" />
      <StatCard label="إجمالي القطع" value={totalQuantity} hint={`${state.items.length} سجل تفصيلي`} icon={<Archive size={19} />} tone="sand" />
      <StatCard label="تحتاج متابعة" value={attentionItems.length} hint={maintenanceCount ? `${maintenanceCount} شقة تحت الصيانة` : "لا توجد تنبيهات شقق"} icon={<BellRing size={19} />} tone="amber" />
    </section>

    <div className="section-heading"><div><span className="eyebrow">المتابعة السريعة</span><h3>آخر الشقق المضافة</h3></div><button type="button" className="text-button" onClick={() => onNavigate("apartments")}>عرض كل الشقق <ArrowUpFromLine size={15} /></button></div>
    {latestApartments.length === 0 ? <EmptyDashboard onAdd={onAddApartment} /> : <section className="apartment-preview-grid">{latestApartments.map((apartment) => <ApartmentMiniCard key={apartment.id} apartment={apartment} itemCount={state.items.filter((item) => item.apartmentId === apartment.id).length} onSelect={() => onSelectApartment(apartment.id)} />)}</section>}

    {categorySummaries.length > 0 && (
      <>
        <div className="section-heading" style={{ marginTop: 26 }}><div><span className="eyebrow">مرتبة حسب الفئات</span><h3>توزيع القطع على الفئات</h3></div><button type="button" className="text-button" onClick={() => onNavigate("inventory")}>فتح سجل القطع <ArrowUpFromLine size={15} /></button></div>
        <section className="apartment-preview-grid">{categorySummaries.map((group) => (
          <button key={group.category} type="button" className="apartment-mini-card" onClick={() => onNavigate("inventory")}>
            <div className="mini-top"><span className="status-pill neutral">{group.category}</span><span className="mini-arrow">↗</span></div>
            <div className="mini-number">{group.totalQuantity.toLocaleString("ar-EG")}</div>
            <div className="mini-meta"><span>قطعة مسجلة</span><span>{group.items.length} سجل</span></div>
          </button>
        ))}</section>
      </>
    )}

    <section className="dashboard-bottom-grid">
      <div className="panel attention-panel"><div className="panel-heading"><div><span className="eyebrow">لا تفوّت شيئاً</span><h3>تنبيهات الجرد</h3></div><button type="button" className="round-link" onClick={() => onNavigate("inventory")}><MoreHorizontal size={18} /></button></div>{attentionItems.length === 0 ? <div className="quiet-empty"><Check size={21} /><span>لا توجد قطع تحتاج متابعة حالياً.</span></div> : <div className="attention-list">{attentionItems.slice(0, 4).map((item) => <div className="attention-row" key={item.id}><span className={`condition-dot ${conditionTone(item.condition)}`} /><div><strong>{item.name}</strong><span>{item.condition} · {state.apartments.find((a) => a.id === item.apartmentId)?.number || "شقة غير محددة"}</span></div><button type="button" onClick={() => onSelectApartment(item.apartmentId)}>فتح</button></div>)}</div>}</div>
      <div className="panel print-panel"><div className="print-panel-art"><Printer size={23} /></div><div><span className="eyebrow">جاهز للورق</span><h3>اطبع سجل شقة على A4</h3><p>نموذج منظم مفرز بالفئات مع عنوان وتاريخ وتوقيعات، مناسب للجولة الميدانية.</p><button type="button" className="button dark" onClick={onPrint}><Printer size={16} /> معاينة الطباعة</button></div></div>
    </section>
  </>;
}

function StatCard({ label, value, hint, icon, tone }: { label: string; value: number; hint: string; icon: React.ReactNode; tone: string }) {
  return <div className={`stat-card stat-${tone}`}><div className="stat-icon">{icon}</div><span>{label}</span><strong>{value.toLocaleString("ar-EG")}</strong><small>{hint}</small></div>;
}

function EmptyDashboard({ onAdd }: { onAdd: () => void }) {
  return <div className="empty-dashboard"><div className="empty-copy"><span className="eyebrow">الخطوة الأولى</span><h3>أنشئ أول شقة في سجلك</h3><p>بعد الإضافة ستتمكن من تسجيل كل قطعة وأي ملاحظة مرتبطة بها، دون الالتزام بقائمة ثابتة.</p><button type="button" className="button primary" onClick={onAdd}><Plus size={17} /> إضافة أول شقة</button></div><div className="empty-number">01</div></div>;
}

function ApartmentMiniCard({ apartment, itemCount, onSelect }: { apartment: Apartment; itemCount: number; onSelect: () => void }) {
  return <button type="button" className="apartment-mini-card" onClick={onSelect}><div className="mini-top"><span className={`status-pill ${statusTone(apartment.status)}`}>{apartment.status}</span><span className="mini-arrow">↗</span></div><div className="mini-number">{apartment.number}</div><div className="mini-meta"><span>{apartment.doctor || "بدون طبيب مسجل"}</span><span>{itemCount} قطعة</span></div></button>;
}

function ApartmentsView({ apartments, items, onAdd, onEdit, onDelete, onSelect, onPrint }: { apartments: Apartment[]; items: InventoryItem[]; onAdd: () => void; onEdit: (apartment: Apartment) => void; onDelete: (id: string) => void; onSelect: (id: string) => void; onPrint: (id: string) => void }) {
  return <>
    <div className="page-intro"><div><p className="page-lede">إدارة الوحدات</p><h2>الشقق التي تحت إشرافك</h2><p>أنشئ بطاقة لكل شقة، ثم افتح سجلها لإضافة كل ما فيها من أثاث وأجهزة ومفروشات.</p></div><button type="button" className="button primary" onClick={onAdd}><Plus size={17} /> إضافة شقة</button></div>
    {apartments.length === 0 ? <EmptyState icon={<Building2 size={26} />} title="لا توجد شقق مضافة" description="ابدأ بإضافة رقم الشقة وبيانات الطبيب لتكوين قاعدة الجرد." actionLabel="إضافة شقة" onAction={onAdd} /> : <div className="apartments-table-wrap"><table className="data-table"><thead><tr><th>رقم الشقة</th><th>الطبيب المقيم</th><th>الحالة</th><th>القطع</th><th>آخر تحديث</th><th>إجراءات</th></tr></thead><tbody>{apartments.map((apartment) => <tr key={apartment.id}><td><button type="button" className="table-link" onClick={() => onSelect(apartment.id)}>{apartment.number}</button></td><td>{apartment.doctor || "—"}</td><td><span className={`status-pill ${statusTone(apartment.status)}`}>{apartment.status}</span></td><td>{items.filter((item) => item.apartmentId === apartment.id).length}</td><td>{formatDate(apartment.updatedAt)}</td><td><div className="row-actions"><IconButton label="فتح السجل" onClick={() => onSelect(apartment.id)}><ClipboardList size={16} /></IconButton><IconButton label="طباعة" onClick={() => onPrint(apartment.id)}><Printer size={16} /></IconButton><IconButton label="تعديل" onClick={() => onEdit(apartment)}><Pencil size={16} /></IconButton><IconButton label="حذف" onClick={() => onDelete(apartment.id)}><Trash2 size={16} /></IconButton></div></td></tr>)}</tbody></table></div>}
  </>;
}

function InventoryView({ apartments, items, selectedApartmentId, setSelectedApartmentId, searchTerm, setSearchTerm, categoryFilter, setCategoryFilter, conditionFilter, setConditionFilter, onAdd, onEdit, onDelete, onPrint }: { apartments: Apartment[]; items: InventoryItem[]; selectedApartmentId: string; setSelectedApartmentId: (value: string) => void; searchTerm: string; setSearchTerm: (value: string) => void; categoryFilter: string; setCategoryFilter: (value: string) => void; conditionFilter: "الكل" | ItemCondition; setConditionFilter: (value: "الكل" | ItemCondition) => void; onAdd: () => void; onEdit: (item: InventoryItem) => void; onDelete: (id: string) => void; onPrint: () => void }) {
  const grouped = groupByCategory(items);
  return <>
    <div className="page-intro inventory-intro"><div><p className="page-lede">قاعدة البيانات المرنة</p><h2>كل قطعة في صف مستقل</h2><p>العرض مرتب حسب الفئات: كل مجموعة عناصر فئة تظهر مع بعضها تحت عنوانها الخاص.</p></div><div className="intro-actions"><button type="button" className="button outline" onClick={onPrint}><Printer size={17} /> طباعة A4</button><button type="button" className="button primary" onClick={onAdd}><Plus size={17} /> إضافة قطعة</button></div></div>
    <div className="filter-bar"><div className="search-field"><Search size={17} /><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="ابحث باسم القطعة أو الملاحظة" aria-label="البحث في القطع" /></div><div className="select-wrap"><Filter size={15} /><select value={selectedApartmentId} onChange={(event) => setSelectedApartmentId(event.target.value)} aria-label="تصفية حسب الشقة"><option value="">كل الشقق</option>{apartments.map((apartment) => <option key={apartment.id} value={apartment.id}>شقة {apartment.number}</option>)}</select><ChevronDown size={15} /></div><div className="select-wrap"><SlidersHorizontal size={15} /><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="تصفية حسب الفئة"><option value="الكل">كل الفئات</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select><ChevronDown size={15} /></div><div className="select-wrap"><select value={conditionFilter} onChange={(event) => setConditionFilter(event.target.value as "الكل" | ItemCondition)} aria-label="تصفية حسب الحالة"><option value="الكل">كل الحالات</option>{itemConditions.map((condition) => <option key={condition} value={condition}>{condition}</option>)}</select><ChevronDown size={15} /></div></div>
    {apartments.length === 0 ? <EmptyState icon={<Archive size={26} />} title="أضف شقة قبل تسجيل القطع" description="كل سجل قطعة يحتاج إلى شقة مرتبطة به، حتى تظل الطباعة منظمة." actionLabel="الذهاب إلى الشقق" onAction={() => setSelectedApartmentId("")} /> : items.length === 0 ? <div className="inventory-empty"><img src={emptyStateUrl} alt="دفتر جرد فارغ" /><div><span className="eyebrow">السجل جاهز</span><h3>لم تتم إضافة قطع بهذه التصفية</h3><p>أضف أول قطعة، أو غيّر خيارات البحث والتصفية لإظهار السجلات الموجودة.</p><button type="button" className="button primary" onClick={onAdd}><Plus size={17} /> إضافة قطعة</button></div></div> : (
      <div>
        {grouped.map((group) => (
          <section key={group.category} className="category-section">
            <header className="category-header">
              <h3 className="category-title">{group.category}</h3>
              <span className="category-count">{group.items.length} سجل · إجمالي الكمية {group.totalQuantity.toLocaleString("ar-EG")}</span>
            </header>
            <div className="inventory-list">
              {group.items.map((item) => (
                <InventoryCard key={item.id} item={item} apartment={apartments.find((apartment) => apartment.id === item.apartmentId)} onEdit={() => onEdit(item)} onDelete={() => onDelete(item.id)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    )}
  </>;
}

function InventoryCard({ item, apartment, onEdit, onDelete }: { item: InventoryItem; apartment?: Apartment; onEdit: () => void; onDelete: () => void }) {
  return <article className={`inventory-card border-${conditionTone(item.condition)}`}><div className="inventory-card-main"><div className="inventory-card-top"><span className="category-tag">{item.category}</span><span className={`status-pill ${conditionTone(item.condition)}`}>{item.condition}</span></div><h3>{item.name}</h3><div className="inventory-card-meta"><span><Building2 size={14} /> شقة {apartment?.number || "غير محددة"}</span><span><Archive size={14} /> الكمية: {item.quantity}</span>{item.amount != null && <span>المبلغ: {item.amount.toLocaleString("ar-EG")}</span>}{item.depreciationRate != null && <span>الإهلاك: {item.depreciationRate}%</span>}</div>{item.notes && <p className="inventory-note">{item.notes}</p>}</div><div className="inventory-card-actions"><IconButton label="تعديل القطعة" onClick={onEdit}><Pencil size={16} /></IconButton><IconButton label="حذف القطعة" onClick={onDelete}><Trash2 size={16} /></IconButton></div></article>;
}

function SettingsView({ buildingName, onBuildingNameChange, onExport, onImport, onPrint }: { buildingName: string; onBuildingNameChange: (value: string) => void; onExport: () => void; onImport: () => void; onPrint: () => void }) {
  return <>
    <div className="page-intro"><div><p className="page-lede">سجل مرتبط بالمستخدم</p><h2>الإعدادات والنسخ</h2><p>يحفظ السجل مركزيًا لكل مستخدم مع نسخة محلية مؤقتة. استخدم JSON لعمل نسخة احتياطية أو لنقل السجل إلى جهاز آخر.</p></div></div>
    <div className="settings-grid"><section className="panel settings-card"><div className="panel-heading"><div><span className="eyebrow">هوية النموذج</span><h3>بيانات المبنى</h3></div><Building2 size={21} /></div><label className="field-label" htmlFor="building-name">اسم المبنى</label><input id="building-name" className="text-input" value={buildingName} onChange={(event) => onBuildingNameChange(event.target.value)} placeholder="مثال: مبنى الأطباء - 1" /><p className="field-help">سيظهر هذا الاسم في واجهة النظام ونموذج الطباعة.</p></section><section className="panel settings-card"><div className="panel-heading"><div><span className="eyebrow">حماية بياناتك</span><h3>نسخة احتياطية</h3></div><Archive size={21} /></div><div className="settings-actions"><button type="button" className="button dark" onClick={onExport}><FileDown size={17} /> تصدير JSON</button><button type="button" className="button outline" onClick={onImport}><ArrowDownToLine size={17} /> استيراد JSON</button><button type="button" className="button outline" onClick={onPrint}><Printer size={17} /> طباعة سجل A4</button></div><div className="backup-note"><Sparkles size={16} /><span>نصيحة: صدّر نسخة بعد كل جولة جرد واحتفظ بها في ملفات الهاتف.</span></div></section></div>
    <section className="panel local-panel"><div className="local-icon"><Check size={20} /></div><div><h3>الحفظ المركزي مفعل</h3><p>بيانات هذا المستخدم محفوظة على الخادم، مع نسخة محلية مؤقتة لتحسين سرعة الاستخدام. تبقى نسخة JSON الاحتياطية مهمة.</p></div></section>
  </>;
}

function EmptyState({ icon, title, description, actionLabel, onAction }: { icon: React.ReactNode; title: string; description: string; actionLabel: string; onAction: () => void }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p><button type="button" className="button primary" onClick={onAction}><Plus size={17} /> {actionLabel}</button></div>;
}

function ApartmentModal({ initial, onClose, onSave }: { initial: Apartment | null; onClose: () => void; onSave: (payload: Omit<Apartment, "id" | "updatedAt">) => void }) {
  const [number, setNumber] = useState(initial?.number || "");
  const [doctor, setDoctor] = useState(initial?.doctor || "");
  const [status, setStatus] = useState<ApartmentStatus>(initial?.status || "شاغرة");
  const [notes, setNotes] = useState(initial?.notes || "");
  return <Modal eyebrow={initial ? "تعديل السجل" : "سجل جديد"} title={initial ? "تعديل بيانات الشقة" : "إضافة شقة جديدة"} onClose={onClose}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (!number.trim()) { toast.error("أدخل رقم الشقة"); return; } onSave({ number: number.trim(), doctor: doctor.trim(), status, notes: notes.trim() }); }}><div className="form-grid"><label className="field-label">رقم الشقة<input autoFocus className="text-input" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="مثال: 204" /></label><label className="field-label">حالة الشقة<select className="text-input" value={status} onChange={(event) => setStatus(event.target.value as ApartmentStatus)}>{apartmentStatuses.map((item) => <option key={item}>{item}</option>)}</select></label></div><label className="field-label">اسم الطبيب المقيم<input className="text-input" value={doctor} onChange={(event) => setDoctor(event.target.value)} placeholder="اختياري" /></label><label className="field-label">ملاحظات عامة<textarea className="text-input textarea" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="أي ملاحظة مرتبطة بالشقة" /></label><div className="modal-actions"><button type="button" className="button outline" onClick={onClose}>إلغاء</button><button type="submit" className="button primary"><Check size={17} /> حفظ الشقة</button></div></form></Modal>;
}

function ItemModal({ initial, apartments, defaultApartmentId, onClose, onSave }: { initial: InventoryItem | null; apartments: Apartment[]; defaultApartmentId: string; onClose: () => void; onSave: (payload: Omit<InventoryItem, "id" | "updatedAt">) => void }) {
  const [apartmentId, setApartmentId] = useState(initial?.apartmentId || defaultApartmentId);
  const [category, setCategory] = useState(initial?.category || "أثاث");
  const [name, setName] = useState(initial?.name || "");
  const [quantity, setQuantity] = useState(String(initial?.quantity || 1));
  const [condition, setCondition] = useState<ItemCondition>(initial?.condition || "جيد");
  const [amount, setAmount] = useState(String(initial?.amount ?? ""));
  const [depreciationRate, setDepreciationRate] = useState(String(initial?.depreciationRate ?? ""));
  const [notes, setNotes] = useState(initial?.notes || "");
  return <Modal eyebrow={initial ? "تعديل السجل" : "إضافة إلى الجرد"} title={initial ? "تعديل بيانات القطعة" : "إضافة قطعة جديدة"} onClose={onClose}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (!name.trim() || !apartmentId) { toast.error("اختر الشقة وأدخل اسم القطعة"); return; } onSave({ apartmentId, category, name: name.trim(), quantity: Math.max(1, Number(quantity) || 1), condition, amount: amount === "" ? undefined : Math.max(0, Number(amount) || 0), depreciationRate: depreciationRate === "" ? undefined : Math.min(100, Math.max(0, Number(depreciationRate) || 0)), notes: notes.trim() }); }}><label className="field-label">الشقة<select autoFocus className="text-input" value={apartmentId} onChange={(event) => setApartmentId(event.target.value)}>{apartments.map((apartment) => <option key={apartment.id} value={apartment.id}>شقة {apartment.number}</option>)}</select></label><div className="form-grid"><label className="field-label">الفئة<select className="text-input" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">الكمية<input className="text-input" type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label></div><label className="field-label">اسم القطعة أو وصفها<input className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: سرير مفرد، غلاية ماء، ستارة..." /></label><div className="form-grid"><label className="field-label">المبلغ (اختياري)<input className="text-input" type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="مثال: 1250" /></label><label className="field-label">نسبة الإهلاك % (اختياري)<input className="text-input" type="number" min="0" max="100" step="0.01" value={depreciationRate} onChange={(event) => setDepreciationRate(event.target.value)} placeholder="مثال: 10" /></label></div><label className="field-label">الحالة<select className="text-input" value={condition} onChange={(event) => setCondition(event.target.value as ItemCondition)}>{itemConditions.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field-label">ملاحظات<textarea className="text-input textarea" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="الماركة، رقم الأصل، النقص أو العطل" /></label><div className="modal-actions"><button type="button" className="button outline" onClick={onClose}>إلغاء</button><button type="submit" className="button primary"><Check size={17} /> حفظ القطعة</button></div></form></Modal>;
}

function PrintSheet({ state, apartmentId }: { state: AppState; apartmentId: string }) {
  const apartment = state.apartments.find((item) => item.id === apartmentId) || state.apartments[0];
  const apartmentItems = state.items.filter((item) => item.apartmentId === apartment?.id);
  const grouped = groupByCategory(apartmentItems);
  let serial = 0;
  return <div className="print-only"><div className="print-header"><div><h1>{state.buildingName}</h1><h2>نموذج جرد أثاث ومحتويات شقة</h2></div><div className="print-logo-box"><img src={logoUrl} alt="" /></div></div><div className="print-meta"><div><b>رقم الشقة</b><span>{apartment?.number || "—"}</span></div><div><b>الطبيب المقيم</b><span>{apartment?.doctor || "—"}</span></div><div><b>حالة الشقة</b><span>{apartment?.status || "—"}</span></div><div><b>تاريخ الطباعة</b><span>{formatDate(nowIso())}</span></div></div><table><thead><tr><th>م</th><th>الفئة</th><th>البيان / القطعة</th><th>العدد</th><th>الحالة</th><th>المبلغ</th><th>الإهلاك</th><th>الملاحظات</th></tr></thead><tbody>{grouped.length ? grouped.map((group) => (
    <>
      <tr className="print-cat-row" key={`cat-${group.category}`}><td colSpan={8}>فئة: {group.category} — {group.items.length} سجل · إجمالي الكمية {group.totalQuantity}</td></tr>
      {group.items.map((item) => { serial += 1; return <tr key={item.id}><td>{serial}</td><td>{item.category}</td><td>{item.name}</td><td>{item.quantity}</td><td>{item.condition}</td><td>{item.amount == null ? "—" : item.amount.toLocaleString("ar-EG")}</td><td>{item.depreciationRate == null ? "—" : `${item.depreciationRate}%`}</td><td>{item.notes || ""}</td></tr>; })}
    </>
  )) : <tr><td colSpan={8} className="print-empty">لا توجد قطع مسجلة لهذه الشقة</td></tr>}</tbody></table><div className="print-notes"><b>ملاحظات عامة</b><p>{apartment?.notes || ""}</p></div><div className="print-signatures"><span>توقيع المستلم: ____________________</span><span>توقيع لجنة الجرد: ____________________</span></div><div className="print-footer">نظام سجل الميدان · مرتب حسب الفئات · صفحة <span className="page-number" /></div></div>;
}
