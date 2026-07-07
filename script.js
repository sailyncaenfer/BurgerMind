const SIZE = 4;
let selectedCells = []; 
let isDragging = false;
let mode = "pen";
let currentDifficulty = "normal";
let rowTotals = [0, 0, 0, 0];
let colTotals = [0, 0, 0, 0];

let historyStack = [];
let redoStack = [];

const BUFFER_MAX = 10;
// Raised from 3 -> 5: testing showed <=3-clue minimal grids occur in ~2.5% of
// attempts and only ~46% of those are solvable by logic alone (rest require
// guessing). Capping at 5 gives a ~15x better generation hit-rate while still
// producing genuinely hard, logic-solvable puzzles.
const MAX_CLUES_HARD = 2;
const FORBIDDEN_TOTALS = [4, 5, 6, 14, 15, 16];

const gridElement = document.getElementById("grid");

function init() {
    createGrid();
    generateBasedOnSetting();
    setupDragListeners();
    setupGlobalCancel();
    window.addEventListener('keydown', handleKeyDown);
    setTimeout(() => { fillBuffer('normal'); fillBuffer('hard'); }, 500);
}

function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
    }
    if (e.key === 'Shift') {
        e.preventDefault();
        setMode(mode === 'pen' ? 'pencil' : 'pen');
        return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        moveSelection(e.key);
        return;
    }
    if (['1', '2', '3', '4'].includes(e.key)) {
        handleInput(e.key);
        return;
    }
    if (e.key === 'Backspace' || e.key === ' ') {
        e.preventDefault();
        handleInput('backspace');
        return;
    }
}

function moveSelection(direction) {
    if (selectedCells.length === 0) {
        const firstCell = document.getElementById('cell-0-0');
        if (firstCell) addCellToSelection(firstCell);
        return;
    }
    const lastCell = selectedCells[selectedCells.length - 1];
    let r = parseInt(lastCell.dataset.r);
    let c = parseInt(lastCell.dataset.c);

    if (direction === 'ArrowUp') r = Math.max(0, r - 1);
    if (direction === 'ArrowDown') r = Math.min(SIZE - 1, r + 1);
    if (direction === 'ArrowLeft') c = Math.max(0, c - 1);
    if (direction === 'ArrowRight') c = Math.min(SIZE - 1, c + 1);

    const nextCell = document.getElementById(`cell-${r}-${c}`);
    if (nextCell) {
        clearSelection();
        addCellToSelection(nextCell);
    }
}

// --- CORE LOGIC ---

function saveState() {
    const currentState = {
        rowTotals: [...rowTotals], 
        colTotals: [...colTotals],
        cells: Array.from(document.querySelectorAll('.cell')).map(cell => ({
            val: cell.querySelector(".val").innerText,
            pencils: Array.from(cell.querySelectorAll(".pencil div")).map(p => p.innerText),
            locked: cell.classList.contains('locked')
        }))
    };
    historyStack.push(JSON.stringify(currentState));
    if (historyStack.length > 50) historyStack.shift();
    redoStack = [];
}

function undo() {
    if (historyStack.length === 0) return;
    const currentState = {
        rowTotals: [...rowTotals], 
        colTotals: [...colTotals],
        cells: Array.from(document.querySelectorAll('.cell')).map(cell => ({
            val: cell.querySelector(".val").innerText,
            pencils: Array.from(cell.querySelectorAll(".pencil div")).map(p => p.innerText),
            locked: cell.classList.contains('locked')
        }))
    };
    redoStack.push(JSON.stringify(currentState));
    const lastState = JSON.parse(historyStack.pop());
    applyState(lastState);
}

function redo() {
    if (redoStack.length === 0) return;
    const currentState = {
        rowTotals: [...rowTotals], 
        colTotals: [...colTotals],
        cells: Array.from(document.querySelectorAll('.cell')).map(cell => ({
            val: cell.querySelector(".val").innerText,
            pencils: Array.from(cell.querySelectorAll(".pencil div")).map(p => p.innerText),
            locked: cell.classList.contains('locked')
        }))
    };
    historyStack.push(JSON.stringify(currentState));
    const nextState = JSON.parse(redoStack.pop());
    applyState(nextState);
}

function applyState(state) {
    rowTotals = state.rowTotals; 
    colTotals = state.colTotals;
    createGrid(); 
    const cells = document.querySelectorAll('.cell');
    state.cells.forEach((data, i) => {
        cells[i].querySelector(".val").innerText = data.val;
        if(data.locked) cells[i].classList.add('locked');
        cells[i].querySelectorAll(".pencil div").forEach((p, pi) => p.innerText = data.pencils[pi]);
    });
    checkGrid();
}

// --- TRIVIAL CLUE DETECTION ---

// A cell is "immediately solvable" if a single row or column total, taken in
// isolation (ignoring every other row/column), already pins that cell to one
// digit. This is checked with the same per-slot candidate machinery used by
// isLogicallySolvable (getLineCandidates, defined below) but applied one line
// at a time instead of iterating the whole grid to a fixed point.
//
// This is a stricter check than "the whole line has a unique arrangement":
// even when a line has several valid arrangements overall, one particular
// slot in it can still take the same digit in all of them, which would let a
// player fill that cell from a single clue with no real deduction. Hard mode
// should require combining row + column information (or reasoning across
// several cells) before anything can be placed, so any such single-line
// giveaway makes the puzzle rejected as too easy.
function hasImmediatelySolvableCell(puzzle, rTots, cTots) {
    const globalCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (puzzle[r][c] !== 0) globalCounts[puzzle[r][c]]++;
    const remain = { 1: 4 - globalCounts[1], 2: 4 - globalCounts[2], 3: 4 - globalCounts[3], 4: 4 - globalCounts[4] };

    // Check each row in isolation
    for (let r = 0; r < SIZE; r++) {
        const emptyCols = []; let clueSum = 0;
        for (let c = 0; c < SIZE; c++) {
            if (puzzle[r][c] === 0) emptyCols.push(c);
            else clueSum += puzzle[r][c];
        }
        if (emptyCols.length === 0) continue;
        const cands = getLineCandidates(emptyCols, rTots[r] - clueSum, remain);
        if (cands.some(set => set.size === 1)) return true;
    }

    // Check each column in isolation
    for (let c = 0; c < SIZE; c++) {
        const emptyRows = []; let clueSum = 0;
        for (let r = 0; r < SIZE; r++) {
            if (puzzle[r][c] === 0) emptyRows.push(r);
            else clueSum += puzzle[r][c];
        }
        if (emptyRows.length === 0) continue;
        const cands = getLineCandidates(emptyRows, cTots[c] - clueSum, remain);
        if (cands.some(set => set.size === 1)) return true;
    }

    return false;
}

// --- LOGICAL SOLVABILITY CHECK ---

// A puzzle can have a unique solution and still be no fun, if the only way to
// reach that solution is guessing and backtracking. This checks whether the
// puzzle can be fully solved using pure deduction: repeatedly narrowing each
// empty cell's candidates using its row total, its column total, and the
// global "each digit used exactly 4 times" constraint, until either the grid
// is fully deduced (logically solvable) or no more progress can be made
// (would require guessing).

// For a line (row or column) with given empty slot count and target sum,
// returns per-slot the set of digits that appear in at least one valid
// completion of that line, respecting the shared global remaining counts.
function getLineCandidates(emptySlots, target, globalRemaining) {
    const candidatesPerSlot = emptySlots.map(() => new Set());
    const remaining = { ...globalRemaining };

    function recurse(slotIndex, sumLeft, chosen) {
        if (slotIndex === emptySlots.length) {
            if (sumLeft === 0) chosen.forEach((d, i) => candidatesPerSlot[i].add(d));
            return;
        }
        for (let d = 1; d <= 4; d++) {
            if (remaining[d] <= 0) continue;
            if (d > sumLeft) continue;
            remaining[d]--;
            chosen.push(d);
            recurse(slotIndex + 1, sumLeft - d, chosen);
            chosen.pop();
            remaining[d]++;
        }
    }
    recurse(0, target, []);
    return candidatesPerSlot;
}

function isLogicallySolvable(puzzle, rTots, cTots) {
    let grid = puzzle.map(row => [...row]);

    while (true) {
        const globalCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c < SIZE; c++)
                if (grid[r][c] !== 0) globalCounts[grid[r][c]]++;
        const remain = { 1: 4 - globalCounts[1], 2: 4 - globalCounts[2], 3: 4 - globalCounts[3], 4: 4 - globalCounts[4] };

        let emptyTotal = 0;
        for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (grid[r][c] === 0) emptyTotal++;
        if (emptyTotal === 0) return true; // fully deduced, no guessing needed

        const cellCand = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

        for (let r = 0; r < SIZE; r++) {
            const emptyCols = []; let clueSum = 0;
            for (let c = 0; c < SIZE; c++) { if (grid[r][c] === 0) emptyCols.push(c); else clueSum += grid[r][c]; }
            if (emptyCols.length === 0) continue;
            const cands = getLineCandidates(emptyCols, rTots[r] - clueSum, remain);
            emptyCols.forEach((c, i) => { cellCand[r][c] = new Set(cands[i]); });
        }

        for (let c = 0; c < SIZE; c++) {
            const emptyRows = []; let clueSum = 0;
            for (let r = 0; r < SIZE; r++) { if (grid[r][c] === 0) emptyRows.push(r); else clueSum += grid[r][c]; }
            if (emptyRows.length === 0) continue;
            const cands = getLineCandidates(emptyRows, cTots[c] - clueSum, remain);
            emptyRows.forEach((r, i) => {
                const colSet = cands[i];
                const existing = cellCand[r][c];
                cellCand[r][c] = existing ? new Set([...existing].filter(d => colSet.has(d))) : colSet;
            });
        }

        let progressed = false;
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (grid[r][c] !== 0) continue;
                const set = cellCand[r][c];
                if (!set || set.size === 0) return false; // contradiction, shouldn't occur for a valid puzzle
                if (set.size === 1) { grid[r][c] = [...set][0]; progressed = true; }
            }
        }
        if (!progressed) return false; // stuck: would require guessing
    }
}

// --- GENERATION & UI ---

// One buffer per difficulty, each background-filled up to BUFFER_MAX so that
// clicking "New Puzzle" almost always just pops a ready-made puzzle instantly
// instead of generating on the spot.
let buffers = { normal: [], hard: [] };

function fillBuffer(difficulty) {
    if (buffers[difficulty].length >= BUFFER_MAX) return; // topped up, nothing to do
    generatePuzzleDataAsync(difficulty, (data) => {
        buffers[difficulty].push(data);
        fillBuffer(difficulty); // keep going until full
    });
}

function isValidTotalSet(tots) {
    return !tots.some(t => FORBIDDEN_TOTALS.includes(t));
}

// Attempts a single puzzle generation. Returns null on failure (caller retries).
// Kept as one fast, non-recursive attempt so it can be wrapped in setTimeout(0)
// and yield to the event loop between tries without blocking the UI.
function tryGenerateHardPuzzleData() {
    let fullGrid = generateFullGrid();
    let rTots = fullGrid.map(row => row.reduce((a, b) => a + b, 0));
    let cTots = Array(SIZE).fill(0).map((_, c) => fullGrid.reduce((sum, row) => sum + row[c], 0));
    if (!isValidTotalSet(rTots) || !isValidTotalSet(cTots)) return null;
    let puzzle = fullGrid.map(row => [...row]);
    let finalPuzzle = minimizeDFS(puzzle, getShuffledCoords(), rTots, cTots);
    let clueCount = 0;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (finalPuzzle[r][c] !== 0) clueCount++;
    // Reject if too many clues, if any clue is trivially deducible (too easy),
    // or if the puzzle can't be fully deduced by logic alone (too hard / requires guessing)
    if (clueCount <= MAX_CLUES_HARD && !hasImmediatelySolvableCell(finalPuzzle, rTots, cTots) && isLogicallySolvable(finalPuzzle, rTots, cTots)) {
        return { puzzle: finalPuzzle, rTots, cTots };
    }
    return null;
}

function tryGenerateNormalPuzzleData() {
    let fullGrid = generateFullGrid();
    let rTots = fullGrid.map(row => row.reduce((a, b) => a + b, 0));
    let cTots = Array(SIZE).fill(0).map((_, c) => fullGrid.reduce((sum, row) => sum + row[c], 0));
    if (!isValidTotalSet(rTots) || !isValidTotalSet(cTots)) return null;
    let puzzle = fullGrid.map(row => [...row]);
    let coords = getShuffledCoords();
    for (let pos of coords) {
        let backup = puzzle[pos.r][pos.c];
        puzzle[pos.r][pos.c] = 0;
        if (countSolutions(puzzle, rTots, cTots) > 1) puzzle[pos.r][pos.c] = backup;
    }
    return { puzzle, rTots, cTots };
}

// Generates one puzzle for the given difficulty without blocking the main
// thread. Rather than yielding after every single failed attempt (which
// wastes time on browser setTimeout(0) clamping, ~4ms minimum per call), it
// runs attempts back-to-back within a small time budget per tick and only
// yields when that budget is used up. Keeps the UI responsive while cutting
// the number of event-loop round trips by roughly the batch size.
const GEN_TIME_BUDGET_MS = 8;
function generatePuzzleDataAsync(difficulty, callback) {
    setTimeout(() => {
        const deadline = Date.now() + GEN_TIME_BUDGET_MS;
        let data = null;
        do {
            data = difficulty === "hard" ? tryGenerateHardPuzzleData() : tryGenerateNormalPuzzleData();
        } while (!data && Date.now() < deadline);
        if (data) callback(data);
        else generatePuzzleDataAsync(difficulty, callback);
    }, 0);
}

function generateBasedOnSetting() {
    const diff = currentDifficulty;
    saveState();
    if (buffers[diff].length > 0) {
        // Instant: serve a pre-generated puzzle from the background buffer
        let data = buffers[diff].shift();
        rowTotals = data.rTots; colTotals = data.cTots;
        renderPuzzle(data.puzzle);
        fillBuffer(diff); // top the buffer back up in the background
    } else {
        // Buffer empty (e.g. very first load): generate synchronously right now.
        // Fast enough (capped clue count) to not noticeably block the UI.
        let data;
        do { data = diff === "hard" ? tryGenerateHardPuzzleData() : tryGenerateNormalPuzzleData(); } while (!data);
        rowTotals = data.rTots; colTotals = data.cTots;
        renderPuzzle(data.puzzle);
        fillBuffer(diff);
    }
}

function minimizeDFS(currentGrid, cellsToTry, rTots, cTots) {
    if (cellsToTry.length === 0) return currentGrid;
    let pos = cellsToTry.pop();
    let backup = currentGrid[pos.r][pos.c];
    currentGrid[pos.r][pos.c] = 0;
    if (countSolutions(currentGrid, rTots, cTots) === 1) return minimizeDFS(currentGrid, cellsToTry, rTots, cTots);
    currentGrid[pos.r][pos.c] = backup;
    return minimizeDFS(currentGrid, cellsToTry, rTots, cTots);
}

function generateFullGrid() {
    let nums = [1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4].sort(() => Math.random() - 0.5);
    let grid = [];
    for(let i=0; i<SIZE; i++) grid.push(nums.slice(i*SIZE, i*SIZE+SIZE));
    return grid;
}

function getShuffledCoords() {
    let coords = [];
    for(let r=0; r<SIZE; r++) for(let c=0; c<SIZE; c++) coords.push({r, c});
    return coords.sort(() => Math.random() - 0.5);
}

function renderPuzzle(puzzle) {
    createGrid(); 
    for(let r=0; r<SIZE; r++) {
        for(let c=0; c<SIZE; c++) {
            if (puzzle[r][c] !== 0) {
                const cell = document.getElementById(`cell-${r}-${c}`);
                cell.querySelector(".val").innerText = puzzle[r][c];
                cell.classList.add("locked");
            }
        }
    }
    checkGrid();
}

function countSolutions(grid, rTots, cTots) {
    let count = 0;
    let tempGrid = grid.map(row => [...row]);
    function solve() {
        if (count > 1) return;
        let r = -1, c = -1;
        for(let i=0; i<SIZE; i++) {
            for(let j=0; j<SIZE; j++) { if(tempGrid[i][j] === 0) { r=i; c=j; break; } }
            if(r !== -1) break;
        }
        if (r === -1) { if (isCompleteAndValid(tempGrid, rTots, cTots)) count++; return; }
        for (let num = 1; num <= 4; num++) {
            if (canPlace(tempGrid, num)) {
                tempGrid[r][c] = num;
                if (isPartialValid(tempGrid, rTots, cTots)) solve();
                tempGrid[r][c] = 0;
            }
        }
    }
    solve();
    return count;
}

function canPlace(grid, num) {
    let occ = 0;
    for(let r=0; r<SIZE; r++) for(let c=0; c<SIZE; c++) if(grid[r][c] === num) occ++;
    return occ < 4;
}

function isPartialValid(grid, rTots, cTots) {
    for(let i=0; i<SIZE; i++) {
        let rSum = 0, rFull = true, cSum = 0, cFull = true;
        for(let j=0; j<SIZE; j++) {
            rSum += grid[i][j]; if(grid[i][j] === 0) rFull = false;
            cSum += grid[j][i]; if(grid[j][i] === 0) cFull = false;
        }
        if (rSum > rTots[i] || (rFull && rSum !== rTots[i])) return false;
        if (cSum > cTots[i] || (cFull && cSum !== cTots[i])) return false;
    }
    return true;
}

function isCompleteAndValid(grid, rTots, cTots) {
    let counts = {1:0, 2:0, 3:0, 4:0};
    for(let r=0; r<SIZE; r++) {
        let rs = 0;
        for(let c=0; c<SIZE; c++) { 
            if(grid[r][c] === 0) return false;
            counts[grid[r][c]]++; rs += grid[r][c]; 
        }
        if (rs !== rTots[r]) return false;
    }
    if (Object.values(counts).some(v => v !== 4)) return false;
    for(let c=0; c<SIZE; c++) {
        let cs = 0;
        for(let r=0; r<SIZE; r++) cs += grid[r][c];
        if (cs !== cTots[c]) return false;
    }
    return true;
}

function toggleSettings() { document.getElementById('settings-menu').classList.toggle('hidden'); }
function setDifficulty(val) { currentDifficulty = val; fillBuffer(val); setTimeout(() => document.getElementById('settings-menu').classList.add('hidden'), 200); }

function createGrid() {
    gridElement.innerHTML = '';
    for (let r = 0; r <= SIZE + 1; r++) {
        for (let c = 0; c <= SIZE + 1; c++) {
            const el = document.createElement("div");
            if (r === 0 && c > 0 && c <= SIZE) { el.className = "check"; el.id = `col-check-${c-1}`; } 
            else if (c === 0 && r > 0 && r <= SIZE) { el.className = "check"; el.id = `row-check-${r-1}`; } 
            else if (c === SIZE + 1 && r > 0 && r <= SIZE) {
                el.className = "total"; el.id = `row-total-${r-1}`;
                el.innerText = rowTotals[r-1] !== 0 ? rowTotals[r-1] : "";
                el.onclick = () => editTotal(el, "row", r-1);
            } else if (r === SIZE + 1 && c > 0 && c <= SIZE) {
                el.className = "total"; el.id = `col-total-${c-1}`;
                el.innerText = colTotals[c-1] !== 0 ? colTotals[c-1] : "";
                el.onclick = () => editTotal(el, "col", c-1);
            } else if (r > 0 && r <= SIZE && c > 0 && c <= SIZE) {
                el.className = "cell"; el.id = `cell-${r-1}-${c-1}`;
                el.dataset.r = r - 1; el.dataset.c = c - 1;
                const v = document.createElement("span"); v.className = "val"; el.appendChild(v);
                const p = document.createElement("div"); p.className = "pencil";
                ["p1", "p2", "p3", "p4"].forEach(cls => { let d = document.createElement("div"); d.className = cls; p.appendChild(d); });
                el.appendChild(p);
                el.addEventListener('mousedown', (e) => startSelect(el, e));
                el.addEventListener('mouseenter', () => continueSelect(el));
                el.addEventListener('touchstart', (e) => { e.preventDefault(); startSelect(el); }, {passive: false});
            }
            gridElement.appendChild(el);
        }
    }
}

function handleInput(key) {
    if (selectedCells.length === 0) return;
    if (key === 'backspace') {
        saveState();
        selectedCells.forEach(cell => {
            if (cell.classList.contains('locked')) return;
            cell.querySelector(".val").innerText = "";
            cell.querySelectorAll(".pencil div").forEach(d => d.innerText = "");
        });
        checkGrid(); return;
    }
    const num = parseInt(key);
    if (num >= 1 && num <= 4) {
        saveState();
        const targets = selectedCells.filter(c => !c.classList.contains('locked'));
        if (targets.length === 0) return;
        if (mode === "pen") {
            const firstVal = targets[0].querySelector(".val").innerText;
            const newVal = (firstVal == num) ? "" : num;
            targets.forEach(cell => {
                cell.querySelectorAll(".pencil div").forEach(d => d.innerText = "");
                cell.querySelector(".val").innerText = newVal;
            });
        } else {
            const allHaveIt = targets.every(c => c.querySelector(`.p${num}`).innerText == num);
            const newVal = allHaveIt ? "" : num;
            targets.forEach(cell => {
                cell.querySelector(".val").innerText = "";
                cell.querySelector(`.p${num}`).innerText = newVal;
            });
        }
        checkGrid();
    }
}

function checkGrid() {
    let rows = Array(SIZE).fill(0), cols = Array(SIZE).fill(0), counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const allCells = document.querySelectorAll(".cell");
    allCells.forEach(c => {
        c.classList.remove("red");
        let v = parseInt(c.querySelector(".val").innerText);
        if (!isNaN(v)) { rows[c.dataset.r] += v; cols[c.dataset.c] += v; counts[v]++; }
    });
    allCells.forEach(c => {
        let v = parseInt(c.querySelector(".val").innerText);
        if (!isNaN(v) && counts[v] > 4) c.classList.add("red");
    });
    for (let i = 0; i < SIZE; i++) {
        const rc = document.getElementById("row-check-" + i);
        const cc = document.getElementById("col-check-" + i);
        if (rc && rowTotals[i] > 0) {
            rc.innerText = (rows[i] === rowTotals[i]) ? "✓" : "✗";
            rc.className = "check " + (rows[i] === rowTotals[i] ? "green" : "red-text");
        }
        if (cc && colTotals[i] > 0) {
            cc.innerText = (cols[i] === colTotals[i]) ? "✓" : "✗";
            cc.className = "check " + (cols[i] === colTotals[i] ? "green" : "red-text");
        }
    }
}

function setMode(m) {
    mode = m;
    const btnPen = document.getElementById('btn-pen');
    const btnPencil = document.getElementById('btn-pencil');
    if(btnPen) btnPen.classList.toggle('active-mode', m === 'pen');
    if(btnPencil) btnPencil.classList.toggle('active-mode', m === 'pencil');
}

function editTotal(el, type, index) {
    if (document.querySelector('.cell.locked')) return;
    let val = prompt(`Enter total:`, el.innerText);
    if (val !== null) {
        let num = parseInt(val) || 0;
        saveState();
        if (type === "row") rowTotals[index] = num; else colTotals[index] = num;
        el.innerText = num !== 0 ? num : "";
        checkGrid();
    }
}

function switchToManual() { saveState(); rowTotals = [0, 0, 0, 0]; colTotals = [0, 0, 0, 0]; createGrid(); checkGrid(); }
function resetInputs() {
    if (!confirm("Clear inputs?")) return;
    saveState();
    document.querySelectorAll('.cell:not(.locked)').forEach(c => {
        c.querySelector('.val').innerText = "";
        c.querySelectorAll('.pencil div').forEach(p => p.innerText = "");
    });
    checkGrid();
}

function setupDragListeners() {
    window.addEventListener('mouseup', () => isDragging = false);
    window.addEventListener('touchend', () => isDragging = false);
    gridElement.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        if (target && target.closest('.cell')) continueSelect(target.closest('.cell'));
    }, {passive: false});
}

function startSelect(cell, e) { isDragging = true; if (!e || !e.shiftKey) clearSelection(); addCellToSelection(cell); }
function continueSelect(cell) { if (isDragging) addCellToSelection(cell); }
function addCellToSelection(cell) { if (!selectedCells.includes(cell)) { selectedCells.push(cell); cell.classList.add('selected'); } }
function clearSelection() { selectedCells.forEach(c => c.classList.remove('selected')); selectedCells = []; }
function setupGlobalCancel() { 
    window.addEventListener('mousedown', (e) => { 
        if (!e.target.closest('.cell') && !e.target.closest('.keypad') && !e.target.closest('.controls') && !e.target.closest('.settings-container')) clearSelection(); 
    });
}

init();
