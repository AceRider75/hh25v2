// =================================================
//      UI, Multiplayer, and Initialization
// =================================================

// --- Firebase Setup ---
const firebaseConfig = {
    apiKey: "AIzaSyB1O5S6aY_q_lujXPeoBlr0iBwj9yjVLBg",
    authDomain: "chess-454ff.firebaseapp.com",
    databaseURL: "https://chess-454ff-default-rtdb.firebaseio.com",
    projectId: "chess-454ff",
    storageBucket: "chess-454ff.appspot.com",
    messagingSenderId: "653430207064",
    appId: "1:653430207064:web:475e1e21d7745f4170902d"
};

// Check if Firebase is already initialized
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
} else {
    firebase.app(); // if already initialized, use that app
}
const database = firebase.database();

// --- References ---
const presenceRef = database.ref(".info/connected");
const userListRef = database.ref("presence");
const queueRef = database.ref("queue"); // Reference to the matchmaking queue
let currentUserRef = null;
let myQueueEntryRef = null; // Reference to my entry in the queue


// --- Global Variables (UI/Multiplayer State) ---
let currentGameId = null;
let playerColor = null; // 'white' or 'black' for the current browser session
let gameRef = null; // Firebase reference to the current game
let gameListener = null; // Firebase listener handle
let queueListenerHandle = null; // Handle for the queue listener
let isSearching = false; // Track if the player is currently searching

// State synced from Firebase via listener
let turn = 'white';
let enPassantSquare = null; // Synced from Firebase, used by game logic
let castlingRights = { // Synced from Firebase, used by game logic
    'white': { kingSide: true, queenSide: true },
    'black': { kingSide: true, queenSide: true }
};
let currentBoardState = null; // Holds the board state array synced from Firebase
let gameStatus = 'pending'; // 'pending', 'waiting', 'active', 'check', 'checkmate', 'stalemate'

// Local UI state
let selectedPiece = null; // DOM element of the selected piece
let pendingPromotionMove = null; // To store details { fromRow, fromCol, toRow, toCol }


// --- DOM Elements ---
// Defined within DOMContentLoaded

// --- Pieces Object ---
// Placed globally or inside DOMContentLoaded, ensure accessible where needed
const pieces = {
    'white': {'pawn': '♙', 'rook': '♖', 'knight': '♘', 'bishop': '♗', 'queen': '♕', 'king': '♔'},
    'black': {'pawn': '♟', 'rook': '♜', 'knight': '♞', 'bishop': '♝', 'queen': '♛', 'king': '♚'}
};


// --- DOMContentLoaded Listener ---
document.addEventListener('DOMContentLoaded', () => {

    // Get DOM elements
    const boardElement = document.getElementById('board');
    const statusElement = document.getElementById('status');
    const createGameBtn = document.getElementById('createGameBtn');
    const joinGameBtn = document.getElementById('joinGameBtn');
    const gameIdInput = document.getElementById('gameIdInput');
    const gameIdDisplay = document.getElementById('gameIdDisplay');
    const multiplayerControls = document.getElementById('multiplayer-controls');
    const undoBtn = document.getElementById('undoMoveBtn');
    const redoBtn = document.getElementById('redoMoveBtn');
    // Add reference for the corner display
    const gameIdCornerValue = document.getElementById('game-id-corner-value');
    // Matchmaking buttons
    const findMatchBtn = document.getElementById('findMatchBtn');
    const cancelSearchBtn = document.getElementById('cancelSearchBtn');

    // Function to clear valid move highlights (UI only)
    function clearValidMoves() {
        document.querySelectorAll('.valid-move').forEach(square => {
            square.classList.remove('valid-move');
            square.classList.remove('capture-move');
        });
    }

     // Function to clear check highlight (UI only)
     function clearCheckHighlight() {
        document.querySelectorAll('.square.check').forEach(square => {
            square.classList.remove('check');
        });
    }

    // Function to highlight the checked king (UI only)
    function highlightCheckedKing(colorInCheck) {
        // Use findKingPosition from game_logic.js
        const kingPos = findKingPosition(currentBoardState, colorInCheck);
        if (kingPos) {
            const kingSquare = document.querySelector(`[data-row="${kingPos[0]}"][data-col="${kingPos[1]}"]`);
            if (kingSquare) {
                kingSquare.classList.add('check');
            }
        }
    }

    // Function to show checkmate modal (UI only)
    function showCheckmateModal(resultText, winningPiece) {
        const modal = document.getElementById('checkmateModal');
        if (!modal) return;
        const resultElement = document.getElementById('checkmateResult');
        const pieceElement = document.getElementById('winningPiece');

        if(resultElement) resultElement.textContent = resultText;
        if(pieceElement) pieceElement.textContent = winningPiece || ''; // May be unused

        modal.style.display = 'block';

        const continueButton = document.getElementById('continueButton');
        if (continueButton) {
            const newButton = continueButton.cloneNode(true);
            continueButton.parentNode.replaceChild(newButton, continueButton);
            newButton.onclick = function() {
                modal.style.display = 'none';
            };
        }

        window.onclick = function(event) {
            if (event.target == modal) {
                modal.style.display = 'none';
            }
        };
    }


    // --- Initialization ---

    // Sets up the initial view state (Multiplayer controls visible)
    function initializeView() {
        if (boardElement) boardElement.innerHTML = '';
        if (gameIdDisplay) gameIdDisplay.textContent = ''; // Clear center display
        if (gameIdCornerValue) gameIdCornerValue.textContent = 'N/A'; // Clear corner display
        if (statusElement) statusElement.textContent = "Create or Join a Game";
        if (multiplayerControls) multiplayerControls.style.display = 'block';
        if (boardElement) boardElement.style.display = 'none';

        if (gameRef && gameListener) {
            gameRef.off('value', gameListener);
        }
        gameRef = null;
        gameListener = null;
        currentGameId = null;
        playerColor = null;
        turn = 'white';
        castlingRights = { 'white': { kingSide: true, queenSide: true }, 'black': { kingSide: true, queenSide: true } };
        enPassantSquare = null;
        currentBoardState = null;
        gameStatus = 'pending';
        selectedPiece = null; // Reset local UI selection

        // Reset search state
        isSearching = false;
        if (myQueueEntryRef) {
            myQueueEntryRef.remove(); // Ensure removed from queue if view resets
            myQueueEntryRef = null;
        }
        if (queueListenerHandle) {
            queueRef.off('value', queueListenerHandle);
            queueListenerHandle = null;
        }

        // Reset button states
        if (createGameBtn) createGameBtn.disabled = false;
        if (joinGameBtn) joinGameBtn.disabled = false;
        if (findMatchBtn) findMatchBtn.disabled = false;
        if (cancelSearchBtn) cancelSearchBtn.style.display = 'none';
        if (multiplayerControls) multiplayerControls.style.display = 'block'; // Show ID controls
        if (document.getElementById('matchmaking-controls')) document.getElementById('matchmaking-controls').style.display = 'block'; // Show matchmaking controls

        // Disable undo/redo
        if (undoBtn) undoBtn.disabled = true;
        if (redoBtn) redoBtn.disabled = true;

        // Ensure event listeners are (re)attached
        // Remove existing listeners first to prevent duplicates if view is re-initialized
        if (createGameBtn) {
             createGameBtn.removeEventListener('click', createGame); // Remove potential old listener
             createGameBtn.addEventListener('click', createGame);
        }
        if (joinGameBtn) {
            joinGameBtn.removeEventListener('click', joinGame);
            joinGameBtn.addEventListener('click', joinGame);
        }
        if (findMatchBtn) {
            findMatchBtn.removeEventListener('click', findMatch);
            findMatchBtn.addEventListener('click', findMatch);
        }
        if (cancelSearchBtn) {
            cancelSearchBtn.removeEventListener('click', cancelSearch);
            cancelSearchBtn.addEventListener('click', cancelSearch);
        }
    }

    // --- Multiplayer Functions ---

    function generateGameId() {
        return Math.random().toString(36).substring(2, 7).toUpperCase();
    }

    function createGame() {
        currentGameId = generateGameId();
        playerColor = 'white';
        gameRef = database.ref('games/' + currentGameId);

        // Use getInitialBoardStateArray from game_logic.js
        const initialBoard = getInitialBoardStateArray();
        const initialCastlingRights = { 'white': { kingSide: true, queenSide: true }, 'black': { kingSide: true, queenSide: true } };
        const initialPositionHash = generatePositionHash(initialBoard, 'white', initialCastlingRights, null);

        const initialGameState = {
            board: initialBoard,
            turn: 'white',
            castlingRights: initialCastlingRights,
            enPassantSquare: null,
            players: { white: true, black: null },
            status: 'waiting',
            halfMoveClock: 0, // For fifty-move rule
            positionHashes: { [initialPositionHash]: 1 } // Store count of starting position
        };

        if (createGameBtn) createGameBtn.disabled = true;
        if (joinGameBtn) joinGameBtn.disabled = true;
        if (statusElement) statusElement.textContent = "Creating game...";

        gameRef.set(initialGameState).then(() => {
            console.log(`Game created with ID: ${currentGameId}`);
            if (gameIdDisplay) gameIdDisplay.textContent = `Game ID: ${currentGameId} (Share this!)`;
            if (gameIdCornerValue) gameIdCornerValue.textContent = currentGameId; // Update corner display
            if (statusElement) statusElement.textContent = "Waiting for opponent...";
            if (multiplayerControls) multiplayerControls.style.display = 'none';
            setupBoardDOM(); // Create squares
            currentBoardState = initialGameState.board; // Set local state
            reloadBoardState(currentBoardState); // Populate UI
            listenToGameUpdates();
        }).catch(error => {
            console.error("Error creating game:", error);
            if (statusElement) statusElement.textContent = `Error creating game: ${error.message}. Check console/rules.`;
            if (createGameBtn) createGameBtn.disabled = false;
            if (joinGameBtn) joinGameBtn.disabled = false;
            // Reset state on error
            currentGameId = null; playerColor = null; gameRef = null;
        });
    }

    function joinGame() {
        const inputId = gameIdInput.value.trim().toUpperCase();
        if (!inputId) {
            if (statusElement) statusElement.textContent = "Please enter a Game ID.";
            return;
        }

        if (createGameBtn) createGameBtn.disabled = true;
        if (joinGameBtn) joinGameBtn.disabled = true;
        if (statusElement) statusElement.textContent = "Joining game...";

        const tempGameRef = database.ref('games/' + inputId);

        tempGameRef.get().then((snapshot) => {
            if (snapshot.exists()) {
                const gameState = snapshot.val();
                // Simple check if 'black' player slot is truthy
                if (gameState.players && gameState.players.black) {
                    if (statusElement) statusElement.textContent = "Game is already full.";
                    if (createGameBtn) createGameBtn.disabled = false;
                    if (joinGameBtn) joinGameBtn.disabled = false;
                } else if (gameState.players && gameState.players.white) {
                    gameRef = tempGameRef; // Assign the valid ref
                    currentGameId = inputId;
                    playerColor = 'black';
                    gameRef.update({ 'players/black': true, status: 'active' }).then(() => {
                        console.log(`Joined game ${currentGameId} as black.`);
                        if (statusElement) statusElement.textContent = "Connected! Loading game...";
                        if (gameIdDisplay) gameIdDisplay.textContent = `Game ID: ${currentGameId}`;
                        if (gameIdCornerValue) gameIdCornerValue.textContent = currentGameId; // Update corner display
                        if (multiplayerControls) multiplayerControls.style.display = 'none';
                        setupBoardDOM();
                        currentBoardState = gameState.board; // Set local state from fetched data
                        reloadBoardState(currentBoardState);
                        listenToGameUpdates();
                    }).catch(error => {
                        console.error("Error updating game state on join:", error);
                        if (statusElement) statusElement.textContent = "Error joining game. Try again.";
                        gameRef = null; currentGameId = null; playerColor = null;
                        if (createGameBtn) createGameBtn.disabled = false;
                        if (joinGameBtn) joinGameBtn.disabled = false;
                    });
                } else {
                    if (statusElement) statusElement.textContent = "Game data incomplete. Cannot join.";
                    if (createGameBtn) createGameBtn.disabled = false;
                    if (joinGameBtn) joinGameBtn.disabled = false;
                }
            } else {
                if (statusElement) statusElement.textContent = "Game ID not found.";
                if (createGameBtn) createGameBtn.disabled = false;
                if (joinGameBtn) joinGameBtn.disabled = false;
            }
        }).catch((error) => {
            console.error("Error checking game ID:", error);
            if (statusElement) statusElement.textContent = "Error checking game ID. Check connection/ID.";
            if (createGameBtn) createGameBtn.disabled = false;
            if (joinGameBtn) joinGameBtn.disabled = false;
        });
    }

    function findMatch() {
        if (isSearching || currentGameId) return; // Don't search if already searching or in game

        console.log("Finding match...");
        isSearching = true;

        // Disable other buttons
        if (createGameBtn) createGameBtn.disabled = true;
        if (joinGameBtn) joinGameBtn.disabled = true;
        if (findMatchBtn) findMatchBtn.disabled = true;
        if (cancelSearchBtn) cancelSearchBtn.style.display = 'inline-block';
        if (statusElement) statusElement.textContent = "Searching for opponent...";

        // Add self to the queue (use push for unique ID)
        myQueueEntryRef = queueRef.push(true);
        const myId = myQueueEntryRef.key; // Store the key immediately

        // Make sure to remove self from queue if connection drops during search
        myQueueEntryRef.onDisconnect().remove();

        // Listen to the queue for potential matches
        queueListenerHandle = queueRef.on('value', handleQueueUpdate);
        // Also start monitoring own queue entry removal (for player 2 scenario)
        // Pass the stored key to the monitor function
        monitorMyQueueEntry(myId); 
    }

    function cancelSearch() {
        if (!isSearching) return;

        console.log("Canceling search...");
        isSearching = false;

        // Remove self from queue
        if (myQueueEntryRef) {
            myQueueEntryRef.onDisconnect().cancel(); // Cancel the onDisconnect handler
            myQueueEntryRef.remove();
            myQueueEntryRef = null;
        }

        // Stop listening to the queue
        if (queueListenerHandle) {
            queueRef.off('value', queueListenerHandle);
            queueListenerHandle = null;
        }

        // Reset UI
        if (createGameBtn) createGameBtn.disabled = false;
        if (joinGameBtn) joinGameBtn.disabled = false;
        if (findMatchBtn) findMatchBtn.disabled = false;
        if (cancelSearchBtn) cancelSearchBtn.style.display = 'none';
        if (statusElement) statusElement.textContent = "Search cancelled.";
    }

    // Callback for queue listener
    function handleQueueUpdate(snapshot) {
        if (!isSearching || !myQueueEntryRef) return; // Only process if currently searching

        const queue = snapshot.val();
        const myId = myQueueEntryRef.key; // My unique ID in the queue
        let opponentId = null;

        // Find someone else in the queue
        for (const id in queue) {
            if (id !== myId) {
                opponentId = id;
                break;
            }
        }

        if (opponentId) {
            console.log("Opponent found:", opponentId);
            isSearching = false; // Found a match, stop searching state

            // Stop listening to the main queue immediately
            if (queueListenerHandle) {
                queueRef.off('value', queueListenerHandle);
                queueListenerHandle = null;
            }
            // Cancel my onDisconnect handler since we found a match
            myQueueEntryRef.onDisconnect().cancel();

            // Try to claim the match (atomic transaction is safer but complex)
            // Simple approach: Assume the first one to see the match creates it.
            // To avoid race conditions where both create a game, let's use the IDs
            // The player with the lexicographically smaller ID creates the game.
            const opponentRef = queueRef.child(opponentId);

            if (myId < opponentId) {
                console.log("My ID is smaller, creating game...");
                // I create the game
                const newGameId = generateGameId();
                const newGame = {
                    board: getInitialBoardStateArray(),
                    turn: 'white',
                    castlingRights: { 'white': { kingSide: true, queenSide: true }, 'black': { kingSide: true, queenSide: true } },
                    enPassantSquare: null,
                    players: { white: myId, black: opponentId }, // Assign players by ID for now
                    status: 'active', // Start active immediately
                    matchmaking: { player1: myId, player2: opponentId } // Store matched IDs
                };

                database.ref('games/' + newGameId).set(newGame).then(() => {
                    console.log("Game created from match:", newGameId);
                    // Remove both players from queue
                    myQueueEntryRef.remove();
                    opponentRef.remove();
                    myQueueEntryRef = null; // Clear local ref

                    // Start the game locally as white
                    startGameFromMatch(newGameId, 'white');

                }).catch(error => {
                    console.error("Failed to create game from match:", error);
                    // Could potentially re-enter queue or notify user
                    cancelSearch(); // Reset UI for now
                });
            } else {
                console.log("Opponent ID is smaller, waiting for them to create game...");
                // Opponent creates the game. We just need to wait for our queue entry to be removed,
                // which implies the game was created and we should find it via another mechanism
                // (or the game creator could write the gameId back to our queue entry - more complex).
                // For simplicity, we'll rely on the opponent removing us. If they fail,
                // we might need a timeout to cancel search.
                 // *** We still need to remove our onDisconnect handler ***
                 // Already cancelled above.
                 // Keep local myQueueEntryRef for now, opponent should remove it.
            }

        } else {
            console.log("No opponent found yet...");
        }
    }

    // Called when a match is successfully made and game created/joined
    function startGameFromMatch(gameId, assignedColor) {
        currentGameId = gameId;
        playerColor = assignedColor;
        gameRef = database.ref('games/' + currentGameId);

        console.log(`Starting matched game ${gameId} as ${playerColor}`);

        // Update UI
        if (statusElement) statusElement.textContent = `Match found! Game starting as ${playerColor}...`;
        if (gameIdDisplay) gameIdDisplay.textContent = `Game ID: ${currentGameId}`;
        if (gameIdCornerValue) gameIdCornerValue.textContent = currentGameId;
        if (multiplayerControls) multiplayerControls.style.display = 'none'; // Hide ID controls
        if (document.getElementById('matchmaking-controls')) document.getElementById('matchmaking-controls').style.display = 'none'; // Hide matchmaking
        if (cancelSearchBtn) cancelSearchBtn.style.display = 'none'; // Ensure cancel is hidden

        // Fetch initial state to display board and start listening
        gameRef.get().then(snapshot => {
             if (snapshot.exists()) {
                 const gameState = snapshot.val();
                 setupBoardDOM();
                 currentBoardState = gameState.board;
                 reloadBoardState(currentBoardState);
                 listenToGameUpdates(); // Start listening to the specific game
             } else {
                 console.error("Error: Game data not found after match was made.");
                  if (statusElement) statusElement.textContent = "Error starting matched game.";
                 // Consider going back to initial view
                 initializeView();
             }
        }).catch(error => {
            console.error("Error fetching game state after match:", error);
             if (statusElement) statusElement.textContent = "Error fetching matched game data.";
            initializeView();
        });
    }

    // This is a workaround for player 2 finding the game
    // A better way involves direct invites or writing gameId back.
    function monitorMyQueueEntry(myId) {
        if (!myQueueEntryRef) return;
        // Detach previous listener if any to prevent duplicates
        myQueueEntryRef.off('value'); 
        myQueueEntryRef.on('value', (snap) => {
            // If my queue entry is gone, and I'm not already in a game, assume P1 matched me.
            if (!snap.exists() && !currentGameId) { 
                console.log("My queue entry removed, likely matched by Player 1. Trying to find game...");
                // Stop listening to own entry now
                myQueueEntryRef.off('value'); 
                findMyMatchedGame(myId);
            }
        });
    }

    // Helper for Player 2 to find the game created by Player 1
    function findMyMatchedGame(myId) {
        // This requires knowing my unique queue ID *after* it's created
        if (!myId) {
            console.error("Cannot find matched game: My queue ID is unknown.");
            cancelSearch(); // Reset UI
            return;
        }

        // Query games to find one where I am player 2
        database.ref('games').orderByChild('matchmaking/player2').equalTo(myId).limitToFirst(1).get()
        .then(snapshot => {
            if (snapshot.exists()) {
                let foundGameId = null;
                snapshot.forEach(childSnap => { // Should only be one
                    foundGameId = childSnap.key;
                });
                if (foundGameId) {
                    console.log("Found matched game:", foundGameId);
                    // Start the game locally as black
                    // Need to ensure onDisconnect is cancelled for the queue ref
                     if (myQueueEntryRef) {
                         myQueueEntryRef.onDisconnect().cancel();
                         // Don't remove it here, it was already removed by player 1
                         myQueueEntryRef = null;
                     }
                    startGameFromMatch(foundGameId, 'black');
                } else {
                     console.log("Matchmaking race condition? Game not found where I am player 2.");
                     cancelSearch(); // Reset UI
                }
            } else {
                 console.log("Could not find game where I was matched as player 2.");
                 cancelSearch(); // Reset UI
            }
        })
        .catch(error => {
            console.error("Error searching for matched game:", error);
            cancelSearch(); // Reset UI
        });
    }

    function listenToGameUpdates() {
        if (!gameRef) return;

        if (gameListener) {
            gameRef.off('value', gameListener);
        }

        console.log("Attaching Firebase listener to:", gameRef.toString());
        gameListener = gameRef.on('value', (snapshot) => {
            if (!snapshot.exists()) {
                if (statusElement) statusElement.textContent = "Game connection lost.";
                alert("Game Over - Connection lost or game deleted.");
                initializeView();
                return;
            }

            const gameState = snapshot.val();
            console.log("Received game state update:", gameState);

            // Update global state variables
            turn = gameState.turn;
            // Provide default if properties missing from Firebase (e.g., initial state)
            castlingRights = gameState.castlingRights || { 'white': { kingSide: true, queenSide: true }, 'black': { kingSide: true, queenSide: true } };
            enPassantSquare = gameState.enPassantSquare || null;
            currentBoardState = gameState.board;
            gameStatus = gameState.status || 'active';

            // Update UI based on new state
            reloadBoardState(currentBoardState); // Update board visuals
            updateStatusText(gameState); // Update text status

            // Handle UI changes for check/checkmate/stalemate
            clearCheckHighlight();
            if (gameStatus === 'check') {
                highlightCheckedKing(turn); // Highlight the king whose turn it is
            } else if (gameStatus === 'checkmate') {
                const winner = turn === 'white' ? 'Black' : 'White';
                showCheckmateModal(`${winner} wins by Checkmate!`, '');
            } else if (gameStatus === 'stalemate') {
                if (statusElement) statusElement.textContent = "Stalemate! It's a draw.";
            }

            // Deselect piece if it's no longer the local player's turn
            if (selectedPiece && turn !== playerColor) {
                 deselectPiece();
             }

            // Ensure corner display remains updated (in case of page refresh joining existing game)
            if (gameIdCornerValue && currentGameId) {
                gameIdCornerValue.textContent = currentGameId;
            }

        }, (error) => {
            console.error("Firebase listener error:", error);
            if (statusElement) statusElement.textContent = "Error listening to game updates. Try refreshing.";
            if (gameRef && gameListener) {
                 gameRef.off('value', gameListener);
            }
            gameListener = null;
        });
    }

    function updateStatusText(gameState) {
        if (!statusElement) return; // Guard against missing element
        if (!playerColor || !currentGameId) {
            statusElement.textContent = "Create or Join a Game";
            return;
        }
        if (gameIdDisplay) gameIdDisplay.textContent = `Game ID: ${currentGameId}`;

        let statusMsg = "";
        const turnPlayer = gameState.turn.charAt(0).toUpperCase() + gameState.turn.slice(1);
        const youAre = `You are ${playerColor}.`;

        switch (gameState.status) {
            case 'waiting': statusMsg = `Waiting for opponent... ${youAre}`; break;
            case 'active': statusMsg = `${turnPlayer}'s turn. ${youAre}`; break;
            case 'check': statusMsg = `${turnPlayer} is in Check! ${turnPlayer}'s turn. ${youAre}`; break;
            case 'checkmate':
                const winner = gameState.turn === 'white' ? 'Black' : 'White';
                statusMsg = `Checkmate! ${winner} wins. Game Over. ${youAre}`; break;
            case 'stalemate': statusMsg = `Stalemate! It's a draw. Game Over. ${youAre}`; break;
            default: statusMsg = `Game status unknown. ${youAre}`;
        }
        statusElement.textContent = statusMsg;
    }

    function sendGameStateToFirebase(newState) {
        if (!gameRef) {
            console.error("Cannot send game state, no game reference.");
            return Promise.reject("No game reference");
        }
        return gameRef.set(newState);
    }


    // --- Board/UI Update Functions ---

    // Creates the 64 squares in the DOM
    function setupBoardDOM() {
        if (!boardElement) return;
        boardElement.innerHTML = '';
        boardElement.style.display = 'grid';
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                const square = document.createElement('div');
                square.classList.add('square');
                square.dataset.row = i;
                square.dataset.col = j;
                square.classList.add((i + j) % 2 === 0 ? 'light' : 'dark');
                square.addEventListener('click', handleClick);
                boardElement.appendChild(square);
            }
        }
    }

    // Updates a single square's DOM based on piece data
    function setPieceOnSquare(squareElement, pieceData) {
         if (pieceData && pieceData.piece) {
            squareElement.textContent = pieces[pieceData.color][pieceData.piece];
            squareElement.dataset.piece = pieceData.piece;
            squareElement.dataset.color = pieceData.color;
            if (pieceData.moved) {
                squareElement.dataset.moved = 'true';
            } else {
                delete squareElement.dataset.moved;
            }
        } else {
            squareElement.textContent = '';
            delete squareElement.dataset.piece;
            delete squareElement.dataset.color;
            delete squareElement.dataset.moved;
        }
    }

    // Updates the entire board display based on the state array
    function reloadBoardState(boardStateArray) {
        if (!boardStateArray || !boardElement) {
            console.error("Cannot reload board state: state or board element missing.");
            return;
        }
        if (boardElement.children.length !== 64) {
            console.warn("Board DOM structure not ready during reload, rebuilding.");
            setupBoardDOM();
            if (boardElement.children.length !== 64) {
                console.error("Failed to build board DOM structure for reload.");
                return;
            }
        }

        console.log("Reloading board DOM from state:", boardStateArray);
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const squareElement = document.querySelector(`.square[data-row="${row}"][data-col="${col}"]`);
                const pieceData = boardStateArray[row]?.[col];
                if (squareElement) {
                    setPieceOnSquare(squareElement, pieceData);
                } else {
                     console.error(`Square element not found for [${row}, ${col}] during reload.`);
                }
            }
        }

        // Clear local UI states after reload
        if (selectedPiece) deselectPiece(); // Uses the fixed clearValidMoves
        clearValidMoves(); // Ensure highlights are gone
        // Check highlight is handled by the listener after state update
    }

    // Reads the current DOM state into a boardState array (needed for move calculation)
    function getCurrentBoardStateFromDOM() {
        let boardState = Array(8).fill(null).map(() => Array(8).fill({ piece: null, color: null, moved: false }));
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                const square = document.querySelector(`.square[data-row="${i}"][data-col="${j}"]`);
                if (square) {
                    boardState[i][j] = {
                        piece: square.dataset.piece || null,
                        color: square.dataset.color || null,
                        moved: square.dataset.moved === 'true'
                    };
                }
                 // If square not found, it remains null initialized above
            }
        }
        return boardState;
    }


    // --- Game Interaction Functions (Event Handlers, Move Logic) ---

    function handleClick(event) {
        const square = event.target.closest('.square');
        if (!square) return;

        if (!gameRef || !playerColor || turn !== playerColor || ['checkmate', 'stalemate'].includes(gameStatus)) {
            console.log("Interaction blocked: Not your turn, game over, or not in active game.");
            if (selectedPiece) deselectPiece();
            return;
        }

        // If clicking own piece (and it's user's turn)
        if (!selectedPiece && square.dataset.piece && square.dataset.color === turn) {
            selectPiece(square);
        }
        // If a piece is already selected
        else if (selectedPiece) {
            // Clicking the selected piece again deselects it
            if (square === selectedPiece) {
                deselectPiece();
            }
            // Clicking a valid move square initiates the move
            else if (square.classList.contains('valid-move')) {
                makeMove(square); // Renamed from movePiece
            }
            // Clicking another of own pieces selects that one instead
            else if (square.dataset.piece && square.dataset.color === turn) {
                 deselectPiece();
                 selectPiece(square);
            }
             // Clicking an invalid square (empty or opponent without valid move flag) deselects
             else {
                 deselectPiece();
             }
        }
    }

    function selectPiece(square) {
        if (selectedPiece) {
            deselectPiece(); // Deselect previous first
        }
        selectedPiece = square;
        square.classList.add('selected');
        showValidMoves(square);
    }

    function deselectPiece() {
         if (selectedPiece) {
            selectedPiece.classList.remove('selected');
         }
        clearValidMoves(); // Removes highlights
        selectedPiece = null;
    }

    // Calculates and shows valid moves for the selected piece (UI only)
    function showValidMoves(selectedSquare) {
        clearValidMoves(); // Clear previous
        if (!selectedSquare) return;

        const fromRow = parseInt(selectedSquare.dataset.row);
        const fromCol = parseInt(selectedSquare.dataset.col);
        const pieceColor = selectedSquare.dataset.color;

        // Use the *synced* currentBoardState, enPassantSquare, and castlingRights
        // Pass them to the game logic function
        const validMoves = getPieceMoves(currentBoardState, fromRow, fromCol, enPassantSquare, castlingRights);

        validMoves.forEach(move => {
            const [toRow, toCol] = move;
            const targetSquare = document.querySelector(`.square[data-row="${toRow}"][data-col="${toCol}"]`);
            if (targetSquare) {
                targetSquare.classList.add('valid-move');
                // Add capture indication if target square has opponent piece
                if (targetSquare.dataset.piece && targetSquare.dataset.color !== pieceColor) {
                    targetSquare.classList.add('capture-move');
                }
            }
        });
    }


    // Renamed from movePiece - Calculates next state and sends to Firebase
    function makeMove(targetSquare) {
        if (!selectedPiece || !targetSquare.classList.contains('valid-move')) return;

        const fromRow = parseInt(selectedPiece.dataset.row);
        const fromCol = parseInt(selectedPiece.dataset.col);
        const toRow = parseInt(targetSquare.dataset.row);
        const toCol = parseInt(targetSquare.dataset.col);

        // Use the *synced* state as the basis for simulation
        const boardBeforeMove = currentBoardState;
        const pieceData = boardBeforeMove?.[fromRow]?.[fromCol];

        if (!pieceData || pieceData.color !== turn) {
             console.error("Trying to move wrong piece or empty square based on synced state.");
             deselectPiece();
             return;
        }

        const pieceType = pieceData.piece;
        const pieceColor = pieceData.color;

        // --- Check for Pawn Promotion --- 
        const isPromotion = pieceType === 'pawn' && (toRow === 0 || toRow === 7);

        if (isPromotion) {
            console.log("Pawn promotion move detected.");
            pendingPromotionMove = { fromRow, fromCol, toRow, toCol };
            // Deselect piece visually, but keep pending move data
            deselectPiece(); 
            showPromotionDialog(pieceColor); // Pass color to show correct piece icons
            return; // Stop execution here, wait for user choice
        }

        // --- Simulate move locally to get the *next* state (for non-promotion moves) ---
        // We pass null for promotionPiece here, as it's not a promotion move
        let nextBoardState = simulateBoardMove(fromRow, fromCol, toRow, toCol, boardBeforeMove, enPassantSquare, null);
        let nextEnPassantSquare = null;
        let nextCastlingRights = JSON.parse(JSON.stringify(castlingRights));

        // 1. Determine next En Passant Possibility
        if (pieceType === 'pawn' && Math.abs(fromRow - toRow) === 2) {
            nextEnPassantSquare = [fromRow + (pieceColor === 'white' ? -1 : 1), fromCol]; // Square skipped over
            console.log("Setting next possible EP square:", nextEnPassantSquare);
        }

        // 2. Update Castling Rights based on piece moved or captured
        // King move
        if (pieceType === 'king') {
            nextCastlingRights[pieceColor].kingSide = false;
            nextCastlingRights[pieceColor].queenSide = false;
        }
        // Rook move (check origin)
        else if (pieceType === 'rook') {
            const originalRookRow = (pieceColor === 'white' ? 7 : 0);
            if (fromRow === originalRookRow) {
                if (fromCol === 0) nextCastlingRights[pieceColor].queenSide = false;
                else if (fromCol === 7) nextCastlingRights[pieceColor].kingSide = false;
            }
        }
        // Capture of opponent's rook on its starting square
        const capturedPieceData = boardBeforeMove[toRow]?.[toCol]; // Piece data *before* move
        if (capturedPieceData && capturedPieceData.piece === 'rook' && capturedPieceData.color !== pieceColor) {
            const opponentColor = capturedPieceData.color;
            const opponentRookRow = (opponentColor === 'white' ? 7 : 0);
            if (toRow === opponentRookRow) {
                if (toCol === 0) nextCastlingRights[opponentColor].queenSide = false;
                else if (toCol === 7) nextCastlingRights[opponentColor].kingSide = false;
            }
        }

        // 3. Determine next turn
        const nextTurn = turn === 'white' ? 'black' : 'white';

        // 4. Check for Check, Checkmate, Stalemate for the *next* player on the *next* board state
        // Pass the state *after* the move, and the EP/Castling state *for the next turn*
        let nextGameStatus = 'active';
        const isNextPlayerInCheck = isInCheck(nextBoardState, nextTurn, nextEnPassantSquare, nextCastlingRights);

        if (isNextPlayerInCheck) {
            // Pass state relevant for next player's move options
            if (!hasValidMoves(nextBoardState, nextTurn, nextEnPassantSquare, nextCastlingRights)) {
                nextGameStatus = 'checkmate';
            } else {
                nextGameStatus = 'check';
            }
        } else {
             // Pass state relevant for next player's move options
             if (!hasValidMoves(nextBoardState, nextTurn, nextEnPassantSquare, nextCastlingRights)) {
                 nextGameStatus = 'stalemate';
             } else {
                 nextGameStatus = 'active';
             }
        }

        // --- Construct the final game state object to send --- 
        const finalGameState = {
            board: nextBoardState,
            turn: nextTurn,
            castlingRights: nextCastlingRights,
            enPassantSquare: nextEnPassantSquare,
            // Assume both players are present when a move is made
            players: { white: true, black: true }, 
            status: nextGameStatus,
            lastMove: { 
                from: [fromRow, fromCol], to: [toRow, toCol],
                piece: pieceType, // Original piece was pawn
                color: pieceColor,
                // Was this move a castle? (King move > 1 square)
                castle: (pieceType === 'king' && Math.abs(fromCol - toCol) === 2),
                promotion: null // Not a promotion move
            }
        };

        // --- Send to Firebase --- 
        if (statusElement) statusElement.textContent = "Sending move...";
        // No need for localSelectedPiece here anymore as deselect happens earlier or not at all
        // deselectPiece(); // Already called if promotion, otherwise handled by listener

        sendGameStateToFirebase(finalGameState)
            .then(() => {
                console.log("Move successfully sent to Firebase.");
                // UI update is handled by the listener receiving this new state
            })
            .catch(error => {
                console.error("Error sending move to Firebase:", error);
                if (statusElement) statusElement.textContent = `Error sending move: ${error.message}. Board might be out of sync.`;
                // Maybe re-select locally to allow retry? Risky if state diverged.
            });
    }

    // --- Promotion Dialog Logic ---

    function showPromotionDialog(pieceColor) {
        const modal = document.getElementById('promotionModal');
        if (!modal) {
            console.error("Promotion modal element (#promotionModal) not found in HTML.");
            // Fallback or error handling needed - maybe auto-queen?
            // For now, let's cancel the pending move if modal missing
            pendingPromotionMove = null;
            return;
        }

        const promotionPieces = { // Use lowercase piece names consistent with game logic
            'q': 'queen',
            'r': 'rook',
            'b': 'bishop',
            'n': 'knight'
        };

        Object.keys(promotionPieces).forEach(key => {
            const button = document.getElementById(`promote-${key}`);
            const pieceType = promotionPieces[key];
            if (button) {
                button.textContent = pieces[pieceColor][pieceType]; // Use global pieces object
                // Remove old listener before adding new one
                button.replaceWith(button.cloneNode(true));
                const newButton = document.getElementById(`promote-${key}`); // Get the new clone
                newButton.addEventListener('click', () => handlePromotionChoice(pieceType));
            } else {
                console.warn(`Promotion button #promote-${key} not found.`);
            }
        });

        modal.style.display = 'block';
    }

    function handlePromotionChoice(chosenPiece) {
        const modal = document.getElementById('promotionModal');
        if (modal) modal.style.display = 'none'; // Hide modal

        if (!pendingPromotionMove) {
            console.error("handlePromotionChoice called but no pendingPromotionMove found.");
            return;
        }

        const { fromRow, fromCol, toRow, toCol } = pendingPromotionMove;
        const pieceColor = playerColor; // The promoting player is the current player
        pendingPromotionMove = null; // Clear pending move immediately

        console.log(`User chose to promote to: ${chosenPiece}`);

        // --- Re-simulate the move *with* the chosen piece --- 
        const boardBeforeMove = currentBoardState;
        let nextBoardState = simulateBoardMove(fromRow, fromCol, toRow, toCol, boardBeforeMove, enPassantSquare, chosenPiece);
        
        // --- Calculate subsequent game state (similar to makeMove) ---
        // Promotion moves cannot set up En Passant for the next turn
        const nextEnPassantSquare = null; 
        
        // Promotion moves don't affect castling rights directly (pawn != king/rook)
        // But need to inherit current rights correctly.
        let nextCastlingRights = JSON.parse(JSON.stringify(castlingRights));
        
        // Check for capture of opponent's rook on its starting square (edge case)
        const capturedPieceData = boardBeforeMove[toRow]?.[toCol]; 
        if (capturedPieceData && capturedPieceData.piece === 'rook' && capturedPieceData.color !== pieceColor) {
            const opponentColor = capturedPieceData.color;
            const opponentRookRow = (opponentColor === 'white' ? 7 : 0);
            if (toRow === opponentRookRow) {
                if (toCol === 0) nextCastlingRights[opponentColor].queenSide = false;
                else if (toCol === 7) nextCastlingRights[opponentColor].kingSide = false;
            }
        }

        const nextTurn = turn === 'white' ? 'black' : 'white';

        let nextGameStatus = 'active';
        const isNextPlayerInCheck = isInCheck(nextBoardState, nextTurn, nextEnPassantSquare, nextCastlingRights);

        if (isNextPlayerInCheck) {
            if (!hasValidMoves(nextBoardState, nextTurn, nextEnPassantSquare, nextCastlingRights)) {
                nextGameStatus = 'checkmate';
            } else {
                nextGameStatus = 'check';
            }
        } else {
             if (!hasValidMoves(nextBoardState, nextTurn, nextEnPassantSquare, nextCastlingRights)) {
                 nextGameStatus = 'stalemate';
             } else {
                 nextGameStatus = 'active';
             }
        }

        // --- Construct the final game state object to send --- 
        const finalGameState = {
            board: nextBoardState,
            turn: nextTurn,
            castlingRights: nextCastlingRights,
            enPassantSquare: nextEnPassantSquare,
            players: { white: true, black: true }, 
            status: nextGameStatus,
            lastMove: { 
                from: [fromRow, fromCol], 
                to: [toRow, toCol],
                piece: 'pawn', // Original piece was a pawn
                color: pieceColor,
                castle: false, // Cannot castle with promotion
                promotion: chosenPiece // Store the chosen piece
            }
        };

        // --- Send to Firebase --- 
        if (statusElement) statusElement.textContent = "Sending move...";
        sendGameStateToFirebase(finalGameState)
            .then(() => {
                console.log("Promotion move successfully sent to Firebase.");
            })
            .catch(error => {
                console.error("Error sending promotion move to Firebase:", error);
                if (statusElement) statusElement.textContent = `Error sending move: ${error.message}. Board might be out of sync.`;
                // Potentially need UI feedback or retry mechanism here
            });
    }

    // --- Initial Setup ---
    initializeView(); // Set up multiplayer controls view

    // --- Firebase Presence Logic ---
    const onlineCountElement = document.getElementById('online-count');

    presenceRef.on("value", (snap) => {
        if (snap.val() === true) {
            // We're connected (or reconnected).
            console.log("Firebase connected.");

            // Add user to the presence list when connected.
            currentUserRef = userListRef.push(true); // Push simple value, key is unique ID

            // Remove user from the presence list when they disconnect.
            currentUserRef.onDisconnect().remove();

        } else {
            // We're disconnected.
            console.log("Firebase disconnected.");
            // (onDisconnect handler should have removed the user)
            // Optionally update UI to show disconnected status
            if(onlineCountElement) onlineCountElement.textContent = '-';
        }
    });

    // Listen for changes in the number of users in the presence list.
    userListRef.on("value", (snap) => {
        const count = snap.numChildren(); // Get number of online users
        console.log("Online users:", count);
        if (onlineCountElement) {
            onlineCountElement.textContent = count;
        }
    });

}); // End DOMContentLoaded
