import { useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Eye,
  Camera,
  Shield,
  Receipt,
  ChevronLeft,
  Scan,
  Sparkles,
} from "lucide-react";
import CameraScanner from "@/components/CameraScanner";
import KYCVerifier from "@/components/KYCVerifier";
import ReceiptReader from "@/components/ReceiptReader";

type VisionTab = "scanner" | "kyc" | "receipt";

const tabs = [
  { key: "scanner" as VisionTab, label: "ماسح المنتجات", icon: <Camera className="h-4 w-4" />, description: "التعرف على المنتجات بالكاميرا" },
  { key: "kyc" as VisionTab, label: "التحقق من الهوية", icon: <Shield className="h-4 w-4" />, description: "KYC وتحقق الوثائق" },
  { key: "receipt" as VisionTab, label: "قارئ الإيصالات", icon: <Receipt className="h-4 w-4" />, description: "استخراج بيانات الإيصال" },
];

export default function VisionHub() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<VisionTab>("scanner");

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-violet-100 rounded-lg">
                <Eye className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">مركز الرؤية الذكية</h1>
                <p className="text-xs text-gray-500">تقنيات الذكاء الاصطناعي للرؤية الحاسوبية</p>
              </div>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            <Sparkles className="h-3 w-3 ml-1" />
            AI Vision
          </Badge>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={cn(
                "flex items-center gap-2 px-4 py-3 rounded-xl border transition-all flex-1",
                activeTab === tab.key
                  ? "border-violet-500 bg-violet-50 text-violet-700"
                  : "bg-white border-gray-200 hover:border-gray-300",
              )}
              onClick={() => setActiveTab(tab.key)}
            >
              <span className={activeTab === tab.key ? "text-violet-600" : "text-gray-500"}>
                {tab.icon}
              </span>
              <div className="text-right">
                <p className="text-sm font-medium">{tab.label}</p>
                <p className="text-[10px] text-gray-500 hidden sm:block">{tab.description}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === "scanner" && <CameraScanner />}
        {activeTab === "kyc" && <KYCVerifier />}
        {activeTab === "receipt" && <ReceiptReader />}
      </main>
    </div>
  );
}
