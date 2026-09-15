import { useCallback, useRef, useState } from "react";

/** أنواع مناطق الالتصاق المغناطيسي */
export type SnapZone = 0 | 25 | 50 | 75;

export interface SnapGuide {
  x: number;
  label: string;
}

export interface UseBubbleSnapOptions {
  containerWidth: number;
  snapDistance?: number;
}

/**
 * نظام الالتصاق المغناطيسي للفقاعات
 * ٤ مناطق: ٠٪، ٢٥٪، ٥٠٪، ٧٥٪ من عرض الشاشة
 */
export function useBubbleSnap(options: UseBubbleSnapOptions) {
  const { containerWidth, snapDistance = 40 } = options;
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [activeSnapZone, setActiveSnapZone] = useState<SnapZone | null>(null);

  /** حساب مناطق الالتصاق بالبكسل */
  const snapPixels = [0, 0.25, 0.5, 0.75].map(
    (pct) => Math.round(containerWidth * pct)
  );

  /** كشف أقرب منطقة التصاق */
  const detectSnap = useCallback(
    (x: number): SnapZone | null => {
      const zones: SnapZone[] = [0, 25, 50, 75];
      for (let i = 0; i < snapPixels.length; i++) {
        if (Math.abs(x - snapPixels[i]) < snapDistance) {
          return zones[i];
        }
      }
      return null;
    },
    [snapPixels, snapDistance]
  );

  /** تحديث خطوط التصاق المرئية */
  const updateGuides = useCallback(
    (currentX: number) => {
      const guides: SnapGuide[] = [];
      const zoneLabels = ["الحافة اليسرى", "الربع", "النصف", "الثلاثة أرباع"];

      for (let i = 0; i < snapPixels.length; i++) {
        if (Math.abs(currentX - snapPixels[i]) < snapDistance) {
          guides.push({
            x: snapPixels[i],
            label: zoneLabels[i],
          });
        }
      }
      setSnapGuides(guides);
    },
    [snapPixels, snapDistance]
  );

  /** مسح خطوط التصاق */
  const clearGuides = useCallback(() => {
    setSnapGuides([]);
    setActiveSnapZone(null);
  }, []);

  /** تطبيق التصاق على X */
  const applySnap = useCallback(
    (x: number): number => {
      const snapX = detectSnap(x);
      if (snapX !== null) {
        setActiveSnapZone(snapX);
        return snapPixels[[0, 25, 50, 75].indexOf(snapX)];
      }
      setActiveSnapZone(null);
      return x;
    },
    [detectSnap, snapPixels]
  );

  /** عرض نافذة عند منطقة التصاق */
  const getSnappedWidth = useCallback(
    (openCount: number): number => {
      if (openCount <= 0) return 360;
      if (openCount === 1) return Math.min(360, Math.round(containerWidth * 0.35));
      if (openCount === 2) return Math.round(containerWidth * 0.45);
      if (openCount === 3) return Math.round(containerWidth * 0.32);
      return Math.round(containerWidth * 0.25);
    },
    [containerWidth]
  );

  return {
    snapGuides,
    activeSnapZone,
    detectSnap,
    updateGuides,
    clearGuides,
    applySnap,
    getSnappedWidth,
    snapPixels,
  };
}
