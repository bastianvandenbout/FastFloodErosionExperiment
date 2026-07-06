// State management for the 1D Visualizer
let terrainData = null;
let hoveredCellIndex = -1;
let pinnedCellIndex = -1;

// Simulation State (Green & Ampt runoff simulation)
// 96 intervals of 15 minutes each (total 24 hours)
let rainfall = new Float32Array(96);
let simulationResults = null;
let avgInfiltrationHourly = new Float32Array(96); // Average infiltration rate (mm/h) per 15-min interval
let criticalStreamPower = 0.20;

// Dragging state for Rainfall Editor
let isDraggingSingleBar = false; // Dragging a single node up/down
let isDraggingSweep = false;     // Freehand sweeping/drawing across multiple bars
let activeRainBarIndex = -1;
let lastMouseX = -1;
let lastMouseY = -1;

// Canvas state for zoom & pan
let scale = 1.0;
let offsetX = 0;
let isDragging = false;
let startX = 0;

// Initialize default rainfall profile: 30 mm total storm depth
// Spread over the first 7 hours (Hours 1 to 6)
function initDefaultRainfall() {
    rainfall.fill(0.0);
    // Hour 1 (intervals 4..7): 2 mm/h
    for (let i = 4; i < 8; i++) rainfall[i] = 2.0;
    // Hour 2 (intervals 8..11): 10 mm/h
    for (let i = 8; i < 12; i++) rainfall[i] = 10.0;
    // Hour 3 (intervals 12..15): 8 mm/h
    for (let i = 12; i < 16; i++) rainfall[i] = 8.0;
    // Hour 4 (intervals 16..19): 6 mm/h
    for (let i = 16; i < 20; i++) rainfall[i] = 6.0;
    // Hour 5 (intervals 20..23): 3 mm/h
    for (let i = 20; i < 24; i++) rainfall[i] = 3.0;
    // Hour 6 (intervals 24..27): 1 mm/h
    for (let i = 24; i < 28; i++) rainfall[i] = 1.0;
}

// DOM Elements
const canvas = document.getElementById('profile-canvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('profile-container');
const loadingOverlay = document.getElementById('loading-overlay');

const slopeSlider = document.getElementById('slope-multiplier');
const textureSlider = document.getElementById('texture-multiplier');
const slopeVal = document.getElementById('slope-val');
const textureVal = document.getElementById('texture-val');
const regenerateBtn = document.getElementById('regenerate-btn');

// Infiltration and Catchment Sliders
const ksatSlider = document.getElementById('ksat-val-input');
const ksatVal = document.getElementById('ksat-val');
const moistureSlider = document.getElementById('moisture-input');
const moistureVal = document.getElementById('moisture-val');
const shapeBSlider = document.getElementById('shape-b-input');
const shapeBVal = document.getElementById('shape-b-val');
const critStreamPowerSlider = document.getElementById('crit-stream-power-input');
const critStreamPowerVal = document.getElementById('crit-stream-power-val');

// Catchment display element
const totalCatchmentAreaVal = document.getElementById('total-catchment-area-val');

// Rainfall Editor Stats & Container
const totalRainVal = document.getElementById('total-rain-val');
const rainfallBarsContainer = document.getElementById('rainfall-bars-editor');

const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomResetBtn = document.getElementById('zoom-reset');

// Telemetry DOM Elements
const telCellId = document.getElementById('hover-cell-id');
const telDistance = document.getElementById('tel-distance');
const telElevation = document.getElementById('tel-elevation');
const telSlope = document.getElementById('tel-slope');
const telManning = document.getElementById('tel-manning');
const telCohesion = document.getElementById('tel-cohesion');
const telGrain = document.getElementById('tel-grain');
const telTotalRain = document.getElementById('tel-total-rain');
const telTotalInfil = document.getElementById('tel-total-infil');
const telDrainageArea = document.getElementById('tel-drainage-area');
const telLocalVel = document.getElementById('tel-local-vel');
const telShapeB = document.getElementById('tel-shape-b');
const telTravelL = document.getElementById('tel-travel-L');
const telAvgVel = document.getElementById('tel-avg-vel');
const telSSFactor = document.getElementById('tel-ss-factor');

// Telemetry DOM Elements (Erosion & Sediment)
const telTC = document.getElementById('tel-tc-val');
const telCs = document.getElementById('tel-cs-val');
const telGamma = document.getElementById('tel-gamma-val');
const telWs = document.getElementById('tel-ws-val');
const telCellNet = document.getElementById('tel-cell-net-val');
const telCellNetContainer = document.getElementById('tel-cell-net-container');
const telPeakOmega = document.getElementById('tel-peak-omega');
const telPeakTC = document.getElementById('tel-peak-tc');

// Catchment Planform Canvas
const catchmentCanvas = document.getElementById('catchment-canvas');
const catchmentCtx = catchmentCanvas.getContext('2d');

// Fetch terrain data from our Python server
async function fetchTerrainData() {
    loadingOverlay.style.display = 'flex';

    const slopeMult = slopeSlider.value;
    const textureMult = textureSlider.value;

    try {
        // Cache bust using Date.now() to ensure clicking Regenerate gets a fresh random seed profile
        const response = await fetch(`/api/data?slope_mult=${slopeMult}&texture_mult=${textureMult}&t=${Date.now()}`);
        if (!response.ok) throw new Error('Network response was not ok');

        terrainData = await response.json();
        loadingOverlay.style.display = 'none';

        // Reset view
        resetView();

        // Run Infiltration and Runoff routing
        runSimulation();

        // Render Rainfall SVG editor
        renderRainfallEditor();

        // Draw terrain profile and catchment planform
        draw();
        drawCatchmentPlanform();
    } catch (error) {
        console.error('Error loading terrain:', error);
        loadingOverlay.innerHTML = `<p style="color: var(--accent-red)">Error loading data from server. Make sure main.py is running!</p>`;
    }
}

// Reset Zoom and Pan to fit the whole profile
function resetView() {
    if (!terrainData) return;
    scale = 1.0;
    offsetX = 0;
    hoveredCellIndex = -1;
    pinnedCellIndex = -1;
    clearTelemetry();
}

// Handle Canvas Resize
function resizeCanvas() {
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Also resize catchment canvas
    if (catchmentCanvas) {
        const catchmentContainer = catchmentCanvas.parentElement;
        catchmentCanvas.width = catchmentContainer.clientWidth;
        catchmentCanvas.height = catchmentContainer.clientHeight;
    }

    draw();
    drawCatchmentPlanform();
}

// Draw the 1D Profile
function draw() {
    if (!terrainData) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const numCells = terrainData.elevations.length;
    const minElev = Math.min(...terrainData.elevations);
    const maxElev = Math.max(...terrainData.elevations);
    const elevRange = maxElev - minElev || 1.0;

    // Drawing margins
    const marginL = 50;
    const marginR = 50;
    const marginT = 40;
    const marginB = 40;

    const drawW = canvas.width - marginL - marginR;
    const drawH = canvas.height - marginT - marginB;

    // Save context for transform operations (zoom/pan)
    ctx.save();

    // Apply clipping mask so drawing doesn't bleed out of horizontal margins
    ctx.beginPath();
    ctx.rect(marginL, 0, drawW, canvas.height);
    ctx.clip();

    // Map cell index to X coordinate on canvas
    const getX = (index) => {
        const rawFrac = index / (numCells - 1);
        const cellX = marginL + rawFrac * drawW;
        return marginL + (cellX - marginL) * scale + offsetX;
    };

    // Map elevation value to Y coordinate on canvas
    const getY = (elev) => {
        const frac = (elev - minElev) / elevRange;
        return marginT + drawH - (frac * drawH);
    };

    // Draw Grid Lines (Dynamic with panning/zoom)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
        const y = marginT + (i / 10) * drawH;
        ctx.beginPath();
        ctx.moveTo(marginL, y);
        ctx.lineTo(marginL + drawW, y);
        ctx.stroke();

        const x = marginL + (i / 10) * drawW;
        ctx.beginPath();
        ctx.moveTo(x, marginT);
        ctx.lineTo(x, marginT + drawH);
        ctx.stroke();
    }

    // 1. Draw Terrain Fill & Path
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(minElev - 10)); // Baseline bottom-left

    for (let i = 0; i < numCells; i++) {
        ctx.lineTo(getX(i), getY(terrainData.elevations[i]));
    }

    ctx.lineTo(getX(numCells - 1), getY(minElev - 10)); // Baseline bottom-right
    ctx.closePath();

    // Premium Earth gradient fill (Browns & Dark Bedrock)
    const terrainGrad = ctx.createLinearGradient(0, marginT, 0, marginT + drawH);
    terrainGrad.addColorStop(0, 'rgba(139, 90, 43, 0.35)'); // Upper top soil
    terrainGrad.addColorStop(0.5, 'rgba(74, 48, 23, 0.7)');  // Bedrock layer
    terrainGrad.addColorStop(1, 'rgba(24, 16, 8, 0.95)');    // Deep dark lithology
    ctx.fillStyle = terrainGrad;
    ctx.fill();

    // Terrain surface line (Warm brown soil cap)
    ctx.beginPath();
    for (let i = 0; i < numCells; i++) {
        const x = getX(i);
        const y = getY(terrainData.elevations[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(160, 105, 50, 0.95)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Draw vertical cell dividers and highlighted surface nodes to make cell division extremely clear!
    if (scale >= 1.5) {
        // Opacity increases as you zoom in closer
        const opacity = Math.min(0.5, 0.08 + (scale - 1.5) * 0.12);
        ctx.strokeStyle = `rgba(0, 210, 255, ${opacity})`;
        ctx.lineWidth = 0.6;
        const yBaseline = getY(minElev - 10);

        for (let i = 0; i < numCells; i++) {
            const x = getX(i);
            if (x >= marginL && x <= marginL + drawW) {
                const yTerrain = getY(terrainData.elevations[i]);

                // Draw clear vertical divider line
                ctx.beginPath();
                ctx.moveTo(x, yTerrain);
                ctx.lineTo(x, yBaseline);
                ctx.stroke();

                // Draw horizontal cell step ticks or surface node dots
                ctx.beginPath();
                ctx.arc(x, yTerrain, 1.25, 0, 2 * Math.PI);
                ctx.fillStyle = '#ffb300';
                ctx.fill();
            }
        }
    }

    // 2. Runoff Accumulation — visualised water depth overlay.
    // Uses Q^0.45 hydraulic geometry scaling (smooth, discharge-driven) with a
    // mild slope modifier and 4× visual exaggeration so the layer is readable
    // on screen while still reflecting relative differences between cells.
    // Pure Manning's is too slope-sensitive for a profile view (steep cells
    // get near-zero depth, flat cells balloon — neither looks right visually).
    const waterExaggeration = 4.0;
    const visWaterDepth = (i) => {
        const Q = simulationResults ? Math.max(0.0, simulationResults.peakQ[i]) : 0.0;
        const S = Math.max(0.02, terrainData.slopes[i]); // clamp slope for display
        const slopeFactor = Math.max(0.3, 1.0 - Math.min(0.7, S * 3.0)); // gentle mod
        return (0.01 + 0.35 * Math.pow(Q, 0.45)) * slopeFactor * waterExaggeration;
    };

    ctx.beginPath();
    for (let i = 0; i < numCells; i++) {
        const x = getX(i);
        const yWater = getY(terrainData.elevations[i] + visWaterDepth(i));
        if (i === 0) ctx.moveTo(x, yWater);
        else ctx.lineTo(x, yWater);
    }
    for (let i = numCells - 1; i >= 0; i--) {
        ctx.lineTo(getX(i), getY(terrainData.elevations[i]));
    }
    ctx.closePath();

    const waterGrad = ctx.createLinearGradient(0, marginT, 0, marginT + drawH);
    waterGrad.addColorStop(0, 'rgba(0, 210, 255, 0.28)');
    waterGrad.addColorStop(1, 'rgba(0, 120, 255, 0.06)');
    ctx.fillStyle = waterGrad;
    ctx.fill();

    // Water surface line
    ctx.beginPath();
    for (let i = 0; i < numCells; i++) {
        const x = getX(i);
        const yWater = getY(terrainData.elevations[i] + visWaterDepth(i));
        if (i === 0) ctx.moveTo(x, yWater);
        else ctx.lineTo(x, yWater);
    }
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 2b. Erosion / Deposition overlay
    // Positive net = erosion (red), negative net = deposition (green)
    // Scale the band height relative to the maximum absolute net value across all cells
    if (simulationResults && simulationResults.cell_net_erosion) {
        const netArr = simulationResults.cell_net_erosion;
        let maxAbsNet = 0.0;
        for (let i = 0; i < numCells; i++) {
            const a = Math.abs(netArr[i]);
            if (a > maxAbsNet) maxAbsNet = a;
        }
        // Visual exaggeration: scale so the max value maps to ~15% of drawing height in elevation units
        const netScale = maxAbsNet > 0 ? (elevRange * 0.15) / maxAbsNet : 0;

        // --- Erosion band (net > 0 → red shading above terrain) ---
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < numCells; i++) {
            const net = netArr[i];
            if (net <= 0) continue;
            const x = getX(i);
            const yTerrain = getY(terrainData.elevations[i]);
            const yNet = getY(terrainData.elevations[i] + net * netScale);
            if (!started) {
                ctx.moveTo(x, yTerrain);
                started = true;
            }
            ctx.lineTo(x, yNet);
        }
        // Close back along terrain (reverse)
        for (let i = numCells - 1; i >= 0; i--) {
            if (netArr[i] <= 0) continue;
            ctx.lineTo(getX(i), getY(terrainData.elevations[i]));
        }
        ctx.closePath();
        const erosionFillGrad = ctx.createLinearGradient(0, marginT, 0, marginT + drawH);
        erosionFillGrad.addColorStop(0, 'rgba(255, 60, 60, 0.30)');
        erosionFillGrad.addColorStop(1, 'rgba(255, 60, 60, 0.05)');
        ctx.fillStyle = erosionFillGrad;
        ctx.fill();

        // --- Deposition band (net < 0 → green shading above terrain) ---
        ctx.beginPath();
        started = false;
        for (let i = 0; i < numCells; i++) {
            const net = netArr[i];
            if (net >= 0) continue;
            const x = getX(i);
            const yTerrain = getY(terrainData.elevations[i]);
            const yNet = getY(terrainData.elevations[i] + (-net) * netScale);
            if (!started) {
                ctx.moveTo(x, yTerrain);
                started = true;
            }
            ctx.lineTo(x, yNet);
        }
        for (let i = numCells - 1; i >= 0; i--) {
            if (netArr[i] >= 0) continue;
            ctx.lineTo(getX(i), getY(terrainData.elevations[i]));
        }
        ctx.closePath();
        const depositFillGrad = ctx.createLinearGradient(0, marginT, 0, marginT + drawH);
        depositFillGrad.addColorStop(0, 'rgba(50, 220, 100, 0.28)');
        depositFillGrad.addColorStop(1, 'rgba(50, 220, 100, 0.05)');
        ctx.fillStyle = depositFillGrad;
        ctx.fill();

        // --- Single net-change profile line (red where eroding, green where depositing) ---
        for (let i = 0; i < numCells - 1; i++) {
            const x0 = getX(i), x1 = getX(i + 1);
            const net0 = netArr[i], net1 = netArr[i + 1];
            const yLine0 = getY(terrainData.elevations[i] + Math.abs(net0) * netScale);
            const yLine1 = getY(terrainData.elevations[i + 1] + Math.abs(net1) * netScale);
            ctx.beginPath();
            ctx.moveTo(x0, yLine0);
            ctx.lineTo(x1, yLine1);
            // Colour by sign of the midpoint
            const midNet = (net0 + net1) * 0.5;
            ctx.strokeStyle = midNet > 0
                ? 'rgba(255, 80, 80, 0.85)'
                : 'rgba(60, 220, 100, 0.85)';
            ctx.lineWidth = 1.8;
            ctx.stroke();
        }
    }

    // 3. Draw Pinned Indicator (Solid Purple Line)
    if (pinnedCellIndex >= 0 && pinnedCellIndex < numCells) {
        const pinX = getX(pinnedCellIndex);
        const pinY = getY(terrainData.elevations[pinnedCellIndex]);

        ctx.strokeStyle = 'rgba(165, 94, 234, 0.5)';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(pinX, marginT);
        ctx.lineTo(pinX, marginT + drawH);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(pinX, pinY, 7, 0, 2 * Math.PI);
        ctx.fillStyle = '#a55eea';
        ctx.shadowColor = '#a55eea';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // 4. Draw Hover Indicator (Dashed Cyan Line) - only if not hovering on pinned cell itself
    if (hoveredCellIndex >= 0 && hoveredCellIndex < numCells && hoveredCellIndex !== pinnedCellIndex) {
        const hoverX = getX(hoveredCellIndex);
        const hoverY = getY(terrainData.elevations[hoveredCellIndex]);

        ctx.strokeStyle = 'rgba(0, 210, 255, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(hoverX, marginT);
        ctx.lineTo(hoverX, marginT + drawH);
        ctx.stroke();
        ctx.setLineDash([]); // Reset line dash

        ctx.beginPath();
        ctx.arc(hoverX, hoverY, 6, 0, 2 * Math.PI);
        ctx.fillStyle = '#00d2ff';
        ctx.shadowColor = '#00d2ff';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    ctx.restore(); // Restore context to draw labels outside clipping

    // 5. Draw dynamic Axis Labels — based on currently visible cells only
    // Invert getX to find which cell indices are at the left and right canvas edges
    const fracLeft = -offsetX / (drawW * scale);
    const fracRight = (drawW - offsetX) / (drawW * scale);
    const iLeft = Math.max(0, Math.floor(fracLeft * (numCells - 1)));
    const iRight = Math.min(numCells - 1, Math.ceil(fracRight * (numCells - 1)));

    // Min/max elevation of visible cells
    let visMinElev = Infinity, visMaxElev = -Infinity;
    for (let i = iLeft; i <= iRight; i++) {
        const e = terrainData.elevations[i];
        if (e < visMinElev) visMinElev = e;
        if (e > visMaxElev) visMaxElev = e;
    }
    if (!isFinite(visMinElev)) { visMinElev = minElev; visMaxElev = maxElev; }

    // Distance at left and right visible edges
    const distLeft = terrainData.distances ? terrainData.distances[iLeft] : iLeft * 2.5;
    const distRight = terrainData.distances ? terrainData.distances[iRight] : iRight * 2.5;
    const fmtDist = (m) => m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;

    ctx.fillStyle = '#cdd6e4';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${visMaxElev.toFixed(1)} m`, marginL - 8, marginT + 4);
    ctx.fillText(`${visMinElev.toFixed(1)} m`, marginL - 8, marginT + drawH);
    ctx.fillText(`Elev (z)`, marginL - 8, marginT - 15);

    ctx.textAlign = 'left';
    ctx.fillText(`${fmtDist(distLeft)} (Upstream)`, marginL, marginT + drawH + 18);
    ctx.textAlign = 'right';
    ctx.fillText(`${fmtDist(distRight)} (Downstream)`, marginL + drawW, marginT + drawH + 18);
    ctx.textAlign = 'center';
    ctx.fillText(`Profile Distance (x)`, marginL + drawW / 2, marginT + drawH + 30);
}

// Convert canvas click/hover X coordinate to array cell index
function getCellIndexFromX(pixelX) {
    if (!terrainData) return -1;
    const numCells = terrainData.elevations.length;
    const marginL = 50;
    const marginR = 50;
    const drawW = canvas.width - marginL - marginR;

    const cellX = (pixelX - offsetX - marginL) / scale + marginL;
    const frac = (cellX - marginL) / drawW;

    if (frac < 0 || frac > 1) return -1;
    return Math.min(numCells - 1, Math.max(0, Math.round(frac * (numCells - 1))));
}

// Lanczos Gamma function approximation
function gamma(x) {
    const p = [
        0.99999999999980993,
        676.5203681218851,
        -1259.1392167224028,
        771.3234285076533,
        -176.61502916214059,
        12.507343278686905,
        -0.13857109526572012,
        9.9843695780195716e-6,
        1.5056327351493116e-7
    ];
    if (x < 0.5) {
        return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
    }
    x -= 1;
    let a = p[0];
    let t = x + 7.5;
    for (let i = 1; i < 9; i++) {
        a += p[i] / (x + i);
    }
    return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

// Estimates the 'b' parameter of the unit hydrograph from the steady-state compensation ratio
function getHydrographB(ratio) {
    if (isNaN(ratio) || ratio <= 0) return 1.0;

    let b_initial = 1.0;
    let b_initial2 = 0.5;
    let b_initial3 = 2.0;

    const evalTerm = (b) => {
        return (1.0 / 2.7172) * Math.pow(b, -1.0 - b) * Math.exp(b) * gamma(1.0 + b);
    };

    let y_initial = evalTerm(b_initial);
    let y_initial2 = evalTerm(b_initial2);
    let y_initial3 = evalTerm(b_initial3);

    let factor = ratio < y_initial3 ? 2.0 : 0.5;
    let lower = ratio < y_initial3 ? false : true;

    if (ratio <= y_initial3 || ratio >= y_initial) {
        for (let i = 0; i < 30; i++) {
            if (i === 29) {
                return 1.0;
            }

            if (lower) {
                b_initial3 = b_initial;
                b_initial = b_initial * factor;
                let total = evalTerm(b_initial);
                if (total > ratio) {
                    break;
                }
            } else {
                b_initial = b_initial3;
                b_initial3 = b_initial3 * factor;
                let total = evalTerm(b_initial3);
                if (total < ratio) {
                    break;
                }
            }
        }
    }

    y_initial = evalTerm(b_initial);
    y_initial2 = evalTerm(b_initial2);
    y_initial3 = evalTerm(b_initial3);

    for (let i = 0; i < 30; i++) {
        if (i === 29) {
            return 1.0;
        }

        let b_half = 0.5 * (b_initial + b_initial3);

        if (Math.abs(b_half - b_initial) < 0.0000001) {
            return b_half;
        }

        let total_half = evalTerm(b_half);

        if (Math.abs(total_half - ratio) < 0.0001) {
            return b_half;
        }

        if (total_half > ratio) {
            b_initial = b_half;
        } else {
            b_initial3 = b_half;
        }
    }

    return 1.0;
}

// Generates time-varying discharge using unit hydrograph approximation
function GetDischargeCurveAtTime(MapQ, MapSS, MapL, MapVAVG, MapB, MapQB, duration_event, timeslice) {
    let data_q = MapQ;

    let h_b = MapB;
    let h_L = MapL;
    let h_vavg = MapVAVG;
    let h_tevent = duration_event;


    // Physical time-to-peak (travel time) in hours
    let h_tpeak = (h_L / h_vavg) / 3600.0;

    // ── Ramp-up / plateau shaping ──────────────────────────────────────────
    // The raw travel-time often produces a very long flat top when
    // event duration >> travel time. Stretch h_tpeak so the plateau shrinks
    // to ~15 % of its original length, giving a slower, longer rising limb.
    const orig_flat_top = Math.max(0.0, h_tevent - h_tpeak);
    if (orig_flat_top > 0) {
        h_tpeak = h_tevent - 0.15 * orig_flat_top;
        h_tpeak = Math.max(h_tpeak, h_tevent * 0.5);   // ramp always ≥ 50 % of event
        h_tpeak = Math.min(h_tpeak, h_tevent * 0.999); // always leave a tiny plateau sliver
    }
    // ────────────────────────────────────────────────────────────────────────

    let h_ss = MapSS;
    let h_qpeak = MapQ;
    let h_qss = h_qpeak / Math.max(0.0001, h_ss);
    let h_qtotal = h_qss * h_tevent * 3600.0;
    let h_qssdur = Math.max(0.0, h_tevent - h_tpeak) * h_qss;

    // get baseflow
    let h_qb = MapQB;

    let qtot_hydro_nonscale = 2.7172 * h_tpeak * 3600.0 * h_qpeak;

    // get ratio (recomputed after h_tpeak rescaling)
    let qtot_hydro_ratio = Math.max(0.01 * h_qtotal, (h_qtotal - h_qssdur)) / Math.max(0.0001, qtot_hydro_nonscale);

    let hydro_b = getHydrographB(qtot_hydro_ratio);

    let t = (timeslice / 3600.0);
    let xh = (timeslice / 3600.0) / Math.max(0.0001, h_tpeak);

    if (t > h_tpeak && t <= h_tevent) {
        data_q = (h_qb + h_qpeak);
    } else if (t >= h_tevent) {
        xh = (t - Math.max(0.0, h_tevent - h_tpeak)) / Math.max(0.0001, h_tpeak);
        data_q = (h_qb + h_qpeak * Math.pow(xh * Math.exp(1.0 - xh), hydro_b));
    } else {
        data_q = (h_qb + h_qpeak * Math.pow(xh * Math.exp(1.0 - xh), hydro_b));
    }

    return isNaN(data_q) || !isFinite(data_q) ? h_qb : data_q;
}

// Full Green & Ampt Infiltration and Runoff Routing simulation model
function runSimulation() {
    if (!terrainData) return;

    const numCells = terrainData.elevations.length;
    const dx = 2.5; // Spacing per cell (meters)
    const lengthKm = 2.5;

    // Sliders
    const ksatInput = parseFloat(ksatSlider.value); // mm/h
    const sm = parseFloat(moistureSlider.value); // Relative moisture
    const b = parseFloat(shapeBSlider.value); // Catchment shape b parameter

    // Calculate maximum width at the outlet in meters: W_max = Length * b (km) * 1000
    const wMax = lengthKm * b * 1000.0;

    // Calculate cell widths, areas, and cumulative drainage areas
    // Note: shape of the catchment tapers to the downstream end (flipped horizontally: widest upstream, narrowest downstream)
    const cellWidths = new Float32Array(numCells);
    const cellAreas = new Float32Array(numCells);
    const drainageAreasM2 = new Float32Array(numCells);

    let runningArea = 0.0;
    for (let i = 0; i < numCells; i++) {
        const frac = i / (numCells - 1);
        // Catchment width W(x) flipped horizontally: widest at upstream (frac=0 => 1-frac=1) and tapered at outlet (frac=1 => 1-frac=0)
        cellWidths[i] = Math.max(1.0, wMax * Math.pow(1.0 - frac, b));
        cellAreas[i] = cellWidths[i] * dx;
        runningArea += cellAreas[i];
        drainageAreasM2[i] = runningArea;
    }

    const totalAreaM2 = drainageAreasM2[numCells - 1];
    const totalAreaKm2 = totalAreaM2 / 1000000.0;
    const totalAreaHa = totalAreaM2 / 10000.0;

    // Update global total catchment badge
    totalCatchmentAreaVal.textContent = `${totalAreaKm2.toFixed(3)} km² (${totalAreaHa.toFixed(1)} ha)`;

    // Interflow calculations using the Xiangjiang parameter model
    const smClamped = Math.max(0.4, Math.min(0.95, sm));
    const xijangparam = 0.18;
    const sm_fac = Math.min(1.0, 1.07 * Math.pow(1.0 - smClamped, xijangparam));

    // Update the moisture slider badge with the calculated sm_fac and interflow percentage
    const interflowPct = (1.0 - sm_fac) * 100.0;
    moistureVal.textContent = `${sm.toFixed(2)} (sm_fac: ${(sm_fac * 100.0).toFixed(0)}%, interflow: ${interflowPct.toFixed(0)}%)`;

    // Define the 3 spatial bins for sub-grid Ksat variation:
    // Bin 1: 80% area with Ksat = ksatInput
    const k1 = ksatInput;
    const porosity1 = 0.15 + 0.5 * Math.pow((Math.max(0.5, k1) / 7640.0), 0.2);
    const psi1 = 10000.0 * Math.pow(60.0 * Math.max(0.5, k1), -0.5) / 100.0;
    const ksat_m_s1 = k1 / 3600000.0;
    const ThetaS1 = porosity1;
    const Theta1 = smClamped * porosity1;

    // Bin 2: 10% area with Ksat = 0.1 * ksatInput
    const k2 = 0.1 * ksatInput;
    const porosity2 = 0.15 + 0.5 * Math.pow((Math.max(0.5, k2) / 7640.0), 0.2);
    const psi2 = 10000.0 * Math.pow(60.0 * Math.max(0.5, k2), -0.5) / 100.0;
    const ksat_m_s2 = k2 / 3600000.0;
    const ThetaS2 = porosity2;
    const Theta2 = smClamped * porosity2;

    // Bin 3: 10% area with Ksat = 2.0 * ksatInput
    const k3 = 2.0 * ksatInput;
    const porosity3 = 0.15 + 0.5 * Math.pow((Math.max(0.5, k3) / 7640.0), 0.2);
    const psi3 = 10000.0 * Math.pow(60.0 * Math.max(0.5, k3), -0.5) / 100.0;
    const ksat_m_s3 = k3 / 3600000.0;
    const ThetaS3 = porosity3;
    const Theta3 = smClamped * porosity3;

    // 96 intervals of 15-minutes (900 seconds) each
    const runoff_intervals = Array.from({ length: numCells }, () => new Float32Array(96));
    const infil_intervals = Array.from({ length: numCells }, () => new Float32Array(96));
    const interflow_intervals = Array.from({ length: numCells }, () => new Float32Array(96));
    const throughflow_Q = Array.from({ length: numCells }, () => new Float32Array(96));

    const cell_total_rain = new Float32Array(numCells);
    const cell_total_infil = new Float32Array(numCells);
    const cell_total_interflow = new Float32Array(numCells);

    // Track separate wetting front depths for the three bins for all cells
    const wfh_1 = new Float32Array(numCells).fill(0.025);
    const wfh_2 = new Float32Array(numCells).fill(0.025);
    const wfh_3 = new Float32Array(numCells).fill(0.025);

    // Sum total storm depth (mm)
    let totalRainDayMm = 0.0;
    for (let i = 0; i < 96; i++) {
        totalRainDayMm += rainfall[i] * 0.25;
    }

    // Run dynamic model cell by cell
    for (let c = 0; c < numCells; c++) {
        let SD = 1.5;

        cell_total_rain[c] = totalRainDayMm;

        // Loop over 96 intervals
        for (let intv = 0; intv < 96; intv++) {
            const rainRateMmHr = rainfall[intv];
            const rainRateMS = rainRateMmHr / 3600000.0; // mm/h to m/s

            // To be stable and accurate, we split the 15-minute interval (900s) 
            // into 30 sub-timesteps of 30 seconds each
            const sub_dt = 30.0;
            const numSubSteps = 30;

            let intvRunoffMeters = 0.0;
            let intvInfilMeters = 0.0;
            let intvInterflowMeters = 0.0;

            for (let step = 0; step < numSubSteps; step++) {
                const wh_i = rainRateMS * sub_dt; // rain depth in meters in this sub-step

                // Bin 1 Infiltration
                const space1 = Math.max(0.0, SD - wfh_1[c]);
                const comp1 = ksat_m_s1 * (1.0 + (psi1 * Math.max(0.00001, ThetaS1 - Theta1)) / Math.max(0.01, wfh_1[c]));
                const infl1 = Math.min(wh_i, Math.min(space1 * 0.5, comp1 * sub_dt));
                const infil_eff1 = infl1 * sm_fac;
                const interflow1 = infl1 * (1.0 - sm_fac);
                const runoff1 = wh_i - infl1;
                wfh_1[c] += infil_eff1 / Math.max(0.00001, ThetaS1 - Theta1);

                // Bin 2 Infiltration
                const space2 = Math.max(0.0, SD - wfh_2[c]);
                const comp2 = ksat_m_s2 * (1.0 + (psi2 * Math.max(0.00001, ThetaS2 - Theta2)) / Math.max(0.01, wfh_2[c]));
                const infl2 = Math.min(wh_i, Math.min(space2 * 0.5, comp2 * sub_dt));
                const infil_eff2 = infl2 * sm_fac;
                const interflow2 = infl2 * (1.0 - sm_fac);
                const runoff2 = wh_i - infl2;
                wfh_2[c] += infil_eff2 / Math.max(0.00001, ThetaS2 - Theta2);

                // Bin 3 Infiltration
                const space3 = Math.max(0.0, SD - wfh_3[c]);
                const comp3 = ksat_m_s3 * (1.0 + (psi3 * Math.max(0.00001, ThetaS3 - Theta3)) / Math.max(0.01, wfh_3[c]));
                const infl3 = Math.min(wh_i, Math.min(space3 * 0.5, comp3 * sub_dt));
                const infil_eff3 = infl3 * sm_fac;
                const interflow3 = infl3 * (1.0 - sm_fac);
                const runoff3 = wh_i - infl3;
                wfh_3[c] += infil_eff3 / Math.max(0.00001, ThetaS3 - Theta3);

                // Take weighted averages for this sub-step
                const stepRunoff = 0.8 * runoff1 + 0.1 * runoff2 + 0.1 * runoff3;
                const stepInfil = 0.8 * infil_eff1 + 0.1 * infil_eff2 + 0.1 * infil_eff3;
                const stepInterflow = 0.8 * interflow1 + 0.1 * interflow2 + 0.1 * interflow3;

                intvRunoffMeters += stepRunoff;
                intvInfilMeters += stepInfil;
                intvInterflowMeters += stepInterflow;
            }

            runoff_intervals[c][intv] = intvRunoffMeters;
            infil_intervals[c][intv] = intvInfilMeters;
            interflow_intervals[c][intv] = intvInterflowMeters;

            cell_total_infil[c] += intvInfilMeters * 1000.0; // convert to mm
            cell_total_interflow[c] += intvInterflowMeters * 1000.0; // convert to mm
        }
    }

    // Accumulate runoff volumes downstream index-by-index (routing through the widening catchment)
    for (let intv = 0; intv < 96; intv++) {
        let accumulatedQ = 0.0; // m3/s
        for (let c = 0; c < numCells; c++) {
            const generatedQ = (runoff_intervals[c][intv] * cellAreas[c]) / 900.0;
            accumulatedQ += generatedQ;
            throughflow_Q[c][intv] = accumulatedQ;
        }
    }

    // Calculate hourly regional average infiltration rate (mm/h)
    avgInfiltrationHourly.fill(0);
    for (let intv = 0; intv < 96; intv++) {
        let sumInfilMeters = 0.0;
        for (let c = 0; c < numCells; c++) {
            sumInfilMeters += infil_intervals[c][intv];
        }
        avgInfiltrationHourly[intv] = ((sumInfilMeters / numCells) * 1000.0) / 0.25;
    }

    // 1. Calculate acc1 and accacc1 to represent drainage area and accumulation weights in 1D
    let acc1 = new Float32Array(numCells);
    let accacc1 = new Float32Array(numCells);
    for (let c = 0; c < numCells; c++) {
        acc1[c] = drainageAreasM2[c] / (dx * dx);
    }
    let runningAccSum = 0;
    for (let c = 0; c < numCells; c++) {
        runningAccSum += acc1[c];
        accacc1[c] = runningAccSum;
    }

    // 2. Calculate average runoff production rate in the window containing 85% of runoff.
    //    Also record per-cell window start/end in seconds for the hydrograph time offset.
    let avg_runoff_rate = new Float32Array(numCells);
    const cell_window_start_sec = new Float32Array(numCells); // time (s) when runoff window starts
    const cell_window_dur_hr = new Float32Array(numCells);    // duration (hours) of runoff window

    for (let c = 0; c < numCells; c++) {
        let totalRunoff = 0;
        for (let i = 0; i < 96; i++) {
            totalRunoff += runoff_intervals[c][i];
        }
        if (totalRunoff <= 0) {
            avg_runoff_rate[c] = 0;
            cell_window_start_sec[c] = 0;
            cell_window_dur_hr[c] = 1.0;
            continue;
        }

        let start = 0;
        let sum_before = 0;
        while (start < 95 && (sum_before + runoff_intervals[c][start]) < 0.15 * totalRunoff) {
            sum_before += runoff_intervals[c][start];
            start++;
        }

        let end = 95;
        let sum_after = 0;
        while (end > start && (sum_after + runoff_intervals[c][end]) < 0.15 * totalRunoff) {
            sum_after += runoff_intervals[c][end];
            end--;
        }

        // Enforce window is at least 1 hour (4 intervals)
        while (end - start + 1 < 4) {
            if (start > 0) start--;
            else if (end < 95) end++;
            else break;
        }

        let sum_window = 0;
        for (let i = start; i <= end; i++) {
            sum_window += runoff_intervals[c][i];
        }
        avg_runoff_rate[c] = sum_window / ((end - start + 1) * 900.0);

        // Store window start time and duration for hydrograph timing
        cell_window_start_sec[c] = start * 900.0;
        cell_window_dur_hr[c] = Math.max(1.0, (end - start + 1) * 0.25);
    }

    // 3. Perform accumulation routing of this average runoff rate to get peak steady state discharge
    let Q_steady = new Float32Array(numCells);
    let runningQ = 0;
    for (let c = 0; c < numCells; c++) {
        runningQ += avg_runoff_rate[c] * cellAreas[c];
        Q_steady[c] = runningQ;
    }

    // 4. Calculate local velocity using Manning's equation based on Q_steady
    let local_vel = new Float32Array(numCells);
    for (let c = 0; c < numCells; c++) {
        let q_val = Math.max(0.00001, Q_steady[c]);
        let s_val = Math.max(0.0001, terrainData.slopes[c]);
        let n_val = Math.max(0.001, terrainData.manning[c]);
        // Use a realistic channel width proportional to the square root of discharge (hydraulic geometry)
        let w_ch = 1.0 + 5.0 * Math.sqrt(q_val);
        local_vel[c] = Math.pow(q_val / w_ch, 0.4) * Math.pow(s_val, 0.3) / Math.pow(n_val, 0.6);
    }

    // 5. Calculate average upstream velocity (path average along the 1D flow line)
    let accvel = new Float32Array(numCells);
    let runningVelSum = 0;
    for (let c = 0; c < numCells; c++) {
        runningVelSum += local_vel[c];
        accvel[c] = runningVelSum;
    }
    let avg_vel_upstream = new Float32Array(numCells);
    for (let c = 0; c < numCells; c++) {
        avg_vel_upstream[c] = accvel[c] / Math.max(1.0, c + 1);
    }

    // 6. Calculate shape parameter b, travel distance L, and steady-state compensation factor ss_comp
    let i_b_arr = new Float32Array(numCells);
    let i_L_arr = new Float32Array(numCells);
    let ss_comp_arr = new Float32Array(numCells);

    // Use cell[0]'s runoff window start as the representative hydrograph start time.
    // This is the time when the catchment actually generates the bulk of its runoff.
    // For display we also compute the raw rainfall start.
    let rainfallStartIndex = 0;
    for (let i = 0; i < 96; i++) {
        if (rainfall[i] > 0) { rainfallStartIndex = i; break; }
    }
    const rainfallStartTimeSec = rainfallStartIndex * 900.0;

    // Total rainfall duration (hours) - kept for ss_comp calculation
    let duration = 0.0;
    for (let i = 0; i < 96; i++) {
        if (rainfall[i] > 0) duration += 0.25;
    }
    duration = Math.max(1.0, duration);

    // Representative catchment-average runoff intensity from cell[0] window
    // (m/s -> mm/h for display)
    const repr_runoff_rate_mms = avg_runoff_rate[Math.min(numCells - 1, Math.floor(numCells / 2))] * 3600000.0;
    const repr_duration_hr = cell_window_dur_hr[Math.min(numCells - 1, Math.floor(numCells / 2))];
    console.log(`[Hydrograph] Rainfall starts at interval ${rainfallStartIndex} (t=${(rainfallStartTimeSec / 3600).toFixed(2)}h), ` +
        `total rain duration=${duration.toFixed(2)}h, runoff window duration=${repr_duration_hr.toFixed(2)}h, ` +
        `avg runoff intensity=${repr_runoff_rate_mms.toFixed(3)} mm/h`);

    const diffusivity_coefficient = 0.1;

    for (let c = 0; c < numCells; c++) {
        let i_Lav = dx * accacc1[c] / Math.max(1.0, acc1[c]);
        let i_L = i_Lav * 3.0 / 2.0;
        let i_n_val = acc1[c];
        let i_b = 1.0;
        let i_dx = dx;

        let do_break = false;
        for (let i = 0; i < 10; i++) {
            let Lnew = ((2.0 + i_b) * i_Lav) / (1.0 + i_b);
            let log_dx_L = Math.log(i_dx / Math.max(0.001, i_L));
            if (Math.abs(log_dx_L) < 1e-6) {
                log_dx_L = log_dx_L < 0 ? -1e-6 : 1e-6;
            }
            let bnew = (-log_dx_L + Math.log(1.0 / Math.max(1.0, i_n_val))) / log_dx_L;

            if (Math.abs(Lnew - i_L) < 0.001 && Math.abs(bnew - i_b) < 0.001) {
                do_break = true;
            }
            i_L = Lnew;
            i_b = bnew;
            if (do_break) break;
        }

        if (isNaN(i_b) || isNaN(i_L) || !isFinite(i_b) || !isFinite(i_L)) {
            i_b = 1.0;
            i_L = i_Lav * 3.0 / 2.0;
        }

        i_b = Math.max(0.00001, i_b);
        i_L = Math.max(dx, i_L);

        i_b_arr[c] = i_b;
        i_L_arr[c] = i_L;

        let ss_comp_x = 2.5 * duration * 3600.0 * avg_vel_upstream[c] / i_L;
        let ss_comp = 1.0;
        if (ss_comp_x < 1.0) {
            let term_diffusivity = Math.min(1.0, Math.exp(-diffusivity_coefficient * Math.log(1.0 / Math.min(1.0, Math.max(0.0001, ss_comp_x)))));
            ss_comp = Math.min(1.0, (1.0 - Math.pow(1.0 - ss_comp_x, 1.0 + i_b))) * term_diffusivity;
        } else {
            ss_comp = 1.0;
        }
        ss_comp_arr[c] = Math.max(0.0001, Math.min(1.0, ss_comp));
    }

    // 7. Calculate peakQ using steady state Q and steady-state compensation factor
    const peakQ = new Float32Array(numCells);
    for (let c = 0; c < numCells; c++) {
        peakQ[c] = Q_steady[c] * ss_comp_arr[c];
    }

    // 8. Generate the routed hydrographs for every cell/pixel.
    // Use the per-cell runoff window start time as the hydrograph time offset,
    // so discharge is zero before the window starts and the shape is evaluated
    // relative to actual runoff onset (not t=0 of the 24h simulation).
    let routed_Q = Array.from({ length: numCells }, () => new Float32Array(96));
    for (let c = 0; c < numCells; c++) {
        const windowStartSec = cell_window_start_sec[c];
        const cellDuration = cell_window_dur_hr[c];
        for (let intv = 0; intv < 96; intv++) {
            const absTimeSec = intv * 900.0;
            if (absTimeSec < windowStartSec) {
                // Before runoff window: no discharge
                routed_Q[c][intv] = 0.0;
            } else {
                // Shift time reference to runoff window start for this cell
                const timeslice = absTimeSec - windowStartSec;
                routed_Q[c][intv] = GetDischargeCurveAtTime(
                    peakQ[c],
                    ss_comp_arr[c],
                    i_L_arr[c],
                    avg_vel_upstream[c],
                    i_b_arr[c],
                    0.0,
                    cellDuration,
                    timeslice
                );
            }
        }
    }

    simulationResults = {
        runoff_intervals,
        infil_intervals,
        interflow_intervals,
        throughflow_Q,
        cell_total_rain,
        cell_total_infil,
        cell_total_interflow,
        peakQ,
        cellWidths,
        drainageAreasM2,
        local_vel,
        i_b_arr,
        i_L_arr,
        avg_vel_upstream,
        ss_comp_arr,
        routed_Q,
        rainfallStartTimeSec,
        cell_window_start_sec,
        cell_window_dur_hr,
        avg_runoff_rate,
        storm_duration_hr: duration,
        repr_runoff_rate_mms,
        repr_duration_hr
    };

    // Run the sediment transport and soil erosion simulation!
    runSedimentSimulation();
}

// Full process-based sediment routing and erosion simulation (LISEM-style CSTR routing)
function runSedimentSimulation() {
    if (!terrainData || !simulationResults) return;

    const numCells = terrainData.elevations.length;
    const dx = 2.5;

    // Read selected timesteps
    const erosionStepsInput = document.getElementById('erosion-steps-input');
    const sliderIdx = erosionStepsInput ? parseInt(erosionStepsInput.value) : 5;
    const erosionStepsOptions = [1, 2, 4, 8, 12, 24, 48, 96];
    const numSteps = erosionStepsOptions[sliderIdx];
    const stepDuration = 86400.0 / numSteps;

    // 1. Precalculate Stokes' settling velocity ws and erosion efficiency gamma
    const cell_ws = new Float32Array(numCells);
    const cell_gamma = new Float32Array(numCells);
    for (let c = 0; c < numCells; c++) {
        const d50_mm = terrainData.grain_sizes[c];
        const d50_m = d50_mm / 1000.0;
        cell_ws[c] = 899250.0 * d50_m * d50_m;

        const coh_kPa = terrainData.cohesion[c];
        cell_gamma[c] = 1.0 / (0.89 + 0.56 * coh_kPa);
    }

    // 2. Precalculate interval-based velocities for all 96 intervals
    const interval_vel = Array.from({ length: numCells }, () => new Float32Array(96));
    for (let c = 0; c < numCells; c++) {
        const s_val = Math.max(0.0001, terrainData.slopes[c]);
        const n_val = Math.max(0.001, terrainData.manning[c]);
        for (let intv = 0; intv < 96; intv++) {
            const q_val = Math.max(0.0, simulationResults.routed_Q[c][intv]);
            // Use a realistic channel width proportional to the square root of discharge (hydraulic geometry)
            const w_ch = 1.0 + 5.0 * Math.sqrt(q_val);
            interval_vel[c][intv] = Math.pow(q_val / w_ch, 0.4) * Math.pow(s_val, 0.3) / Math.pow(n_val, 0.6);
        }
    }

    // 2b. Calculate peak stream power (omega) and peak transport capacity (TC) for each cell
    const cell_peak_omega = new Float32Array(numCells);
    const cell_peak_tc = new Float32Array(numCells);
    for (let c = 0; c < numCells; c++) {
        const s_val = Math.max(0.0001, terrainData.slopes[c]);
        const d50_mm = terrainData.grain_sizes[c];
        const d50_microns = Math.max(0.001, d50_mm * 1000.0);
        const logD50 = Math.log10(d50_microns);
        const c_govers = Math.pow(10, -1.545 - 0.354 * logD50);
        const d_govers = 2.053 - 0.283 * logD50;

        let maxOmega = 0.0;
        let maxTC = 0.0;

        for (let intv = 0; intv < 96; intv++) {
            const q_val = Math.max(0.0, simulationResults.routed_Q[c][intv]);
            const omega = 100.0 * q_val * s_val; // 100 * q * s
            if (omega > maxOmega) maxOmega = omega;

            let TC = 0.0;
            if (omega > criticalStreamPower) {
                TC = 2650.0 * c_govers * Math.pow(omega - criticalStreamPower, d_govers);
            }
            if (TC > maxTC) maxTC = TC;
        }
        cell_peak_omega[c] = maxOmega;
        cell_peak_tc[c] = maxTC;
    }

    // 3. Average routed discharge and local velocities into N timesteps
    const Q_steps = Array.from({ length: numCells }, () => new Float32Array(numSteps));
    const V_steps = Array.from({ length: numCells }, () => new Float32Array(numSteps));
    const M = 96 / numSteps;

    for (let c = 0; c < numCells; c++) {
        for (let t = 0; t < numSteps; t++) {
            let sumQ = 0.0;
            let sumV = 0.0;
            for (let intv = t * M; intv < (t + 1) * M; intv++) {
                sumQ += simulationResults.routed_Q[c][intv];
                sumV += interval_vel[c][intv];
            }
            Q_steps[c][t] = sumQ / M;
            V_steps[c][t] = sumV / M;
        }
    }

    // 4. Sediment routing
    const Cs = Array.from({ length: numCells }, () => new Float32Array(numSteps));
    const TC_steps = Array.from({ length: numCells }, () => new Float32Array(numSteps));
    const erosion_rate_steps = Array.from({ length: numCells }, () => new Float32Array(numSteps));
    const deposition_rate_steps = Array.from({ length: numCells }, () => new Float32Array(numSteps));

    const cell_total_erosion = new Float32Array(numCells);
    const cell_total_deposition = new Float32Array(numCells);
    const cell_net_erosion = new Float32Array(numCells);

    let total_catchment_erosion = 0.0;
    let total_catchment_deposition = 0.0;
    let total_sediment_yield = 0.0;

    for (let t = 0; t < numSteps; t++) {
        for (let c = 0; c < numCells; c++) {
            const Q_out = Q_steps[c][t];
            const V = V_steps[c][t];
            const S = Math.max(0.0001, terrainData.slopes[c]);
            // Use a realistic channel width proportional to the square root of discharge (hydraulic geometry)
            const w_ch = 1.0 + 5.0 * Math.sqrt(Q_out);
            const A_c = w_ch * dx;

            const d50_mm = terrainData.grain_sizes[c];
            const d50_microns = Math.max(0.001, d50_mm * 1000.0);
            const logD50 = Math.log10(d50_microns);
            const c_govers = Math.pow(10, -1.545 - 0.354 * logD50);
            const d_govers = 2.053 - 0.283 * logD50;

            // Stream power: 100 * Q_out * S
            const omega = 100.0 * Q_out * S;
            let TC = 0.0;
            if (omega > criticalStreamPower) {
                TC = 2650.0 * c_govers * Math.pow(omega - criticalStreamPower, d_govers);
            }
            TC_steps[c][t] = TC;

            let Q_in = 0.0;
            let C_in = 0.0;
            if (c > 0) {
                Q_in = Q_steps[c - 1][t];
                C_in = Cs[c - 1][t];
            }

            const k_ero = cell_gamma[c] * cell_ws[c];
            const k_dep = cell_ws[c];

            const load_in = Q_in * C_in;
            const load_cap = Q_out * TC;

            let Cs_val = 0.0;
            let E_rate = 0.0;
            let D_rate = 0.0;
            let c_c = 0.0001;

            if (load_in < load_cap) {
                if (Q_out > 1e-12) {
                    const C_in_prime = load_in / Q_out;
                    const exponent = (k_ero * A_c) / Q_out;
                    Cs_val = TC - (TC - C_in_prime) * Math.exp(-exponent);
                    E_rate = c_c * (Q_out * Cs_val - load_in) / A_c;
                } else {
                    Cs_val = TC;
                    E_rate = c_c * (load_cap - load_in) / A_c;
                }
                Cs_val = Math.max(0.0, Cs_val);
                E_rate = Math.max(0.0, E_rate);
                D_rate = 0.0;
            } else if (load_in > load_cap) {
                // Deposition settles exponentially based on travel duration
                if (Q_out > 1e-12) {
                    const C_in_prime = load_in / Q_out;
                    const exponent = (cell_ws[c] * A_c) / Q_out;
                    Cs_val = TC + (C_in_prime - TC) * Math.exp(-exponent);
                    D_rate = (load_in - Q_out * Cs_val) / A_c;
                } else {
                    Cs_val = TC;
                    D_rate = load_in / A_c;
                }
                Cs_val = Math.max(0.0, Cs_val);
                D_rate = c_c * Math.max(0.0, D_rate);
                E_rate = 0.0;
            } else {
                Cs_val = TC;
                E_rate = 0.0;
                D_rate = 0.0;
            }

            Cs[c][t] = Cs_val;
            erosion_rate_steps[c][t] = E_rate;
            deposition_rate_steps[c][t] = D_rate;

            const erosion_mass = E_rate * A_c * stepDuration;
            const deposition_mass = D_rate * A_c * stepDuration;

            cell_total_erosion[c] += erosion_mass;
            cell_total_deposition[c] += deposition_mass;
        }

        const Q_outlet = Q_steps[numCells - 1][t];
        const Cs_outlet = Cs[numCells - 1][t];
        const outflow_mass = Q_outlet * Cs_outlet * stepDuration;
        total_sediment_yield += outflow_mass;
    }

    for (let c = 0; c < numCells; c++) {
        cell_net_erosion[c] = cell_total_erosion[c] - cell_total_deposition[c];
        total_catchment_erosion += cell_total_erosion[c];
        total_catchment_deposition += cell_total_deposition[c];
    }

    const cell_avg_tc = new Float32Array(numCells);
    const cell_avg_cs = new Float32Array(numCells);
    for (let c = 0; c < numCells; c++) {
        let sumTC = 0.0;
        let sumCs = 0.0;
        for (let t = 0; t < numSteps; t++) {
            sumTC += TC_steps[c][t];
            sumCs += Cs[c][t];
        }
        cell_avg_tc[c] = sumTC / numSteps;
        cell_avg_cs[c] = sumCs / numSteps;
    }

    simulationResults.erosion_timesteps = numSteps;
    simulationResults.step_duration = stepDuration;
    simulationResults.cell_ws = cell_ws;
    simulationResults.cell_gamma = cell_gamma;
    simulationResults.Q_steps = Q_steps;
    simulationResults.V_steps = V_steps;
    simulationResults.Cs = Cs;
    simulationResults.TC_steps = TC_steps;
    simulationResults.erosion_rate_steps = erosion_rate_steps;
    simulationResults.deposition_rate_steps = deposition_rate_steps;
    simulationResults.cell_total_erosion = cell_total_erosion;
    simulationResults.cell_total_deposition = cell_total_deposition;
    simulationResults.cell_net_erosion = cell_net_erosion;
    simulationResults.cell_avg_tc = cell_avg_tc;
    simulationResults.cell_avg_cs = cell_avg_cs;
    simulationResults.cell_peak_omega = cell_peak_omega;
    simulationResults.cell_peak_tc = cell_peak_tc;
    simulationResults.total_catchment_erosion = total_catchment_erosion;
    simulationResults.total_catchment_deposition = total_catchment_deposition;
    simulationResults.total_sediment_yield = total_sediment_yield;

    const totalErosionVal = document.getElementById('total-erosion-val');
    const totalDepositionVal = document.getElementById('total-deposition-val');
    const sedimentYieldVal = document.getElementById('sediment-yield-val');

    if (totalErosionVal) totalErosionVal.textContent = `${total_catchment_erosion.toFixed(1)} kg`;
    if (totalDepositionVal) totalDepositionVal.textContent = `${total_catchment_deposition.toFixed(1)} kg`;
    if (sedimentYieldVal) sedimentYieldVal.textContent = `${total_sediment_yield.toFixed(1)} kg`;

    drawSpatialSedimentProfile('spatial-sediment-chart');
}

// Drawing function for Sediment Concentration chart
function drawSedimentConcChart(containerId, cellIndex) {
    const container = document.getElementById(containerId);
    if (!container || !simulationResults) return;

    const width = 400;
    const height = 150;
    const paddingL = 40;
    const paddingR = 15;
    const paddingT = 15;
    const paddingB = 25;

    const plotW = width - paddingL - paddingR;
    const plotH = height - paddingT - paddingB;

    const numSteps = simulationResults.erosion_timesteps;
    const csData = simulationResults.Cs[cellIndex];
    const tcData = simulationResults.TC_steps[cellIndex];

    let maxCs = Math.max(Math.max(...csData), Math.max(...tcData));
    if (maxCs <= 0) maxCs = 0.1;
    const yMax = maxCs * 1.15;

    const getX = (step) => paddingL + (step / Math.max(1, numSteps - 1)) * plotW;
    const getY = (val) => paddingT + plotH - (Math.min(yMax, val) / yMax) * plotH;

    let gridHtml = '';
    for (let i = 0; i <= 4; i++) {
        const val = (i / 4) * yMax;
        const y = getY(val);
        gridHtml += `<line x1="${paddingL}" y1="${y}" x2="${width - paddingR}" y2="${y}" stroke="rgba(255,255,255,0.04)" stroke-width="1" />`;
    }

    let csPath = '';
    let tcPath = '';
    for (let t = 0; t < numSteps; t++) {
        const x = getX(t);
        const yCs = getY(csData[t]);
        const yTc = getY(tcData[t]);

        if (t === 0) {
            csPath += `M ${x} ${yCs}`;
            tcPath += `M ${x} ${yTc}`;
        } else {
            csPath += ` L ${x} ${yCs}`;
            tcPath += ` L ${x} ${yTc}`;
        }
    }

    container.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%;">
            ${gridHtml}
            <path d="${tcPath}" fill="none" stroke="rgba(255, 165, 2, 0.4)" stroke-width="1.5" stroke-dasharray="3,3" />
            <path d="${csPath}" fill="none" stroke="rgba(0, 210, 255, 0.85)" stroke-width="2" />
            
            <line x1="${paddingL}" y1="${paddingT + plotH}" x2="${width - paddingR}" y2="${paddingT + plotH}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
            
            <text x="${paddingL - 8}" y="${getY(0) + 3}" class="chart-axis-text" text-anchor="end">0.0</text>
            <text x="${paddingL - 8}" y="${getY(yMax / 2) + 3}" class="chart-axis-text" text-anchor="end">${(yMax / 2).toFixed(2)}</text>
            <text x="${paddingL - 8}" y="${getY(yMax) + 3}" class="chart-axis-text" text-anchor="end">${yMax.toFixed(2)}</text>
            
            <text x="${getX(0)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">0h</text>
            <text x="${getX(numSteps / 2)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">12h</text>
            <text x="${getX(numSteps - 1)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">24h</text>
            
            <text x="${width / 2}" y="${height - 2}" font-family="var(--font-sans)" font-size="9" fill="var(--text-muted)" text-anchor="middle">Sediment Conc (kg/m³) • Solid Blue: Cs, Orange Dashed: TC (Cap)</text>
        </svg>
    `;
}

// Drawing function for Erosion/Deposition Rates chart
function drawErosionRatesChart(containerId, cellIndex) {
    const container = document.getElementById(containerId);
    if (!container || !simulationResults) return;

    const width = 400;
    const height = 150;
    const paddingL = 40;
    const paddingR = 15;
    const paddingT = 15;
    const paddingB = 25;

    const plotW = width - paddingL - paddingR;
    const plotH = height - paddingT - paddingB;

    const numSteps = simulationResults.erosion_timesteps;
    const eData = simulationResults.erosion_rate_steps[cellIndex];
    const dData = simulationResults.deposition_rate_steps[cellIndex];
    const qData = simulationResults.Q_steps[cellIndex];

    const rates = new Float32Array(numSteps);
    const dx = 2.5;
    for (let t = 0; t < numSteps; t++) {
        const Q_out = qData[t];
        const w_ch = 1.0 + 5.0 * Math.sqrt(Q_out);
        const A_c = w_ch * dx;
        rates[t] = (eData[t] - dData[t]) * A_c; // in kg/s
    }

    let maxVal = Math.max(...Array.from(rates).map(Math.abs));
    if (maxVal <= 0) maxVal = 0.001;
    const yMax = maxVal * 1.15;

    const getX = (step) => paddingL + (step / Math.max(1, numSteps - 1)) * plotW;
    const getY = (val) => paddingT + plotH / 2 - (val / yMax) * (plotH / 2);

    let gridHtml = '';
    gridHtml += `<line x1="${paddingL}" y1="${getY(0)}" x2="${width - paddingR}" y2="${getY(0)}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />`;
    gridHtml += `<line x1="${paddingL}" y1="${getY(yMax / 2)}" x2="${width - paddingR}" y2="${getY(yMax / 2)}" stroke="rgba(255,255,255,0.03)" stroke-width="1" />`;
    gridHtml += `<line x1="${paddingL}" y1="${getY(-yMax / 2)}" x2="${width - paddingR}" y2="${getY(-yMax / 2)}" stroke="rgba(255,255,255,0.03)" stroke-width="1" />`;

    let path = '';
    let fillErosion = `M ${getX(0)} ${getY(0)}`;
    let fillDeposition = `M ${getX(0)} ${getY(0)}`;

    for (let t = 0; t < numSteps; t++) {
        const x = getX(t);
        const y = getY(rates[t]);
        if (t === 0) {
            path += `M ${x} ${y}`;
        } else {
            path += ` L ${x} ${y}`;
        }

        if (rates[t] >= 0) {
            fillErosion += ` L ${x} ${y}`;
            fillDeposition += ` L ${x} ${getY(0)}`;
        } else {
            fillErosion += ` L ${x} ${getY(0)}`;
            fillDeposition += ` L ${x} ${y}`;
        }
    }
    fillErosion += ` L ${getX(numSteps - 1)} ${getY(0)} Z`;
    fillDeposition += ` L ${getX(numSteps - 1)} ${getY(0)} Z`;

    container.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%;">
            ${gridHtml}
            <path d="${fillErosion}" fill="rgba(255, 71, 87, 0.1)" stroke="none" />
            <path d="${fillDeposition}" fill="rgba(46, 213, 115, 0.1)" stroke="none" />
            <path d="${path}" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2" />
            
            <line x1="${paddingL}" y1="${paddingT + plotH}" x2="${width - paddingR}" y2="${paddingT + plotH}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
            
            <text x="${paddingL - 8}" y="${getY(yMax) + 3}" class="chart-axis-text red-tick" text-anchor="end">+${yMax.toFixed(4)}</text>
            <text x="${paddingL - 8}" y="${getY(0) + 3}" class="chart-axis-text" text-anchor="end">0.0</text>
            <text x="${paddingL - 8}" y="${getY(-yMax) + 3}" class="chart-axis-text green-tick" text-anchor="end">-${yMax.toFixed(4)}</text>
            
            <text x="${getX(0)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">0h</text>
            <text x="${getX(numSteps / 2)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">12h</text>
            <text x="${getX(numSteps - 1)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">24h</text>
            
            <text x="${width / 2}" y="${height - 2}" font-family="var(--font-sans)" font-size="9" fill="var(--text-muted)" text-anchor="middle">Erosion(+) & Deposition(-) Rate (kg/s)</text>
        </svg>
    `;
}

// Drawing function for Spatial Catchment Sediment profile
function drawSpatialSedimentProfile(containerId) {
    const container = document.getElementById(containerId);
    if (!container || !simulationResults) return;

    const width = 400;
    const height = 150;
    const paddingL = 40;
    const paddingR = 15;
    const paddingT = 15;
    const paddingB = 25;

    const plotW = width - paddingL - paddingR;
    const plotH = height - paddingT - paddingB;

    const numCells = terrainData.elevations.length;
    const netData = simulationResults.cell_net_erosion;

    let maxNet = Math.max(...Array.from(netData).map(Math.abs));
    if (maxNet <= 0) maxNet = 0.1;
    const yMax = maxNet * 1.15;

    const getX = (idx) => paddingL + (idx / (numCells - 1)) * plotW;
    const getY = (val) => paddingT + plotH / 2 - (val / yMax) * (plotH / 2);

    let gridHtml = '';
    gridHtml += `<line x1="${paddingL}" y1="${getY(0)}" x2="${width - paddingR}" y2="${getY(0)}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />`;
    gridHtml += `<line x1="${paddingL}" y1="${getY(yMax / 2)}" x2="${width - paddingR}" y2="${getY(yMax / 2)}" stroke="rgba(255,255,255,0.03)" stroke-width="1" />`;
    gridHtml += `<line x1="${paddingL}" y1="${getY(-yMax / 2)}" x2="${width - paddingR}" y2="${getY(-yMax / 2)}" stroke="rgba(255,255,255,0.03)" stroke-width="1" />`;

    let path = '';
    let fillErosion = `M ${getX(0)} ${getY(0)}`;
    let fillDeposition = `M ${getX(0)} ${getY(0)}`;

    for (let c = 0; c < numCells; c++) {
        const x = getX(c);
        const y = getY(netData[c]);
        if (c === 0) {
            path += `M ${x} ${y}`;
        } else {
            path += ` L ${x} ${y}`;
        }

        if (netData[c] >= 0) {
            fillErosion += ` L ${x} ${y}`;
            fillDeposition += ` L ${x} ${getY(0)}`;
        } else {
            fillErosion += ` L ${x} ${getY(0)}`;
            fillDeposition += ` L ${x} ${y}`;
        }
    }
    fillErosion += ` L ${getX(numCells - 1)} ${getY(0)} Z`;
    fillDeposition += ` L ${getX(numCells - 1)} ${getY(0)} Z`;

    let markerHtml = '';
    const activeIndex = pinnedCellIndex !== -1 ? pinnedCellIndex : hoveredCellIndex;
    if (activeIndex !== -1 && activeIndex < numCells) {
        const markerX = getX(activeIndex);
        markerHtml = `
            <line x1="${markerX}" y1="${paddingT}" x2="${markerX}" y2="${paddingT + plotH}" stroke="rgba(255, 255, 255, 0.25)" stroke-width="1" stroke-dasharray="2,2" />
            <circle cx="${markerX}" cy="${getY(netData[activeIndex])}" r="3.5" fill="${pinnedCellIndex !== -1 ? 'var(--accent-purple)' : 'var(--accent-blue)'}" stroke="#fff" stroke-width="1" />
        `;
    }

    container.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%;">
            ${gridHtml}
            <path d="${fillErosion}" fill="rgba(255, 71, 87, 0.1)" stroke="none" />
            <path d="${fillDeposition}" fill="rgba(46, 213, 115, 0.1)" stroke="none" />
            <path d="${path}" fill="none" stroke="rgba(0, 210, 255, 0.75)" stroke-width="1.8" />
            
            ${markerHtml}
            
            <line x1="${paddingL}" y1="${paddingT + plotH}" x2="${width - paddingR}" y2="${paddingT + plotH}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
            
            <text x="${paddingL - 8}" y="${getY(yMax) + 3}" class="chart-axis-text red-tick" text-anchor="end">+${yMax.toFixed(1)}</text>
            <text x="${paddingL - 8}" y="${getY(0) + 3}" class="chart-axis-text" text-anchor="end">0.0</text>
            <text x="${paddingL - 8}" y="${getY(-yMax) + 3}" class="chart-axis-text green-tick" text-anchor="end">-${yMax.toFixed(1)}</text>
            
            <text x="${getX(0)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">0m</text>
            <text x="${getX(numCells / 2)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">1.2km</text>
            <text x="${getX(numCells - 1)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">2.5km</text>
            
            <text x="${width / 2}" y="${height - 2}" font-family="var(--font-sans)" font-size="9" fill="var(--text-muted)" text-anchor="middle">Net Erosion(+) & Deposition(-) per Cell (kg)</text>
        </svg>
    `;
}

// Update Active Cell Telemetry Card
function updateTelemetry(index) {
    if (!terrainData || index < 0 || index >= terrainData.elevations.length) {
        clearTelemetry();
        return;
    }

    // Show pinned or active state
    if (index === pinnedCellIndex) {
        telCellId.textContent = `Cell #${index} (Pinned)`;
        telCellId.className = 'cell-badge pinned';
    } else {
        telCellId.textContent = `Cell #${index}`;
        telCellId.className = 'cell-badge active';
    }

    telDistance.textContent = terrainData.distances[index].toFixed(1);
    telElevation.textContent = terrainData.elevations[index].toFixed(4);
    telSlope.textContent = terrainData.slopes[index].toFixed(6);
    telManning.textContent = terrainData.manning[index].toFixed(3);
    telCohesion.textContent = terrainData.cohesion[index].toFixed(2);

    const grainSizeMm = terrainData.grain_sizes[index];
    if (grainSizeMm < 0.01) {
        const microns = grainSizeMm * 1000;
        telGrain.textContent = `${grainSizeMm.toFixed(5)} (${microns.toFixed(1)} µm)`;
    } else {
        telGrain.textContent = grainSizeMm.toFixed(4);
    }

    // Show Daily Rainfall, Infiltration, and Interflow for this pixel
    if (simulationResults) {
        const rainMm = simulationResults.cell_total_rain[index];
        const infilMm = simulationResults.cell_total_infil[index];
        const interflowMm = simulationResults.cell_total_interflow[index];

        const pct = rainMm > 0 ? (infilMm / rainMm) * 100.0 : 0.0;
        const interflowPct = rainMm > 0 ? (interflowMm / rainMm) * 100.0 : 0.0;

        telTotalRain.textContent = `${rainMm.toFixed(1)} mm`;
        telTotalInfil.textContent = `${infilMm.toFixed(1)} mm (${pct.toFixed(1)}%)`;

        const telTotalInterflow = document.getElementById('tel-total-interflow');
        if (telTotalInterflow) {
            telTotalInterflow.textContent = `${interflowMm.toFixed(1)} mm (${interflowPct.toFixed(1)}%)`;
        }

        // Upstream Drainage Area
        const areaM2 = simulationResults.drainageAreasM2[index];
        const areaKm2 = areaM2 / 1000000.0;
        const areaHa = areaM2 / 10000.0;
        telDrainageArea.textContent = `${areaKm2.toFixed(3)} km² (${areaHa.toFixed(1)} ha)`;

        // Update the new 5 telemetry fields
        if (telLocalVel) telLocalVel.textContent = `${simulationResults.local_vel[index].toFixed(3)}`;
        if (telShapeB) telShapeB.textContent = `${simulationResults.i_b_arr[index].toFixed(3)}`;
        if (telTravelL) telTravelL.textContent = `${simulationResults.i_L_arr[index].toFixed(1)}`;
        if (telAvgVel) telAvgVel.textContent = `${simulationResults.avg_vel_upstream[index].toFixed(3)}`;
        if (telSSFactor) telSSFactor.textContent = `${simulationResults.ss_comp_arr[index].toFixed(3)}`;

        // Populate Erosion & Sediment telemetry
        if (telTC) telTC.textContent = `${simulationResults.cell_avg_tc[index].toFixed(3)}`;
        if (telCs) telCs.textContent = `${simulationResults.cell_avg_cs[index].toFixed(3)}`;
        if (telGamma) telGamma.textContent = `${simulationResults.cell_gamma[index].toFixed(3)}`;
        if (telWs) telWs.textContent = `${(simulationResults.cell_ws[index] * 1000.0).toFixed(2)}`;
        if (telPeakOmega) telPeakOmega.textContent = `${simulationResults.cell_peak_omega[index].toFixed(3)}`;
        if (telPeakTC) telPeakTC.textContent = `${simulationResults.cell_peak_tc[index].toFixed(3)}`;
        if (telCellNet) {
            const netVal = simulationResults.cell_net_erosion[index];
            if (netVal >= 0) {
                telCellNet.textContent = `+${netVal.toFixed(2)}`;
                if (telCellNetContainer) telCellNetContainer.className = 'tel-value-inline highlight-slope';
            } else {
                telCellNet.textContent = `${netVal.toFixed(2)}`;
                if (telCellNetContainer) telCellNetContainer.className = 'tel-value-inline highlight-infil-tel';
            }
        }

        const peakQVal = simulationResults.peakQ[index];
        // True Manning's depth: h = (Q·n / (w·√S))^(3/5)
        const peakS = Math.max(0.0001, terrainData.slopes[index]);
        const peakN = Math.max(0.001,  terrainData.manning[index]);
        const peakW = 1.0 + 5.0 * Math.sqrt(Math.max(0, peakQVal));
        const rawWaterDepth = peakQVal > 1e-9
            ? Math.pow((peakQVal * peakN) / (peakW * Math.sqrt(peakS)), 0.6)
            : 0.0;

        const telPeakQ = document.getElementById('tel-peak-q');
        const telPeakDepth = document.getElementById('tel-peak-depth');
        if (telPeakQ) telPeakQ.textContent = peakQVal.toFixed(4);
        if (telPeakDepth) {
            const depthMm = rawWaterDepth * 1000.0;
            telPeakDepth.textContent = `${rawWaterDepth.toFixed(3)} m (${depthMm.toFixed(1)} mm)`;
        }

        // Flow duration (runoff window) and avg runoff intensity for this cell
        const telFlowDuration = document.getElementById('tel-flow-duration');
        const telRunoffIntensity = document.getElementById('tel-runoff-intensity');
        if (simulationResults.cell_window_dur_hr && simulationResults.avg_runoff_rate) {
            const windowDurHr = simulationResults.cell_window_dur_hr[index];
            const windowStartHr = simulationResults.cell_window_start_sec[index] / 3600.0;
            const runoffMmH = simulationResults.avg_runoff_rate[index] * 3600000.0;
            if (telFlowDuration) telFlowDuration.textContent =
                `${windowDurHr.toFixed(2)} h (starts ${windowStartHr.toFixed(2)} h)`;
            if (telRunoffIntensity) telRunoffIntensity.textContent = runoffMmH.toFixed(3);
        }
    }

    // Redraw spatial sediment profile to update markers
    drawSpatialSedimentProfile('spatial-sediment-chart');

    // Update temporal hydrographs
    updateActiveCellCharts(index);

    // Redraw catchment planform to show active cell location marker!
    drawCatchmentPlanform();
}

function clearTelemetry() {
    if (pinnedCellIndex !== -1) {
        updateTelemetry(pinnedCellIndex);
        return;
    }

    telCellId.textContent = 'Hover Profile';
    telCellId.className = 'cell-badge';
    telDistance.textContent = '-';
    telElevation.textContent = '-';
    telSlope.textContent = '-';
    telManning.textContent = '-';
    telCohesion.textContent = '-';
    telGrain.textContent = '-';
    telTotalRain.textContent = '-';
    telTotalInfil.textContent = '-';
    const telTotalInterflow = document.getElementById('tel-total-interflow');
    if (telTotalInterflow) telTotalInterflow.textContent = '-';
    telDrainageArea.textContent = '-';

    // Clear the new 5 telemetry fields
    if (telLocalVel) telLocalVel.textContent = '-';
    if (telShapeB) telShapeB.textContent = '-';
    if (telTravelL) telTravelL.textContent = '-';
    if (telAvgVel) telAvgVel.textContent = '-';
    if (telSSFactor) telSSFactor.textContent = '-';

    // Clear sediment fields
    if (telTC) telTC.textContent = '-';
    if (telCs) telCs.textContent = '-';
    if (telGamma) telGamma.textContent = '-';
    if (telWs) telWs.textContent = '-';
    if (telPeakOmega) telPeakOmega.textContent = '-';
    if (telPeakTC) telPeakTC.textContent = '-';
    if (telCellNet) {
        telCellNet.textContent = '-';
        if (telCellNetContainer) telCellNetContainer.className = 'tel-value-inline highlight-slope';
    }
    const telPeakQ = document.getElementById('tel-peak-q');
    const telPeakDepth = document.getElementById('tel-peak-depth');
    if (telPeakQ) telPeakQ.textContent = '-';
    if (telPeakDepth) telPeakDepth.textContent = '-';

    clearActiveCellCharts();
    drawCatchmentPlanform();
    drawSpatialSedimentProfile('spatial-sediment-chart');
}

// Clear charts overlay message
function clearActiveCellCharts() {
    document.getElementById('infil-chart-badge').textContent = 'No Cell Pinned';
    document.getElementById('infil-chart-badge').className = 'badge badge-inactive';
    document.getElementById('water-height-chart').innerHTML = `<div class="chart-overlay-msg">Hover or Click Cell to View Infiltration</div>`;

    document.getElementById('discharge-chart-badge').textContent = 'No Cell Pinned';
    document.getElementById('discharge-chart-badge').className = 'badge badge-inactive';
    document.getElementById('discharge-chart').innerHTML = `<div class="chart-overlay-msg">Hover or Click Cell to View Throughflow</div>`;

    const interflowBadge = document.getElementById('interflow-chart-badge');
    if (interflowBadge) {
        interflowBadge.textContent = 'No Cell Pinned';
        interflowBadge.className = 'badge badge-inactive';
    }
    const sedimentChart = document.getElementById('sediment-chart');
    if (sedimentChart) {
        sedimentChart.innerHTML = `<div class="chart-overlay-msg">Hover or Click Cell to View Interflow</div>`;
    }

    const csBadge = document.getElementById('sediment-conc-chart-badge');
    if (csBadge) {
        csBadge.textContent = 'No Cell Pinned';
        csBadge.className = 'badge badge-inactive';
    }
    const csChart = document.getElementById('sediment-conc-chart');
    if (csChart) {
        csChart.innerHTML = `<div class="chart-overlay-msg">Hover or Click Cell to View Sediment Concentration</div>`;
    }

    const erBadge = document.getElementById('erosion-rates-chart-badge');
    if (erBadge) {
        erBadge.textContent = 'No Cell Pinned';
        erBadge.className = 'badge badge-inactive';
    }
    const erChart = document.getElementById('erosion-rates-chart');
    if (erChart) {
        erChart.innerHTML = `<div class="chart-overlay-msg">Hover or Click Cell to View Erosion/Deposition Rates</div>`;
    }
}

// Draw charts for the selected cell
function updateActiveCellCharts(index) {
    if (index < 0 || !simulationResults) return;

    // First Chart: Infiltration (mm/h)
    document.getElementById('infil-chart-badge').textContent = `Cell #${index}`;
    document.getElementById('infil-chart-badge').className = 'badge badge-active';
    drawInfiltrationChart('water-height-chart', index);

    // Second Chart: Discharge (Q throughflow in m3/s)
    document.getElementById('discharge-chart-badge').textContent = `Cell #${index}`;
    document.getElementById('discharge-chart-badge').className = 'badge badge-active';
    drawDischargeChart('discharge-chart', index);

    // Third Chart: Interflow Rate (mm/h)
    const interflowBadge = document.getElementById('interflow-chart-badge');
    if (interflowBadge) {
        interflowBadge.textContent = `Cell #${index}`;
        interflowBadge.className = 'badge badge-active';
    }
    drawInterflowChart('sediment-chart', index);

    // Fourth Chart: Sediment Concentration (Cs and TC)
    const csBadge = document.getElementById('sediment-conc-chart-badge');
    if (csBadge) {
        csBadge.textContent = `Cell #${index}`;
        csBadge.className = 'badge badge-active';
    }
    drawSedimentConcChart('sediment-conc-chart', index);

    // Fifth Chart: Erosion & Deposition Rates
    const erosionRatesBadge = document.getElementById('erosion-rates-chart-badge');
    if (erosionRatesBadge) {
        erosionRatesBadge.textContent = `Cell #${index}`;
        erosionRatesBadge.className = 'badge badge-active';
    }
    drawErosionRatesChart('erosion-rates-chart', index);
}

// Render dynamic Infiltration Chart SVG (15-min / 96 interval)
function drawInfiltrationChart(containerId, cellIndex) {
    const container = document.getElementById(containerId);
    if (!container || !simulationResults) return;

    const width = 400;
    const height = 150;
    const paddingL = 40;
    const paddingR = 15;
    const paddingT = 15;
    const paddingB = 25;

    const plotW = width - paddingL - paddingR;
    const plotH = height - paddingT - paddingB;

    const yMax = 50.0;

    const getX = (intv) => paddingL + (intv / 95) * plotW;
    const getY = (val) => paddingT + plotH - (Math.min(yMax, val) / yMax) * plotH;

    let gridHtml = '';
    for (let i = 0; i <= 4; i++) {
        const val = (i / 4) * yMax;
        const y = getY(val);
        gridHtml += `<line x1="${paddingL}" y1="${y}" x2="${width - paddingR}" y2="${y}" stroke="rgba(255,255,255,0.04)" stroke-width="1" />`;
    }

    let rainPath = `M ${getX(0)} ${getY(0)}`;
    for (let h = 0; h < 96; h++) {
        const x1 = getX(h);
        const x2 = getX(h + 1 === 96 ? 95.99 : h + 1);
        const y = getY(rainfall[h]);
        rainPath += ` L ${x1} ${y} L ${x2} ${y}`;
    }
    rainPath += ` L ${getX(95.99)} ${getY(0)} Z`;

    const cellInfil = simulationResults.infil_intervals[cellIndex];
    let infilPath = '';
    for (let h = 0; h < 96; h++) {
        const valMmHr = (cellInfil[h] * 1000.0) / 0.25;
        const x = getX(h);
        const y = getY(valMmHr);
        if (h === 0) infilPath += `M ${x} ${y}`;
        else infilPath += ` L ${x} ${y}`;
    }

    container.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%;">
            ${gridHtml}
            <path d="${rainPath}" fill="rgba(0, 210, 255, 0.12)" stroke="rgba(0, 210, 255, 0.45)" stroke-width="1" />
            <path d="${infilPath}" fill="none" stroke="rgba(46, 213, 115, 0.85)" stroke-width="2" />
            
            <line x1="${paddingL}" y1="${paddingT + plotH}" x2="${width - paddingR}" y2="${paddingT + plotH}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
            
            <text x="${paddingL - 8}" y="${getY(0) + 3}" class="chart-axis-text" text-anchor="end">0</text>
            <text x="${paddingL - 8}" y="${getY(25) + 3}" class="chart-axis-text" text-anchor="end">25</text>
            <text x="${paddingL - 8}" y="${getY(50) + 3}" class="chart-axis-text" text-anchor="end">50</text>
            
            <text x="${getX(0)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">0h</text>
            <text x="${getX(48)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">12h</text>
            <text x="${getX(95)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">24h</text>
            
            <text x="${width / 2}" y="${height - 2}" font-family="var(--font-sans)" font-size="9" fill="var(--text-muted)" text-anchor="middle">15-Minute Profile (96 Steps) • Blue: Rain, Green: Infiltration</text>
        </svg>
    `;
}

// Render dynamic Throughflow SVG (15-min / 96 interval)
function drawDischargeChart(containerId, cellIndex) {
    const container = document.getElementById(containerId);
    if (!container || !simulationResults) return;

    const width = 400;
    const height = 150;
    const paddingL = 48;
    const paddingR = 15;
    const paddingT = 15;
    const paddingB = 25;

    const plotW = width - paddingL - paddingR;
    const plotH = height - paddingT - paddingB;

    const qData = simulationResults.throughflow_Q[cellIndex];
    const qRouted = simulationResults.routed_Q[cellIndex];

    let qMax = Math.max(Math.max(...qData), Math.max(...qRouted));
    if (qMax <= 0) qMax = 0.001; // Avoid dividing by 0
    const scaleMax = qMax * 1.15;

    const getX = (intv) => paddingL + (intv / 95) * plotW;
    const getY = (val) => paddingT + plotH - (val / scaleMax) * plotH;

    let gridHtml = '';
    for (let i = 0; i <= 4; i++) {
        const val = (i / 4) * scaleMax;
        const y = getY(val);
        gridHtml += `<line x1="${paddingL}" y1="${y}" x2="${width - paddingR}" y2="${y}" stroke="rgba(255,255,255,0.04)" stroke-width="1" />`;
    }

    let pathRaw = '';
    for (let h = 0; h < 96; h++) {
        const x = getX(h);
        const y = getY(qData[h]);
        if (h === 0) pathRaw += `M ${x} ${y}`;
        else pathRaw += ` L ${x} ${y}`;
    }

    let pathRouted = '';
    let fillRouted = `M ${getX(0)} ${getY(0)}`;
    for (let h = 0; h < 96; h++) {
        const x = getX(h);
        const y = getY(qRouted[h]);
        if (h === 0) pathRouted += `M ${x} ${y}`;
        else pathRouted += ` L ${x} ${y}`;
        fillRouted += ` L ${x} ${y}`;
    }
    fillRouted += ` L ${getX(95)} ${getY(0)} Z`;

    const peakLitersS = Math.max(...qRouted) * 1000.0;

    container.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%;">
            ${gridHtml}
            <path d="${fillRouted}" fill="rgba(0, 210, 255, 0.06)" />
            <path d="${pathRaw}" fill="none" stroke="rgba(0, 210, 255, 0.25)" stroke-width="1.5" stroke-dasharray="3,3" />
            <path d="${pathRouted}" fill="none" stroke="rgba(0, 210, 255, 0.85)" stroke-width="2" />
            
            <line x1="${paddingL}" y1="${paddingT + plotH}" x2="${width - paddingR}" y2="${paddingT + plotH}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
            
            <text x="${paddingL - 8}" y="${getY(0) + 3}" class="chart-axis-text" text-anchor="end">0.00</text>
            <text x="${paddingL - 8}" y="${getY(scaleMax / 2) + 3}" class="chart-axis-text" text-anchor="end">${(scaleMax / 2).toFixed(3)}</text>
            <text x="${paddingL - 8}" y="${getY(scaleMax) + 3}" class="chart-axis-text" text-anchor="end">${scaleMax.toFixed(3)}</text>
            
            <text x="${getX(0)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">0h</text>
            <text x="${getX(48)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">12h</text>
            <text x="${getX(95)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">24h</text>
            
            <text x="${width / 2}" y="${height - 2}" font-family="var(--font-sans)" font-size="9" fill="var(--text-muted)" text-anchor="middle">Q (m³/s) • Peak: ${Math.max(...qRouted).toFixed(3)} m³/s (${peakLitersS.toFixed(1)} L/s) • Dashed: Raw, Solid: Routed</text>
        </svg>
    `;
}

// Render dynamic Interflow Chart SVG (15-min / 96 interval)
function drawInterflowChart(containerId, cellIndex) {
    const container = document.getElementById(containerId);
    if (!container || !simulationResults) return;

    const width = 400;
    const height = 150;
    const paddingL = 40;
    const paddingR = 15;
    const paddingT = 15;
    const paddingB = 25;

    const plotW = width - paddingL - paddingR;
    const plotH = height - paddingT - paddingB;

    const cellInterflow = simulationResults.interflow_intervals[cellIndex];

    // Find max interflow rate to scale the Y axis dynamically
    let maxVal = 0.0;
    for (let h = 0; h < 96; h++) {
        const valMmHr = (cellInterflow[h] * 1000.0) / 0.25; // depth in 15 mins to mm/h
        if (valMmHr > maxVal) maxVal = valMmHr;
    }
    const yMax = Math.max(1.0, Math.ceil(maxVal * 1.1));

    const getX = (intv) => paddingL + (intv / 95) * plotW;
    const getY = (val) => paddingT + plotH - (Math.min(yMax, val) / yMax) * plotH;

    let gridHtml = '';
    for (let i = 0; i <= 4; i++) {
        const val = (i / 4) * yMax;
        const y = getY(val);
        gridHtml += `<line x1="${paddingL}" y1="${y}" x2="${width - paddingR}" y2="${y}" stroke="rgba(255,255,255,0.04)" stroke-width="1" />`;
    }

    let interflowPath = '';
    let interflowFill = `M ${getX(0)} ${getY(0)}`;
    for (let h = 0; h < 96; h++) {
        const valMmHr = (cellInterflow[h] * 1000.0) / 0.25;
        const x = getX(h);
        const y = getY(valMmHr);
        if (h === 0) interflowPath += `M ${x} ${y}`;
        else interflowPath += ` L ${x} ${y}`;
        interflowFill += ` L ${x} ${y}`;
    }
    interflowFill += ` L ${getX(95)} ${getY(0)} Z`;

    container.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%;">
            ${gridHtml}
            <path d="${interflowFill}" fill="rgba(165, 94, 234, 0.08)" />
            <path d="${interflowPath}" fill="none" stroke="rgba(165, 94, 234, 0.85)" stroke-width="2" />
            
            <line x1="${paddingL}" y1="${paddingT + plotH}" x2="${width - paddingR}" y2="${paddingT + plotH}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
            
            <text x="${paddingL - 8}" y="${getY(0) + 3}" class="chart-axis-text" text-anchor="end">0</text>
            <text x="${paddingL - 8}" y="${getY(yMax / 2) + 3}" class="chart-axis-text" text-anchor="end">${(yMax / 2).toFixed(1)}</text>
            <text x="${paddingL - 8}" y="${getY(yMax) + 3}" class="chart-axis-text" text-anchor="end">${yMax.toFixed(1)}</text>
            
            <text x="${getX(0)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">0h</text>
            <text x="${getX(48)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">12h</text>
            <text x="${getX(95)}" y="${height - 8}" class="chart-axis-text" text-anchor="middle">24h</text>
            
            <text x="${width / 2}" y="${height - 2}" font-family="var(--font-sans)" font-size="9" fill="var(--text-muted)" text-anchor="middle">15-Minute Profile (96 Steps) • Purple: Interflow Rate (mm/h)</text>
        </svg>
    `;
}

// Render Interactive 24h Rainfall Hyetograph Editor (with average regional infiltration overlay)
// Supports 96 intervals (15 mins each) over 24 hours. Includes full-height invisible dragging handles.
// Supports EQ-style mouse drag sweep-to-draw interaction!
function renderRainfallEditor() {
    if (!rainfallBarsContainer) return;

    const containerWidth = rainfallBarsContainer.clientWidth || 800;
    const height = 120;
    const paddingL = 40;
    const paddingR = 15;
    const paddingT = 10;
    const paddingB = 20;

    const plotW = containerWidth - paddingL - paddingR;
    const plotH = height - paddingT - paddingB;

    const yMax = 50.0; // Max rainfall value in mm/h

    const getX = (intv) => paddingL + (intv / 96) * plotW;
    const getY = (val) => paddingT + plotH - (val / yMax) * plotH;
    const getValFromY = (y) => {
        const val = ((paddingT + plotH - y) / plotH) * yMax;
        return Math.min(yMax, Math.max(0.0, val));
    };

    const getBarIndexFromX = (pixelX) => {
        const frac = (pixelX - paddingL) / plotW;
        const idx = Math.floor(frac * 96);
        return Math.min(95, Math.max(0, idx));
    };

    // Calculate total storm depth
    let totalDepth = 0.0;
    for (let i = 0; i < 96; i++) {
        totalDepth += rainfall[i] * 0.25;
    }
    totalRainVal.textContent = `${totalDepth.toFixed(1)} mm`;

    // Horizontal grid lines
    let gridHtml = '';
    for (let i = 0; i <= 5; i++) {
        const val = (i / 5) * yMax;
        const y = getY(val);
        gridHtml += `
            <line x1="${paddingL}" y1="${y}" x2="${containerWidth - paddingR}" y2="${y}" class="rain-gridline" />
            <text x="${paddingL - 8}" y="${y + 3}" class="rain-text" text-anchor="end">${val.toFixed(0)}</text>
        `;
    }

    // Build SVG bars
    const barWidth = Math.max(1, (plotW / 96) - 1);
    let barsHtml = '';

    for (let h = 0; h < 96; h++) {
        const x = getX(h) + 0.5;
        const yRain = getY(rainfall[h]);
        const barH = paddingT + plotH - yRain;

        // Average regional infiltration overlay inside the rainfall bar
        const avgInfilVal = avgInfiltrationHourly[h];
        const yInfil = getY(avgInfilVal);

        // Height of the infiltration segment inside the rainfall bar (clamped to the rainfall height!)
        const infilH = Math.min(barH, paddingT + plotH - yInfil);
        const yInfilStart = paddingT + plotH - infilH;

        barsHtml += `
            <g class="rain-bar-group" data-hour="${h}">
                <!-- Outer Rainfall Bar (Blue) -->
                <rect id="rain-bar-rect-${h}" x="${x}" y="${yRain}" width="${barWidth}" height="${barH}" class="rain-bar ${h === activeRainBarIndex ? 'active' : ''}" />
                
                <!-- Inner Infiltration Overlay (Green) -->
                <rect id="infil-bar-rect-${h}" x="${x}" y="${yInfilStart}" width="${barWidth}" height="${infilH}" 
                      fill="rgba(46, 213, 115, 0.6)" stroke="none" pointer-events="none" rx="1" />
                      
                <!-- INVISIBLE FULL-HEIGHT DRAGGING HANDLE: Enables pulling up from 0 mm/h! -->
                <rect x="${x - 1}" y="${paddingT}" width="${barWidth + 2}" height="${plotH}" 
                      fill="transparent" class="rain-bar-handle" data-index="${h}" style="cursor: crosshair;" />

                <!-- DRAGGING HANDLE NODE (Sleek circle at the top of the bar) -->
                <circle id="rain-bar-node-${h}" cx="${x + barWidth / 2}" cy="${yRain}" r="3.2"
                        class="rain-bar-node ${h === activeRainBarIndex ? 'active' : ''}" data-index="${h}" style="cursor: ns-resize;" />
            </g>
        `;
    }

    // Build hour labels (labeled every 2 hours)
    let labelsHtml = '';
    for (let h = 0; h < 96; h += 8) {
        const hourNum = h / 4;
        labelsHtml += `<text x="${getX(h) + (plotW / 192)}" y="${height - 4}" class="rain-text-hour" text-anchor="middle">${h === 0 ? '0h' : hourNum + 'h'}</text>`;
    }

    rainfallBarsContainer.innerHTML = `
        <svg id="rainfall-editor-svg" viewBox="0 0 ${containerWidth} ${height}" width="100%" height="${height}" style="user-select: none; display: block;">
            ${gridHtml}
            ${barsHtml}
            <!-- Axis lines -->
            <line x1="${paddingL}" y1="${paddingT + plotH}" x2="${containerWidth - paddingR}" y2="${paddingT + plotH}" class="rain-axis-line" />
            <line x1="${paddingL}" y1="${paddingT}" x2="${paddingL}" y2="${paddingT + plotH}" class="rain-axis-line" />
            
            ${labelsHtml}
            <text x="${paddingL - 32}" y="${height / 2 - 10}" class="rain-text" font-weight="600" transform="rotate(-90, ${paddingL - 32}, ${height / 2 - 10})" text-anchor="middle">Rain / Infil (mm/h)</text>
        </svg>
    `;

    const svgEl = document.getElementById('rainfall-editor-svg');

    // DOM direct updates for fluid dragging performance (prevents full innerHTML re-render lag)
    const updateRainfallEditorDOM = () => {
        // Update total storm depth
        let currentTotal = 0.0;
        for (let i = 0; i < 96; i++) {
            currentTotal += rainfall[i] * 0.25;
        }
        totalRainVal.textContent = `${currentTotal.toFixed(1)} mm`;

        for (let h = 0; h < 96; h++) {
            const yRain = getY(rainfall[h]);
            const barH = paddingT + plotH - yRain;

            const rRect = document.getElementById(`rain-bar-rect-${h}`);
            if (rRect) {
                rRect.setAttribute('y', yRain);
                rRect.setAttribute('height', barH);
                if (h === activeRainBarIndex) {
                    rRect.classList.add('active');
                } else {
                    rRect.classList.remove('active');
                }
            }

            const avgInfilVal = avgInfiltrationHourly[h];
            const yInfil = getY(avgInfilVal);
            const infilH = Math.min(barH, paddingT + plotH - yInfil);
            const yInfilStart = paddingT + plotH - infilH;

            const iRect = document.getElementById(`infil-bar-rect-${h}`);
            if (iRect) {
                iRect.setAttribute('y', yInfilStart);
                iRect.setAttribute('height', infilH);
            }

            const nodeCircle = document.getElementById(`rain-bar-node-${h}`);
            if (nodeCircle) {
                nodeCircle.setAttribute('cy', yRain);
                if (h === activeRainBarIndex) {
                    nodeCircle.classList.add('active');
                } else {
                    nodeCircle.classList.remove('active');
                }
            }
        }
    };

    const updateTelemetryAndProfileCanvas = () => {
        if (pinnedCellIndex !== -1) {
            updateTelemetry(pinnedCellIndex);
        } else if (hoveredCellIndex !== -1) {
            updateTelemetry(hoveredCellIndex);
        }
        draw();
        drawCatchmentPlanform();
    };

    // Bind mouse events to support both Node Dragging (precise single bar) and EQ Sweep Drawing
    svgEl.addEventListener('mousedown', (e) => {
        const rect = svgEl.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const target = e.target;
        if (target && target.classList.contains('rain-bar-node')) {
            // Drag single node
            isDraggingSingleBar = true;
            isDraggingSweep = false;
            activeRainBarIndex = parseInt(target.getAttribute('data-index'));
            lastMouseY = mouseY;
        } else {
            // Sweep draw mode
            isDraggingSweep = true;
            isDraggingSingleBar = false;
            const targetIdx = getBarIndexFromX(mouseX);
            if (targetIdx >= 0 && targetIdx < 96) {
                activeRainBarIndex = targetIdx;
                const newRainRate = getValFromY(mouseY);
                rainfall[targetIdx] = Math.round(newRainRate * 10) / 10.0;
                lastMouseX = mouseX;
                lastMouseY = mouseY;

                runSimulation();
                updateRainfallEditorDOM();
                updateTelemetryAndProfileCanvas();
            }
        }
        e.preventDefault();
    });

    const handleRainBarDrag = (e) => {
        if (!isDraggingSingleBar && !isDraggingSweep) return;

        const rect = svgEl.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        if (isDraggingSingleBar) {
            if (activeRainBarIndex >= 0 && activeRainBarIndex < 96) {
                const newRainRate = getValFromY(mouseY);
                rainfall[activeRainBarIndex] = Math.round(newRainRate * 10) / 10.0;

                runSimulation();
                updateRainfallEditorDOM();
                updateTelemetryAndProfileCanvas();
            }
        } else if (isDraggingSweep) {
            const currentIdx = getBarIndexFromX(mouseX);
            const startIdx = getBarIndexFromX(lastMouseX);

            if (currentIdx >= 0 && currentIdx < 96 && startIdx >= 0 && startIdx < 96) {
                const minIdx = Math.min(startIdx, currentIdx);
                const maxIdx = Math.max(startIdx, currentIdx);

                const startRate = getValFromY(lastMouseY);
                const endRate = getValFromY(mouseY);

                if (minIdx === maxIdx) {
                    rainfall[minIdx] = Math.round(endRate * 10) / 10.0;
                } else {
                    for (let i = minIdx; i <= maxIdx; i++) {
                        const t = (i - startIdx) / (currentIdx - startIdx);
                        const rate = startRate + t * (endRate - startRate);
                        rainfall[i] = Math.round(rate * 10) / 10.0;
                    }
                }

                lastMouseX = mouseX;
                lastMouseY = mouseY;
                activeRainBarIndex = currentIdx;

                runSimulation();
                updateRainfallEditorDOM();
                updateTelemetryAndProfileCanvas();
            }
        }
    };

    svgEl.addEventListener('mousemove', handleRainBarDrag);

    const endRainDrag = () => {
        if (isDraggingSingleBar || isDraggingSweep) {
            isDraggingSingleBar = false;
            isDraggingSweep = false;
            activeRainBarIndex = -1;
            renderRainfallEditor(); // Redraw clean with normal sizes
        }
    };

    svgEl.addEventListener('mouseup', endRainDrag);
    svgEl.addEventListener('mouseleave', endRainDrag);
}

// Draw Symmetrical Catchment Planform Geometry funnel shape
function drawCatchmentPlanform() {
    if (!catchmentCanvas || !terrainData || !simulationResults) return;

    const width = catchmentCanvas.width;
    const height = catchmentCanvas.height;

    catchmentCtx.clearRect(0, 0, width, height);

    const numCells = terrainData.elevations.length;
    const marginL = 50;
    const marginR = 50;
    const drawW = width - marginL - marginR;
    const middleY = height / 2;

    // Find maximum catchment width across the cells to scale vertical boundaries
    const maxWidth = Math.max(...simulationResults.cellWidths);

    // Scale mapping functions
    const getX = (index) => marginL + (index / (numCells - 1)) * drawW;
    const getYHalfWidth = (w) => (w / maxWidth) * (height * 0.42); // takes 84% of canvas vertical space

    // 1. Draw Catchment shape path (Symmetrical top and bottom)
    catchmentCtx.beginPath();

    // Top boundary boundary path (starts at top-left edge instead of center line to support flipped shapes cleanly)
    catchmentCtx.moveTo(getX(0), middleY - getYHalfWidth(simulationResults.cellWidths[0]));
    for (let i = 0; i < numCells; i++) {
        const halfW = getYHalfWidth(simulationResults.cellWidths[i]);
        catchmentCtx.lineTo(getX(i), middleY - halfW);
    }

    // Bottom boundary path (looping back from downstream to upstream)
    for (let i = numCells - 1; i >= 0; i--) {
        const halfW = getYHalfWidth(simulationResults.cellWidths[i]);
        catchmentCtx.lineTo(getX(i), middleY + halfW);
    }
    catchmentCtx.closePath();

    // Catchment gradient fill (funnel view)
    const catchmentGrad = catchmentCtx.createLinearGradient(marginL, 0, marginL + drawW, 0);
    catchmentGrad.addColorStop(0, 'rgba(46, 213, 115, 0.04)');
    catchmentGrad.addColorStop(0.5, 'rgba(0, 210, 255, 0.08)');
    catchmentGrad.addColorStop(1, 'rgba(0, 210, 255, 0.16)');

    catchmentCtx.fillStyle = catchmentGrad;
    catchmentCtx.fill();

    // Draw boundary stroke
    catchmentCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    catchmentCtx.lineWidth = 1.2;
    catchmentCtx.stroke();

    // Draw central flow channel line (dotted blue)
    catchmentCtx.beginPath();
    catchmentCtx.moveTo(getX(0), middleY);
    catchmentCtx.lineTo(getX(numCells - 1), middleY);
    catchmentCtx.strokeStyle = 'rgba(0, 210, 255, 0.35)';
    catchmentCtx.lineWidth = 1;
    catchmentCtx.setLineDash([4, 4]);
    catchmentCtx.stroke();
    catchmentCtx.setLineDash([]);

    // 2. Draw Marker for active cell (hovered or pinned)
    const activeIndex = pinnedCellIndex !== -1 ? pinnedCellIndex : hoveredCellIndex;
    if (activeIndex !== -1 && activeIndex < numCells) {
        const markerX = getX(activeIndex);
        const halfW = getYHalfWidth(simulationResults.cellWidths[activeIndex]);

        // Draw cross-section indicator line
        catchmentCtx.strokeStyle = activeIndex === pinnedCellIndex ? 'rgba(165, 94, 234, 0.7)' : 'rgba(0, 210, 255, 0.6)';
        catchmentCtx.lineWidth = 1.5;
        catchmentCtx.beginPath();
        catchmentCtx.moveTo(markerX, middleY - halfW);
        catchmentCtx.lineTo(markerX, middleY + halfW);
        catchmentCtx.stroke();

        // Draw center channel dot marker
        catchmentCtx.beginPath();
        catchmentCtx.arc(markerX, middleY, 4, 0, 2 * Math.PI);
        catchmentCtx.fillStyle = activeIndex === pinnedCellIndex ? '#a55eea' : '#00d2ff';
        catchmentCtx.shadowColor = activeIndex === pinnedCellIndex ? '#a55eea' : '#00d2ff';
        catchmentCtx.shadowBlur = 8;
        catchmentCtx.fill();
        catchmentCtx.shadowBlur = 0;

        catchmentCtx.strokeStyle = '#fff';
        catchmentCtx.lineWidth = 1.2;
        catchmentCtx.stroke();
    }

    // 3. Labels
    catchmentCtx.fillStyle = '#8b9bb4';
    catchmentCtx.font = '9px "JetBrains Mono", monospace';
    catchmentCtx.textAlign = 'left';
    catchmentCtx.fillText('Upstream (Divide)', marginL, middleY - 6);
    catchmentCtx.textAlign = 'right';
    catchmentCtx.fillText('Downstream (Outlet)', marginL + drawW, middleY - 6);
}

// Global pinning state handles clicks
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    if (isDragging) {
        offsetX = mouseX - startX;
        draw();
        drawCatchmentPlanform();
    } else {
        const index = getCellIndexFromX(mouseX);
        if (index !== hoveredCellIndex) {
            hoveredCellIndex = index;
            if (pinnedCellIndex === -1) {
                updateTelemetry(index);
            } else {
                draw();
                drawCatchmentPlanform();
            }
        }
    }
});

canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    if (e.button === 0) {
        isDragging = true;
        startX = e.clientX - rect.left - offsetX;

        const index = getCellIndexFromX(mouseX);
        if (index !== -1) {
            pinnedCellIndex = index;
            updateTelemetry(index);
            draw();
            drawCatchmentPlanform();
        }
    }
    else if (e.button === 2) {
        pinnedCellIndex = -1;
        clearTelemetry();
        draw();
        drawCatchmentPlanform();
    }
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('mouseup', () => {
    isDragging = false;
    if (isDraggingSingleBar || isDraggingSweep) {
        isDraggingSingleBar = false;
        isDraggingSweep = false;
        activeRainBarIndex = -1;
        renderRainfallEditor();
    }
});

canvas.addEventListener('mouseleave', () => {
    isDragging = false;
    hoveredCellIndex = -1;
    if (pinnedCellIndex === -1) {
        clearTelemetry();
    }
    draw();
    drawCatchmentPlanform();
});

// Zoom via Mouse Wheel
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    const zoomIntensity = 0.05;
    const zoomFactor = e.deltaY < 0 ? (1 + zoomIntensity) : (1 - zoomIntensity);
    const marginL = 50;

    const newScale = Math.min(25.0, Math.max(1.0, scale * zoomFactor));
    offsetX = mouseX - marginL - (mouseX - marginL - offsetX) * (newScale / scale);
    scale = newScale;

    if (scale === 1.0) offsetX = 0;
    draw();
    drawCatchmentPlanform();
});

// Zoom Control Buttons
zoomInBtn.addEventListener('click', () => {
    scale = Math.min(25.0, scale * 1.3);
    draw();
    drawCatchmentPlanform();
});

zoomOutBtn.addEventListener('click', () => {
    scale = Math.max(1.0, scale / 1.3);
    if (scale === 1.0) offsetX = 0;
    draw();
    drawCatchmentPlanform();
});

zoomResetBtn.addEventListener('click', () => {
    resetView();
    draw();
    drawCatchmentPlanform();
});

// Sliders and Re-generation Events
slopeSlider.addEventListener('input', () => {
    slopeVal.textContent = `${parseFloat(slopeSlider.value).toFixed(2)}x`;
    fetchTerrainData();
});

textureSlider.addEventListener('input', () => {
    textureVal.textContent = `${parseFloat(textureSlider.value).toFixed(2)}x`;
    fetchTerrainData();
});

ksatSlider.addEventListener('input', () => {
    ksatVal.textContent = `${parseFloat(ksatSlider.value).toFixed(1)} mm/h`;
    runSimulation();
    renderRainfallEditor();
    if (pinnedCellIndex !== -1) updateTelemetry(pinnedCellIndex);
    else if (hoveredCellIndex !== -1) updateTelemetry(hoveredCellIndex);
    draw();
    drawCatchmentPlanform();
});

moistureSlider.addEventListener('input', () => {
    runSimulation();
    renderRainfallEditor();
    if (pinnedCellIndex !== -1) updateTelemetry(pinnedCellIndex);
    else if (hoveredCellIndex !== -1) updateTelemetry(hoveredCellIndex);
    draw();
    drawCatchmentPlanform();
});

shapeBSlider.addEventListener('input', () => {
    shapeBVal.textContent = `${parseFloat(shapeBSlider.value).toFixed(2)}`;
    runSimulation();
    renderRainfallEditor();
    if (pinnedCellIndex !== -1) updateTelemetry(pinnedCellIndex);
    else if (hoveredCellIndex !== -1) updateTelemetry(hoveredCellIndex);
    draw();
    drawCatchmentPlanform();
});

critStreamPowerSlider.addEventListener('input', () => {
    criticalStreamPower = parseFloat(critStreamPowerSlider.value);
    critStreamPowerVal.textContent = `${criticalStreamPower.toFixed(2)} cm/s`;
    runSimulation();
    renderRainfallEditor();
    if (pinnedCellIndex !== -1) updateTelemetry(pinnedCellIndex);
    else if (hoveredCellIndex !== -1) updateTelemetry(hoveredCellIndex);
    draw();
    drawCatchmentPlanform();
});

// Bind Erosion Steps Slider
const erosionStepsSlider = document.getElementById('erosion-steps-input');
const erosionStepsVal = document.getElementById('erosion-steps-val');
if (erosionStepsSlider) {
    erosionStepsSlider.addEventListener('input', () => {
        const sliderIdx = parseInt(erosionStepsSlider.value);
        const labels = [
            "1 step (24h avg)",
            "2 steps (12h avg)",
            "4 steps (6h avg)",
            "8 steps (3h avg)",
            "12 steps (2h avg)",
            "24 steps (1h avg)",
            "48 steps (30m avg)",
            "96 steps (15m avg)"
        ];
        if (erosionStepsVal) erosionStepsVal.textContent = labels[sliderIdx];

        runSimulation();
        renderRainfallEditor();
        if (pinnedCellIndex !== -1) updateTelemetry(pinnedCellIndex);
        else if (hoveredCellIndex !== -1) updateTelemetry(hoveredCellIndex);
        draw();
        drawCatchmentPlanform();
    });
}

// Fetch new terrain when clicking regenerate
regenerateBtn.addEventListener('click', fetchTerrainData);

// Window Resize Handling
window.addEventListener('resize', () => {
    resizeCanvas();
    renderRainfallEditor();
});

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    initDefaultRainfall();
    resizeCanvas();
    fetchTerrainData();
});
