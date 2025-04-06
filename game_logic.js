// =========================================
//          Game Logic Functions
// =========================================
// These functions operate on boardState arrays
// and contain core chess rules. They should be pure functions
// as much as possible, taking state as input.

// Generates the initial board state array
function getInitialBoardStateArray() {
    let boardState = Array(8).fill(null).map(() => Array(8).fill({ piece: null, color: null, moved: false }));
    const pieceOrder = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

    ['white', 'black'].forEach((color, index) => {
        const row = index === 0 ? 7 : 0;
        pieceOrder.forEach((piece, col) => {
            boardState[row][col] = { piece: piece, color: color, moved: false };
        });
        const pawnRow = index === 0 ? 6 : 1;
        for (let col = 0; col < 8; col++) {
            boardState[pawnRow][col] = { piece: 'pawn', color: color, moved: false };
        }
    });
    return boardState;
}

// findKingPosition: Operates on boardState array
function findKingPosition(boardState, color) {
    if (!boardState) return null;
    for(let row = 0; row < 8; row++) {
        for(let col = 0; col < 8; col++) {
            // Check bounds and piece existence
            if(boardState[row] && boardState[row][col] && boardState[row][col].piece === 'king' && boardState[row][col].color === color) {
                return [row, col];
            }
        }
    }
    return null; // King not found
}

// isSquareUnderAttack: Operates on a boardState array
function isSquareUnderAttack(boardState, row, col, colorOfDefender, currentEnPassantSquare, currentCastlingRights) {
    if (!boardState) return false;
    const opponentColor = colorOfDefender === 'white' ? 'black' : 'white';
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const pieceData = boardState[r]?.[c]; // Safely access
            if (pieceData && pieceData.piece && pieceData.color === opponentColor) {
                // Get potential attacking moves for this opponent piece *without* check filtering
                const attackingMoves = getPieceMovesInternal(boardState, r, c, false, false, currentEnPassantSquare, currentCastlingRights);
                if (attackingMoves.some(move => move && move.length === 2 && move[0] === row && move[1] === col)) {
                    return true; // Found an attacker
                }
            }
        }
    }
    return false; // No attackers found
}


// isInCheck: Operates on a boardState array
function isInCheck(boardState, color, currentEnPassantSquare, currentCastlingRights) {
    const kingPosition = findKingPosition(boardState, color);

    if(!kingPosition) {
        // console.warn("King not found in isInCheck for color:", color);
        return false; // Cannot be in check if king doesn't exist
    }
    // Pass state needed by isSquareUnderAttack -> getPieceMovesInternal
    return isSquareUnderAttack(boardState, kingPosition[0], kingPosition[1], color, currentEnPassantSquare, currentCastlingRights);
}


// simulateBoardMove: Operates on and returns a boardState array, handles 'moved' status
// Needs currentEnPassantSquare to correctly simulate EP captures
// Takes optional promotionPiece for handling pawn promotion choices
function simulateBoardMove(fromRow, fromCol, toRow, toCol, boardState, currentEnPassantSquare, promotionPiece = null) {
    if (!boardState) {
        console.error("simulateBoardMove called with invalid boardState");
        return null; // Or throw error
    }
    let simulatedBoard = JSON.parse(JSON.stringify(boardState)); // Deep copy
    const pieceData = simulatedBoard[fromRow]?.[fromCol];

    if (!pieceData || !pieceData.piece) {
         console.warn("simulateBoardMove: No piece found at source", fromRow, fromCol);
         return simulatedBoard; // No piece to move
    }

    // Ensure target exists
    if (!simulatedBoard[toRow] || typeof simulatedBoard[toRow][toCol] === 'undefined') {
        console.error("simulateBoardMove: Target coordinates invalid", toRow, toCol);
        return simulatedBoard; // Invalid target
    }

    // Basic Move
    const movedPieceData = { ...pieceData, moved: true }; // Set moved flag
    simulatedBoard[fromRow][fromCol] = { piece: null, color: null, moved: false }; // Clear source
    simulatedBoard[toRow][toCol] = movedPieceData; // Place on destination

    // --- Simulate Special Moves within the state ---

    // En Passant Capture Simulation (Remove captured pawn)
    if (pieceData.piece === 'pawn' && currentEnPassantSquare) {
        const epCaptureTargetRow = currentEnPassantSquare[0];
        const epCaptureTargetCol = currentEnPassantSquare[1];
        // Check if pawn moved diagonally to the target EP square
        if (toRow === epCaptureTargetRow && toCol === epCaptureTargetCol && Math.abs(fromCol - toCol) === 1) {
            const capturedPawnRow = toRow + (pieceData.color === 'white' ? 1 : -1);
            const capturedPawnCol = toCol;
            if (simulatedBoard[capturedPawnRow]?.[capturedPawnCol]?.piece === 'pawn') { // Check if captured pawn exists
                simulatedBoard[capturedPawnRow][capturedPawnCol] = { piece: null, color: null, moved: false };
                console.log("Simulated EP Capture of pawn at", capturedPawnRow, capturedPawnCol);
            }
        }
    }

    // Castling Simulation (Move Rook)
    if (pieceData.piece === 'king' && Math.abs(fromCol - toCol) === 2) {
        const rookFromCol = toCol > fromCol ? 7 : 0;
        const rookToCol = toCol > fromCol ? 5 : 3;
        if (simulatedBoard[fromRow]?.[rookFromCol]) { // Check state
            const rookData = { ...simulatedBoard[fromRow][rookFromCol], moved: true }; // Set moved flag on rook
            simulatedBoard[fromRow][rookFromCol] = { piece: null, color: null, moved: false }; // Clear original rook pos
            simulatedBoard[fromRow][rookToCol] = rookData; // Place rook on new square
            console.log("Simulated Castling Rook Move");
        }
    }

    // Pawn Promotion Simulation (Auto-Queen for simulation if no piece specified)
    if (pieceData.piece === 'pawn' && (toRow === 0 || toRow === 7)) {
        const finalPiece = promotionPiece || 'queen'; // Use choice or default to Queen
        simulatedBoard[toRow][toCol] = { piece: finalPiece, color: pieceData.color, moved: true };
        console.log(`Simulated Pawn Promotion to ${finalPiece}`);
    }

    return simulatedBoard;
}

// getPieceMoves: Public interface, performs safety filtering
// Needs current state (EP, Castling) to pass down for accurate simulation
function getPieceMoves(boardState, row, col, currentEnPassantSquare, currentCastlingRights) {
    const pieceColor = boardState?.[row]?.[col]?.color;
    if (!pieceColor) return []; // No piece or color

    // Get raw moves (including potential castling), without internal safety check
    const rawMoves = getPieceMovesInternal(boardState, row, col, true, false, currentEnPassantSquare, currentCastlingRights);

    // --- Filter for moves that leave the king in check ---
    const safeMoves = rawMoves.filter(move => {
        if (!move || move.length !== 2) return false;
        const [toR, toC] = move;
        if (toR < 0 || toR >= 8 || toC < 0 || toC >= 8) return false;

        // Pass currentEnPassantSquare for accurate simulation of the potential move
        const simulatedBoardAfterMove = simulateBoardMove(row, col, toR, toC, boardState, currentEnPassantSquare);
        if (!simulatedBoardAfterMove) return false; // Simulation failed

        // Check safety using the state *after* the move
        // Also need to pass state relevant for *that* board (EP, Castling rights don't change mid-check)
        return !isInCheck(simulatedBoardAfterMove, pieceColor, currentEnPassantSquare, currentCastlingRights);
    });

    return safeMoves;
}


// getPieceMovesInternal: Generates raw moves ONLY
// Needs currentEnPassantSquare for EP check, currentCastlingRights for basic castle check
function getPieceMovesInternal(boardState, row, col, includeCastling = false, filterForCheckSafety = false, currentEnPassantSquare, currentCastlingRights) {
    const pieceColor = boardState?.[row]?.[col]?.color;
    if (!pieceColor) return [];

    let moves = [];
    const piece = boardState?.[row]?.[col]?.piece;
    if (!piece) return [];

    switch(piece) {
            case 'pawn':
            const direction = pieceColor === 'white' ? -1 : 1;
            const nextRow = row + direction;
            const twoRowsAhead = row + 2 * direction;

            // Forward 1 step
            if (nextRow >= 0 && nextRow < 8 && !boardState[nextRow]?.[col]?.piece) {
                moves.push([nextRow, col]);
                // Forward 2 steps (initial move)
                const initialRow = pieceColor === 'white' ? 6 : 1;
                // Check the square *between* is also empty
                if (row === initialRow && twoRowsAhead >= 0 && twoRowsAhead < 8 &&
                    !boardState[nextRow]?.[col]?.piece && // Square 1 step ahead must be empty
                    !boardState[twoRowsAhead]?.[col]?.piece) { // Square 2 steps ahead must be empty
                        moves.push([twoRowsAhead, col]);
                }
            }
            // Diagonal Captures
            [-1, 1].forEach(offset => {
                const captureCol = col + offset;
                if (nextRow >= 0 && nextRow < 8 && captureCol >= 0 && captureCol < 8) {
                    const targetPiece = boardState[nextRow]?.[captureCol];
                    if (targetPiece && targetPiece.piece && targetPiece.color !== pieceColor) {
                        moves.push([nextRow, captureCol]);
                    }
                }
            });
            // En Passant Capture (Check possibility based on *passed* currentEnPassantSquare)
            if (currentEnPassantSquare) {
                const epTargetRow = currentEnPassantSquare[0];
                const epTargetCol = currentEnPassantSquare[1];
                // Check if the pawn is on the correct rank and can move diagonally to the target EP square
                const correctEpSourceRow = pieceColor === 'white' ? 3 : 4;
                if (row === correctEpSourceRow && nextRow === epTargetRow && Math.abs(col - epTargetCol) === 1) {
                    // Check if the piece *being captured* (behind the EP square) exists and is opponent pawn
                    const capturedPawnRow = epTargetRow + (pieceColor === 'white' ? 1 : -1);
                    if (boardState[capturedPawnRow]?.[epTargetCol]?.piece === 'pawn' && boardState[capturedPawnRow]?.[epTargetCol]?.color !== pieceColor) {
                       moves.push([epTargetRow, epTargetCol]);
                    }
                }
            }
            break;
        case 'rook':
            moves = generateStraightMovesForSim(row, col, boardState);
            break;
        case 'knight':
            const knightDeltas = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
            knightDeltas.forEach(delta => {
                const newRow = row + delta[0];
                const newCol = col + delta[1];
                if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
                    const targetPiece = boardState[newRow]?.[newCol];
                    if (!targetPiece || !targetPiece.piece || targetPiece.color !== pieceColor) {
                        moves.push([newRow, newCol]);
                    }
                }
            });
            break;
        case 'bishop':
            moves = generateDiagonalMovesForSim(row, col, boardState);
            break;
        case 'queen':
            moves = [
                ...generateStraightMovesForSim(row, col, boardState),
                ...generateDiagonalMovesForSim(row, col, boardState)
            ];
            break;
        case 'king':
            // Regular moves
            for (let i = -1; i <= 1; i++) {
                for (let j = -1; j <= 1; j++) {
                    if (i === 0 && j === 0) continue;
                    const newRow = row + i;
                    const newCol = col + j;
                    if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
                        const targetPiece = boardState[newRow]?.[newCol];
                        if (!targetPiece || !targetPiece.piece || targetPiece.color !== pieceColor) {
                            moves.push([newRow, newCol]);
                        }
                    }
                }
            }
            // Castling moves (Basic checks ONLY - uses passed currentCastlingRights)
            if (includeCastling && currentCastlingRights && currentCastlingRights[pieceColor]) {
                const kingData = boardState[row]?.[col];
                if (kingData && !kingData.moved) {
                    // Kingside basic check
                    if (currentCastlingRights[pieceColor].kingSide) {
                        const rookKingside = boardState[row]?.[7];
                        if (rookKingside && rookKingside.piece === 'rook' && rookKingside.color === pieceColor && !rookKingside.moved &&
                            !boardState[row]?.[5]?.piece && !boardState[row]?.[6]?.piece) {
                                moves.push([row, col + 2]);
                        }
                    }
                    // Queenside basic check
                    if (currentCastlingRights[pieceColor].queenSide) {
                            const rookQueenside = boardState[row]?.[0];
                            if (rookQueenside && rookQueenside.piece === 'rook' && rookQueenside.color === pieceColor && !rookQueenside.moved &&
                                !boardState[row]?.[1]?.piece && !boardState[row]?.[2]?.piece && !boardState[row]?.[3]?.piece) {
                                moves.push([row, col - 2]);
                        }
                    }
                }
            }
            break;
    }

    // Filter moves landing on own pieces (final basic check)
    moves = moves.filter(move => {
            if (!move || move.length !== 2) return false;
            const [r, c] = move;
            if (r < 0 || r >= 8 || c < 0 || c >= 8) return false;
            const targetPiece = boardState[r]?.[c];
            return !(targetPiece && targetPiece.piece && targetPiece.color === pieceColor);
        });

    // filterForCheckSafety parameter is now ignored, safety check happens in public getPieceMoves

    return moves;
}

// generateStraightMovesForSim: Helper for simulation, uses boardState
function generateStraightMovesForSim(row, col, boardState) {
    let moves = [];
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const pieceColor = boardState?.[row]?.[col]?.color;
    if (!pieceColor) return [];

    directions.forEach(dir => {
        for (let i = 1; i < 8; i++) {
            const newRow = row + dir[0] * i;
            const newCol = col + dir[1] * i;
            if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
                const targetPiece = boardState[newRow]?.[newCol];
                if (!targetPiece || !targetPiece.piece) { // Empty square
                    moves.push([newRow, newCol]);
                } else { // Hit a piece
                    if (targetPiece.color !== pieceColor) { // Opponent piece
                        moves.push([newRow, newCol]);
                    }
                    break; // Stop path
                }
            } else break; // Out of bounds
        }
    });
    return moves;
}

// generateDiagonalMovesForSim: Helper for simulation, uses boardState
function generateDiagonalMovesForSim(row, col, boardState) {
    let moves = [];
    const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    const pieceColor = boardState?.[row]?.[col]?.color;
    if (!pieceColor) return [];

    directions.forEach(dir => {
        for (let i = 1; i < 8; i++) {
            const newRow = row + dir[0] * i;
            const newCol = col + dir[1] * i;
                if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
                    const targetPiece = boardState[newRow]?.[newCol];
                    if (!targetPiece || !targetPiece.piece) { // Empty square
                        moves.push([newRow, newCol]);
                    } else { // Hit a piece
                        if (targetPiece.color !== pieceColor) { // Opponent piece
                            moves.push([newRow, newCol]);
                        }
                        break; // Stop path
                    }
                } else break; // Out of bounds
        }
    });
    return moves;
}

// hasValidMoves: Operates on boardState, uses getPieceMoves
function hasValidMoves(boardState, color, currentEnPassantSquare, currentCastlingRights) {
    if (!boardState) return false;
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const pieceData = boardState[row]?.[col];
            if (pieceData && pieceData.piece && pieceData.color === color) {
                // Pass current state details needed by getPieceMoves
                const moves = getPieceMoves(boardState, row, col, currentEnPassantSquare, currentCastlingRights);
                if (moves && moves.length > 0) {
                    return true; // Found at least one valid move
                }
            }
        }
    }
    return false; // No valid moves found
}

// Generates a unique string hash for a given position state
// Used for detecting repetitions (threefold repetition)
function generatePositionHash(boardState, turn, castlingRights, enPassantSquare) {
    let hash = '';

    // 1. Board State
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const pieceData = boardState[r]?.[c];
            if (pieceData && pieceData.piece) {
                // Use standard FEN notation pieces (uppercase white, lowercase black)
                hash += pieceData.color === 'white' ? pieceData.piece.toUpperCase() : pieceData.piece.toLowerCase();
            } else {
                hash += '1'; // Placeholder for empty square (changed from '.')
            }
        }
        hash += '_'; // Separator for rows
    }

    // Remove trailing separator
    hash = hash.slice(0, -1);

    // 2. Active Turn
    hash += '-' + turn.charAt(0); // 'w' or 'b'

    // 3. Castling Availability
    hash += '-';
    let castlingStr = '';
    if (castlingRights.white.kingSide) castlingStr += 'K';
    if (castlingRights.white.queenSide) castlingStr += 'Q';
    if (castlingRights.black.kingSide) castlingStr += 'k';
    if (castlingRights.black.queenSide) castlingStr += 'q';
    hash += castlingStr || '-'; // Use '-' if no rights

    // 4. En Passant Target Square
    hash += '-';
    if (enPassantSquare && enPassantSquare.length === 2) {
        // Convert [row, col] to algebraic notation (e.g., [3, 4] -> e5)
        const file = String.fromCharCode('a'.charCodeAt(0) + enPassantSquare[1]);
        const rank = 8 - enPassantSquare[0];
        hash += file + rank;
    } else {
        hash += '-'; // Placeholder if no EP square
    }

    return hash;
}
