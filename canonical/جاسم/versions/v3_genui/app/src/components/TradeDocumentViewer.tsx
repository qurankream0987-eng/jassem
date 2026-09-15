import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  FileText,
  Receipt,
  Globe,
  Package,
  ClipboardList,
  Landmark,
  Download,
  Printer,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileCheck,
  Stamp,
  Send,
  Shield,
} from "lucide-react";

type DocumentType =
  | "proforma"
  | "commercial"
  | "origin"
  | "customs"
  | "packing"
  | "murabaha";

interface DocumentConfig {
  type: DocumentType;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

const documents: DocumentConfig[] = [
  {
    type: "proforma",
    label: "فاتورة بروفورما",
    description: "فاتورة أولية غير ملزمة لعرض الأسعار",
    icon: <Receipt className="h-5 w-5" />,
    color: "text-blue-600",
    bgColor: "bg-blue-50 border-blue-200",
  },
  {
    type: "commercial",
    label: "الفاتورة التجارية",
    description: "فاتورة رسمية للبضائع المباعة",
    icon: <FileText className="h-5 w-5" />,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50 border-emerald-200",
  },
  {
    type: "origin",
    label: "شهادة المنشأ",
    description: "تثبت بلد تصنيع المنتج",
    icon: <Globe className="h-5 w-5" />,
    color: "text-violet-600",
    bgColor: "bg-violet-50 border-violet-200",
  },
  {
    type: "customs",
    label: "إقرار جمركي",
    description: "إقرار التخليص الجمركي الرسمي",
    icon: <Landmark className="h-5 w-5" />,
    color: "text-amber-600",
    bgColor: "bg-amber-50 border-amber-200",
  },
  {
    type: "packing",
    label: "قائمة التعبئة",
    description: "تفاصيل محتويات كل علبة",
    icon: <Package className="h-5 w-5" />,
    color: "text-cyan-600",
    bgColor: "bg-cyan-50 border-cyan-200",
  },
  {
    type: "murabaha",
    label: "عقد المرابحة",
    description: "عقد التمويل الإسلامي للصفقة",
    icon: <Scale className="h-5 w-5" />,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50 border-emerald-200",
  },
];

// Proforma Invoice Content
function ProformaContent() {
  return (
    <div className="space-y-4">
      <div className="text-center border-b pb-4">
        <h3 className="text-xl font-bold">فاتورة بروفورما</h3>
        <p className="text-sm text-gray-500">Proforma Invoice</p>
        <p className="text-sm text-gray-500 mt-1">رقم: PI-2024-001 | التاريخ: {new Date().toLocaleDateString("ar-KW")}</p>
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="font-bold text-gray-700">البائع / المُصدر:</p>
          <p>شركة الصادرات العربية</p>
          <p>الرياض، المملكة العربية السعودية</p>
          <p>السجل التجاري: 1010123456</p>
        </div>
        <div>
          <p className="font-bold text-gray-700">المشتري / المستورد:</p>
          <p>شركة الواردات الكويتية</p>
          <p>الكويت</p>
          <p>السجل التجاري: 123456789</p>
        </div>
      </div>
      <table className="w-full text-sm border rounded-lg overflow-hidden">
        <thead className="bg-gray-50">
          <tr>
            <th className="p-2 border text-right">#</th>
            <th className="p-2 border text-right">الوصف</th>
            <th className="p-2 border text-center">الكمية</th>
            <th className="p-2 border text-center">سعر الوحدة</th>
            <th className="p-2 border text-center">المجموع</th>
          </tr>
        </thead>
        <tbody>
          <tr><td className="p-2 border">1</td><td className="p-2 border">منتج أ</td><td className="p-2 border text-center">100</td><td className="p-2 border text-center">10.000</td><td className="p-2 border text-center">1,000.000</td></tr>
          <tr><td className="p-2 border">2</td><td className="p-2 border">منتج ب</td><td className="p-2 border text-center">200</td><td className="p-2 border text-center">15.000</td><td className="p-2 border text-center">3,000.000</td></tr>
          <tr><td className="p-2 border">3</td><td className="p-2 border">منتج ج</td><td className="p-2 border text-center">50</td><td className="p-2 border text-center">20.000</td><td className="p-2 border text-center">1,000.000</td></tr>
        </tbody>
      </table>
      <div className="flex justify-end">
        <div className="w-64 space-y-1 text-sm">
          <div className="flex justify-between"><span>المجموع:</span><span>5,000.000 د.ك</span></div>
          <div className="flex justify-between"><span>الخصم (5%):</span><span className="text-red-600">-250.000 د.ك</span></div>
          <div className="flex justify-between font-bold border-t pt-1"><span>الصافي:</span><span>4,750.000 د.ك</span></div>
        </div>
      </div>
      <div className="text-xs text-gray-500 bg-gray-50 p-3 rounded-lg">
        <p className="font-bold">ملاحظة:</p>
        <p>هذه فاتورة بروفورما غير ملزمة وليست طلباً رسمياً. الأسعار قابلة للتغيير.</p>
      </div>
    </div>
  );
}

// Commercial Invoice Content
function CommercialContent() {
  return (
    <div className="space-y-4">
      <div className="text-center border-b pb-4">
        <h3 className="text-xl font-bold">الفاتورة التجارية</h3>
        <p className="text-sm text-gray-500">Commercial Invoice</p>
        <p className="text-sm text-gray-500 mt-1">رقم: CI-2024-001 | التاريخ: {new Date().toLocaleDateString("ar-KW")}</p>
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="font-bold text-gray-700">المُصدر:</p>
          <p>شركة الصادرات العربية</p>
          <p>الرياض، المملكة العربية السعودية</p>
          <p>الرقم الضريبي: 310XXXXXXXX</p>
        </div>
        <div>
          <p className="font-bold text-gray-700">المستورد:</p>
          <p>شركة الواردات الكويتية</p>
          <p>الكويت</p>
          <p>الرقم الضريبي: 300XXXXXXXX</p>
        </div>
      </div>
      <table className="w-full text-sm border rounded-lg overflow-hidden">
        <thead className="bg-emerald-50">
          <tr>
            <th className="p-2 border text-right">#</th>
            <th className="p-2 border text-right">الوصف</th>
            <th className="p-2 border text-center">الكمية</th>
            <th className="p-2 border text-center">الوزن</th>
            <th className="p-2 border text-center">سعر الوحدة</th>
            <th className="p-2 border text-center">المجموع</th>
          </tr>
        </thead>
        <tbody>
          <tr><td className="p-2 border">1</td><td className="p-2 border">منتج أ - دفعة 1</td><td className="p-2 border text-center">100</td><td className="p-2 border text-center">500kg</td><td className="p-2 border text-center">10.000</td><td className="p-2 border text-center">1,000.000</td></tr>
          <tr><td className="p-2 border">2</td><td className="p-2 border">منتج ب - دفعة 1</td><td className="p-2 border text-center">200</td><td className="p-2 border text-center">800kg</td><td className="p-2 border text-center">15.000</td><td className="p-2 border text-center">3,000.000</td></tr>
        </tbody>
      </table>
      <div className="flex justify-end">
        <div className="w-64 space-y-1 text-sm">
          <div className="flex justify-between"><span>المجموع الفرعي:</span><span>4,000.000 د.ك</span></div>
          <div className="flex justify-between"><span>الشحن:</span><span>150.000 د.ك</span></div>
          <div className="flex justify-between"><span>التأمين:</span><span>50.000 د.ك</span></div>
          <div className="flex justify-between font-bold border-t pt-1"><span>الإجمالي:</span><span className="text-emerald-700">4,200.000 د.ك</span></div>
        </div>
      </div>
    </div>
  );
}

// Certificate of Origin
function OriginContent() {
  return (
    <div className="space-y-4">
      <div className="text-center border-b pb-4">
        <h3 className="text-xl font-bold">شهادة منشأ</h3>
        <p className="text-sm text-gray-500">Certificate of Origin</p>
        <p className="text-sm text-gray-500 mt-1">رقم: CO-2024-001</p>
      </div>
      <div className="border-2 border-violet-200 rounded-xl p-6 space-y-4">
        <div className="text-center">
          <Badge className="bg-violet-100 text-violet-700">شهادة رسمية</Badge>
        </div>
        <p className="text-sm leading-relaxed">
          نشهد بأن البضائع المذكورة أدناه منشأها المملكة العربية السعودية،
          وأنها تم تصنيعها/إنتاجها في المنشآت التابعة للشركة المذكورة أدناه.
        </p>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            <p className="font-bold text-gray-700">اسم المصدر:</p>
            <p>شركة الصادرات العربية</p>
          </div>
          <div className="space-y-2">
            <p className="font-bold text-gray-700">بلد المنشأ:</p>
            <p>المملكة العربية السعودية</p>
          </div>
          <div className="space-y-2">
            <p className="font-bold text-gray-700">رقم الفاتورة:</p>
            <p className="font-mono">CI-2024-001</p>
          </div>
          <div className="space-y-2">
            <p className="font-bold text-gray-700">التاريخ:</p>
            <p>{new Date().toLocaleDateString("ar-KW")}</p>
          </div>
        </div>
        <table className="w-full text-sm border rounded-lg overflow-hidden">
          <thead className="bg-violet-50">
            <tr><th className="p-2 border text-right">المنتج</th><th className="p-2 border text-center">رمز HS</th><th className="p-2 border text-center">بلد المنشأ</th></tr>
          </thead>
          <tbody>
            <tr><td className="p-2 border">منتج أ</td><td className="p-2 border text-center font-mono">6109.10</td><td className="p-2 border text-center">المملكة العربية السعودية</td></tr>
            <tr><td className="p-2 border">منتج ب</td><td className="p-2 border text-center font-mono">6203.42</td><td className="p-2 border text-center">المملكة العربية السعودية</td></tr>
          </tbody>
        </table>
        <div className="text-center text-xs text-gray-500 pt-4">
          <p>تصدر هذه الشهادة من غرفة التجارة والصناعة</p>
        </div>
      </div>
    </div>
  );
}

// Customs Declaration
function CustomsContent() {
  return (
    <div className="space-y-4">
      <div className="text-center border-b pb-4">
        <h3 className="text-xl font-bold">إقرار جمركي</h3>
        <p className="text-sm text-gray-500">Customs Declaration</p>
        <p className="text-sm text-gray-500 mt-1">رقم: CD-2024-001</p>
      </div>
      <div className="border-2 border-amber-200 rounded-xl p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-bold text-gray-700">المستورد:</p>
            <p>شركة الواردات الكويتية</p>
            <p>رقم السجل: 123456789</p>
          </div>
          <div>
            <p className="font-bold text-gray-700">ميناء الدخول:</p>
            <p>ميناء الشويخ - الكويت</p>
          </div>
          <div>
            <p className="font-bold text-gray-700">بلد المصدر:</p>
            <p>المملكة العربية السعودية</p>
          </div>
          <div>
            <p className="font-bold text-gray-700">طريقة النقل:</p>
            <p>شاحنات برية</p>
          </div>
        </div>
        <table className="w-full text-sm border rounded-lg overflow-hidden">
          <thead className="bg-amber-50">
            <tr>
              <th className="p-2 border text-right">المنتج</th>
              <th className="p-2 border text-center">رمز HS</th>
              <th className="p-2 border text-center">الكمية</th>
              <th className="p-2 border text-center">القيمة</th>
              <th className="p-2 border text-center">الرسوم (5%)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="p-2 border">منتج أ</td>
              <td className="p-2 border text-center font-mono">6109.10</td>
              <td className="p-2 border text-center">100</td>
              <td className="p-2 border text-center">1,000.000</td>
              <td className="p-2 border text-center">50.000</td>
            </tr>
            <tr>
              <td className="p-2 border">منتج ب</td>
              <td className="p-2 border text-center font-mono">6203.42</td>
              <td className="p-2 border text-center">200</td>
              <td className="p-2 border text-center">3,000.000</td>
              <td className="p-2 border text-center">150.000</td>
            </tr>
          </tbody>
        </table>
        <div className="flex justify-between items-center p-3 bg-amber-50 rounded-lg">
          <span className="font-bold">إجمالي الرسوم الجمركية:</span>
          <span className="text-xl font-bold text-amber-700">200.000 د.ك</span>
        </div>
      </div>
    </div>
  );
}

// Packing List
function PackingContent() {
  return (
    <div className="space-y-4">
      <div className="text-center border-b pb-4">
        <h3 className="text-xl font-bold">قائمة التعبئة</h3>
        <p className="text-sm text-gray-500">Packing List</p>
        <p className="text-sm text-gray-500 mt-1">رقم: PL-2024-001</p>
      </div>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="p-3 bg-cyan-50 rounded-lg">
          <p className="text-xs text-cyan-600">إجمالي الطرود</p>
          <p className="font-bold text-lg">5</p>
        </div>
        <div className="p-3 bg-cyan-50 rounded-lg">
          <p className="text-xs text-cyan-600">الوزن الإجمالي</p>
          <p className="font-bold text-lg">1,300 kg</p>
        </div>
        <div className="p-3 bg-cyan-50 rounded-lg">
          <p className="text-xs text-cyan-600">الحجم</p>
          <p className="font-bold text-lg">2.5 m³</p>
        </div>
      </div>
      <table className="w-full text-sm border rounded-lg overflow-hidden">
        <thead className="bg-cyan-50">
          <tr>
            <th className="p-2 border text-right">الطرد</th>
            <th className="p-2 border text-right">المحتويات</th>
            <th className="p-2 border text-center">الكمية</th>
            <th className="p-2 border text-center">الوزن</th>
            <th className="p-2 border text-center">الأبعاد</th>
          </tr>
        </thead>
        <tbody>
          <tr><td className="p-2 border">1 من 5</td><td className="p-2 border">منتج أ</td><td className="p-2 border text-center">50</td><td className="p-2 border text-center">250 kg</td><td className="p-2 border text-center">100×80×60</td></tr>
          <tr><td className="p-2 border">2 من 5</td><td className="p-2 border">منتج أ</td><td className="p-2 border text-center">50</td><td className="p-2 border text-center">250 kg</td><td className="p-2 border text-center">100×80×60</td></tr>
          <tr><td className="p-2 border">3 من 5</td><td className="p-2 border">منتج ب</td><td className="p-2 border text-center">100</td><td className="p-2 border text-center">400 kg</td><td className="p-2 border text-center">120×100×70</td></tr>
          <tr><td className="p-2 border">4 من 5</td><td className="p-2 border">منتج ب</td><td className="p-2 border text-center">100</td><td className="p-2 border text-center">400 kg</td><td className="p-2 border text-center">120×100×70</td></tr>
        </tbody>
      </table>
    </div>
  );
}

// Murabaha Agreement
function MurabahaContent() {
  return (
    <div className="space-y-4">
      <div className="text-center border-b pb-4">
        <h3 className="text-xl font-bold">عقد المرابحة الإسلامية</h3>
        <p className="text-sm text-gray-500">Murabaha Agreement</p>
        <p className="text-sm text-gray-500 mt-1">رقم: MA-2024-001</p>
      </div>
      <div className="border-2 border-emerald-200 rounded-xl p-6 space-y-4 bg-emerald-50/10">
        <div className="text-center">
          <Badge className="bg-emerald-100 text-emerald-700">
            <Shield className="h-3 w-3 ml-1" />
            عقد إسلامي معتمد
          </Badge>
        </div>

        <div className="text-sm space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-white rounded-lg border">
              <p className="font-bold text-gray-700 mb-1">الطرف الأول (البائع/الممول):</p>
              <p>شركة التمويل الإسلامي</p>
              <p className="text-xs text-gray-500">ترخيص: 45/أ/2024</p>
            </div>
            <div className="p-3 bg-white rounded-lg border">
              <p className="font-bold text-gray-700 mb-1">الطرف الثاني (المشتري):</p>
              <p>شركة الواردات الكويتية</p>
              <p className="text-xs text-gray-500">السجل: 123456789</p>
            </div>
          </div>

          <div className="p-4 bg-white rounded-lg border space-y-3">
            <p className="font-bold text-emerald-700">تفاصيل الصفقة:</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">سعر التكلفة:</span> <span className="font-bold">4,200.000 د.ك</span></div>
              <div><span className="text-gray-500">نسبة الربح:</span> <span className="font-bold">10%</span></div>
              <div><span className="text-gray-500">سعر البيع:</span> <span className="font-bold">4,620.000 د.ك</span></div>
              <div><span className="text-gray-500">مدة التقسيط:</span> <span className="font-bold">12 شهر</span></div>
              <div><span className="text-gray-500">القسط الشهري:</span> <span className="font-bold">385.000 د.ك</span></div>
              <div><span className="text-gray-500">إجمالي الربح:</span> <span className="font-bold">420.000 د.ك</span></div>
            </div>
          </div>

          <div className="p-4 bg-white rounded-lg border">
            <p className="font-bold text-emerald-700 mb-2">بنود العقد:</p>
            <ol className="space-y-2 text-sm list-decimal list-inside">
              <li>يلتزم الطرف الأول بشراء البضاعة وامتلاكها قبل إعادة بيعها للطرف الثاني.</li>
              <li>يلتزم الطرف الثاني بشراء البضاعة من الطرف الأول بسعر البيع المتفق عليه.</li>
              <li>يتم سداد ثمن البضاعة على أقساط شهرية متساوية قدرها 385.000 د.ك.</li>
              <li>لا يوجد فائدة مركبة أو رسوم تأخير إضافية.</li>
              <li>في حالة التأخر عن السداد، يُمنح الطرف الثاني مهلة سماح 15 يوماً.</li>
              <li>يحق للطرف الأول مطالبة الطرف الثاني بالسداد المبكر بدون أي رسوم.</li>
            </ol>
          </div>

          <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
            <p className="text-xs text-emerald-700 font-medium text-center">
              هذا العقد مُعد وفقاً لأحكام الشريعة الإسلامية وتحت إشراف هيئة الرقابة الشرعية
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Scale({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="M7 21h10" />
      <path d="M12 3v18" />
      <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </svg>
  );
}

export default function TradeDocumentViewer() {
  const [activeDoc, setActiveDoc] = useState<DocumentType>("proforma");

  const activeConfig = documents.find((d) => d.type === activeDoc) || documents[0];

  const renderDocument = () => {
    switch (activeDoc) {
      case "proforma": return <ProformaContent />;
      case "commercial": return <CommercialContent />;
      case "origin": return <OriginContent />;
      case "customs": return <CustomsContent />;
      case "packing": return <PackingContent />;
      case "murabaha": return <MurabahaContent />;
      default: return <ProformaContent />;
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-indigo-600" />
            وثائق التجارة الدولية
          </CardTitle>
          <CardDescription>
            عرض وإدارة وثائق التجارة والشحن الدولي
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Document Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {documents.map((doc) => (
              <button
                key={doc.type}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all whitespace-nowrap",
                  activeDoc === doc.type
                    ? cn(doc.bgColor, "border-2")
                    : "bg-white border-gray-200 hover:border-gray-300",
                )}
                onClick={() => setActiveDoc(doc.type)}
              >
                <span className={cn(activeDoc === doc.type ? doc.color : "text-gray-500")}>
                  {doc.icon}
                </span>
                <div className="text-right">
                  <span className={cn(
                    "text-sm font-medium block",
                    activeDoc === doc.type ? doc.color : "text-gray-700",
                  )}>
                    {doc.label}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {/* Active Document Info */}
          <div className={cn("p-3 rounded-lg border", activeConfig.bgColor)}>
            <div className="flex items-center gap-2">
              <span className={activeConfig.color}>{activeConfig.icon}</span>
              <div>
                <p className="font-bold text-sm">{activeConfig.label}</p>
                <p className="text-xs text-gray-500">{activeConfig.description}</p>
              </div>
              <div className="mr-auto">
                <Badge variant="outline" className="text-xs">
                  <CheckCircle2 className="h-3 w-3 ml-1" />
                  جاهز
                </Badge>
              </div>
            </div>
          </div>

          {/* Document Content */}
          <Card className="border">
            <CardContent className="p-6">
              {renderDocument()}
            </CardContent>
          </Card>

          {/* Navigation */}
          <div className="flex justify-between">
            <Button
              variant="outline"
              disabled={documents.indexOf(activeConfig) === 0}
              onClick={() => {
                const idx = documents.findIndex((d) => d.type === activeDoc);
                if (idx > 0) setActiveDoc(documents[idx - 1].type);
              }}
            >
              <ChevronRight className="h-4 w-4 ml-2" />
              السابق
            </Button>
            <div className="flex gap-1">
              {documents.map((doc, i) => (
                <button
                  key={doc.type}
                  className={cn(
                    "w-2.5 h-2.5 rounded-full transition-all",
                    activeDoc === doc.type ? "bg-indigo-600 w-6" : "bg-gray-300",
                  )}
                  onClick={() => setActiveDoc(doc.type)}
                />
              ))}
            </div>
            <Button
              variant="outline"
              disabled={documents.indexOf(activeConfig) === documents.length - 1}
              onClick={() => {
                const idx = documents.findIndex((d) => d.type === activeDoc);
                if (idx < documents.length - 1) setActiveDoc(documents[idx + 1].type);
              }}
            >
              التالي
              <ChevronLeft className="h-4 w-4 mr-2" />
            </Button>
          </div>
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button variant="outline" className="flex-1">
            <Printer className="h-4 w-4 ml-2" />
            طباعة
          </Button>
          <Button variant="outline" className="flex-1">
            <Send className="h-4 w-4 ml-2" />
            إرسال بالبريد
          </Button>
          <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white">
            <Download className="h-4 w-4 ml-2" />
            تحميل PDF
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
