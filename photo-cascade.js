const imageA = document.getElementById("image-a");
const imageB = document.getElementById("image-b");
const messageContainer = document.getElementById("message");
const helpContainer = document.getElementById("help");

const PRELOAD = 3;
const HISTORY_LIMIT = 100;
const CACHE_RADIUS = 3;
const MANUAL_FADE_SECONDS = 0.15;
const MIN_INTERVAL_SECONDS = 1;
const MAX_FAILURES = 3;

const queue = [];
let futureLoad;
const history = [];
const historyCache = new Map();
let historyCursor = -1;
let seedCounter = 0;

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
    const run = {};
    state = { kind: "loading", run };
    updateImage(run);
}

function makeSlide() {
    const seed = `${Date.now()}-${seedCounter++}`;
    const url = `https://picsum.photos/seed/${seed}/${window.innerWidth}/${window.innerHeight}`;
    return { seed, url };
}

function rememberSlide(slide) {
    history.push({ seed: slide.seed, url: slide.url });
    if (history.length > HISTORY_LIMIT) { history.shift(); }
    historyCursor = history.length - 1;
    historyCache.set(slide.url, { promise: Promise.resolve(slide.image) });
    warmHistoryCache();
}

function preloadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load ${url}`));
        img.src = url;
    });
}

function startHistoryLoad(url) {
    const image = new Image();
    let rejectLoad;
    let settled = false;
    const promise = new Promise((resolve, reject) => {
        rejectLoad = reject;
        image.onload = () => { settled = true; resolve(image); };
        image.onerror = () => { settled = true; reject(new Error(`Failed to load ${url}`)); };
        image.src = url;
    });
    return {
        promise,
        cancel() {
            if (settled) { return; }
            settled = true;
            image.onload = null;
            image.onerror = null;
            image.src = "";
            rejectLoad(new Error(`Cancelled load of ${url}`));
        },
    };
}

function loadHistoryImage(url) {
    if (!historyCache.has(url)) {
        const entry = startHistoryLoad(url);
        entry.promise = entry.promise.catch(error => {
            if (historyCache.get(url) === entry) { historyCache.delete(url); }
            throw error;
        });
        historyCache.set(url, entry);
    }
    return historyCache.get(url).promise;
}

function pruneHistoryCache(centerIndex) {
    const nearby = new Set();
    const first = Math.max(0, centerIndex - CACHE_RADIUS);
    const last = Math.min(history.length - 1, centerIndex + CACHE_RADIUS);
    for (let index = first; index <= last; index++) {
        nearby.add(history[index].url);
    }
    for (const [url, entry] of historyCache) {
        if (!nearby.has(url)) {
            entry.cancel?.();
            historyCache.delete(url);
        }
    }
    return nearby;
}

function warmHistoryCache() {
    const nearby = pruneHistoryCache(historyCursor);
    for (const url of nearby) {
        loadHistoryImage(url).catch(() => {});
    }
}

async function queueImage() {
    if (futureLoad) { return futureLoad; }
    if (queue.length >= PRELOAD) { return; }

    const slide = makeSlide();
    futureLoad = preloadImage(slide.url).then(image => {
        if (queue.length < PRELOAD) { queue.push({ ...slide, image }); }
        failedPreloads = 0;
    }).catch(error => {
        console.error(`Error preloading image: ${error.message}`);
        ++failedPreloads;
        if (MAX_FAILURES === failedPreloads) {
            flashMessageHTML("Trouble loading images");
        }
    }).finally(() => {
        futureLoad = undefined;
    });
    return futureLoad;
}

function transitionImage(backgroundImage, fadeSeconds = intervalSeconds / 5) {

    const fadeDuration = `${fadeSeconds}s`;
    hiddenImage.style.backgroundImage = backgroundImage;
    hiddenImage.style.transitionDuration = fadeDuration;
    visibleImage.style.transitionDuration = fadeDuration;

    hiddenImage.classList.add("visible");
    visibleImage.classList.remove("visible");

    [visibleImage, hiddenImage] = [hiddenImage, visibleImage];
}

async function updateImage(run) {

    try {
        if (historyCursor < history.length - 1) {
            const nextIndex = historyCursor + 1;
            const image = await loadHistoryImage(history[nextIndex].url);
            if (state.kind !== "loading" || state.run !== run) { return; }
            historyCursor = nextIndex;
            transitionImage(`url(${image.src})`);
            warmHistoryCache();
        } else {
            if (queue.length === 0) {
                await queueImage();
            }

            if (state.kind !== "loading" || state.run !== run) { return; }

            if (queue.length > 0) {
                const slide = queue.shift();
                transitionImage(`url(${slide.url})`);
                rememberSlide(slide);
            }

            await queueImage();
        }
    } catch (error) {
        if (state.run === run) {
            console.error(`Error loading history image: ${error.message}`);
            flashMessageHTML("Trouble loading history image");
        }
    } finally {
        if (state.run !== run) { return; }
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
    case "seeking":
        if (state.resumeAt === undefined) {
            state.resumeAt = Date.now() + 1000;
            flashMessageHTML("Resuming");
        } else {
            state.resumeAt = undefined;
            flashMessageHTML("Pausing");
        }
        break;
    case "paused":
        scheduleUpdate(1000);
        flashMessageHTML("Resuming");
        break;
    case "initializing-paused":
        state = { kind: "initializing-resuming", resumeAt: Date.now() + 1000 };
        flashMessageHTML("Resuming");
        break;
    case "loading-paused":
        state = { kind: "loading-resuming", run: state.run, resumeAt: Date.now() + 1000 };
        flashMessageHTML("Resuming");
        break;
    case "initializing":
    case "initializing-resuming":
        state = { kind: "initializing-paused" };
        flashMessageHTML("Pausing");
        break;
    case "loading":
    case "loading-resuming":
        state = { kind: "loading-paused", run: state.run };
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

function pausePlayback() {
    clearTimeout(timeoutId);
    timeoutId = undefined;
    switch (state.kind) {
    case "initializing":
    case "initializing-resuming":
        state = { kind: "initializing-paused" };
        break;
    case "loading":
    case "loading-resuming":
        state = { kind: "loading-paused", run: state.run };
        break;
    case "seeking":
        state.resumeAt = undefined;
        break;
    default:
        state = { kind: "paused" };
    }
}

function seekHistory(index, resumeAt) {
    clearTimeout(timeoutId);
    timeoutId = undefined;
    const seek = { kind: "seeking", index, resumeAt };
    state = seek;

    pruneHistoryCache(index);
    loadHistoryImage(history[index].url).then(image => {
        if (state !== seek) { return; }
        historyCursor = index;
        transitionImage(`url(${image.src})`, MANUAL_FADE_SECONDS);
        warmHistoryCache();
        if (seek.resumeAt === undefined) {
            state = { kind: "paused" };
        } else {
            scheduleUpdate(Math.max(0, seek.resumeAt - Date.now()));
        }
    }).catch(error => {
        if (state !== seek) { return; }
        state = { kind: "paused" };
        console.error(`Error loading history image: ${error.message}`);
        flashMessageHTML("Trouble loading history image");
    });
}

function stepHistory(direction) {
    const index = state.kind === "seeking" ? state.index : historyCursor;
    if (direction < 0) {
        pausePlayback();
        if (index <= 0) {
            flashMessageHTML("Start of history");
        } else {
            seekHistory(index - 1);
        }
    } else if (index < history.length - 1) {
        const nextIndex = index + 1;
        const resumeAt = nextIndex === history.length - 1 ? Date.now() + 1000 : undefined;
        seekHistory(nextIndex, resumeAt);
    } else if (state.kind === "seeking") {
        state.resumeAt = Date.now() + 1000;
    } else if (state.kind === "paused" ||
               state.kind === "initializing-paused" ||
               state.kind === "loading-paused") {
        togglePause();
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
    case 'p': stepHistory(-1);           break;
    case 'n': stepHistory(1);            break;
    case 'f': toggleFullscreen();       break;
    case '=':
    case '+': incrementInterval();      break;
    case '_':
    case '-': decrementInterval();      break;
    }
})
