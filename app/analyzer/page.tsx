import type { Metadata } from "next";

import { StockAnalyzerDashboard } from "../dashboard/StockAnalyzerDashboard";

export const metadata: Metadata = {
  title: "Stock Analyzer | Stock Audit",
  description: "Private U.S. equity history, CAGR, and valuation research dashboard.",
};

export default function AnalyzerPage() {
  return <StockAnalyzerDashboard />;
}
