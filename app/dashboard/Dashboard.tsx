"use client";

import { ContactShadows, useCursor } from "@react-three/drei";
import {
  Canvas,
  type ThreeEvent,
  useFrame,
  useThree,
} from "@react-three/fiber";
import {
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import {
  createHoldingEdits,
  getHoldingDisplayTicker,
  type HoldingEdits,
} from "./edit-model";
import {
  INITIAL_DASHBOARD_SNAPSHOT,
  INITIAL_SHARED_PORTFOLIO_STATE,
} from "./initial-shared-portfolio";
import {
  isYahooCandidateCurrencyCompatible,
  type MarketQuote,
  type YahooSearchCandidate,
} from "./market-data";
import {
  applyLiveMarketState,
  createLiveMarketRefreshPlan,
  createLiveMarketState,
  type LiveMarketBatchResponse,
  type LiveMarketState,
} from "./live-market";
import {
  calculateDashboard,
  createScenario,
  type DashboardSnapshot,
  type Scenario,
} from "./model";
import type { SharedPortfolioState } from "./portfolio-api";
import {
  buildDashboardSnapshotFromSharedPortfolio,
  exportMinimalHoldingsWorkbook,
  parseMinimalHoldingsWorkbook,
  validateSharedHoldings,
  type SharedHoldingInput,
} from "./shared-portfolio";

const TABS = [
  ["overview", "ภาพรวม"],
  ["shareholders", "ผู้ถือหุ้น"],
  ["holdings", "หุ้นที่ถือ"],
  ["dividends", "ปันผล"],
  ["transactions", "รายการ"],
] as const;

const PORTFOLIO_THEME = {
  meadow: "#62835f",
  sky: "#6597aa",
  gold: "#cda650",
  loss: "#b7675f",
  denim: "#466b88",
} as const;

const PAINTED_CLAY_MATERIAL = {
  metalness: 0.015,
  roughness: 0.82,
  selectedEmissiveIntensity: 0.035,
} as const;

const GHIBLI_SCENE_LIGHTS = {
  sky: "#dcebdc",
  ground: "#6f7658",
  sun: "#ffe5ad",
  rim: "#b7d8cc",
  track: "#e5dfcf",
} as const;

const MARKET_REFRESH_SOURCES =
  "OpenAI web search · saved to shared PostgreSQL";

type Tab = (typeof TABS)[number][0];
type SourceMode = "embedded" | "shared";
type EditPasswordPurpose = "edit" | "import";
type HoldingMarketUi = {
  candidates?: YahooSearchCandidate[];
  isSearching?: boolean;
  isFetching?: boolean;
  error?: string;
  notice?: string;
};
type TickerAllocation = {
  ticker: string;
  displayTicker: string;
  marketValue: number;
  ratio: number;
  color: string;
};
type BarChart3DMode = "paired" | "diverging" | "progress";
type BarChart3DValue = {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  color: string;
  tone?: "positive" | "negative" | "neutral";
};
type BarChart3DRow = {
  id: string;
  label: string;
  meta?: string;
  badge?: string;
  headline: string;
  detail: string;
  buttonAriaLabel: string;
  values: BarChart3DValue[];
};

const createEmptyLiveMarketState = (): LiveMarketState => ({
  quotesByTicker: {},
  failures: {},
  refreshedStockCount: 0,
  retainedStockCount: 0,
  requestedStockCount: 0,
  refreshedFx: false,
  retainedFx: false,
  cooldownActive: false,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const decimalFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INITIAL_SNAPSHOT = INITIAL_DASHBOARD_SNAPSHOT;

const formatThb = (value: number, digits = 0) => {
  const formatter =
    digits > 0
      ? new Intl.NumberFormat("en-US", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        })
      : numberFormatter;
  return `${value < 0 ? "−" : ""}฿${formatter.format(Math.abs(value))}`;
};

const formatNative = (value: number, currency: "THB" | "USD") =>
  currency === "USD"
    ? `$${decimalFormatter.format(value)}`
    : formatThb(value, 2);

const formatSignedThb = (value: number) =>
  value > 0 ? `+${formatThb(value)}` : formatThb(value);

const formatPct = (value: number, digits = 2) =>
  `${(value * 100).toFixed(digits)}%`;

const formatQty = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);

const formatDate = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
};

const formatLiveTimestamp = (timestamp?: string) => {
  if (!timestamp) return "";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok",
  }).format(parsed);
};

const pnlClass = (value: number) =>
  value > 0 ? "positive" : value < 0 ? "negative" : "neutral";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function EmptyTransactions() {
  return (
    <div className="empty-state">
      <strong>ไม่พบรายการตาม filter ที่เลือก</strong>
      <span>ลองล้างคำค้นหา หรือเปลี่ยนประเภทการซื้อ/ขาย</span>
    </div>
  );
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

function Bar3DMotionMesh({
  position,
  size,
  color,
  isActive,
  liftAmount,
  metalness,
  roughness,
  highlightIntensity,
  prefersReducedMotion,
  onActivate,
  onDeactivate,
}: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  isActive: boolean;
  liftAmount: number;
  metalness: number;
  roughness: number;
  highlightIntensity: number;
  prefersReducedMotion: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [isHovered, setIsHovered] = useState(false);
  const invalidate = useThree((state) => state.invalidate);
  const isHighlighted = isActive || isHovered;
  const baseZ = position[2];
  useCursor(isHovered);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (prefersReducedMotion) {
      mesh.position.z = baseZ + (isHighlighted ? liftAmount : 0);
    }
    invalidate();
  }, [baseZ, invalidate, isHighlighted, liftAmount, prefersReducedMotion]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh || prefersReducedMotion) return;
    const targetZ = baseZ + (isHighlighted ? liftAmount : 0);
    mesh.position.z = THREE.MathUtils.damp(mesh.position.z, targetZ, 9, delta);
    if (Math.abs(mesh.position.z - targetZ) > 0.001) invalidate();
  });

  return (
    <mesh
      ref={meshRef}
      position={position}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onActivate();
      }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        setIsHovered(true);
        onActivate();
      }}
      onPointerOut={() => {
        setIsHovered(false);
        onDeactivate();
      }}
    >
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        emissive={isHighlighted ? color : "#000000"}
        emissiveIntensity={isHighlighted ? highlightIntensity : 0}
        metalness={metalness}
        roughness={roughness}
      />
    </mesh>
  );
}

function Bar3DTrackMesh({
  position,
  size,
}: {
  position: [number, number, number];
  size: [number, number, number];
}) {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={GHIBLI_SCENE_LIGHTS.track}
        transparent
        opacity={0.54}
        metalness={0}
        roughness={0.92}
      />
    </mesh>
  );
}

function BarChart3DScene({
  rows,
  mode,
  scaleMax,
  activeIndex,
  onActivate,
  onDeactivate,
  prefersReducedMotion,
}: {
  rows: BarChart3DRow[];
  mode: BarChart3DMode;
  scaleMax: number;
  activeIndex: number;
  onActivate: (index: number) => void;
  onDeactivate: () => void;
  prefersReducedMotion: boolean;
}) {
  const viewportWidth = useThree((state) => state.viewport.width);
  const fullWidth = Math.max(5.2, viewportWidth * 0.98);
  const halfWidth = fullWidth / 2;
  const startX = -halfWidth;
  const rowStep = mode === "paired" ? 1.55 : 1.3;
  const topY = ((rows.length - 1) * rowStep) / 2;
  const isPerformanceMode = mode === "diverging";
  const liftAmount = isPerformanceMode ? 0.34 : 0;
  const groupRotation: [number, number, number] = isPerformanceMode
    ? [-0.13, 0, 0]
    : [0, 0, 0];
  const materialMetalness = isPerformanceMode
    ? 0.035
    : PAINTED_CLAY_MATERIAL.metalness;
  const materialRoughness = isPerformanceMode
    ? 0.76
    : PAINTED_CLAY_MATERIAL.roughness;
  const highlightIntensity = isPerformanceMode
    ? 0.055
    : PAINTED_CLAY_MATERIAL.selectedEmissiveIntensity;

  return (
    <>
      <ambientLight intensity={isPerformanceMode ? 1.05 : 1.2} />
      <hemisphereLight args={[GHIBLI_SCENE_LIGHTS.sky, GHIBLI_SCENE_LIGHTS.ground, isPerformanceMode ? 1.35 : 1.5]} />
      <directionalLight
        position={[-4, 5, 7]}
        intensity={isPerformanceMode ? 2.8 : 2.35}
        color={GHIBLI_SCENE_LIGHTS.sun}
      />
      <pointLight
        position={[4, -2, 5]}
        intensity={isPerformanceMode ? 7.5 : 2.2}
        color={GHIBLI_SCENE_LIGHTS.rim}
      />
      <group rotation={groupRotation}>
        {mode === "diverging" ? (
          <Bar3DTrackMesh
            position={[0, 0, 0.12]}
            size={[0.035, Math.max(1.2, topY * 2 + 1), 0.18]}
          />
        ) : null}
        {rows.flatMap((row, rowIndex) => {
          const rowY = topY - rowIndex * rowStep;
          return row.values.flatMap((value, valueIndex) => {
            const pairedOffset =
              mode === "paired" && row.values.length > 1
                ? 0.28 - valueIndex * 0.56
                : 0;
            const ratio = Math.min(Math.abs(value.value) / Math.max(scaleMax, 1), 1);
            const maximumBarWidth = mode === "diverging" ? halfWidth : fullWidth;
            const width = Math.max(0.15, ratio * maximumBarWidth);
            const trackHeight =
              mode === "diverging" ? 0.72 : mode === "paired" ? 0.52 : 0.32;
            const barHeight =
              mode === "diverging" ? 0.44 : mode === "paired" ? 0.42 : 0.34;
            const x =
              mode === "diverging"
                ? (value.value >= 0 ? 1 : -1) * (width / 2)
                : startX + width / 2;
            const y = rowY + pairedOffset;
            const key = `${row.id}-${value.id}`;

            return [
              <Bar3DTrackMesh
                key={`${key}-track`}
                position={[mode === "diverging" ? 0 : 0, y, -0.14]}
                size={[fullWidth, trackHeight, isPerformanceMode ? 0.12 : 0.05]}
              />,
              <Bar3DMotionMesh
                key={key}
                position={[x, y, isPerformanceMode ? valueIndex * 0.025 : 0]}
                size={[width, barHeight, isPerformanceMode ? 0.36 : 0.16]}
                color={value.color}
                isActive={rowIndex === activeIndex}
                liftAmount={liftAmount}
                metalness={materialMetalness}
                roughness={materialRoughness}
                highlightIntensity={highlightIntensity}
                prefersReducedMotion={prefersReducedMotion}
                onActivate={() => onActivate(rowIndex)}
                onDeactivate={onDeactivate}
              />,
            ];
          });
        })}
      </group>
    </>
  );
}

function CompactBarField3D({
  rows,
  mode,
  scaleMax,
  ariaLabel,
  className = "",
}: {
  rows: BarChart3DRow[];
  mode: BarChart3DMode;
  scaleMax: number;
  ariaLabel: string;
  className?: string;
}) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const [canvasReady, setCanvasReady] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const cameraDistance = mode === "paired" && rows.length === 1 ? 4.2 : 6.4;

  return (
    <div
      className={`compact-r3f-bar-field ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
    >
      <div
        className={`compact-r3f-fallback ${mode} ${canvasReady ? "canvas-ready" : ""}`}
        aria-hidden="true"
      >
        {rows.flatMap((row) =>
          row.values.map((value) => {
            const ratio = Math.min(
              Math.abs(value.value) / Math.max(scaleMax, 1),
              1,
            );
            const width = `${ratio * (mode === "diverging" ? 50 : 100)}%`;
            return (
              <span
                className={value.value < 0 ? "loss" : "gain"}
                key={`${row.id}-${value.id}`}
              >
                <i style={{ backgroundColor: value.color, width }} />
              </span>
            );
          }),
        )}
      </div>
      {rows.length ? (
        <Canvas
          aria-hidden="true"
          dpr={[1, 1.25]}
          frameloop="demand"
          camera={{ position: [0, 0, cameraDistance], fov: 34 }}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          onCreated={() => setCanvasReady(true)}
          onPointerMissed={() => setActiveIndex(-1)}
          fallback={null}
        >
          <BarChart3DScene
            rows={rows}
            mode={mode}
            scaleMax={scaleMax}
            activeIndex={activeIndex}
            onActivate={setActiveIndex}
            onDeactivate={() => setActiveIndex(-1)}
            prefersReducedMotion={prefersReducedMotion}
          />
        </Canvas>
      ) : null}
    </div>
  );
}

function AllocationSegment({
  startAngle,
  endAngle,
  color,
  isActive,
  prefersReducedMotion,
  onActivate,
}: {
  startAngle: number;
  endAngle: number;
  color: string;
  isActive: boolean;
  prefersReducedMotion: boolean;
  onActivate: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [isHovered, setIsHovered] = useState(false);
  const invalidate = useThree((state) => state.invalidate);
  const middleAngle = (startAngle + endAngle) / 2;
  const directionX = Math.cos(middleAngle);
  const directionY = Math.sin(middleAngle);
  useCursor(isHovered);

  const geometry = useMemo(() => {
    const outerRadius = 2.05;
    const innerRadius = 1.16;
    const angularGap = Math.min(0.022, (endAngle - startAngle) * 0.12);
    const start = startAngle + angularGap / 2;
    const end = endAngle - angularGap / 2;
    const shape = new THREE.Shape();

    shape.moveTo(Math.cos(start) * outerRadius, Math.sin(start) * outerRadius);
    shape.absarc(0, 0, outerRadius, start, end, false);
    shape.lineTo(Math.cos(end) * innerRadius, Math.sin(end) * innerRadius);
    shape.absarc(0, 0, innerRadius, end, start, true);
    shape.closePath();

    const nextGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.28,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.045,
      bevelThickness: 0.045,
      curveSegments: 48,
    });
    nextGeometry.translate(0, 0, -0.14);
    nextGeometry.computeVertexNormals();
    return nextGeometry;
  }, [endAngle, startAngle]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (prefersReducedMotion) {
      const offset = isActive ? 0.16 : 0;
      mesh.position.set(
        directionX * offset,
        directionY * offset,
        isActive ? 0.12 : 0,
      );
    }
    invalidate();
  }, [directionX, directionY, invalidate, isActive, prefersReducedMotion]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh || prefersReducedMotion) return;

    const offset = isActive ? 0.16 : 0;
    const targetX = directionX * offset;
    const targetY = directionY * offset;
    const targetZ = isActive ? 0.12 : 0;
    mesh.position.x = THREE.MathUtils.damp(mesh.position.x, targetX, 8, delta);
    mesh.position.y = THREE.MathUtils.damp(mesh.position.y, targetY, 8, delta);
    mesh.position.z = THREE.MathUtils.damp(mesh.position.z, targetZ, 8, delta);

    if (
      Math.abs(mesh.position.x - targetX) > 0.001 ||
      Math.abs(mesh.position.y - targetY) > 0.001 ||
      Math.abs(mesh.position.z - targetZ) > 0.001
    ) {
      invalidate();
    }
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      castShadow
      receiveShadow
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onActivate();
      }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        setIsHovered(true);
        onActivate();
      }}
      onPointerOut={() => setIsHovered(false)}
    >
      <meshStandardMaterial
        color={color}
        emissive={isActive ? color : "#000000"}
        emissiveIntensity={
          isActive ? PAINTED_CLAY_MATERIAL.selectedEmissiveIntensity : 0
        }
        metalness={PAINTED_CLAY_MATERIAL.metalness}
        roughness={PAINTED_CLAY_MATERIAL.roughness}
      />
    </mesh>
  );
}

function PortfolioRingScene({
  allocations,
  activeIndex,
  onActivate,
  prefersReducedMotion,
}: {
  allocations: TickerAllocation[];
  activeIndex: number;
  onActivate: (index: number) => void;
  prefersReducedMotion: boolean;
}) {
  const segments = useMemo(
    () =>
      allocations.map((allocation, index) => {
        const priorRatio = sum(
          allocations.slice(0, index).map((prior) => prior.ratio),
        );
        const startAngle = -Math.PI / 2 + priorRatio * Math.PI * 2;
        const endAngle = startAngle + allocation.ratio * Math.PI * 2;
        return { ...allocation, startAngle, endAngle };
      }),
    [allocations],
  );

  return (
    <>
      <ambientLight intensity={1.05} />
      <hemisphereLight args={[GHIBLI_SCENE_LIGHTS.sky, GHIBLI_SCENE_LIGHTS.ground, 1.55]} />
      <directionalLight
        castShadow
        position={[-3.5, 5.5, 7]}
        intensity={3.05}
        color={GHIBLI_SCENE_LIGHTS.sun}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight
        position={[4.5, -1.5, 4]}
        intensity={10}
        color={GHIBLI_SCENE_LIGHTS.rim}
      />
      <group rotation={[-0.69, 0.05, -0.08]} position={[0, 0.1, 0]}>
        {segments.map((segment, index) => (
          <AllocationSegment
            key={segment.ticker}
            startAngle={segment.startAngle}
            endAngle={segment.endAngle}
            color={segment.color}
            isActive={index === activeIndex}
            prefersReducedMotion={prefersReducedMotion}
            onActivate={() => onActivate(index)}
          />
        ))}
      </group>
      <ContactShadows
        position={[0, -1.72, -0.2]}
        opacity={0.27}
        scale={6.4}
        blur={2.8}
        far={4.2}
        resolution={512}
      />
    </>
  );
}

function PortfolioComposition3D({
  allocations,
  totalValue,
  fallbackStyle,
}: {
  allocations: TickerAllocation[];
  totalValue: number;
  fallbackStyle: CSSProperties;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [canvasReady, setCanvasReady] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const activeAllocation = allocations[activeIndex] ?? allocations[0];
  const activateNextAllocation = () => {
    if (!allocations.length) return;
    setActiveIndex((currentIndex) => (currentIndex + 1) % allocations.length);
  };

  return (
    <div className="composition-experience">
      <div
        className={`composition-3d-stage ${canvasReady ? "canvas-ready" : ""}`}
        role="group"
        aria-label="Interactive 3D portfolio composition ring"
      >
        <button
          className={`allocation-fallback-ring ${canvasReady ? "canvas-ready" : ""}`}
          type="button"
          style={fallbackStyle}
          onClick={activateNextAllocation}
          aria-label={
            activeAllocation
              ? `Select next allocation. Current allocation is ${activeAllocation.displayTicker} at ${formatPct(activeAllocation.ratio, 1)}`
              : "Portfolio allocation ring"
          }
          aria-hidden={canvasReady}
          tabIndex={canvasReady ? -1 : 0}
        />
        {allocations.length ? (
          <Canvas
            aria-hidden="true"
            shadows="basic"
            dpr={[1, 1.5]}
            frameloop="demand"
            camera={{ position: [0, 1.05, 7.1], fov: 34 }}
            onCreated={() => setCanvasReady(true)}
            fallback={null}
          >
            <PortfolioRingScene
              allocations={allocations}
              activeIndex={activeIndex}
              onActivate={setActiveIndex}
              prefersReducedMotion={prefersReducedMotion}
            />
          </Canvas>
        ) : null}
        <div className="composition-center-card" aria-hidden="true">
          <strong>{formatThb(totalValue)}</strong>
          <span>Total value</span>
          {activeAllocation ? (
            <small>
              {activeAllocation.displayTicker} · {formatPct(activeAllocation.ratio, 1)}
            </small>
          ) : null}
        </div>
      </div>

      <aside className="allocation-detail-card" aria-label="Exact portfolio allocation values">
        <div className="allocation-detail-heading">
          <div>
            <span>ALLOCATION</span>
            <strong>Exact values</strong>
          </div>
          <small>{allocations.length} tickers</small>
        </div>
        <div className="allocation-detail-list">
          {allocations.map((allocation, index) => (
            <button
              className={index === activeIndex ? "active" : ""}
              key={allocation.ticker}
              type="button"
              aria-pressed={index === activeIndex}
              aria-label={`Select ${allocation.displayTicker} allocation ${formatPct(allocation.ratio, 1)}, ${formatThb(allocation.marketValue)}`}
              onClick={() => setActiveIndex(index)}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
            >
              <i style={{ backgroundColor: allocation.color }} aria-hidden="true" />
              <span>
                <strong>{allocation.displayTicker}</strong>
                <small>{formatThb(allocation.marketValue)}</small>
              </span>
              <b>{formatPct(allocation.ratio, 1)}</b>
            </button>
          ))}
        </div>
        <div className="allocation-detail-total">
          <span>Total portfolio value</span>
          <strong>{formatThb(totalValue)}</strong>
        </div>
        <span className="sr-only" aria-live="polite">
          {activeAllocation
            ? `${activeAllocation.displayTicker} selected, ${formatPct(activeAllocation.ratio, 1)} of portfolio`
            : "No ticker selected"}
        </span>
      </aside>
    </div>
  );
}

export function Dashboard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importPasswordRef = useRef("");
  const pendingImportFileRef = useRef<File | null>(null);
  const editModeButtonRef = useRef<HTMLButtonElement>(null);
  const editPasswordInputRef = useRef<HTMLInputElement>(null);
  const refreshRequestIdRef = useRef(0);
  const workbookRequestIdRef = useRef(0);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(INITIAL_SNAPSHOT);
  const [scenario, setScenario] = useState<Scenario>(() =>
    createScenario(INITIAL_SNAPSHOT),
  );
  const [sourceMode, setSourceMode] = useState<SourceMode>("embedded");
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [showScenario, setShowScenario] = useState(false);
  const [showEditPasswordDialog, setShowEditPasswordDialog] = useState(false);
  const [editPasswordPurpose, setEditPasswordPurpose] =
    useState<EditPasswordPurpose>("edit");
  const [editPassword, setEditPassword] = useState("");
  const [editPasswordError, setEditPasswordError] = useState("");
  const [editPasswordPromptVersion, setEditPasswordPromptVersion] = useState(0);
  const [isVerifyingEditPassword, setIsVerifyingEditPassword] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importError, setImportError] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const [search, setSearch] = useState("");
  const [sideFilter, setSideFilter] = useState("ALL");
  const [accountFilter, setAccountFilter] = useState("ALL");
  const [portfolioHoldings, setPortfolioHoldings] = useState<SharedHoldingInput[]>(
    () => INITIAL_SHARED_PORTFOLIO_STATE.holdings,
  );
  const [holdingEdits, setHoldingEdits] = useState<HoldingEdits>(() =>
    createHoldingEdits(INITIAL_SNAPSHOT),
  );
  const [marketUi, setMarketUi] = useState<Record<string, HoldingMarketUi>>({});
  const [liveMarketState, setLiveMarketState] = useState<LiveMarketState>(
    createEmptyLiveMarketState,
  );
  const [liveMarketNotice, setLiveMarketNotice] = useState("");
  const [isRefreshingMarket, setIsRefreshingMarket] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportNotice, setExportNotice] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    let isActive = true;
    const requestId = workbookRequestIdRef.current;

    const loadSharedPortfolio = async () => {
      try {
        const response = await fetch("/api/portfolio", { cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as
          | SharedPortfolioState
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            "error" in body && body.error
              ? body.error
              : "Shared portfolio database is unavailable.",
          );
        }
        if (!isActive || requestId !== workbookRequestIdRef.current) return;
        const state = body as SharedPortfolioState;
        const nextSnapshot = buildDashboardSnapshotFromSharedPortfolio(
          state.holdings,
          state.settings,
          state.latestImport?.filename ?? "Shared portfolio database",
        );
        const nextEdits = createHoldingEdits(nextSnapshot);
        const plan = createLiveMarketRefreshPlan(nextSnapshot, nextEdits);
        const timestamps = Object.values(state.quotes)
          .map((quote) => quote.quoteTimestamp)
          .filter((value): value is string => Boolean(value));
        const nextLiveState = createLiveMarketState(plan, {
          quotes: state.quotes,
          failures: {},
          fetchedAt:
            timestamps.sort().at(-1) ??
            state.latestImport?.importedAt ??
            new Date().toISOString(),
          provider: "Shared PostgreSQL",
          ...(state.marketSources?.length
            ? { sources: state.marketSources }
            : {}),
          refreshedKeys: [],
          retainedKeys: Object.keys(state.quotes),
        });
        setPortfolioHoldings(validateSharedHoldings(state.holdings));
        setSnapshot(nextSnapshot);
        setScenario(createScenario(nextSnapshot));
        setHoldingEdits(nextEdits);
        setMarketUi({});
        setLiveMarketState(nextLiveState);
        setLiveMarketNotice("โหลดราคาล่าสุดที่บันทึกไว้ในฐานข้อมูลร่วมแล้ว");
        setIsRefreshingMarket(false);
        setExportError("");
        setExportNotice("");
        setSourceMode("shared");
        setImportNotice(
          state.latestImport
            ? `กำลังใช้ ${state.latestImport.filename} จากฐานข้อมูลร่วม`
            : "กำลังใช้พอร์ตเริ่มต้นจากฐานข้อมูลร่วม",
        );
      } catch (error) {
        if (!isActive || requestId !== workbookRequestIdRef.current) return;
        setImportNotice(
          `${error instanceof Error ? error.message : "Shared portfolio database is unavailable."} แสดง embedded snapshot ชั่วคราว`,
        );
      }
    };

    void loadSharedPortfolio();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!showEditPasswordDialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      if (editPasswordInputRef.current) {
        editPasswordInputRef.current.value = "";
        editPasswordInputRef.current.focus();
      }
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
    };
  }, [showEditPasswordDialog]);

  const importedScenario = useMemo(() => createScenario(snapshot), [snapshot]);
  const liveScenario = useMemo(
    () => applyLiveMarketState(snapshot, scenario, liveMarketState),
    [liveMarketState, scenario, snapshot],
  );
  const result = useMemo(
    () => calculateDashboard(snapshot, liveScenario),
    [liveScenario, snapshot],
  );

  const scenarioDirty =
    JSON.stringify(scenario) !== JSON.stringify(importedScenario);
  const liveMarketFailureCount = Object.keys(liveMarketState.failures).length;
  const liveMarketProvider = liveMarketState.provider ?? MARKET_REFRESH_SOURCES;
  const liveMarketStatusText = liveMarketState.fetchedAt
    ? liveMarketState.cooldownActive
      ? `Market prices · saved quotes reused · 5-minute API cooldown · ${formatLiveTimestamp(liveMarketState.fetchedAt)} · ${liveMarketProvider}`
      : `Market prices · ${liveMarketState.refreshedStockCount} refreshed · ${liveMarketState.retainedStockCount} retained${liveMarketState.refreshedFx ? " · USD/THB refreshed" : liveMarketState.retainedFx ? " · USD/THB retained" : " · USD/THB unavailable"} · ${formatLiveTimestamp(liveMarketState.fetchedAt)} · ${liveMarketProvider}`
    : `Market prices: refresh manually · ${MARKET_REFRESH_SOURCES}.`;
  const tickerEditsDirty = snapshot.holdings.some((holding) => {
    const editedTicker = getHoldingDisplayTicker(holding.ticker, holdingEdits)
      .trim()
      .toUpperCase();
    return editedTicker !== holding.ticker || Boolean(holdingEdits[holding.ticker]?.quote);
  });
  const editableDirty = scenarioDirty || tickerEditsDirty;
  const sharedHoldings = result.holdings.filter(
    (holding) => holding.category === "shared",
  );
  const personalHoldings = result.holdings.filter(
    (holding) => holding.category === "personal",
  );
  const editableHoldings = Array.from(
    new Map(result.holdings.map((holding) => [holding.ticker, holding])).values(),
  );
  const shareholderRows = snapshot.shareholders.map((holder) => {
    const personalMarketValue = sum(
      result.holdings
        .filter((holding) => holding.owner === holder.owner)
        .map((holding) => holding.marketValue),
    );
    const sharedMarketValue = result.totals.sharedMarketValue * holder.poolPercent;
    const estimatedEquity = sharedMarketValue + personalMarketValue;
    return {
      ...holder,
      sharedMarketValue,
      personalMarketValue,
      estimatedEquity,
      equityPnl: estimatedEquity - holder.totalInvested,
    };
  });
  const ownerValueCeiling = Math.max(
    1,
    ...shareholderRows.flatMap((holder) => [
      holder.totalInvested,
      holder.estimatedEquity,
    ]),
  );
  const ownershipRows = [...shareholderRows].sort(
    (left, right) => right.poolPercent - left.poolPercent,
  );

  const tickerBreakdown = Array.from(
    result.holdings
      .reduce((byTicker, holding) => {
        const current = byTicker.get(holding.ticker) ?? {
          ticker: holding.ticker,
          marketValue: 0,
          unrealizedPnl: 0,
        };
        current.marketValue += holding.marketValue;
        current.unrealizedPnl += holding.unrealizedPnl;
        byTicker.set(holding.ticker, current);
        return byTicker;
      }, new Map<string, { ticker: string; marketValue: number; unrealizedPnl: number }>())
      .values(),
  ).sort((left, right) => right.marketValue - left.marketValue);
  const tickerColors = [
    PORTFOLIO_THEME.meadow,
    PORTFOLIO_THEME.sky,
    PORTFOLIO_THEME.gold,
    PORTFOLIO_THEME.loss,
    PORTFOLIO_THEME.denim,
  ];
  const tickerAllocations = tickerBreakdown.map((item, index) => ({
    ticker: item.ticker,
    displayTicker: getHoldingDisplayTicker(item.ticker, holdingEdits),
    marketValue: item.marketValue,
    ratio: item.marketValue / Math.max(result.totals.marketValue, 1),
    color: tickerColors[index % tickerColors.length],
  }));
  const tickerRingStops = tickerAllocations
    .map((item, index) => {
      const start = sum(tickerAllocations.slice(0, index).map((prior) => prior.ratio));
      const end = start + item.ratio;
      return `${item.color} ${start * 100}% ${end * 100}%`;
    })
    .join(", ");
  const tickerRingFallbackStyle = {
    background: `conic-gradient(${tickerRingStops || "#dfe5e4 0% 100%"})`,
  } as CSSProperties;
  const pnlCeiling = Math.max(
    1,
    ...tickerBreakdown.map((item) => Math.abs(item.unrealizedPnl)),
  );
  const dividendOwners = [...result.dividend.byOwner].sort(
    (left, right) => right.capitalPercent - left.capitalPercent,
  );
  const ownershipChartRows: BarChart3DRow[] = ownershipRows.map((holder) => ({
    id: holder.owner,
    label: holder.owner,
    meta: `${formatPct(holder.poolPercent, 1)} pool`,
    badge: holder.owner.startsWith("Me")
      ? "ME"
      : holder.owner.slice(0, 1).toUpperCase(),
    headline: formatThb(holder.estimatedEquity),
    detail: `${holder.owner}: invested ${formatThb(holder.totalInvested)} · current equity ${formatThb(holder.estimatedEquity)}`,
    buttonAriaLabel: `Select ${holder.owner} ownership comparison: invested ${formatThb(holder.totalInvested)}, current equity ${formatThb(holder.estimatedEquity)}`,
    values: [
      {
        id: "invested",
        label: "Invested",
        value: holder.totalInvested,
        formattedValue: formatThb(holder.totalInvested),
        color: PORTFOLIO_THEME.gold,
      },
      {
        id: "equity",
        label: "Equity",
        value: holder.estimatedEquity,
        formattedValue: formatThb(holder.estimatedEquity),
        color: PORTFOLIO_THEME.meadow,
      },
    ],
  }));
  const pnlChartRows: BarChart3DRow[] = tickerBreakdown.map((item) => {
    const displayTicker = getHoldingDisplayTicker(item.ticker, holdingEdits);
    return {
      id: item.ticker,
      label: displayTicker,
      headline: formatSignedThb(item.unrealizedPnl),
      detail: `${displayTicker}: ${item.unrealizedPnl >= 0 ? "unrealized gain" : "unrealized loss"} ${formatThb(Math.abs(item.unrealizedPnl))}`,
      buttonAriaLabel: `Select ${displayTicker} unrealized P&L ${formatSignedThb(item.unrealizedPnl)}`,
      values: [
        {
          id: "pnl",
          label: item.unrealizedPnl >= 0 ? "Gain" : "Loss",
          value: item.unrealizedPnl,
          formattedValue: formatSignedThb(item.unrealizedPnl),
          color: item.unrealizedPnl >= 0 ? PORTFOLIO_THEME.meadow : PORTFOLIO_THEME.loss,
          tone: pnlClass(item.unrealizedPnl),
        },
      ],
    };
  });
  const dividendChartRows: BarChart3DRow[] = dividendOwners.map((owner) => ({
    id: owner.owner,
    label: owner.owner,
    meta: `${formatPct(owner.capitalPercent, 1)} of forecast`,
    badge: owner.owner.startsWith("Me")
      ? "ME"
      : owner.owner.slice(0, 1).toUpperCase(),
    headline: formatThb(owner.net),
    detail: `${owner.owner}: ${formatPct(owner.capitalPercent, 1)} of net forecast · ${formatThb(owner.net)}`,
    buttonAriaLabel: `Select ${owner.owner} dividend forecast ${formatPct(owner.capitalPercent, 1)}, ${formatThb(owner.net)}`,
    values: [
      {
        id: "forecast",
        label: "Net forecast",
        value: owner.capitalPercent,
        formattedValue: formatThb(owner.net),
        color: PORTFOLIO_THEME.sky,
      },
    ],
  }));

  const dividendLines = snapshot.dividend.lines.map((line) => {
    const dps = scenario.dividendDps[line.ticker] ?? line.dps;
    const gross = line.eligibleQuantity * dps;
    const wht = gross * scenario.whtRate;
    return { ...line, dps, gross, wht, net: gross - wht };
  });
  const currentCapitalForecast = snapshot.dividend.basis === "current-capital";

  const accountOptions = Array.from(
    new Set(snapshot.transactions.map((transaction) => transaction.account)),
  ).sort();
  const filteredTransactions = snapshot.transactions.filter((transaction) => {
    const haystack = [
      transaction.date,
      transaction.account,
      transaction.ticker,
      transaction.side,
      transaction.note,
    ]
      .join(" ")
      .toLowerCase();
    return (
      haystack.includes(search.toLowerCase()) &&
      (sideFilter === "ALL" || transaction.side === sideFilter) &&
      (accountFilter === "ALL" || transaction.account === accountFilter)
    );
  });

  const applyWorkbook = async (file: File, password: string) => {
    const requestId = ++workbookRequestIdRef.current;
    setImportError("");
    setImportNotice("");
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx")) {
        throw new Error("กรุณาเลือกไฟล์ .xlsx เท่านั้น");
      }
      const sourceBytes = await file.arrayBuffer();
      const parsed = parseMinimalHoldingsWorkbook(sourceBytes, file.name);
      const response = await fetch("/api/portfolio/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password,
          filename: parsed.filename,
          holdings: parsed.holdings,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as
        | SharedPortfolioState
        | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "บันทึกพอร์ตลงฐานข้อมูลร่วมไม่สำเร็จ",
        );
      }
      if (requestId !== workbookRequestIdRef.current) return;
      const state = body as SharedPortfolioState;
      const nextSnapshot = buildDashboardSnapshotFromSharedPortfolio(
        state.holdings,
        state.settings,
        state.latestImport?.filename ?? file.name,
      );
      const nextEdits = createHoldingEdits(nextSnapshot);
      const plan = createLiveMarketRefreshPlan(nextSnapshot, nextEdits);
      const timestamps = Object.values(state.quotes)
        .map((quote) => quote.quoteTimestamp)
        .filter((value): value is string => Boolean(value));
      const nextLiveState = createLiveMarketState(plan, {
        quotes: state.quotes,
        failures: {},
        fetchedAt:
          timestamps.sort().at(-1) ??
          state.latestImport?.importedAt ??
          new Date().toISOString(),
        provider: "Shared PostgreSQL",
        ...(state.marketSources?.length ? { sources: state.marketSources } : {}),
        refreshedKeys: [],
        retainedKeys: Object.keys(state.quotes),
      });
      setPortfolioHoldings(validateSharedHoldings(state.holdings));
      setSnapshot(nextSnapshot);
      setScenario(createScenario(nextSnapshot));
      setHoldingEdits(nextEdits);
      setMarketUi({});
      refreshRequestIdRef.current += 1;
      setLiveMarketState(nextLiveState);
      setLiveMarketNotice("ใช้ราคาล่าสุดที่บันทึกไว้ในฐานข้อมูลร่วม");
      setIsRefreshingMarket(false);
      setExportError("");
      setExportNotice("");
      setSourceMode("shared");
      setActiveTab("overview");
      setShowScenario(false);
      setShowEditPasswordDialog(false);
      setEditPassword("");
      setEditPasswordError("");
      setImportNotice("Import สำเร็จและบันทึกพอร์ตนี้ไว้ในฐานข้อมูลร่วมแล้ว");
    } catch (error) {
      setImportError(
        error instanceof Error
          ? `Import ไม่สำเร็จ: ${error.message}`
          : "Import ไม่สำเร็จ โปรดลองอีกครั้ง",
      );
    } finally {
      importPasswordRef.current = "";
      pendingImportFileRef.current = null;
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const password = importPasswordRef.current;
    if (file && password) {
      await applyWorkbook(file, password);
    } else if (file) {
      setImportError("กรุณายืนยันรหัสผ่านก่อน Import Excel");
    }
    event.target.value = "";
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) requestImportWorkbook(file);
  };

  const updatePrice = (ticker: string, rawValue: string) => {
    const nextValue = Number(rawValue);
    if (!Number.isFinite(nextValue) || nextValue <= 0) return;
    setScenario((current) => ({
      ...current,
      prices: { ...current.prices, [ticker]: nextValue },
    }));
    setHoldingEdits((current) => ({
      ...current,
      [ticker]: {
        ...(current[ticker] ?? { targetTicker: ticker, searchQuery: ticker }),
        quote: undefined,
        priceSource: "Manual",
      },
    }));
  };

  const updateDps = (ticker: string, rawValue: string) => {
    const nextValue = Number(rawValue);
    if (!Number.isFinite(nextValue) || nextValue < 0) return;
    setScenario((current) => ({
      ...current,
      dividendDps: { ...current.dividendDps, [ticker]: nextValue },
    }));
  };

  const updateMarketUi = (ticker: string, next: Partial<HoldingMarketUi>) => {
    setMarketUi((current) => ({
      ...current,
      [ticker]: { ...current[ticker], ...next },
    }));
  };

  const updateTargetTicker = (ticker: string, rawValue: string) => {
    setHoldingEdits((current) => ({
      ...current,
      [ticker]: {
        ...(current[ticker] ?? { targetTicker: ticker, searchQuery: ticker }),
        targetTicker: rawValue.toUpperCase(),
        selectedCandidate: undefined,
        quote: undefined,
        priceSource: "Manual",
      },
    }));
  };

  const updateSearchQuery = (ticker: string, rawValue: string) => {
    setHoldingEdits((current) => ({
      ...current,
      [ticker]: {
        ...(current[ticker] ?? { targetTicker: ticker, searchQuery: ticker }),
        searchQuery: rawValue,
      },
    }));
  };

  const searchYahoo = async (ticker: string) => {
    const query = holdingEdits[ticker]?.searchQuery.trim() ?? "";
    if (!query) {
      updateMarketUi(ticker, { error: "กรอกชื่อบริษัทหรือ Yahoo symbol ก่อนค้นหา" });
      return;
    }
    updateMarketUi(ticker, {
      isSearching: true,
      error: "",
      notice: "",
      candidates: [],
    });
    try {
      const response = await fetch(`/api/market/search?q=${encodeURIComponent(query)}`);
      const body = (await response.json()) as {
        candidates?: YahooSearchCandidate[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "ค้นหา Yahoo Finance ไม่สำเร็จ");
      const candidates = Array.isArray(body.candidates) ? body.candidates : [];
      updateMarketUi(ticker, {
        isSearching: false,
        candidates,
        error: candidates.length ? "" : "ไม่พบ symbol ที่ใช้ได้จาก Yahoo Finance",
      });
    } catch (error) {
      updateMarketUi(ticker, {
        isSearching: false,
        error:
          error instanceof Error ? error.message : "ค้นหา Yahoo Finance ไม่สำเร็จ",
      });
    }
  };

  const selectYahooCandidate = (ticker: string, candidate: YahooSearchCandidate) => {
    const holding = snapshot.holdings.find((item) => item.ticker === ticker);
    if (!holding) return;
    if (!isYahooCandidateCurrencyCompatible(candidate.currency, holding.currency)) {
      updateMarketUi(ticker, {
        error: `${candidate.symbol} ใช้สกุล ${candidate.currency}; holding นี้ต้องเป็น ${holding.currency}`,
      });
      return;
    }
    setHoldingEdits((current) => ({
      ...current,
      [ticker]: {
        ...(current[ticker] ?? { targetTicker: ticker, searchQuery: ticker }),
        targetTicker: candidate.symbol,
        searchQuery: candidate.name,
        selectedCandidate: candidate,
        quote: undefined,
      },
    }));
    updateMarketUi(ticker, { error: "", notice: `เลือก ${candidate.symbol} แล้ว` });
  };

  const refreshYahooQuote = async (ticker: string) => {
    const holding = snapshot.holdings.find((item) => item.ticker === ticker);
    const selectedCandidate = holdingEdits[ticker]?.selectedCandidate;
    if (!holding || !selectedCandidate) {
      updateMarketUi(ticker, { error: "เลือกผลลัพธ์ Yahoo Finance ก่อนดึงราคา" });
      return;
    }
    updateMarketUi(ticker, { isFetching: true, error: "", notice: "" });
    try {
      const response = await fetch(
        `/api/market/quote?symbol=${encodeURIComponent(selectedCandidate.symbol)}`,
      );
      const body = (await response.json()) as { quote?: MarketQuote; error?: string };
      if (!response.ok) throw new Error(body.error || "ดึงราคาจาก Yahoo Finance ไม่สำเร็จ");
      const quote = body.quote;
      if (!quote) throw new Error("Yahoo Finance ไม่ได้ส่งราคาที่ใช้งานได้");
      if (quote.symbol !== selectedCandidate.symbol || quote.currency !== holding.currency) {
        throw new Error("symbol หรือสกุลเงินของ quote ไม่ตรงกับ holding นี้");
      }
      setScenario((current) => ({
        ...current,
        prices: { ...current.prices, [ticker]: quote.price },
      }));
      setHoldingEdits((current) => ({
        ...current,
        [ticker]: {
          ...(current[ticker] ?? { targetTicker: ticker, searchQuery: ticker }),
          targetTicker: quote.symbol,
          quote,
          priceSource: "Yahoo Finance",
        },
      }));
      updateMarketUi(ticker, {
        isFetching: false,
        notice: `ดึง ${formatNative(quote.price, holding.currency)} จาก Yahoo Finance แล้ว`,
      });
    } catch (error) {
      updateMarketUi(ticker, {
        isFetching: false,
        error:
          error instanceof Error ? error.message : "ดึงราคาจาก Yahoo Finance ไม่สำเร็จ",
      });
    }
  };

  const refreshLiveMarketPrices = async () => {
    const plan = createLiveMarketRefreshPlan(snapshot, holdingEdits);
    if (plan.stocks.length === 0) {
      setLiveMarketState({
        ...createEmptyLiveMarketState(),
        failures: plan.unmappedTickers,
      });
      setLiveMarketNotice("ยังไม่มี mapping สำหรับแหล่งราคา");
      return;
    }

    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    setIsRefreshingMarket(true);
    setLiveMarketNotice("กำลังค้นหาราคาตลาด…");

    try {
      const response = await fetch("/api/market/refresh", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as Partial<
        LiveMarketBatchResponse
      > & { error?: string };
      if (!response.ok) {
        throw new Error(body.error || "ดึงราคาตลาดไม่สำเร็จ");
      }
      if (requestId !== refreshRequestIdRef.current) return;

      const nextState = createLiveMarketState(plan, {
        quotes: body.quotes ?? {},
        failures: body.failures ?? {},
        fetchedAt:
          typeof body.fetchedAt === "string"
            ? body.fetchedAt
            : new Date().toISOString(),
        ...(typeof body.provider === "string" ? { provider: body.provider } : {}),
        ...(Array.isArray(body.sources) ? { sources: body.sources } : {}),
        ...(Array.isArray(body.refreshedKeys)
          ? { refreshedKeys: body.refreshedKeys }
          : {}),
        ...(Array.isArray(body.retainedKeys)
          ? { retainedKeys: body.retainedKeys }
          : {}),
        ...(body.cooldownActive === true ? { cooldownActive: true } : {}),
      });
      setLiveMarketState(nextState);
      const failureCount = Object.keys(nextState.failures).length;
      const firstFailure = Object.values(nextState.failures)[0];
      setLiveMarketNotice(
        nextState.cooldownActive
          ? "ยังใช้ราคาที่บันทึกไว้เพราะอยู่ในช่วงพัก API 5 นาที — ไม่มีการเรียก OpenAI เพิ่ม"
          : failureCount
          ? `${failureCount} รายการยังไม่มีราคาที่ใช้ได้ · ${firstFailure}`
          : nextState.retainedStockCount || nextState.retainedFx
            ? `อัปเดตค่าที่หาได้แล้ว และคงค่าฐานข้อมูลเดิม ${nextState.retainedStockCount + (nextState.retainedFx ? 1 : 0)} รายการ`
            : "อัปเดตราคาตลาดและบันทึกลงฐานข้อมูลร่วมแล้ว",
      );
    } catch (error) {
      if (requestId !== refreshRequestIdRef.current) return;
      setLiveMarketNotice(
        error instanceof Error
          ? `${error.message} — ยังคงแสดงค่าที่บันทึกไว้ก่อนหน้า`
          : "ดึงราคา live ไม่สำเร็จ — ยังคงแสดงค่าที่บันทึกไว้ก่อนหน้า",
      );
    } finally {
      if (requestId === refreshRequestIdRef.current) {
        setIsRefreshingMarket(false);
      }
    }
  };

  const resetEdits = () => {
    setScenario(createScenario(snapshot));
    setHoldingEdits(createHoldingEdits(snapshot));
    setMarketUi({});
    setExportError("");
    setExportNotice("");
  };

  const closeEditPasswordDialog = () => {
    if (isVerifyingEditPassword) return;
    setShowEditPasswordDialog(false);
    setEditPassword("");
    setEditPasswordError("");
    importPasswordRef.current = "";
    pendingImportFileRef.current = null;
    window.requestAnimationFrame(() => editModeButtonRef.current?.focus());
  };

  const requestEditMode = () => {
    if (showScenario) {
      setShowScenario(false);
      setEditPassword("");
      setEditPasswordError("");
      return;
    }
    setEditPasswordPurpose("edit");
    setEditPassword("");
    setEditPasswordError("");
    setEditPasswordPromptVersion((current) => current + 1);
    setShowEditPasswordDialog(true);
  };

  const requestImportWorkbook = (file: File | null = null) => {
    pendingImportFileRef.current = file;
    importPasswordRef.current = "";
    setEditPasswordPurpose("import");
    setEditPassword("");
    setEditPasswordError("");
    setEditPasswordPromptVersion((current) => current + 1);
    setShowEditPasswordDialog(true);
  };

  const verifyEditPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editPassword) {
      setEditPasswordError("กรุณาใส่รหัสผ่าน Edit Mode");
      editPasswordInputRef.current?.focus();
      return;
    }

    setIsVerifyingEditPassword(true);
    setEditPasswordError("");
    try {
      const response = await fetch("/api/edit-auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: editPassword }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        authenticated?: boolean;
      };

      if (!response.ok || body.authenticated !== true) {
        setEditPassword("");
        setEditPasswordError(
          response.status === 401
            ? "รหัสผ่านไม่ถูกต้อง"
            : response.status === 503
              ? "ระบบตรวจสอบรหัสผ่านยังไม่พร้อม"
              : "ตรวจสอบรหัสผ่านไม่ได้ โปรดลองอีกครั้ง",
        );
        window.requestAnimationFrame(() => editPasswordInputRef.current?.focus());
        return;
      }

      const verifiedPassword = editPassword;
      setEditPassword("");
      setEditPasswordError("");
      setShowEditPasswordDialog(false);
      if (editPasswordPurpose === "import") {
        importPasswordRef.current = verifiedPassword;
        const pendingFile = pendingImportFileRef.current;
        if (pendingFile) {
          void applyWorkbook(pendingFile, verifiedPassword);
        } else {
          window.requestAnimationFrame(() => fileInputRef.current?.click());
        }
        window.setTimeout(() => {
          if (importPasswordRef.current === verifiedPassword) {
            importPasswordRef.current = "";
          }
        }, 120_000);
      } else {
        setShowScenario(true);
        window.requestAnimationFrame(() => editModeButtonRef.current?.focus());
      }
    } catch {
      setEditPassword("");
      setEditPasswordError("เชื่อมต่อระบบตรวจสอบรหัสผ่านไม่ได้ โปรดลองอีกครั้ง");
      window.requestAnimationFrame(() => editPasswordInputRef.current?.focus());
    } finally {
      setIsVerifyingEditPassword(false);
    }
  };

  const exportWorkbook = () => {
    setExportError("");
    setExportNotice("");
    setIsExporting(true);
    try {
      const exportHoldings = validateSharedHoldings(
        portfolioHoldings.map((holding) => ({
          ...holding,
          ticker: getHoldingDisplayTicker(holding.ticker, holdingEdits),
        })),
      );
      const exported = exportMinimalHoldingsWorkbook(exportHoldings, {
        exportedAt: new Date().toISOString(),
      });
      const blob = new Blob([exported.bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exported.filename;
      link.click();
      URL.revokeObjectURL(url);
      setExportNotice(
        `สร้าง ${exported.filename} แล้ว — มีเฉพาะ Ticker, Owner/Account, Entry Price และ Units`,
      );
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "สร้างไฟล์ Excel ใหม่ไม่สำเร็จ",
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <main className="dashboard-shell ghibli-countryside-ledger">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-cluster">
            <div className="brand-mark" aria-hidden="true">
              SA
            </div>
            <div>
              <p className="eyebrow">PRIVATE PORTFOLIO</p>
              <h1>Stock Audit</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              className="button button-market-refresh"
              type="button"
              onClick={refreshLiveMarketPrices}
              disabled={isRefreshingMarket}
            >
              {isRefreshingMarket ? "Refreshing prices..." : "Refresh market prices"}
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => requestImportWorkbook()}
            >
              Import Excel
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFileChange}
              hidden
            />
          </div>
        </div>
      </header>

      <div className="dashboard-container">
        <section className="source-banner">
          <div>
            <span className={`source-dot ${sourceMode}`} aria-hidden="true" />
            <strong>{sourceMode === "shared" ? "Shared PostgreSQL portfolio" : "Embedded audit snapshot"}</strong>
            <span> · {snapshot.filename} · As of {snapshot.asOfDate}</span>
          </div>
          <span className={editableDirty ? "scenario-status active" : "scenario-status"}>
            {editableDirty ? "Unsaved dashboard scenario" : sourceMode === "shared" ? "Shared values" : "Fallback values"}
          </span>
        </section>

        <section
          className={`live-market-status ${liveMarketState.fetchedAt ? "updated" : "idle"}${liveMarketFailureCount ? " partial" : ""}`}
          aria-live="polite"
        >
          <span className="live-market-status-dot" aria-hidden="true" />
          <div>
            <strong>{liveMarketStatusText}</strong>
            <span>
              {liveMarketNotice ||
                "Refresh saves the latest usable quotes to the shared database."}
            </span>
            {liveMarketState.sources?.length ? (
              <span className="live-market-source-links">
                Sources consulted:
                {liveMarketState.sources.map((source) => (
                  <a href={source.url} key={source.url} rel="noreferrer" target="_blank">
                    {source.title}
                  </a>
                ))}
              </span>
            ) : null}
          </div>
        </section>

        <section
          className={`import-zone ${isDragging ? "dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div>
            <strong>อัปเดต Holdings จาก Excel</strong>
            <span>ใช้ไฟล์ 4 คอลัมน์: Ticker, Owner/Account, Entry Price, Units</span>
          </div>
          <button
            className="text-button"
            type="button"
            onClick={() => requestImportWorkbook()}
          >
            เลือกไฟล์
          </button>
        </section>
        {importError ? (
          <p className="import-error" role="alert">
            {importError}
          </p>
        ) : null}
        {importNotice ? (
          <p className="import-notice" role="status">
            {importNotice}
          </p>
        ) : null}

        <nav className="tabs" aria-label="Dashboard sections">
          {TABS.map(([tab, label]) => (
            <button
              className={activeTab === tab ? "active" : ""}
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeTab === "overview" ? (
          <>
            <section className="wealth-hero">
              <div className="wealth-hero-primary">
                <div className="wealth-hero-copy">
                  <p className="eyebrow">FAMILY PORTFOLIO</p>
                  <span className="wealth-hero-label">Portfolio Market Value</span>
                  <h2>{formatThb(result.totals.marketValue)}</h2>
                  <div className="wealth-hero-summary">
                    <strong className={pnlClass(result.totals.totalPnl)}>
                      Total P&amp;L {formatSignedThb(result.totals.totalPnl)}
                    </strong>
                    <span>As of {snapshot.asOfDate}</span>
                  </div>
                </div>
                <div className="wealth-hero-artwork" aria-hidden="true">
                  <img src="/family-portfolio-hero.png" alt="" />
                </div>
              </div>
              <div className="wealth-hero-stats">
                <div>
                  <span>Unrealized P&amp;L</span>
                  <strong className={pnlClass(result.totals.unrealizedPnl)}>
                    {formatSignedThb(result.totals.unrealizedPnl)}
                  </strong>
                  <small>Mark-to-market</small>
                </div>
                <div>
                  <span>Realized P&amp;L</span>
                  <strong className={pnlClass(result.totals.realizedPnl)}>
                    {formatSignedThb(result.totals.realizedPnl)}
                  </strong>
                  <small>Imported audit figure</small>
                </div>
                <div>
                  <span>Net Dividend Forecast</span>
                  <strong>{formatThb(result.dividend.net)}</strong>
                  <small>Current capital basis</small>
                </div>
              </div>
            </section>

            <section
              className="panel family-ownership-panel"
              aria-label="Family ownership comparison: invested capital versus estimated current equity"
            >
              <SectionTitle
                eyebrow="FAMILY OWNERSHIP"
                title="ใครถืออะไร · Family ownership"
                action={(
                  <span
                    className="shared-pool-badge minimal"
                    aria-label={`Shared pool ${formatThb(snapshot.summary.sharedCapital)}`}
                  >
                    <small>SHARED POOL</small>
                    <strong>{formatThb(snapshot.summary.sharedCapital)}</strong>
                  </span>
                )}
              />
              <div className="ownership-legend" aria-hidden="true">
                <span><i className="capital-swatch" />Total invested</span>
                <span><i className="equity-swatch" />Current equity</span>
              </div>
              <div className="ownership-chart">
                {ownershipRows.map((holder, index) => {
                  const chartRow = ownershipChartRows[index];
                  return (
                    <div className="ownership-row" key={holder.owner}>
                      <div className="owner-identity">
                        <span className="owner-avatar" aria-hidden="true">
                          {holder.owner.startsWith("Me")
                            ? "ME"
                            : holder.owner.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <strong>{holder.owner}</strong>
                          <span>{formatPct(holder.poolPercent, 1)} pool</span>
                        </div>
                      </div>
                      <div className="owner-bars">
                        <div className="owner-bar-labels" aria-hidden="true">
                          <span>Invested</span>
                          <span>Equity</span>
                        </div>
                        <CompactBarField3D
                          rows={[chartRow]}
                          mode="paired"
                          scaleMax={ownerValueCeiling}
                          ariaLabel={`Interactive 3D family ownership bars for ${holder.owner}: invested ${formatThb(holder.totalInvested)}, current equity ${formatThb(holder.estimatedEquity)}`}
                          className="ownership-r3f-bars"
                        />
                        <div className="owner-bar-values">
                          <strong>{formatThb(holder.totalInvested)}</strong>
                          <strong>{formatThb(holder.estimatedEquity)}</strong>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="panel-note">
                Current equity = shared market value × pool % + personal position market value.
              </p>
            </section>

            <section className="wealth-analytics-grid">
              <article
                className="panel composition-panel"
                aria-label="Portfolio composition by ticker"
              >
                <SectionTitle
                  eyebrow="ALLOCATION"
                  title="Portfolio composition"
                  action={<span className="composition-total-chip">{formatThb(result.totals.marketValue)}</span>}
                />
                <PortfolioComposition3D
                  allocations={tickerAllocations}
                  totalValue={result.totals.marketValue}
                  fallbackStyle={tickerRingFallbackStyle}
                />
                <p className="panel-note">Shared and personal accounts are aggregated by ticker.</p>
              </article>

              <article className="panel pnl-chart-panel" aria-label="Unrealized P&L by ticker">
                <SectionTitle eyebrow="PERFORMANCE" title="P&L by ticker" />
                <div className="pnl-chart">
                  <div className="pnl-axis" aria-hidden="true">
                    <span>Loss</span>
                    <span>฿0</span>
                    <span>Gain</span>
                  </div>
                  <div className="pnl-compact-grid">
                    <div className="pnl-row-labels">
                      {pnlChartRows.map((row) => (
                        <strong key={row.id}>{row.label}</strong>
                      ))}
                    </div>
                    <CompactBarField3D
                      rows={pnlChartRows}
                      mode="diverging"
                      scaleMax={pnlCeiling}
                      ariaLabel="Interactive 3D unrealized P&L bars"
                      className="pnl-r3f-bars"
                    />
                    <div className="pnl-row-values">
                      {pnlChartRows.map((row) => (
                        <b className={row.values[0]?.tone} key={row.id}>
                          {row.values[0]?.formattedValue}
                        </b>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="panel-note">Unrealized P&amp;L only; realized trades remain in the ledger.</p>
              </article>

              <article
                className="panel dividend-distribution-panel"
                aria-label="Net dividend forecast distribution"
              >
                <SectionTitle eyebrow="NEXT FAMILY CASH FLOW" title="Dividend distribution" />
                <div className="dividend-total">
                  <span>Net forecast</span>
                  <strong>{formatThb(result.dividend.net)}</strong>
                  <small>{formatPct(result.dividend.grossYield)} gross yield · current capital</small>
                </div>
                <div className="dividend-owner-chart">
                  <div className="dividend-compact-grid">
                    <div className="dividend-row-labels">
                      {dividendOwners.map((owner) => (
                        <div key={owner.owner}>
                          <strong>{owner.owner}</strong>
                          <span>{formatPct(owner.capitalPercent, 1)}</span>
                        </div>
                      ))}
                    </div>
                    <CompactBarField3D
                      rows={dividendChartRows}
                      mode="progress"
                      scaleMax={1}
                      ariaLabel="Interactive 3D net dividend forecast bars"
                      className="dividend-r3f-bars"
                    />
                    <div className="dividend-row-values">
                      {dividendOwners.map((owner) => (
                        <b key={owner.owner}>{formatThb(owner.net)}</b>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="panel-note warning">
                  Forecast from current capital; historical Apr 2026 net was {formatThb(snapshot.historicalDividend.net)}.
                </p>
              </article>
            </section>
          </>
        ) : null}

        {activeTab === "shareholders" ? (
          <section className="panel">
            <SectionTitle
              eyebrow="OWNERSHIP"
              title="เงินลงทุนและมูลค่าโดยประมาณต่อคน"
            />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Shareholder</th>
                    <th>Shared Capital</th>
                    <th>% Pool</th>
                    <th>Personal</th>
                    <th>Total Invested</th>
                    <th>Est. Current Equity</th>
                    <th>P&amp;L vs Invested</th>
                  </tr>
                </thead>
                <tbody>
                  {shareholderRows.map((holder) => (
                    <tr key={holder.owner}>
                      <td>
                        <strong>{holder.owner}</strong>
                      </td>
                      <td>{formatThb(holder.sharedCapital)}</td>
                      <td>{formatPct(holder.poolPercent)}</td>
                      <td>{formatThb(holder.personalCapital)}</td>
                      <td>{formatThb(holder.totalInvested)}</td>
                      <td>{formatThb(holder.estimatedEquity)}</td>
                      <td className={pnlClass(holder.equityPnl)}>
                        {formatThb(holder.equityPnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="panel-note">
              Estimated Current Equity = Shared Market Value × % Pool + personal position market value.
              It is a dashboard estimate; the audit ledger remains in Excel.
            </p>
          </section>
        ) : null}

        {activeTab === "holdings" ? (
          <section className="holdings-layout">
            {[
              ["Shared pool · SCB + KBANK", sharedHoldings],
              ["Personal positions · Owner-specific", personalHoldings],
            ].map(([title, positions]) => (
              <article className="panel" key={String(title)}>
                <SectionTitle eyebrow="HOLDINGS" title={String(title)} />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th>Owner / Account</th>
                        <th>Qty</th>
                        <th>Avg Cost</th>
                        <th>Current Price</th>
                        <th>Market Value</th>
                        <th>Unrealized P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(positions as typeof result.holdings).map((holding) => (
                        <tr key={`${holding.ticker}:${holding.account}`}>
                          <td>
                            <strong>{getHoldingDisplayTicker(holding.ticker, holdingEdits)}</strong>
                            <span className="currency-tag">{holding.currency}</span>
                          </td>
                          <td>{holding.owner ?? holding.account}</td>
                          <td>{formatQty(holding.quantity)}</td>
                          <td>{formatThb(holding.avgCostThb, 2)}</td>
                          <td>{formatNative(holding.priceNative, holding.currency)}</td>
                          <td>{formatThb(holding.marketValue)}</td>
                          <td className={pnlClass(holding.unrealizedPnl)}>
                            {formatThb(holding.unrealizedPnl)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
          </section>
        ) : null}

        {activeTab === "dividends" ? (
          <>
            <section className="dividend-flow">
              <div>
                <span>{currentCapitalForecast ? "Gross forecast" : "Gross dividend"}</span>
                <strong>{formatThb(result.dividend.gross)}</strong>
              </div>
              <span className="flow-arrow">−</span>
              <div>
                <span>{formatPct(scenario.whtRate, 0)} WHT</span>
                <strong>{formatThb(result.dividend.wht)}</strong>
              </div>
              <span className="flow-arrow">=</span>
              <div className="net-flow">
                <span>{currentCapitalForecast ? "Net forecast" : "Net received"}</span>
                <strong>{formatThb(result.dividend.net)}</strong>
              </div>
            </section>

            <section className="overview-grid">
              <article className="panel">
                <SectionTitle
                  eyebrow={currentCapitalForecast ? "CURRENT-CAPITAL FORECAST" : "DIVIDEND LINES"}
                  title={currentCapitalForecast ? "DPS และหุ้นที่ถือปัจจุบัน" : "หุ้นและสิทธิ์ปันผล"}
                  action={
                    currentCapitalForecast ? (
                      <span className="count-chip">
                        Yield {formatPct(result.dividend.grossYield)}
                      </span>
                    ) : undefined
                  }
                />
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th>{currentCapitalForecast ? "Current Qty" : "Eligible Qty"}</th>
                        <th>DPS</th>
                        <th>{currentCapitalForecast ? "Gross reference" : "Gross"}</th>
                        <th>{currentCapitalForecast ? "Treatment" : "WHT"}</th>
                        {!currentCapitalForecast ? <th>Net</th> : null}
                        {!currentCapitalForecast ? <th>XD</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {dividendLines.map((line) => (
                        <tr key={line.ticker}>
                          <td><strong>{getHoldingDisplayTicker(line.ticker, holdingEdits)}</strong></td>
                          <td>{formatQty(line.eligibleQuantity)}</td>
                          <td>{formatThb(line.dps, 2)}</td>
                          <td>{formatThb(line.gross)}</td>
                          <td>{currentCapitalForecast ? line.note : formatThb(line.wht)}</td>
                          {!currentCapitalForecast ? <td>{formatThb(line.net)}</td> : null}
                          {!currentCapitalForecast ? <td>{formatDate(line.xdDate)}</td> : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="panel">
                <SectionTitle
                  eyebrow={currentCapitalForecast ? "CURRENT CAPITAL SPLIT" : "CURRENT POOL RATIO"}
                  title={currentCapitalForecast ? "แบ่งยอดสุทธิประมาณการ" : "แบ่งสุทธิให้แต่ละคน"}
                  action={
                    currentCapitalForecast ? (
                      <span className="count-chip">
                        Capital {formatThb(result.dividend.currentCapital)}
                      </span>
                    ) : undefined
                  }
                />
                <div className="payout-list">
                  {result.dividend.byOwner.map((owner) => (
                    <div key={owner.owner}>
                      <span>{owner.owner}</span>
                      <strong>{formatThb(owner.net)}</strong>
                      <small>
                        {currentCapitalForecast ? (
                          <>Capital {formatThb(owner.capital)} · {formatPct(owner.capitalPercent)} · </>
                        ) : null}
                        Gross {formatThb(owner.gross)} · WHT {formatThb(owner.wht)}
                      </small>
                    </div>
                  ))}
                </div>
                <p className="panel-note warning">
                  {currentCapitalForecast
                    ? `Historical Apr 2026 payout: ${formatThb(snapshot.historicalDividend.net)} net. This forecast uses current capital and prior-year recurring DPS; it is not an announced payout.`
                    : "Historical Apr 2026 payout uses its historical eligibility and allocation. This view is for scenario planning only."}
                </p>
              </article>
            </section>
          </>
        ) : null}

        {activeTab === "transactions" ? (
          <section className="panel transaction-panel">
            <SectionTitle
              eyebrow="LEDGER"
              title="รายการซื้อขายจาก Excel"
              action={<span className="count-chip">{filteredTransactions.length} / {snapshot.transactions.length} rows</span>}
            />
            <div className="filters">
              <label>
                <span>ค้นหา</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Ticker, account, note..."
                />
              </label>
              <label>
                <span>Side</span>
                <select value={sideFilter} onChange={(event) => setSideFilter(event.target.value)}>
                  <option value="ALL">All</option>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </label>
              <label>
                <span>Account</span>
                <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
                  <option value="ALL">All accounts</option>
                  {accountOptions.map((account) => (
                    <option key={account} value={account}>{account}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="table-wrap">
              <table className="transactions-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Account</th>
                    <th>Ticker</th>
                    <th>Side</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>FX</th>
                    <th>Cost / Proceeds</th>
                    <th>Realized P&amp;L</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((transaction, index) => (
                    <tr key={`${transaction.date}-${transaction.ticker}-${index}`}>
                      <td>{formatDate(transaction.date)}</td>
                      <td>{transaction.account}</td>
                      <td><strong>{getHoldingDisplayTicker(transaction.ticker, holdingEdits)}</strong></td>
                      <td>
                        <span className={`side-pill ${transaction.side.toLowerCase()}`}>
                          {transaction.side}
                        </span>
                      </td>
                      <td>{formatQty(transaction.quantity)}</td>
                      <td>{transaction.currency === "USD" ? `$${decimalFormatter.format(transaction.priceNative)}` : formatThb(transaction.priceNative, 2)}</td>
                      <td>{transaction.fx ? decimalFormatter.format(transaction.fx) : "—"}</td>
                      <td>{formatThb(transaction.costProceedsThb)}</td>
                      <td className={pnlClass(transaction.realizedPnlThb)}>
                        {formatThb(transaction.realizedPnlThb)}
                      </td>
                      <td className="transaction-note">{transaction.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredTransactions.length === 0 ? <EmptyTransactions /> : null}
            </div>
            <p className="panel-note warning">
              Realized P&amp;L is imported from the current audit workbook. Confirm lot-time-specific cost treatment before using it for settlement-grade accounting.
            </p>
          </section>
        ) : null}

        <section className={`scenario-panel ${showScenario ? "open" : ""}`}>
          <div className="scenario-heading">
            <div>
              <p className="eyebrow">EDIT &amp; EXPORT</p>
              <h2>แก้ dashboard scenario และ export raw holdings</h2>
              <p>ราคา Yahoo ใช้ดู scenario เท่านั้น; Save จะสร้าง Excel ใหม่แบบ 4 คอลัมน์</p>
            </div>
            <div className="scenario-actions">
              {showScenario ? (
                <>
                  <button
                    className="button button-ghost"
                    type="button"
                    onClick={resetEdits}
                  >
                    Reset
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={isExporting}
                    onClick={exportWorkbook}
                  >
                    {isExporting ? "กำลังสร้าง Excel..." : "Save & Download Excel"}
                  </button>
                </>
              ) : null}
              <button
                ref={editModeButtonRef}
                className="button button-primary"
                type="button"
                onClick={requestEditMode}
              >
                {showScenario ? "ปิด Edit Mode" : "เปิด Edit Mode"}
              </button>
            </div>
          </div>

          {showScenario ? (
            <>
              <div className="scenario-body">
                <div className="scenario-group market-edit-group">
                  <h3>Holdings, global ticker และราคาปัจจุบัน</h3>
                  <p className="scenario-note">
                    การเปลี่ยน ticker จะเขียนทับ ticker เดิมใน ledger และสูตรที่อ้างถึงมันเฉพาะในไฟล์ใหม่
                  </p>
                  <div className="holding-edit-list">
                    {editableHoldings.map((holding) => {
                      const edit = holdingEdits[holding.ticker] ?? {
                        targetTicker: holding.ticker,
                        searchQuery: holding.ticker,
                      };
                      const market = marketUi[holding.ticker] ?? {};
                      return (
                        <article className="holding-edit-card" key={holding.ticker}>
                          <div className="holding-edit-title">
                            <div>
                              <strong>{holding.ticker}</strong>
                              <span>{holding.owner ?? holding.account} · {holding.currency}</span>
                            </div>
                            {edit.targetTicker !== holding.ticker ? (
                              <span className="rename-preview">→ {edit.targetTicker || "(empty)"}</span>
                            ) : null}
                          </div>
                          <div className="holding-edit-fields">
                            <label>
                              <span>Global audit ticker</span>
                              <input
                                value={edit.targetTicker}
                                onChange={(event) => updateTargetTicker(holding.ticker, event.target.value)}
                              />
                            </label>
                            <label>
                              <span>Search Yahoo Finance</span>
                              <div className="inline-input-action">
                                <input
                                  value={edit.searchQuery}
                                  onChange={(event) => updateSearchQuery(holding.ticker, event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      void searchYahoo(holding.ticker);
                                    }
                                  }}
                                />
                                <button
                                  className="inline-button"
                                  type="button"
                                  disabled={market.isSearching}
                                  onClick={() => void searchYahoo(holding.ticker)}
                                >
                                  {market.isSearching ? "Searching..." : "Search"}
                                </button>
                              </div>
                            </label>
                            <label>
                              <span>Current price ({holding.currency})</span>
                              <div className="inline-input-action">
                                <input
                                  type="number"
                                  min="0.0001"
                                  step="0.01"
                                  value={scenario.prices[holding.ticker] ?? 0}
                                  onChange={(event) => updatePrice(holding.ticker, event.target.value)}
                                />
                                <button
                                  className="inline-button"
                                  type="button"
                                  disabled={!edit.selectedCandidate || market.isFetching}
                                  onClick={() => void refreshYahooQuote(holding.ticker)}
                                >
                                  {market.isFetching ? "Fetching..." : "Fetch"}
                                </button>
                              </div>
                            </label>
                          </div>
                          {market.candidates?.length ? (
                            <div className="yahoo-candidates" aria-label={`${holding.ticker} Yahoo candidates`}>
                              {market.candidates.map((candidate) => (
                                <button
                                  className={
                                    edit.selectedCandidate?.symbol === candidate.symbol
                                      ? "selected"
                                      : ""
                                  }
                                  key={candidate.symbol}
                                  type="button"
                                  onClick={() => selectYahooCandidate(holding.ticker, candidate)}
                                >
                                  <strong>{candidate.symbol}</strong>
                                  <span>{candidate.name}</span>
                                  <small>{candidate.exchange} · {candidate.currency}</small>
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {edit.selectedCandidate ? (
                            <p className="selection-note">
                              Selected: {edit.selectedCandidate.name} · {edit.selectedCandidate.symbol}
                            </p>
                          ) : null}
                          {edit.quote ? (
                            <p className="selection-note">
                              Yahoo quote: {formatNative(edit.quote.price, holding.currency)} · {edit.quote.marketState}
                            </p>
                          ) : null}
                          {market.error ? <p className="market-message error" role="alert">{market.error}</p> : null}
                          {market.notice ? <p className="market-message">{market.notice}</p> : null}
                        </article>
                      );
                    })}
                  </div>
                </div>
                <div className="scenario-group">
                  <h3>FX และ forecast dividend assumptions</h3>
                  <div className="scenario-grid">
                    <label>
                      <span>USD / THB FX</span>
                      <input
                        type="number"
                        min="0.0001"
                        step="0.0001"
                        value={scenario.fx}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value);
                          if (Number.isFinite(nextValue) && nextValue > 0) {
                            setScenario((current) => ({ ...current, fx: nextValue }));
                          }
                        }}
                      />
                    </label>
                    {snapshot.dividend.lines.map((line) => (
                      <label key={line.ticker}>
                        <span>{getHoldingDisplayTicker(line.ticker, holdingEdits)} DPS (THB)</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={scenario.dividendDps[line.ticker] ?? line.dps}
                          onChange={(event) => updateDps(line.ticker, event.target.value)}
                        />
                      </label>
                    ))}
                    <label>
                      <span>Withholding tax (%)</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={scenario.whtRate * 100}
                        onChange={(event) => {
                          const nextValue = Number(event.target.value) / 100;
                          if (Number.isFinite(nextValue) && nextValue >= 0 && nextValue <= 1) {
                            setScenario((current) => ({ ...current, whtRate: nextValue }));
                          }
                        }}
                      />
                    </label>
                  </div>
                  <p className="scenario-note">
                    ราคา current, DPS และ WHT เป็น dashboard scenario เท่านั้น; Excel ที่ export จะเก็บเฉพาะ Ticker, Owner/Account, Entry Price และ Units
                  </p>
                </div>
              </div>
              {exportError ? <p className="export-message error" role="alert">{exportError}</p> : null}
              {exportNotice ? <p className="export-message">{exportNotice}</p> : null}
            </>
          ) : null}
        </section>

        {showEditPasswordDialog ? (
          <div
            className="edit-password-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeEditPasswordDialog();
            }}
          >
            <section
              className="edit-password-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-password-title"
              aria-describedby="edit-password-description"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeEditPasswordDialog();
                }
              }}
            >
              <div className="edit-password-heading">
                <span className="edit-password-lock" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M7.5 10V7.7a4.5 4.5 0 0 1 9 0V10m-10 0h11a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5v-7A1.5 1.5 0 0 1 6.5 10Z" />
                  </svg>
                </span>
                <div>
                  <p className="eyebrow">PRIVATE CONTROL</p>
                  <h2 id="edit-password-title">
                    {editPasswordPurpose === "import"
                      ? "Authorize Shared Import"
                      : "Unlock Edit Mode"}
                  </h2>
                </div>
              </div>
              <p id="edit-password-description" className="edit-password-description">
                {editPasswordPurpose === "import"
                  ? "ใส่รหัสผ่านเพื่อแทนที่ Holdings ในฐานข้อมูลร่วม ระบบจะตรวจสอบไฟล์อีกครั้งบน server"
                  : "ใส่รหัสผ่านเพื่อแก้ dashboard scenario และ export Excel ระบบจะถามใหม่ทุกครั้งหลังปิด Edit Mode"}
              </p>
              <form className="edit-password-form" onSubmit={verifyEditPassword}>
                <label htmlFor="edit-password">Edit Mode password</label>
                <input
                  key={editPasswordPromptVersion}
                  ref={editPasswordInputRef}
                  id="edit-password"
                  name={`edit-mode-password-${editPasswordPromptVersion}`}
                  type="password"
                  autoComplete="one-time-code"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  spellCheck={false}
                  value={editPassword}
                  disabled={isVerifyingEditPassword}
                  aria-invalid={Boolean(editPasswordError)}
                  aria-errormessage={editPasswordError ? "edit-password-error" : undefined}
                  onChange={(event) => {
                    setEditPassword(event.target.value);
                    if (editPasswordError) setEditPasswordError("");
                  }}
                />
                <div className="edit-password-message" aria-live="polite">
                  {editPasswordError ? (
                    <p id="edit-password-error" role="alert">
                      {editPasswordError}
                    </p>
                  ) : (
                    <p>รหัสจะถูกส่งไปตรวจสอบกับ Worker และไม่ถูกบันทึกใน browser</p>
                  )}
                </div>
                <div className="edit-password-actions">
                  <button
                    className="button button-ghost"
                    type="button"
                    disabled={isVerifyingEditPassword}
                    onClick={closeEditPasswordDialog}
                  >
                    ยกเลิก
                  </button>
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={isVerifyingEditPassword}
                  >
                    {isVerifyingEditPassword
                      ? "กำลังตรวจสอบ..."
                      : editPasswordPurpose === "import"
                        ? "Continue to Import"
                        : "Unlock Edit Mode"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        ) : null}

        <footer className="dashboard-footer">
          <span>Shared source of truth: Railway PostgreSQL</span>
          <span>Excel import/export contains only the four raw holding fields.</span>
        </footer>
      </div>
    </main>
  );
}
