export const PRICE_CHART_RANGES = [
  "1M",
  "6M",
  "YTD",
  "1Y",
  "5Y",
  "10Y",
  "15Y",
] as const;

export type PriceChartRange = (typeof PRICE_CHART_RANGES)[number];

const parseEodDate = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) ? null : date;
};

const formatEodDate = (value: Date) => value.toISOString().slice(0, 10);

const setCalendarMonth = (date: Date, monthsAgo: number) => {
  const shifted = new Date(date);
  const originalDay = shifted.getUTCDate();
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() - monthsAgo);
  const lastDay = new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  shifted.setUTCDate(Math.min(originalDay, lastDay));
  return shifted;
};

const setCalendarYear = (date: Date, yearsAgo: number) => {
  const shifted = new Date(date);
  const originalMonth = shifted.getUTCMonth();
  const originalDay = shifted.getUTCDate();
  shifted.setUTCDate(1);
  shifted.setUTCFullYear(shifted.getUTCFullYear() - yearsAgo, originalMonth, 1);
  const lastDay = new Date(Date.UTC(
    shifted.getUTCFullYear(),
    originalMonth + 1,
    0,
  )).getUTCDate();
  shifted.setUTCDate(Math.min(originalDay, lastDay));
  return shifted;
};

export const rangeStartDate = (latestDate: string, range: PriceChartRange) => {
  const latest = parseEodDate(latestDate);
  if (!latest) return latestDate;

  if (range === "1M") return formatEodDate(setCalendarMonth(latest, 1));
  if (range === "6M") return formatEodDate(setCalendarMonth(latest, 6));
  if (range === "YTD") return `${latest.getUTCFullYear()}-01-01`;
  if (range === "1Y") return formatEodDate(setCalendarYear(latest, 1));
  if (range === "5Y") return formatEodDate(setCalendarYear(latest, 5));
  if (range === "10Y") return formatEodDate(setCalendarYear(latest, 10));
  return formatEodDate(setCalendarYear(latest, 15));
};

export const selectPriceRange = <T extends { date: string }>(
  points: T[],
  range: PriceChartRange,
) => {
  if (!points.length) return [];
  const cutoff = rangeStartDate(points.at(-1)!.date, range);
  return points.filter((point) => point.date >= cutoff);
};
