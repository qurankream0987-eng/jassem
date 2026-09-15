import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Plug,
  PlugZap,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Server,
  ShoppingBag,
  CreditCard,
  Store,
  UtensilsCrossed,
  ChevronLeft,
  Settings,
  LogOut,
  ClipboardList,
  Activity,
} from "lucide-react";

const systemIcons: Record<string, React.ReactNode> = {
  toast: <UtensilsCrossed className="h-5 w-5" />,
  square: <CreditCard className="h-5 w-5" />,
  clover: <ShoppingBag className="h-5 w-5" />,
  shopify: <Store className="h-5 w-5" />,
  woocommerce: <Store className="h-5 w-5" />,
  magento: <Store className="h-5 w-5" />,
  stripe: <CreditCard className="h-5 w-5" />,
  paypal: <CreditCard className="h-5 w-5" />,
  custom_api: <Server className="h-5 w-5" />,
  other: <Server className="h-5 w-5" />,
};

const systemLabelsAr: Record<string, string> = {
  toast: "Toast POS",
  square: "Square",
  clover: "Clover",
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  magento: "Magento",
  stripe: "Stripe",
  paypal: "PayPal",
  custom_api: "API مخصص",
  other: "أخرى",
};

const statusBadgeAr = {
  idle: { label: "جاهز", variant: "secondary" as const },
  syncing: { label: "جاري المزامنة", variant: "default" as const },
  success: { label: "تم", variant: "secondary" as const },
  error: { label: "خطأ", variant: "destructive" as const },
};

type ConnectFormData = {
  name: string;
  systemType: string;
  apiKey: string;
  apiSecret: string;
  apiEndpoint: string;
  merchantId: string;
  shopDomain: string;
  locationId: string;
};

export default function ConnectDashboard() {
  const navigate = useNavigate();
  const merchantId = 1; // In production, from auth context

  const [showAddForm, setShowAddForm] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [selectedSystem, setSelectedSystem] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const systemsQuery = trpc.smartconnect.listSystems.useQuery({
    merchantId,
  });
  const logsQuery = trpc.smartconnect.getLogs.useQuery(
    { limit: 50 },
    { enabled: !!selectedSystem },
  );

  const connectMutation = trpc.smartconnect.connect.useMutation({
    onSuccess: () => {
      utils.smartconnect.listSystems.invalidate();
      setShowAddForm(false);
      resetForm();
    },
  });
  const disconnectMutation = trpc.smartconnect.disconnect.useMutation({
    onSuccess: () => utils.smartconnect.listSystems.invalidate(),
  });
  const syncMutation = trpc.smartconnect.sync.useMutation({
    onSuccess: () => {
      utils.smartconnect.listSystems.invalidate();
      utils.smartconnect.getLogs.invalidate();
      setSyncingId(null);
    },
    onError: () => setSyncingId(null),
  });
  const testMutation = trpc.smartconnect.testConnection.useMutation({
    onSuccess: () => setTestingId(null),
    onError: () => setTestingId(null),
  });

  const [form, setForm] = useState<ConnectFormData>({
    name: "",
    systemType: "toast",
    apiKey: "",
    apiSecret: "",
    apiEndpoint: "",
    merchantId: "",
    shopDomain: "",
    locationId: "",
  });

  function resetForm() {
    setForm({
      name: "",
      systemType: "toast",
      apiKey: "",
      apiSecret: "",
      apiEndpoint: "",
      merchantId: "",
      shopDomain: "",
      locationId: "",
    });
  }

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    const config: Record<string, unknown> = {};
    if (form.merchantId) config.merchantId = form.merchantId;
    if (form.shopDomain) config.shopDomain = form.shopDomain;
    if (form.locationId) config.locationId = form.locationId;
    if (form.apiEndpoint) config.apiEndpoint = form.apiEndpoint;

    connectMutation.mutate({
      merchantId,
      name: form.name,
      systemType: form.systemType as "toast" | "square" | "clover" | "shopify" | "woocommerce" | "magento" | "stripe" | "paypal" | "custom_api" | "other",
      apiKey: form.apiKey || undefined,
      apiSecret: form.apiSecret || undefined,
      apiEndpoint: form.apiEndpoint || undefined,
      config,
    });
  }

  function handleDisconnect(systemId: number) {
    if (confirm("هل أنت متأكد من فصل الاتصال؟")) {
      disconnectMutation.mutate({ systemId, merchantId });
    }
  }

  function handleSync(systemId: number) {
    setSyncingId(systemId);
    syncMutation.mutate({ systemId, operation: "full_sync" });
  }

  function handleTest(systemId: number) {
    setTestingId(systemId);
    testMutation.mutate({ systemId });
  }

  const systems = systemsQuery.data || [];

  // Sample mock data for connectors display
  const connectorStats = [
    {
      systemType: "toast",
      label: "Toast POS",
      description: "ربط مع نظام Toast لمطاعمك",
      endpoint: "https://api.toasttab.com/",
      authType: "Bearer Token",
    },
    {
      systemType: "square",
      label: "Square",
      description: "ربط مع Square للمدفوعات والمنتجات",
      endpoint: "https://connect.squareup.com/",
      authType: "Square-Application-Secret",
    },
    {
      systemType: "clover",
      label: "Clover",
      description: "ربط مع Clover POS",
      endpoint: "https://api.clover.com/",
      authType: "API Token",
    },
    {
      systemType: "shopify",
      label: "Shopify",
      description: "ربط مع متجر Shopify",
      endpoint: "https://{shop}.myshopify.com/admin/api/2024-01/",
      authType: "Access Token",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <Plug className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">لوحة الربط الذكي</h1>
                <p className="text-xs text-gray-500">إدارة اتصالات الأنظمة الخارجية</p>
              </div>
            </div>
          </div>
          <Button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Plug className="h-4 w-4 ml-2" />
            ربط نظام جديد
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-emerald-500">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-emerald-50 rounded-lg">
                <Server className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{systems.length}</p>
                <p className="text-xs text-gray-500">الأنظمة المتصلة</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <RefreshCw className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {systems.filter((s) => s.syncStatus === "success").length}
                </p>
                <p className="text-xs text-gray-500">المزامنة الناجحة</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-amber-500">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-amber-50 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {systems.filter((s) => s.syncStatus === "error").length}
                </p>
                <p className="text-xs text-gray-500">أخطاء المزامنة</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-purple-500">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-purple-50 rounded-lg">
                <Activity className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {systems.filter((s) => s.isActive).length}
                </p>
                <p className="text-xs text-gray-500">الأنظمة النشطة</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Add System Form */}
        {showAddForm && (
          <Card className="border-2 border-emerald-200 bg-emerald-50/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Plug className="h-5 w-5 text-emerald-600" />
                ربط نظام جديد
              </CardTitle>
              <CardDescription>
                أدخل بيانات الاتصال لنظام نقاط البيع الخارجي
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleConnect} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">اسم الاتصال</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                      placeholder="مثال: فرع الدسمة - Toast"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">نوع النظام</label>
                    <select
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                      value={form.systemType}
                      onChange={(e) => setForm({ ...form, systemType: e.target.value })}
                    >
                      {connectorStats.map((c) => (
                        <option key={c.systemType} value={c.systemType}>
                          {c.label}
                        </option>
                      ))}
                      <option value="woocommerce">WooCommerce</option>
                      <option value="magento">Magento</option>
                      <option value="stripe">Stripe</option>
                      <option value="paypal">PayPal</option>
                      <option value="custom_api">API مخصص</option>
                      <option value="other">أخرى</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">مفتاح API</label>
                    <input
                      type="password"
                      className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                      placeholder="أدخل مفتاح API"
                      value={form.apiKey}
                      onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">سر API (اختياري)</label>
                    <input
                      type="password"
                      className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                      placeholder="أدخل سر API"
                      value={form.apiSecret}
                      onChange={(e) => setForm({ ...form, apiSecret: e.target.value })}
                    />
                  </div>
                </div>

                {form.systemType === "clover" && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">معرف التاجر (Merchant ID)</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                      placeholder="مثال: ABC123DEF"
                      value={form.merchantId}
                      onChange={(e) => setForm({ ...form, merchantId: e.target.value })}
                    />
                  </div>
                )}

                {form.systemType === "shopify" && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">نطاق المتجر</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                      placeholder="مثال: my-store"
                      value={form.shopDomain}
                      onChange={(e) => setForm({ ...form, shopDomain: e.target.value })}
                    />
                    <p className="text-xs text-gray-500">
                      سيكون الرابط: https://{form.shopDomain || "my-store"}.myshopify.com
                    </p>
                  </div>
                )}

                {form.systemType === "square" && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">معرف الموقع (Location ID)</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                      placeholder="مثال: L123ABC"
                      value={form.locationId}
                      onChange={(e) => setForm({ ...form, locationId: e.target.value })}
                    />
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button
                    type="submit"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={connectMutation.isPending}
                  >
                    {connectMutation.isPending ? (
                      <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                    ) : (
                      <Plug className="h-4 w-4 ml-2" />
                    )}
                    {connectMutation.isPending ? "جاري الربط..." : "ربط النظام"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowAddForm(false)}>
                    إلغاء
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Available Connectors */}
        {!showAddForm && systems.length === 0 && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-4">الأنظمة المتاحة للربط</h2>
            <div className="grid grid-cols-2 gap-4">
              {connectorStats.map((conn) => (
                <Card
                  key={conn.systemType}
                  className="cursor-pointer hover:shadow-lg transition-shadow border hover:border-emerald-300"
                  onClick={() => {
                    setForm({ ...form, systemType: conn.systemType });
                    setShowAddForm(true);
                  }}
                >
                  <CardContent className="p-4 flex items-start gap-4">
                    <div className="p-3 bg-gray-100 rounded-xl">
                      {systemIcons[conn.systemType] || <Server className="h-5 w-5" />}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-gray-900">{conn.label}</h3>
                      <p className="text-sm text-gray-500 mt-1">{conn.description}</p>
                      <div className="flex gap-2 mt-3">
                        <Badge variant="outline" className="text-xs">
                          {conn.authType}
                        </Badge>
                        <Badge variant="outline" className="text-xs font-mono">
                          {conn.endpoint}
                        </Badge>
                      </div>
                    </div>
                    <Plug className="h-5 w-5 text-emerald-500" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Connected Systems */}
        {systems.length > 0 && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-4">الأنظمة المتصلة</h2>
            <div className="space-y-3">
              {systems.map((system) => {
                const status = statusBadgeAr[system.syncStatus as keyof typeof statusBadgeAr] || statusBadgeAr.idle;
                const isSyncing = syncingId === system.id;
                const isTesting = testingId === system.id;

                return (
                  <Card
                    key={system.id}
                    className={cn(
                      "transition-all",
                      selectedSystem === system.id ? "border-emerald-400 ring-1 ring-emerald-200" : "",
                    )}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "p-2.5 rounded-xl",
                              system.isActive ? "bg-emerald-50" : "bg-gray-100",
                            )}
                          >
                            {systemIcons[system.systemType] || <Server className="h-5 w-5" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-gray-900">{system.name}</h3>
                              <Badge variant={system.isActive ? "default" : "outline"}>
                                {system.isActive ? "نشط" : "غير نشط"}
                              </Badge>
                              <Badge variant={status.variant}>{status.label}</Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                              <span>{systemLabelsAr[system.systemType] || system.systemType}</span>
                              {system.apiEndpoint && (
                                <span className="font-mono">{system.apiEndpoint}</span>
                              )}
                              {system.lastSyncAt && (
                                <span>
                                  آخر مزامنة:{" "}
                                  {new Date(system.lastSyncAt).toLocaleString("ar-KW")}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTest(system.id!)}
                            disabled={isTesting}
                          >
                            {isTesting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            <span className="mr-1">اختبار</span>
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSync(system.id!)}
                            disabled={isSyncing}
                          >
                            {isSyncing ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            <span className="mr-1">
                              {isSyncing ? "جاري..." : "مزامنة"}
                            </span>
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedSystem(selectedSystem === system.id ? null : system.id!)}
                          >
                            <ClipboardList className="h-3.5 w-3.5" />
                            <span className="mr-1">السجلات</span>
                          </Button>

                          {system.isActive ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => handleDisconnect(system.id!)}
                              disabled={disconnectMutation.isPending}
                            >
                              <LogOut className="h-3.5 w-3.5" />
                              <span className="mr-1">فصل</span>
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" disabled>
                              <XCircle className="h-3.5 w-3.5" />
                              <span className="mr-1">غير متصل</span>
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Test Result */}
                      {testMutation.data && testingId === null && (
                        <div
                          className={cn(
                            "mt-3 p-3 rounded-lg text-sm",
                            testMutation.data.success
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700",
                          )}
                        >
                          {testMutation.data.message}
                          {testMutation.data.latency && (
                            <span className="mr-2">({testMutation.data.latency}ms)</span>
                          )}
                        </div>
                      )}

                      {/* Logs Panel */}
                      {selectedSystem === system.id && (
                        <div className="mt-4 pt-4 border-t">
                          <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                            <ClipboardList className="h-4 w-4" />
                            سجلات المزامنة
                          </h4>
                          {logsQuery.isLoading ? (
                            <div className="text-center py-4">
                              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                            </div>
                          ) : logsQuery.data && logsQuery.data.length > 0 ? (
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                              {logsQuery.data.map((log) => (
                                <div
                                  key={log.id}
                                  className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-sm"
                                >
                                  <div className="flex items-center gap-2">
                                    {log.status === "success" ? (
                                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                    ) : (
                                      <XCircle className="h-4 w-4 text-red-500" />
                                    )}
                                    <span>{log.operation}</span>
                                  </div>
                                  <div className="flex items-center gap-3 text-xs text-gray-500">
                                    <span>{log.recordsCount} سجل</span>
                                    <span>{new Date(log.createdAt).toLocaleString("ar-KW")}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400 text-center py-4">
                              لا توجد سجلات مزامنة
                            </p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Connector Info */}
        {systems.length > 0 && (
          <Card className="bg-blue-50/50 border-blue-200">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4 text-blue-600" />
                إضافة نظام جديد
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-3">
                {connectorStats.map((conn) => {
                  const alreadyConnected = systems.some(
                    (s) => s.systemType === conn.systemType && s.isActive,
                  );
                  return (
                    <button
                      key={conn.systemType}
                      className={cn(
                        "p-3 rounded-xl border text-right transition-all",
                        alreadyConnected
                          ? "bg-emerald-50 border-emerald-200 opacity-60 cursor-not-allowed"
                          : "bg-white hover:border-emerald-300 hover:shadow-sm",
                      )}
                      onClick={() => {
                        if (!alreadyConnected) {
                          setForm({ ...form, systemType: conn.systemType });
                          setShowAddForm(true);
                        }
                      }}
                      disabled={alreadyConnected}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {systemIcons[conn.systemType]}
                        <span className="font-bold text-sm">{conn.label}</span>
                        {alreadyConnected && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                      </div>
                      <p className="text-xs text-gray-500">{conn.description}</p>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
