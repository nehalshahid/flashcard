let flashcardsDeck = [];
let originalDeck = [];
let currentCardIndex = 0;
let masteredScore = 0;
let lastTopic = '';
let lastCount = 8;

// DOM
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
const ghostFront = document.getElementById('ghost-front');
const ghostBack = document.getElementById('ghost-back');
const reviewBtn = document.getElementById('review-btn');
const correctBtn = document.getElementById('correct-btn');
const restartBtn = document.getElementById('restart-btn');
const retryBtn = document.getElementById('retry-btn');
const finalScore = document.getElementById('final-score');
const scoreDenom = document.getElementById('score-denom');
const feedbackMsg = document.getElementById('feedback-msg');
const resultsBar = document.getElementById('results-bar');
const toast = document.getElementById('toast');

// File upload handling
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const uploadLabel = document.getElementById('upload-label');
let uploadedFile = null;

uploadZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
        uploadedFile = file;
        uploadLabel.textContent = `✓ ${file.name}`;
        uploadZone.classList.add('has-file');
    }
});

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) {
        uploadedFile = file;
        uploadLabel.textContent = `✓ ${file.name}`;
        uploadZone.classList.add('has-file');
        fileInput.files = e.dataTransfer.files;
    }
});

// Events
generateBtn.addEventListener('click', generateDeck);
flashcard.addEventListener('click', flipCard);
correctBtn.addEventListener('click', () => handleAction(true));
reviewBtn.addEventListener('click', () => handleAction(false));
restartBtn.addEventListener('click', resetToSetup);
retryBtn.addEventListener('click', retryDeck);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (!flashcardContainer.classList.contains('hidden')) {
        if (e.code === 'Space') { e.preventDefault(); flipCard(); }
        if (e.code === 'ArrowRight') handleAction(true);
        if (e.code === 'ArrowLeft') handleAction(false);
        if (e.code === 'Escape') resetToSetup();
    }
    if (!setupContainer.classList.contains('hidden') && e.code === 'Enter' && e.ctrlKey) {
        generateDeck();
    }
});

function flipCard() {
    flashcard.classList.toggle('flipped');
}

async function generateDeck() {
    const rawTopic = topicInput.value.trim();
    if (!rawTopic && !uploadedFile) { showToast('Enter a topic or upload a file'); return; }

    lastTopic = rawTopic;
    lastCount = parseInt(cardCountSelect.value);

    setupContainer.classList.add('hidden');
    loadingContainer.classList.remove('hidden');

    try {
        let response;

        if (uploadedFile) {
            const formData = new FormData();
            formData.append('file', uploadedFile);
            formData.append('cardCount', lastCount);

            response = await fetch('/api/generate-flashcards', {
                method: 'POST',
                body: formData
            });
        } else {
            response = await fetch('/api/generate-flashcards', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic: rawTopic, cardCount: lastCount }),
            });
        }

        if (!response.ok) throw new Error('Bad response');
        const data = await response.json();

        if (data.success && data.deck && data.deck.length > 0) {
            flashcardsDeck = data.deck;
            originalDeck = [...data.deck];
            currentCardIndex = 0;
            masteredScore = 0;
            loadingContainer.classList.add('hidden');
            flashcardContainer.classList.remove('hidden');
            renderCard();
        } else {
            throw new Error('Empty deck');
        }
    } catch (error) {
        console.error(error);
        showToast('Failed to generate — try again');
        loadingContainer.classList.add('hidden');
        setupContainer.classList.remove('hidden');
    }
}

function renderCard() {
    flashcard.classList.remove('flipped');
    const card = flashcardsDeck[currentCardIndex];
    const num = String(currentCardIndex + 1);

    setTimeout(() => {
        questionText.textContent = card.question;
        answerText.textContent = card.answer;
        ghostFront.textContent = num;
        ghostBack.textContent = num;
    }, 120);

    cardCounter.textContent = `${currentCardIndex + 1} / ${flashcardsDeck.length}`;
    scoreCounter.textContent = `${masteredScore} mastered`;
    progressBar.style.width = `${(currentCardIndex / flashcardsDeck.length) * 100}%`;
}

function handleAction(isMastered) {
    if (isMastered) {
        masteredScore++;
        // Bump animation on score badge
        scoreCounter.classList.add('bump');
        setTimeout(() => scoreCounter.classList.remove('bump'), 300);
        currentCardIndex++;
        if (currentCardIndex >= flashcardsDeck.length) {
            showResults();
        } else {
            renderCard();
        }
    } else {
        // Restart from card 1
        currentCardIndex = 0;
        masteredScore = 0;
        flashcard.classList.remove('flipped');
        renderCard();
        showToast('Starting over from card 1');
    }
}

function showResults() {
    flashcardContainer.classList.add('hidden');
    resultsContainer.classList.remove('hidden');

    const total = originalDeck.length;
    const pct = Math.round((masteredScore / total) * 100);

    finalScore.textContent = masteredScore;
    scoreDenom.textContent = `/${total}`;

    setTimeout(() => {
        resultsBar.style.width = `${pct}%`;
    }, 100);

    if (pct === 100) {
        feedbackMsg.textContent = "Flawless. Every concept locked in — you're ready.";
        launchConfetti();
    } else if (pct >= 75) {
        feedbackMsg.textContent = "Strong run. A couple of edges to clean up — one more pass will seal it.";
    } else if (pct >= 50) {
        feedbackMsg.textContent = "Decent start. Review the ones you missed and go again.";
    } else {
        feedbackMsg.textContent = "Rough first pass — that's fine. Generate the deck again and push through it.";
    }
}

function resetToSetup() {
    resultsContainer.classList.add('hidden');
    flashcardContainer.classList.add('hidden');
    loadingContainer.classList.add('hidden');
    setupContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
}

function retryDeck() {
    flashcardsDeck = [...originalDeck];
    currentCardIndex = 0;
    masteredScore = 0;
    resultsContainer.classList.add('hidden');
    flashcardContainer.classList.remove('hidden');
    renderCard();
}

function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2800);
}

// Confetti
function launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#F0A500', '#00BFA5', '#E4E4DC', '#E05252', '#ffffff'];
    const pieces = Array.from({ length: 120 }, () => ({
        x: Math.random() * canvas.width,
        y: -10,
        w: Math.random() * 8 + 4,
        h: Math.random() * 4 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        speed: Math.random() * 3 + 2,
        angle: Math.random() * 360,
        spin: (Math.random() - 0.5) * 6,
        drift: (Math.random() - 0.5) * 2
    }));

    let frame;
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pieces.forEach(p => {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle * Math.PI / 180);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
            p.y += p.speed;
            p.x += p.drift;
            p.angle += p.spin;
        });
        if (pieces.some(p => p.y < canvas.height)) {
            frame = requestAnimationFrame(draw);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
    draw();
    setTimeout(() => { cancelAnimationFrame(frame); ctx.clearRect(0, 0, canvas.width, canvas.height); }, 4000);
}