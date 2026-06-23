// Application State
let flashcardsDeck = [];
let currentCardIndex = 0;
let masteredScore = 0;

// DOM Elements
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

const reviewBtn = document.getElementById('review-btn');
const correctBtn = document.getElementById('correct-btn');
const restartBtn = document.getElementById('restart-btn');
const finalScore = document.getElementById('final-score');
const feedbackMsg = document.getElementById('feedback-msg');

// Event Listeners
generateBtn.addEventListener('click', generateDeck);
flashcard.addEventListener('click', () => flashcard.classList.toggle('flipped'));
correctBtn.addEventListener('click', () => handleCardAction(true));
reviewBtn.addEventListener('click', () => handleCardAction(false));
restartBtn.addEventListener('click', resetApp);

// Mock Intelligent Generation Pipeline (Stands in for LLM processing)
function generateDeck() {
    const rawTopic = topicInput.value.trim();
    if (!rawTopic) {
        alert("Please enter a topic or paste lecture notes first!");
        return;
    }

    const count = parseInt(cardCountSelect.value);
    
    // UI Transitions
    setupContainer.classList.add('hidden');
    loadingContainer.classList.remove('hidden');

    // Simulate Network latency / LLM processing overhead
    setTimeout(() => {
        flashcardsDeck = buildMockCards(rawTopic, count);
        currentCardIndex = 0;
        masteredScore = 0;
        
        loadingContainer.classList.add('hidden');
        flashcardContainer.classList.remove('hidden');
        
        renderCurrentCard();
    }, 1800);
}

// Logic to render information on the active card element
function renderCurrentCard() {
    // Reset state transformations
    flashcard.classList.remove('flipped');
    
    const currentCard = flashcardsDeck[currentCardIndex];
    
    // Delay setting text slightly if flipping back from previous action to avoid spoilers
    setTimeout(() => {
        questionText.textContent = currentCard.question;
        answerText.textContent = currentCard.answer;
    }, 150);

    // Update Indicators
    cardCounter.textContent = `Card ${currentCardIndex + 1} of ${flashcardsDeck.length}`;
    scoreCounter.innerHTML = `<i class="fa-solid fa-check-circle"></i> Mastered: ${masteredScore}`;
    
    const progressPercent = ((currentCardIndex) / flashcardsDeck.length) * 100;
    progressBar.style.width = `${progressPercent}%`;
}

// Processes scoring and card movement logic
function handleCardAction(isMastered) {
    if (isMastered) {
        masteredScore++;
    }

    currentCardIndex++;

    if (currentCardIndex < flashcardsDeck.length) {
        renderCurrentCard();
    } else {
        showResults();
    }
}

// Renders the end-of-session evaluation metric engine
function showResults() {
    flashcardContainer.classList.add('hidden');
    resultsContainer.classList.remove('hidden');
    
    progressBar.style.width = '100%';
    finalScore.textContent = `${masteredScore}/${flashcardsDeck.length}`;
    
    const percentage = (masteredScore / flashcardsDeck.length) * 100;
    if (percentage === 100) {
        feedbackMsg.textContent = "Flawless performance! You've perfectly integrated this concept into long term memory.";
    } else if (percentage >= 70) {
        feedbackMsg.textContent = "Strong analytical grasp! Just a few minor edge cases to clean up next run.";
    } else {
        feedbackMsg.textContent = "Sub-optimal retention. We highly suggest triggering another generation cycle to reinforce this state.";
    }
}

function resetApp() {
    resultsContainer.classList.add('hidden');
    setupContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
}

// Fallback rule engine parsing prompt context to match typical academic domains
function buildMockCards(topic, count) {
    const deck = [];
    const lowerTopic = topic.toLowerCase();
    
    let templateType = "general";
    if (lowerTopic.includes("tree") || lowerTopic.includes("bst") || lowerTopic.includes("data structure")) {
        templateType = "bst";
    } else if (lowerTopic.includes("schedul") || lowerTopic.includes("os") || lowerTopic.includes("process")) {
        templateType = "os";
    }

    for (let i = 1; i <= count; i++) {
        if (templateType === "bst") {
            deck.push({
                question: `[BST Concept #${i}] What is the worst-case time complexity for searching an element in an un-balanced Binary Search Tree?`,
                answer: `O(n). This structural degradation occurs when elements are inserted in strictly sequential order, transforming the tree into a linked list hierarchy.`
            });
        } else if (templateType === "os") {
            deck.push({
                question: `[OS Concept #${i}] How does Round Robin scheduling mitigate starvation conditions inside the execution pipeline?`,
                answer: `By implementing static 'Time Quantums'. Each computational thread receives a bounded allocation of CPU runtime before getting forcefully pre-empted.`
            });
        } else {
            deck.push({
                question: `Key Technical Core Concept Insight #${i} covering: "${topic.substring(0, 30)}..."`,
                answer: `This abstract assertion represents atomic takeaway #${i} analyzed directly from your provided study documents. It encapsulates critical context for evaluation frameworks.`
            });
        }
    }
    return deck;
}