const SIZE = 4;
let selectedCells = []; 
let isDragging = false;
let mode = "pen";
let currentDifficulty = "normal";
let rowTotals = [0, 0, 0, 0];
let colTotals = [0, 0, 0, 0];
let historyStack = [];
let puzzleBuffer = [];
const BUFFER_MAX = 5;
const MAX_CLUES_HARD = 3;
const FORBIDDEN_TOTALS = [4, 5, 15, 16];

const gridElement = document.getElementById("grid");

function init() {
    createGrid();
    generateBasedOnSetting();
    setupDragListeners();
    setupGlobalCancel();
    window.addEventListener('keydown', handleKeyDown);
    setTimeout(fillBuffer, 1000);
}

function handleKeyDown(e) {
    // 1. Handle Undo (Ctrl + Z)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
    }
    // 2. Handle Mode Toggle (Shift)
    if (e.key === 'Shift') {
        e.preventDefault();
        setMode(mode === 'pen' ? 'pencil' : 'pen');
        return;
    }
    // 3. Handle Navigation (Arrows)
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        moveSelection(e.key);
        return;
    }
    // 4. Handle Cell Input (1, 2, 3, 4)
    if (['1', '2', '3', '4'].includes(e.key)) {
        handleInput(e.key);
        return;
    }
    // 5. Handle Clear (Backspace or Space)
    if (e.key === 'Backspace' || e.key === ' ') {
        e.preventDefault();
        handleInput('backspace');
        return;
    }
}

function moveSelection(direction) {
    if (selectedCells.length === 0) {
        // If nothing is selected, start at the top-left
        const firstCell = document.getElementById('cell-0-0');
        if (firstCell) addCellToSelection(firstCell);
        return;
    }

    // Use the last selected cell as the pivot for movement
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

function fillBuffer() {
    if (puzzleBuffer.length < BUFFER_MAX) {
        generateMinimalPuzzleAsync((newPuzzle) => {
            puzzleBuffer.push(newPuzzle);
            fillBuffer();
        });
    } else {
        setTimeout(fillBuffer, 5000);
    }
}

function isValidTotalSet(tots) {
    return !tots.some(t => FORBIDDEN_TOTALS.includes(t));
}

function isTrivial(targetSum, existingNums) {
    let remainingSum = targetSum - existingNums.reduce((a, b) => a + b, 0);
    let slotsOpen = 4 - existingNums.length;
    if (slotsOpen === 0) return false;
    let combinations = 0;
    const findCombos = (sum, slots) => {
        if (slots === 0) { if (sum === 0) combinations++; return; }
        for (let i = 1; i <= 4; i++) { if (sum - i >= 0) findCombos(sum - i, slots - 1); }
    };
    findCombos(remainingSum, slotsOpen);
    return combinations <= 1;
}

function hasTrivialStart(grid, rTots, cTots) {
    for (let r = 0; r < SIZE; r++) {
        let existing = [];
        for (let c = 0; c < SIZE; c++) if (grid[r][c] !== 0) existing.push(grid[r][c]);
        if (isTrivial(rTots[r], existing)) return true;
    }
    for (let c = 0; c < SIZE; c++) {
        let existing = [];
        for (let r = 0; r < SIZE; r++) if (grid[r][c] !== 0) existing.push(grid[r][c]);
        if (isTrivial(cTots[c], existing)) return true;
    }
    return false;
}

function generateMinimalPuzzleAsync(callback) {
    setTimeout(() => {
        let fullGrid = generateFullGrid();
        let rTots = fullGrid.map(row => row.reduce((a,b) => a+b, 0));
        let cTots = Array(SIZE).fill(0).map((_, c) => fullGrid.reduce((sum, row) => sum + row[c], 0));
        if (!isValidTotalSet(rTots) || !isValidTotalSet(cTots)) { generateMinimalPuzzleAsync(callback); return; }
        let puzzle = fullGrid.map(row => [...row]);
        let finalPuzzle = minimizeDFS(puzzle, getShuffledCoords(), rTots, cTots);
        let clueCount = 0;
        for(let r=0; r<SIZE; r++) for(let c=0; c<SIZE; c++) if(finalPuzzle[r][c] !== 0) clueCount++;
        if (clueCount <= MAX_CLUES_HARD && !hasTrivialStart(finalPuzzle, rTots, cTots)) {
            callback({ puzzle: finalPuzzle, rTots, cTots });
        } else {
            generateMinimalPuzzleAsync(callback);
        }
    }, 0);
}

function generateBasedOnSetting() {
    if (currentDifficulty === "hard") {
        if (puzzleBuffer.length > 0) {
            saveState();
            let data = puzzleBuffer.shift();
            rowTotals = data.rTots; colTotals = data.cTots;
            renderPuzzle(data.puzzle);
            fillBuffer();
        } else {
            generateHardPuzzle(); 
        }
    } else {
        generatePuzzle();
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

function generatePuzzle() {
    saveState();
    let fullGrid, rTots, cTots;
    do {
        fullGrid = generateFullGrid();
        rTots = fullGrid.map(row => row.reduce((a,b) => a+b, 0));
        cTots = Array(SIZE).fill(0).map((_, c) => fullGrid.reduce((sum, row) => sum + row[c], 0));
    } while (!isValidTotalSet(rTots) || !isValidTotalSet(cTots));
    rowTotals = rTots; colTotals = cTots;
    let puzzle = fullGrid.map(row => [...row]);
    let coords = getShuffledCoords();
    for(let pos of coords) {
        let backup = puzzle[pos.r][pos.c];
        puzzle[pos.r][pos.c] = 0;
        if (countSolutions(puzzle, rowTotals, colTotals) > 1) puzzle[pos.r][pos.c] = backup;
    }
    renderPuzzle(puzzle);
}

function generateHardPuzzle() {
    saveState();
    let fullGrid, rTots, cTots, finalPuzzle;
    do {
        fullGrid = generateFullGrid();
        rTots = fullGrid.map(row => row.reduce((a,b) => a+b, 0));
        cTots = Array(SIZE).fill(0).map((_, c) => fullGrid.reduce((sum, row) => sum + row[c], 0));
        if (isValidTotalSet(rTots) && isValidTotalSet(cTots)) {
            let puzzle = fullGrid.map(row => [...row]);
            finalPuzzle = minimizeDFS(puzzle, getShuffledCoords(), rTots, cTots);
        }
    } while (!finalPuzzle || hasTrivialStart(finalPuzzle, rTots, cTots));
    rowTotals = rTots; colTotals = cTots;
    renderPuzzle(finalPuzzle);
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
function setDifficulty(val) { currentDifficulty = val; setTimeout(() => document.getElementById('settings-menu').classList.add('hidden'), 200); }

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

function saveState() {
    const currentState = {
        rowTotals: [...rowTotals], colTotals: [...colTotals],
        cells: Array.from(document.querySelectorAll('.cell')).map(cell => ({
            val: cell.querySelector(".val").innerText,
            pencils: Array.from(cell.querySelectorAll(".pencil div")).map(p => p.innerText),
            locked: cell.classList.contains('locked')
        }))
    };
    historyStack.push(JSON.stringify(currentState));
    if (historyStack.length > 30) historyStack.shift();
}

function undo() {
    if (historyStack.length === 0) return;
    const lastState = JSON.parse(historyStack.pop());
    rowTotals = lastState.rowTotals; colTotals = lastState.colTotals;
    createGrid(); 
    const cells = document.querySelectorAll('.cell');
    lastState.cells.forEach((data, i) => {
        cells[i].querySelector(".val").innerText = data.val;
        if(data.locked) cells[i].classList.add('locked');
        cells[i].querySelectorAll(".pencil div").forEach((p, pi) => p.innerText = data.pencils[pi]);
    });
    checkGrid();
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
