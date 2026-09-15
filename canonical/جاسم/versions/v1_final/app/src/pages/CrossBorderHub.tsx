import { useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Globe,
  Calculator,
  Landmark,
  ClipboardList,
  ChevronLeft,
  TrendingUp,
  Ship,
} from "lucide-react";
import CrossBorderCalculator from "@/components/CrossBorderCalculator";
import MurabahaDisplay from "@/components/MurabahaDisplay";
import TradeDocumentViewer from "@/components/TradeDocumentViewer";

type CrossBorderTab = "calculator" | "murabaha" | "documents";

const tabs = [
  { key: "calculator" as CrossBorderTab, label: "حاسبة التكاليف", icon: <Calculator className="h-4 w-4" />, description: "احسب الجمارك والشحن والمرابحة" },
  { key: "murabaha" as CrossBorderTab, label: "المرابحة الإسلامية", icon: <Landmark className="h-4 w-4" />, description: "عرض شروط التمويل الإسلامي" },
  { key: "documents" as CrossBorderTab, label: "الوثائق", icon: <ClipboardList className="h-4 w-4" />, description: "وثائق التجارة الدولية" },
];

export default function CrossBorderHub() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<CrossBorderTab>("calculator");

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
              <div className="p-2 bg-blue-100 rounded-lg">
                <Globe className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">التجارة الدولية</h1>
                <p className="text-xs text-gray-500">حلول التجارة والتمويل العابر للحدود</p>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="text-xs">
              <Ship className="h-3 w-3 ml-1" />
              {tabs.find((t) => t.key === activeTab)?.label}
            </Badge>
          </div>
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
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "bg-white border-gray-200 hover:border-gray-300",
              )}
              onClick={() => setActiveTab(tab.key)}
            >
              <span className={activeTab === tab.key ? "text-blue-600" : "text-gray-500"}>
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
        {activeTab === "calculator" && <CrossBorderCalculator />}
        {activeTab === "murabaha" && <MurabahaDisplay />}
        {activeTab === "documents" && <TradeDocumentViewer />}
      </main>
    </div>
  );
}
