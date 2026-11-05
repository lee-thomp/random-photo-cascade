const imageA = document.getElementById("image-a");
const imageB = document.getElementById("image-b");
const messageContainer = document.getElementById("message");
const helpContainer = document.getElementById("help");

const PRELOAD = 3;
const SEED_HISTORY = 32;
const MIN_INTERVAL_SECONDS = 1;
const MAX_FAILURES = 3;

const queue = [];
const seedQueue = [];

let help = false;
let intervalSeconds = 5;
let failedPreloads = 0;

let visibleImage = imageA;
let hiddenImage  = imageB;

let timeoutId;
let opacityTimeoutId;
let state = { kind: "initializing" };

function scheduleUpdate(delay) {
    clearTimeout(timeoutId);
    state = { kind: "waiting" };
    timeoutId = setTimeout(runScheduledUpdate, delay);
}

function runScheduledUpdate() {
    timeoutId = undefined;
    if (state.kind === "waiting") { startUpdate(); }
}

function startUpdate() {
    state = { kind: "loading" };
    updateImage();
}

function fetchImage() {
    try {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const seed = Date.now();
        const imageUrl = `https://picsum.photos/seed/${seed}/${width}/${height}`;

        // Check this if a cool image has just flashed by and you want to see it
        // again.  You'll have to do some manual fiddling right now to get it
        // back up but don't worry I'm working on implementing this!
        seedQueue.push(seed);
        if (seedQueue.length > SEED_HISTORY) { seedQueue.shift(); }

        return imageUrl;
    } catch (error) {
        console.error('Error fetching image:', error);
        return null;
    }
}

function preloadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load ${url}`));
        img.src = url;
    });
}

async function queueImage() {
    if (queue.length >= PRELOAD) {
        return;
    }

    const imageUrl = fetchImage();

    if (!imageUrl) {
        return;
    }

    try {
        const img = await preloadImage(imageUrl);
        queue.push(img);
        failedPreloads = 0;
    } catch(e) {
        console.error(`Error preloading image: ${e.message}`);
        ++failedPreloads;

        if (MAX_FAILURES === failedPreloads) {
            flashMessageHTML("Trouble loading images");
        }
    }
}

function transitionImage(backgroundImage) {

    const fadeSeconds = `${intervalSeconds / 5}s`;
    hiddenImage.style.backgroundImage = backgroundImage;
    hiddenImage.style.transitionDuration = fadeSeconds;
    visibleImage.style.transitionDuration = fadeSeconds;

    hiddenImage.classList.add("visible");
    visibleImage.classList.remove("visible");

    [visibleImage, hiddenImage] = [hiddenImage, visibleImage];
}

async function updateImage() {

    try {
        if (queue.length === 0) {
            await queueImage();
        }

        if (state.kind !== "loading") { return; }

        if (queue.length > 0) {
            const img = queue.shift();
            transitionImage(`url(${img.src})`);
        }

        await queueImage();
    } finally {
        switch (state.kind) {
        case "loading":
            scheduleUpdate(intervalSeconds * 1000);
            break;
        case "loading-paused":
            state = { kind: "paused" };
            break;
        case "loading-resuming":
            scheduleUpdate(Math.max(0, state.resumeAt - Date.now()));
            break;
        }
    }
}

function flashMessageHTML(message) {
    clearTimeout(opacityTimeoutId);
    messageContainer.innerHTML = `<p>${message}</p>`;

    messageContainer.classList.add("visible");

    opacityTimeoutId = setTimeout(() => {
        messageContainer.classList.remove("visible");
    }, 1000);
}

function togglePause() {
    switch (state.kind) {
    case "paused":
        scheduleUpdate(1000);
        flashMessageHTML("Resuming");
        break;
    case "initializing-paused":
        state = { kind: "initializing-resuming", resumeAt: Date.now() + 1000 };
        flashMessageHTML("Resuming");
        break;
    case "loading-paused":
        state = { kind: "loading-resuming", resumeAt: Date.now() + 1000 };
        flashMessageHTML("Resuming");
        break;
    case "initializing":
    case "initializing-resuming":
        state = { kind: "initializing-paused" };
        flashMessageHTML("Pausing");
        break;
    case "loading":
    case "loading-resuming":
        state = { kind: "loading-paused" };
        flashMessageHTML("Pausing");
        break;
    case "waiting":
        clearTimeout(timeoutId);
        timeoutId = undefined;
        state = { kind: "paused" };
        flashMessageHTML("Pausing");
        break;
    }
}

function toggleHelp() {
    helpContainer.hidden = !helpContainer.hidden;
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.body.requestFullscreen().catch((err) => {
            console.error(`Error enabling fullscreen: ${err.message}`)});
    } else if (document.exitFullscreen) {
        document.exitFullscreen();
    }
}

function incrementInterval() {
    ++intervalSeconds;
    flashMessageHTML(`${intervalSeconds}s`);
}

function decrementInterval() {
    if (intervalSeconds <= MIN_INTERVAL_SECONDS) {
        intervalSeconds =  MIN_INTERVAL_SECONDS;
    } else {
        --intervalSeconds;
        flashMessageHTML(`${intervalSeconds}s`);
    }
}

(async function init() {
    flashMessageHTML("Loading images —press <kbd>h</kbd> for help");
    for (let i = 0; i < PRELOAD; i++) {
        await queueImage();
    }
    switch (state.kind) {
    case "initializing":
        startUpdate();
        break;
    case "initializing-paused":
        state = { kind: "paused" };
        break;
    case "initializing-resuming":
        scheduleUpdate(Math.max(0, state.resumeAt - Date.now()));
        break;
    }
})();

document.addEventListener('keydown', (event) => {
    switch (event.key) {
    case ' ': togglePause();            break;
    case '?':
    case 'h': toggleHelp();             break;
    case 'f': toggleFullscreen();       break;
    case '=':
    case '+': incrementInterval();      break;
    case '_':
    case '-': decrementInterval();      break;
    }
})
