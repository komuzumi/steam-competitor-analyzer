import { EstimateConfidence } from "@/types";

export function formatConfidenceLabel(confidence: EstimateConfidence): string {
  if (confidence === "High") return "高";
  if (confidence === "Medium") return "中";
  return "低";
}
