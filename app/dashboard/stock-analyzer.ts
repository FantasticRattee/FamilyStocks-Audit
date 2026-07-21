export type AnalyzerPricePoint = {
  date: string;
  close: number;
  adjustedClose: number;
};

export type AnalyzerValuationPoint = {
  date: string;
  value: number | null;
};

export type AnalyzerForwardEps = {
  value: number;
  period: string;
  asOfDate?: string;
  source: string;
};

export type StockAnalysisInput = {
  ticker: string;
  currency: string;
  fetchedAt: string;
  prices: AnalyzerPricePoint[];
  trailingPe: AnalyzerValuationPoint[];
  forwardEps?: AnalyzerForwardEps;
};

export type StockAnalyzerSource = {
  price: string;
  trailingPe: string;
  forwardPe: string;
  warnings?: string[];
};

export type StockAnalyzerSnapshot = {
  ticker: string;
  currency: string;
  fetchedAt: string;
  source: StockAnalyzerSource;
  input: StockAnalysisInput;
  analysis?: StockAnalysis;
};

export type AveragePoint = {
  period: string;
  average: number;
  adjustedAverage: number;
  observations: number;
};

export type AnnualPePoint = {
  year: number;
  value: number | null;
  asOfDate: string;
};

type Horizon = 5 | 10 | 15;

type HorizonValues = Record<Horizon, number | null>;
type HorizonDates = Record<Horizon, string | null>;

export type StockAnalysis = {
  currentPrice: number;
  currentPriceDate: string;
  coverage: {
    startDate: string;
    endDate: string;
    observations: number;
  };
  priceSeries: AnalyzerPricePoint[];
  monthlyAverages: AveragePoint[];
  annualAverages: AveragePoint[];
  cagr: {
    price: HorizonValues;
    totalReturn: HorizonValues;
    startDates: HorizonDates;
  };
  annualPe: AnnualPePoint[];
  forwardPe: {
    current: number | null;
    status: string;
    period?: string;
    source?: string;
  };
};

const HORIZONS = [5, 10, 15] as const satisfies readonly Horizon[];
const MILLIS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1000;

const isIsoDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));

const timestampFor = (date: string) => Date.parse(`${date}T00:00:00.000Z`);

const isFinitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const toPriceSeries = (prices: AnalyzerPricePoint[]) =>
  prices
    .filter(
      (point) =>
        isIsoDate(point.date) &&
        isFinitePositive(point.close) &&
        isFinitePositive(point.adjustedClose),
    )
    .sort((left, right) => left.date.localeCompare(right.date));

const createHorizonValues = (): HorizonValues => ({ 5: null, 10: null, 15: null });
const createHorizonDates = (): HorizonDates => ({ 5: null, 10: null, 15: null });

const dateYearsBefore = (date: string, years: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCFullYear(value.getUTCFullYear() - years);
  return value.toISOString().slice(0, 10);
};

const groupedAverages = (
  prices: AnalyzerPricePoint[],
  periodFor: (point: AnalyzerPricePoint) => string,
) => {
  const groups = new Map<
    string,
    { closeTotal: number; adjustedTotal: number; observations: number }
  >();
  for (const point of prices) {
    const period = periodFor(point);
    const group = groups.get(period) ?? {
      closeTotal: 0,
      adjustedTotal: 0,
      observations: 0,
    };
    group.closeTotal += point.close;
    group.adjustedTotal += point.adjustedClose;
    group.observations += 1;
    groups.set(period, group);
  }
  return [...groups.entries()].map(([period, group]) => ({
    period,
    average: group.closeTotal / group.observations,
    adjustedAverage: group.adjustedTotal / group.observations,
    observations: group.observations,
  }));
};

const annualPeSeries = (trailingPe: AnalyzerValuationPoint[]) => {
  const sorted = trailingPe
    .filter((point) => isIsoDate(point.date) && typeof point.value === "number" && Number.isFinite(point.value))
    .sort((left, right) => left.date.localeCompare(right.date));
  const latestByYear = new Map<number, AnalyzerValuationPoint>();
  for (const point of sorted) {
    latestByYear.set(Number(point.date.slice(0, 4)), point);
  }
  return [...latestByYear.entries()]
    .sort(([left], [right]) => left - right)
    .map(([year, point]) => ({
      year,
      value: point.value && point.value > 0 ? point.value : null,
      asOfDate: point.date,
    }));
};

const cagrFor = (
  startValue: number,
  endValue: number,
  startDate: string,
  endDate: string,
) => {
  const years = (timestampFor(endDate) - timestampFor(startDate)) / MILLIS_PER_YEAR;
  if (!Number.isFinite(years) || years <= 0 || !isFinitePositive(startValue) || !isFinitePositive(endValue)) {
    return null;
  }
  return Math.pow(endValue / startValue, 1 / years) - 1;
};

export const isSafeAnalyzerTicker = (value: string) =>
  /^[A-Za-z][A-Za-z0-9.-]{0,11}$/.test(value.trim());

export const buildStockAnalysis = (input: StockAnalysisInput): StockAnalysis => {
  const priceSeries = toPriceSeries(input.prices);
  if (!priceSeries.length) {
    throw new Error("At least one valid historical price is required.");
  }

  const latest = priceSeries.at(-1)!;
  const priceCagr = createHorizonValues();
  const totalReturnCagr = createHorizonValues();
  const startDates = createHorizonDates();

  for (const horizon of HORIZONS) {
    const targetDate = dateYearsBefore(latest.date, horizon);
    const startingPoint = [...priceSeries]
      .reverse()
      .find((point) => point.date <= targetDate);
    if (!startingPoint) continue;
    startDates[horizon] = startingPoint.date;
    priceCagr[horizon] = cagrFor(
      startingPoint.close,
      latest.close,
      startingPoint.date,
      latest.date,
    );
    totalReturnCagr[horizon] = cagrFor(
      startingPoint.adjustedClose,
      latest.adjustedClose,
      startingPoint.date,
      latest.date,
    );
  }

  const forwardEps = input.forwardEps;
  const canCalculateForwardPe = forwardEps && isFinitePositive(forwardEps.value);

  return {
    currentPrice: latest.close,
    currentPriceDate: latest.date,
    coverage: {
      startDate: priceSeries[0]!.date,
      endDate: latest.date,
      observations: priceSeries.length,
    },
    priceSeries,
    monthlyAverages: groupedAverages(priceSeries, (point) => point.date.slice(0, 7)),
    annualAverages: groupedAverages(priceSeries, (point) => point.date.slice(0, 4)),
    cagr: {
      price: priceCagr,
      totalReturn: totalReturnCagr,
      startDates,
    },
    annualPe: annualPeSeries(input.trailingPe),
    forwardPe: canCalculateForwardPe
      ? {
          current: latest.close / forwardEps.value,
          status: "Current consensus only; this is not point-in-time history.",
          period: forwardEps.period,
          source: forwardEps.source,
        }
      : {
          current: null,
          status:
            "Historical Forward P/E requires a point-in-time estimates provider.",
        },
  };
};
