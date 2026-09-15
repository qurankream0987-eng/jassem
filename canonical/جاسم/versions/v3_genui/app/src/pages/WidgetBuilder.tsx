import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Code2,
  Eye,
  Copy,
  Check,
  ChevronLeft,
  Palette,
  Move,
  Maximize,
  MessageCircle,
  BarChart3,
  Sun,
  Moon,
  Sparkles,
  Smartphone,
  Monitor,
  Tablet,
} from "lucide-react";

type Theme = "light" | "dark" | "custom";
type Position = "bottom-right" | "bottom-left" | "top-right" | "top-left";
type BubbleStyle = "circle" | "rounded" | "square";
type BubbleSize = "sm" | "md" | "lg";

export default function WidgetBuilder() {
  const navigate = useNavigate();

  const [name, setName] = useState("ودجتي");
  const [theme, setTheme] = useState<Theme>("light");
  const [primaryColor, setPrimaryColor] = useState("#10b981");
  const [position, setPosition] = useState<Position>("bottom-right");
  const [bubbleSize, setBubbleSize] = useState<BubbleSize>("md");
  const [bubbleStyle, setBubbleStyle] = useState<BubbleStyle>("circle");
  const [greeting, setGreeting] = useState("مرحباً! كيف يمكنني مساعدتك؟");
  const [placeholder, setPlaceholder] = useState("اكتب رسالتك هنا...");
  const [chatWidth, setChatWidth] = useState(380);
  const [chatHeight, setChatHeight] = useState(520);
  const [apiKey, setApiKey] = useState("jsk_demo_xxxxxxxx");
  const [copied, setCopied] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");

  // Generate embed code
  const embedCode = useMemo(() => {
    const params = new URLSearchParams();
    params.set("api_key", apiKey);
    params.set("theme", theme);
    if (theme === "custom" || (theme !== "dark" && primaryColor !== "#10b981")) {
      params.set("primary_color", primaryColor);
    }
    params.set("position", position);
    params.set("bubble_size", String(
      bubbleSize === "sm" ? 48 : bubbleSize === "lg" ? 72 : 60
    ));
    params.set("bubble_style", bubbleStyle);
    params.set("greeting", greeting);
    params.set("placeholder", placeholder);
    params.set("lang", "ar");
    params.set("dir", "rtl");
    if (chatWidth !== 380) params.set("chat_width", String(chatWidth));
    if (chatHeight !== 520) params.set("chat_height", String(chatHeight));

    return `<!-- JASIM Chat Widget -->
<script src="https://jasim.ai/widget.js?${params.toString()}"></script>
<div id="jasim-bubble"></div>
<!-- End JASIM Chat Widget -->`;
  }, [apiKey, theme, primaryColor, position, bubbleSize, bubbleStyle, greeting, placeholder, chatWidth, chatHeight]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = embedCode;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Mock analytics data
  const analyticsData = [
    { date: "2024-01-01", impressions: 124, interactions: 45, conversions: 8 },
    { date: "2024-01-02", impressions: 156, interactions: 62, conversions: 12 },
    { date: "2024-01-03", impressions: 189, interactions: 78, conversions: 15 },
    { date: "2024-01-04", impressions: 143, interactions: 51, conversions: 9 },
    { date: "2024-01-05", impressions: 201, interactions: 89, conversions: 18 },
    { date: "2024-01-06", impressions: 267, interactions: 112, conversions: 24 },
    { date: "2024-01-07", impressions: 234, interactions: 98, conversions: 21 },
  ];

  const totalImpressions = analyticsData.reduce((s, d) => s + d.impressions, 0);
  const totalInteractions = analyticsData.reduce((s, d) => s + d.interactions, 0);
  const totalConversions = analyticsData.reduce((s, d) => s + d.conversions, 0);
  const interactionRate = Math.round((totalInteractions / totalImpressions) * 100);
  const conversionRate = Math.round((totalConversions / totalInteractions) * 100);

  const sizePx = bubbleSize === "sm" ? 48 : bubbleSize === "lg" ? 72 : 60;
  const borderRadius = bubbleStyle === "square" ? "12px" : bubbleStyle === "rounded" ? "16px" : "50%";

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-violet-100 rounded-lg">
                <Code2 className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">منشئ الودجت</h1>
                <p className="text-xs text-gray-500">إنشاء وإدارة الودجت المضمن</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPreviewOpen(!previewOpen)}
            >
              <Eye className="h-4 w-4 ml-1" />
              {previewOpen ? "إخفاء المعاينة" : "عرض المعاينة"}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-12 gap-6">
        {/* Settings Panel */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          {/* Basic Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-600" />
                الإعدادات الأساسية
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">اسم الودجت</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">مفتاح API</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">رسالة الترحيب</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">نص حقل الإدخال</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  value={placeholder}
                  onChange={(e) => setPlaceholder(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Theme Selector */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Palette className="h-4 w-4 text-amber-600" />
                المظهر
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Theme */}
              <div className="space-y-2">
                <label className="text-sm font-medium">السمة</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "light", label: "فاتح", icon: <Sun className="h-4 w-4" /> },
                    { key: "dark", label: "داكن", icon: <Moon className="h-4 w-4" /> },
                    { key: "custom", label: "مخصص", icon: <Sparkles className="h-4 w-4" /> },
                  ].map((t) => (
                    <button
                      key={t.key}
                      className={cn(
                        "flex flex-col items-center gap-1 p-3 rounded-xl border transition-all",
                        theme === t.key
                          ? "border-violet-500 bg-violet-50 text-violet-700"
                          : "border-gray-200 hover:border-gray-300",
                      )}
                      onClick={() => setTheme(t.key as Theme)}
                    >
                      {t.icon}
                      <span className="text-xs font-medium">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Primary Color */}
              {(theme === "custom" || theme === "light") && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">اللون الرئيسي</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-10 h-10 rounded-lg border cursor-pointer"
                    />
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="flex-1 px-3 py-2 border rounded-lg text-sm font-mono"
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Position & Size */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Move className="h-4 w-4 text-blue-600" />
                الموقع والحجم
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Position */}
              <div className="space-y-2">
                <label className="text-sm font-medium">موقع الفقاعة</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "bottom-right", label: "أسفل يمين" },
                    { key: "bottom-left", label: "أسفل يسار" },
                    { key: "top-right", label: "أعلى يمين" },
                    { key: "top-left", label: "أعلى يسار" },
                  ].map((p) => (
                    <button
                      key={p.key}
                      className={cn(
                        "p-2 rounded-lg border text-sm transition-all",
                        position === p.key
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 hover:border-gray-300",
                      )}
                      onClick={() => setPosition(p.key as Position)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bubble Size */}
              <div className="space-y-2">
                <label className="text-sm font-medium">حجم الفقاعة</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "sm", label: "صغير", px: 48 },
                    { key: "md", label: "متوسط", px: 60 },
                    { key: "lg", label: "كبير", px: 72 },
                  ].map((s) => (
                    <button
                      key={s.key}
                      className={cn(
                        "flex flex-col items-center gap-1 p-2 rounded-lg border transition-all",
                        bubbleSize === s.key
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 hover:border-gray-300",
                      )}
                      onClick={() => setBubbleSize(s.key as BubbleSize)}
                    >
                      <div
                        className="rounded-full bg-gray-300"
                        style={{
                          width: s.px * 0.4,
                          height: s.px * 0.4,
                        }}
                      />
                      <span className="text-xs">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Bubble Style */}
              <div className="space-y-2">
                <label className="text-sm font-medium">شكل الفقاعة</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "circle", label: "دائري" },
                    { key: "rounded", label: "مدور" },
                    { key: "square", label: "مربع" },
                  ].map((s) => (
                    <button
                      key={s.key}
                      className={cn(
                        "p-2 rounded-lg border text-sm transition-all flex flex-col items-center gap-1",
                        bubbleStyle === s.key
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 hover:border-gray-300",
                      )}
                      onClick={() => setBubbleStyle(s.key as BubbleStyle)}
                    >
                      <div
                        className="w-6 h-6 bg-gray-300"
                        style={{
                          borderRadius:
                            s.key === "circle" ? "50%" : s.key === "rounded" ? "8px" : "2px",
                        }}
                      />
                      <span className="text-xs">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Chat Dimensions */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">عرض الدردشة</label>
                  <input
                    type="number"
                    min={280}
                    max={600}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    value={chatWidth}
                    onChange={(e) => setChatWidth(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">ارتفاع الدردشة</label>
                  <input
                    type="number"
                    min={300}
                    max={800}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    value={chatHeight}
                    onChange={(e) => setChatHeight(Number(e.target.value))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Preview & Code Panel */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          {/* Live Preview */}
          {previewOpen && (
            <Card className="border-2 border-violet-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Eye className="h-4 w-4 text-violet-600" />
                    معاينة مباشرة
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    <button
                      className={cn(
                        "p-2 rounded-lg transition-all",
                        previewDevice === "desktop" ? "bg-violet-100 text-violet-700" : "text-gray-400 hover:text-gray-600",
                      )}
                      onClick={() => setPreviewDevice("desktop")}
                    >
                      <Monitor className="h-4 w-4" />
                    </button>
                    <button
                      className={cn(
                        "p-2 rounded-lg transition-all",
                        previewDevice === "tablet" ? "bg-violet-100 text-violet-700" : "text-gray-400 hover:text-gray-600",
                      )}
                      onClick={() => setPreviewDevice("tablet")}
                    >
                      <Tablet className="h-4 w-4" />
                    </button>
                    <button
                      className={cn(
                        "p-2 rounded-lg transition-all",
                        previewDevice === "mobile" ? "bg-violet-100 text-violet-700" : "text-gray-400 hover:text-gray-600",
                      )}
                      onClick={() => setPreviewDevice("mobile")}
                    >
                      <Smartphone className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div
                  className={cn(
                    "mx-auto border-2 border-dashed border-gray-300 rounded-2xl overflow-hidden relative bg-gray-100",
                    previewDevice === "desktop" ? "max-w-full h-[520px]" :
                    previewDevice === "tablet" ? "max-w-[600px] h-[480px]" :
                    "max-w-[320px] h-[500px]",
                  )}
                >
                  {/* Mock Website */}
                  <div className="h-full flex flex-col bg-white">
                    <div className="h-12 bg-gray-800 flex items-center px-4 gap-4">
                      <div className="w-20 h-4 bg-gray-600 rounded" />
                      <div className="flex-1" />
                      <div className="w-8 h-4 bg-gray-600 rounded" />
                      <div className="w-8 h-4 bg-gray-600 rounded" />
                    </div>
                    <div className="flex-1 p-4 space-y-3 overflow-hidden">
                      <div className="w-3/4 h-6 bg-gray-200 rounded" />
                      <div className="w-1/2 h-4 bg-gray-100 rounded" />
                      <div className="grid grid-cols-3 gap-3 mt-4">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <div key={i} className="bg-gray-50 rounded-lg p-3 space-y-2">
                            <div className="w-full h-16 bg-gray-200 rounded" />
                            <div className="w-3/4 h-3 bg-gray-200 rounded" />
                            <div className="w-1/2 h-3 bg-gray-100 rounded" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Preview Bubble */}
                  <div
                    className="absolute shadow-lg flex items-center justify-center"
                    style={{
                      width: sizePx,
                      height: sizePx,
                      background: primaryColor,
                      borderRadius,
                      ...(position === "bottom-right" ? { bottom: 20, right: 20 } :
                        position === "bottom-left" ? { bottom: 20, left: 20 } :
                        position === "top-right" ? { top: 60, right: 20 } :
                        { top: 60, left: 20 }),
                    }}
                  >
                    <MessageCircle className="text-white" style={{ width: sizePx * 0.4, height: sizePx * 0.4 }} />
                  </div>

                  {/* Preview Chat Window */}
                  <div
                    className="absolute bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border"
                    style={{
                      width: Math.min(chatWidth, previewDevice === "mobile" ? 280 : chatWidth),
                      height: Math.min(chatHeight, 400),
                      ...(position === "bottom-right" ? { bottom: sizePx + 30, right: 20 } :
                        position === "bottom-left" ? { bottom: sizePx + 30, left: 20 } :
                        position === "top-right" ? { top: sizePx + 70, right: 20 } :
                        { top: sizePx + 70, left: 20 }),
                    }}
                  >
                    {/* Header */}
                    <div
                      className="px-4 py-3 flex items-center justify-between"
                      style={{ background: theme === "dark" ? "#1f2937" : primaryColor }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                          <MessageCircle className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-white font-semibold text-sm">مساعد جاسم</span>
                      </div>
                      <button className="text-white/80 hover:text-white">
                        <Maximize className="w-4 h-4" />
                      </button>
                    </div>
                    {/* Messages */}
                    <div className="flex-1 p-3 space-y-3 overflow-hidden"
                      style={{ background: theme === "dark" ? "#1f2937" : "#f9fafb" }}
                    >
                      <div
                        className="max-w-[80%] p-3 rounded-2xl text-sm rounded-br-md"
                        style={{
                          background: theme === "dark" ? "#374151" : "#e5e7eb",
                          color: theme === "dark" ? "#f3f4f6" : "#374151",
                        }}
                      >
                        {greeting}
                      </div>
                      <div
                        className="max-w-[80%] p-3 rounded-2xl text-sm rounded-bl-md mr-auto"
                        style={{ background: primaryColor, color: "white" }}
                      >
                        مرحباً، أحتاج مساعدة في طلبي
                      </div>
                      <div
                        className="max-w-[80%] p-3 rounded-2xl text-sm rounded-br-md"
                        style={{
                          background: theme === "dark" ? "#374151" : "#e5e7eb",
                          color: theme === "dark" ? "#f3f4f6" : "#374151",
                        }}
                      >
                        بالتأكيد! ما رقم الطلب؟
                      </div>
                    </div>
                    {/* Input */}
                    <div className="p-3 border-t flex items-center gap-2" style={{ background: theme === "dark" ? "#1f2937" : "white" }}>
                      <input
                        type="text"
                        className="flex-1 px-4 py-2 rounded-full border text-sm"
                        style={{
                          background: theme === "dark" ? "#374151" : "white",
                          color: theme === "dark" ? "#f3f4f6" : "#1f2937",
                          borderColor: theme === "dark" ? "#4b5563" : "#d1d5db",
                        }}
                        placeholder={placeholder}
                        readOnly
                      />
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: primaryColor }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                          <line x1="22" y1="2" x2="11" y2="13" />
                          <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Embed Code */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Code2 className="h-4 w-4 text-emerald-600" />
                كود التضمين
              </CardTitle>
              <CardDescription>
                انسخ هذا الكود والصقه في موقعك
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <pre className="bg-gray-900 text-gray-100 p-4 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed">
                  {embedCode}
                </pre>
                <Button
                  size="sm"
                  className="absolute top-2 left-2 bg-gray-700 hover:bg-gray-600"
                  onClick={copyToClipboard}
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 ml-1" />
                      تم النسخ
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 ml-1" />
                      نسخ
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Badge variant="outline">HTML</Badge>
              <Badge variant="outline">Vanilla JS</Badge>
              <Badge variant="outline">لا يتطلب مكتبات</Badge>
              <Badge variant="outline" className="text-emerald-600">
                postMessage API
              </Badge>
            </CardFooter>
          </Card>

          {/* Analytics */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-blue-600" />
                تحليلات الاستخدام
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="text-center p-3 bg-blue-50 rounded-xl">
                  <p className="text-2xl font-bold text-blue-700">{totalImpressions}</p>
                  <p className="text-xs text-blue-500">مرات الظهور</p>
                </div>
                <div className="text-center p-3 bg-violet-50 rounded-xl">
                  <p className="text-2xl font-bold text-violet-700">{totalInteractions}</p>
                  <p className="text-xs text-violet-500">التفاعلات</p>
                </div>
                <div className="text-center p-3 bg-emerald-50 rounded-xl">
                  <p className="text-2xl font-bold text-emerald-700">{totalConversions}</p>
                  <p className="text-xs text-emerald-500">التحويلات</p>
                </div>
                <div className="text-center p-3 bg-amber-50 rounded-xl">
                  <p className="text-2xl font-bold text-amber-700">{interactionRate}%</p>
                  <p className="text-xs text-amber-500">معدل التفاعل</p>
                </div>
              </div>

              {/* Simple Bar Chart */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700">النشاط الأسبوعي</h4>
                <div className="flex items-end gap-1 h-32">
                  {analyticsData.map((d, i) => {
                    const maxVal = Math.max(...analyticsData.map((a) => a.impressions));
                    const h = (d.impressions / maxVal) * 100;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full flex flex-col gap-0.5">
                          <div
                            className="w-full bg-blue-200 rounded-t"
                            style={{ height: `${(d.impressions / maxVal) * 60}px` }}
                          />
                          <div
                            className="w-full bg-violet-300 rounded-t"
                            style={{ height: `${(d.interactions / maxVal) * 60}px` }}
                          />
                          <div
                            className="w-full bg-emerald-300 rounded-t"
                            style={{ height: `${(d.conversions / maxVal) * 60}px` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-400">
                          {d.date.slice(5)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-blue-200 rounded" />
                    <span>الظهور</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-violet-300 rounded" />
                    <span>التفاعل</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-emerald-300 rounded" />
                    <span>التحويل</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
