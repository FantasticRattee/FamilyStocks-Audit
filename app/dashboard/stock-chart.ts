export type LineChartPoint = {
  label: string;
  value: number;
};

export type LineChartCoordinate = {
  point: LineChartPoint;
  x: number;
  y: number;
};

export type LineChartGeometry = {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  yAxisX: number;
  plotTop: number;
  plotBottom: number;
  minimum: number;
  maximum: number;
  coordinates: LineChartCoordinate[];
  xTicks: Array<{ label: string; x: number; index: number }>;
  yTicks: Array<{ value: number; y: number }>;
};

const dimensions = {
  width: 720,
  height: 294,
  plotLeft: 22,
  plotRight: 620,
  yAxisX: 632,
  plotTop: 18,
  plotBottom: 236,
} as const;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const parseChartDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) ? null : date;
};

export const formatChartAxisDate = (value: string) => {
  if (/^\d{4}$/.test(value)) return value;
  const date = parseChartDate(value);
  return date
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date)
    : value;
};

export const formatChartTooltipDate = (value: string) => {
  if (/^\d{4}$/.test(value)) return value;
  const date = parseChartDate(value);
  return date
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date)
    : value;
};

const axisIndices = (length: number, desiredCount = 5) => {
  if (length <= 1) return [0];
  const count = Math.min(desiredCount, length);
  return Array.from(
    new Set(
      Array.from({ length: count }, (_, index) =>
        Math.round((index * (length - 1)) / Math.max(count - 1, 1)),
      ),
    ),
  );
};

export const buildLineChartGeometry = (points: LineChartPoint[]): LineChartGeometry => {
  const values = points.map((point) => point.value);
  const observedMinimum = values.length ? Math.min(...values) : 0;
  const observedMaximum = values.length ? Math.max(...values) : 0;
  const observedSpread = observedMaximum - observedMinimum;
  const equalValuePadding = observedSpread === 0
    ? Math.max(Math.abs(observedMaximum) * 0.04, 1)
    : 0;
  const minimum = observedMinimum - equalValuePadding;
  const maximum = observedMaximum + equalValuePadding;
  const spread = maximum - minimum || 1;
  const plotWidth = dimensions.plotRight - dimensions.plotLeft;
  const plotHeight = dimensions.plotBottom - dimensions.plotTop;
  const lastIndex = Math.max(points.length - 1, 1);

  const coordinates = points.map((point, index) => ({
    point,
    x: dimensions.plotLeft + (index / lastIndex) * plotWidth,
    y: dimensions.plotBottom - ((point.value - minimum) / spread) * plotHeight,
  }));

  const xTicks = axisIndices(points.length).map((index) => ({
    label: formatChartAxisDate(points[index]!.label),
    x: coordinates[index]!.x,
    index,
  }));

  const yTicks = [maximum, (maximum + minimum) / 2, minimum].map((value) => ({
    value,
    y: dimensions.plotBottom - ((value - minimum) / spread) * plotHeight,
  }));

  return {
    ...dimensions,
    minimum,
    maximum,
    coordinates,
    xTicks,
    yTicks,
  };
};

export const nearestLineChartPointIndex = ({
  clientX,
  rectLeft,
  rectWidth,
  geometry,
}: {
  clientX: number;
  rectLeft: number;
  rectWidth: number;
  geometry: LineChartGeometry;
}) => {
  if (geometry.coordinates.length <= 1) return 0;
  const viewportX = ((clientX - rectLeft) / Math.max(rectWidth, 1)) * geometry.width;
  const progress = clamp(
    (viewportX - geometry.plotLeft) / (geometry.plotRight - geometry.plotLeft),
    0,
    1,
  );
  return Math.round(progress * (geometry.coordinates.length - 1));
};
