let flashcardsDeck = [];
let currentCardIndex = 0;
let masteredScore = 0;

const setupContainer = document.getElementById('setup-container');
const loadingContainer = document.getElementById('loading-container');
const flashcardContainer = document.getElementById('flashcard-container');
const resultsContainer = document.getElementById('results-container');

const topicInput = document.getElementById('topic-input');
const cardCountSelect = document.getElementById('card-count');
const generateBtn = document.getElementById('generate-btn');

const flashcard = document.getElementById('flashcard');
const questionText = document.getElementById('question-text');
const answerText = document.getElementById('answer-text');
const cardCounter = document.getElementById('card-counter');
const scoreCounter = document.getElementById('score-counter');
const progressBar = document.getElementById('progress-bar');
const ghostNumFront = document.getElementById('ghost-num-front');
const ghostNumBack = document.getElementById('ghost-num-back');

const reviewBtn = document.getElementById('review-btn');
const correctBtn = document.getElementById('correct-btn');
const restartBtn = document.getElementById('restart-btn');
const finalScore = document.getElementById('final-score');
const feedbackMsg = document.getElementById('feedback-msg');

generateBtn.addEventListener('click', generateDeck);
flashcard.addEventListener('click', () => flashcard.classList.toggle('flipped'));
correctBtn.addEventListener('click', () => handleCardAction(true));
reviewBtn.addEventListener('click', () => handleCardAction(false));
restartBtn.addEventListener('click', resetApp);

async function generateDeck() {
    const rawTopic = topicInput.value.trim();
    if (!rawTopic) {
        alert("Please enter a topic or paste lecture notes first!");
        return;
    }

    const count = parseInt(cardCountSelect.value);
    setupContainer.classList.add('hidden');
    loadingContainer.classList.remove('hidden');

    try {
        const response = await fetch('/api/generate-flashcards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic: rawTopic, cardCount: count }),
        });

        if (!response.ok) throw new Error('Network response returned an error status.');

        const data = await response.json();

        if (data.success && data.deck) {
            flashcardsDeck = data.deck;
            currentCardIndex = 0;
            masteredScore = 0;
            loadingContainer.classList.add('hidden');
            flashcardContainer.classList.remove('hidden');
            renderCurrentCard();
        } else {
            throw new Error('Malformed schema returned from backend.');
        }
    } catch (error) {
        console.error("Pipeline breakdown:", error);
        alert("Failed to connect to the AI backend. Make sure your server is running!");
        loadingContainer.classList.add('hidden');
        setupContainer.classList.remove('hidden');
    }
}

function pad(n) { return String(n).padStart(2, '0'); }

function renderCurrentCard() {
    flashcard.classList.remove('flipped');
    const currentCard = flashcardsDeck[currentCardIndex];
    const num = String(currentCardIndex + 1);

    setTimeout(() => {
        questionText.textContent = currentCard.question;
        answerText.textContent = currentCard.answer;
        ghostNumFront.textContent = num;
        ghostNumBack.textContent = num;
    }, 150);

    cardCounter.textContent = `${pad(currentCardIndex + 1)} / ${pad(flashcardsDeck.length)}`;
    scoreCounter.textContent = `\u2713 ${masteredScore} mastered`;

    const progressPercent = (currentCardIndex / flashcardsDeck.length) * 100;
    progressBar.style.width = `${progressPercent}%`;
}

function handleCardAction(isMastered) {
    if (isMastered) masteredScore++;
    currentCardIndex++;
    if (currentCardIndex < flashcardsDeck.length) {
        renderCurrentCard();
    } else {
        showResults();
    }
}

function showResults() {
    flashcardContainer.classList.add('hidden');
    resultsContainer.classList.remove('hidden');
    progressBar.style.width = '100%';
    finalScore.textContent = `${masteredScore}/${flashcardsDeck.length}`;

    const pct = (masteredScore / flashcardsDeck.length) * 100;
    if (pct === 100) {
        feedbackMsg.textContent = "Flawless. Every concept locked in. You're ready.";
    } else if (pct >= 70) {
        feedbackMsg.textContent = "Strong run. A few edges to clean up — one more pass should seal it.";
    } else {
        feedbackMsg.textContent = "Rough start. That's fine. Generate the deck again and push through it.";
    }
}

function resetApp() {
    resultsContainer.classList.add('hidden');
    setupContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
}