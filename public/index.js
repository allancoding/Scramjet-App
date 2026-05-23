"use strict";

const form = document.getElementById("sj-form");
const homeForm = document.getElementById("sj-home-form");
const address = document.getElementById("sj-address");
const homeAddress = document.getElementById("sj-home-address");
const searchEngine = document.getElementById("sj-search-engine");
const homeSearchEngine = document.getElementById("sj-home-engine");
const backButton = document.getElementById("sj-back");
const forwardButton = document.getElementById("sj-forward");
const reloadButton = document.getElementById("sj-reload");
const toggleButton = document.getElementById("sj-toggle-ui");
const appShell = document.querySelector(".app-shell");
const homePanel = document.getElementById("sj-home");
const statusPanel = document.getElementById("sj-status");
const error = document.getElementById("sj-error");
const errorCode = document.getElementById("sj-error-code");

const homeQueryParam = "q";
const gotoQueryParam = "goto";
const directResourcePattern = /\.(?:avif|bmp|gif|ico|jpe?g|json|mp3|mp4|ogg|pdf|png|svg|txt|wav|webm|xml)(?:$|[?#])/i;
const directImagePattern = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:$|[?#])/i;
const directPdfPattern = /\.pdf(?:$|[?#])/i;

const { Controller } = $scramjetController;
const ScramjetPlugin = $scramjet.Plugin;
const LibcurlClient =
	window.LibcurlTransport?.LibcurlClient ??
	window.CurlMod?.default ??
	window.CurlMod;

function normalizeRawHeaders(headers) {
	if (!headers) return [];
	if (typeof headers[Symbol.iterator] === "function") {
		return Array.from(headers, ([name, value]) => [String(name), String(value)]);
	}
	return Object.entries(headers).map(([name, value]) => [String(name), String(value)]);
}

function wrapTransport(transportInstance) {
	return {
		get ready() {
			return transportInstance.ready;
		},
		init() {
			return transportInstance.init?.();
		},
		request(remote, method, body, headers, signal) {
			return Promise.resolve(
				transportInstance.request(remote, method, body, headers, signal)
			).then((response) => {
				if (!response || typeof response !== "object") return response;
				return {
					...response,
					headers: normalizeRawHeaders(response.headers),
				};
			});
		},
		connect(...args) {
			return transportInstance.connect(...args);
		},
		sendSetCookie(...args) {
			return transportInstance.sendSetCookie?.(...args);
		},
	};
}

let controller = null;
let browsingFrame = null;
let swReady = false;
let transportReady = false;
let transport = null;

function parseDisplayUrl(rawUrl) {
	if (!rawUrl) return "";
	const prefixPattern = /\/~\/sj\/[^/]+\//;
	const prefixMatch = rawUrl.match(prefixPattern);
	if (!prefixMatch) {
		try {
			return new URL(rawUrl).href;
		} catch {
			return rawUrl;
		}
	}
	const encodedTarget = rawUrl.slice(prefixMatch.index + prefixMatch[0].length);
	const targetWithoutProxySuffix = encodedTarget.split(/[?#]/, 1)[0];
	if (!targetWithoutProxySuffix) return rawUrl;
	try {
		return decodeURIComponent(targetWithoutProxySuffix);
	} catch {
		return rawUrl;
	}
}

function showError(message, detail = "") {
	error.textContent = message;
	errorCode.textContent = detail;
	statusPanel.classList.add("has-error");
}

function clearError() {
	error.textContent = "";
	errorCode.textContent = "";
	statusPanel.classList.remove("has-error");
}

// Suggestions/autocomplete removed: no-op placeholder functions kept intentionally empty.

function getHomeQueryValue() {
	return new URLSearchParams(location.search).get(homeQueryParam) || "";
}

function getGotoValue() {
	return new URLSearchParams(location.search).get(gotoQueryParam) || "";
}

function syncHomeQueryValue(value) {
	const url = new URL(location.href);
	const trimmedValue = value.trim();
	if (trimmedValue) url.searchParams.set(homeQueryParam, trimmedValue);
	else url.searchParams.delete(homeQueryParam);
	url.searchParams.delete(gotoQueryParam);
	history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function isDirectResourceUrl(urlValue) {
	try {
		const parsedUrl = new URL(urlValue);
		return directResourcePattern.test(parsedUrl.pathname);
	} catch {
		return directResourcePattern.test(String(urlValue || ""));
	}
}

function getDirectResourceKind(urlValue) {
	try {
		const pathname = new URL(urlValue).pathname;
		if (directImagePattern.test(pathname)) return "image";
		if (directPdfPattern.test(pathname)) return "pdf";
	} catch {
		if (directImagePattern.test(String(urlValue || ""))) return "image";
		if (directPdfPattern.test(String(urlValue || ""))) return "pdf";
	}
	return "other";
}

function buildDirectResourceViewer(targetUrl, kind) {
	const safeTarget = JSON.stringify(targetUrl);
	const viewerHtml =
		kind === "image"
			? `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}body{display:flex;align-items:center;justify-content:center}img{max-width:100vw;max-height:100vh;object-fit:contain;display:block}</style></head><body><img alt="image" src=${safeTarget}></body></html>`
			: kind === "pdf"
				? `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}embed{width:100vw;height:100vh;border:0;display:block}</style></head><body><embed src=${safeTarget} type="application/pdf"></body></html>`
				: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}iframe{width:100vw;height:100vh;border:0;display:block}</style></head><body><iframe src=${safeTarget} referrerpolicy="no-referrer"></iframe></body></html>`;

	return `data:text/html;charset=utf-8,${encodeURIComponent(viewerHtml)}`;
}

function syncInputs(value, engine) {
	address.value = value;
	homeAddress.value = value;
	searchEngine.value = engine;
	homeSearchEngine.value = engine;
}

function syncAddressOnly(value) {
	address.value = value;
	homeAddress.value = value;
}

function syncAddressAndQuery(value) {
	syncAddressOnly(value);
	syncHomeQueryValue(value);
}

function isHomeVisible() {
	return !homePanel.classList.contains("is-hidden");
}

function restoreHomeQueryValue() {
	const queryValue = getHomeQueryValue();
	if (queryValue) syncAddressOnly(queryValue);
	return queryValue;
}

function installUrlWatcher(frame) {
	if (!ScramjetPlugin) return;
	const plugin = new ScramjetPlugin("url-watcher");
	plugin.tap(frame.hooks.init.post, (context) => {
		if (!context.isTopLevel) return;
		syncAddressOnly(context.client.url.href);
		plugin.tap(context.client.hooks.lifecycle.navigate, (_context, props) => {
			syncAddressOnly(props.url);
		});
	});
}

function getOrCreateFrame() {
	if (!browsingFrame) {
		if (!controller) throw new Error("Controller is not ready.");
		browsingFrame = controller.createFrame();
		browsingFrame.element.id = "sj-frame";
		installUrlWatcher(browsingFrame);
		document.querySelector(".viewport").appendChild(browsingFrame.element);
	}
	return browsingFrame;
}

async function ensureReady() {
	if (!swReady) {
		await registerSW();
		swReady = true;
	}

	if (!transportReady) {
		if (!LibcurlClient) {
			throw new Error("Libcurl transport failed to load.");
		}
		transport = wrapTransport(
			new LibcurlClient({
				wisp:
					(location.protocol === "https:" ? "wss" : "ws") +
					"://" +
					location.host +
				"/wisp/",
			})
		);
		transportReady = true;
	}

	if (!controller) {
		const readySw = navigator.serviceWorker.controller ?? (await navigator.serviceWorker.ready).active;
		if (!readySw) {
			throw new Error("Service worker controller unavailable.");
		}
		controller = new Controller({
			serviceworker: readySw,
			transport,
		});
		await controller.wait();
	}
}

async function navigate(inputValue, engineTemplate, options = {}) {
	const { specialMode = false, persistGoto = false } = options;
	const value = inputValue.trim();
	if (!value) {
		showError("Type a URL or search query first.");
		return;
	}

	clearError();
	syncInputs(value, engineTemplate);
	if (!persistGoto) {
		syncHomeQueryValue(value);
	}

	try {
		await ensureReady();
		const url = search(value, engineTemplate);
		syncAddressOnly(url);
		const frame = getOrCreateFrame();
		let frameUrl = url;
		homePanel.classList.add("is-hidden");
		if (specialMode) {
			appShell.classList.add("is-goto-mode");
			appShell.classList.add("is-ui-collapsed");
			appShell.classList.add("is-url-collapsed");
			const isDirectResource = isDirectResourceUrl(url);
			appShell.classList.toggle("is-direct-resource", isDirectResource);
			if (isDirectResource) {
				frameUrl = buildDirectResourceViewer(url, getDirectResourceKind(url));
			}
		} else {
			appShell.classList.remove("is-goto-mode");
			appShell.classList.remove("is-direct-resource");
			appShell.classList.remove("is-url-collapsed");
			appShell.classList.remove("is-ui-collapsed");
		}
		frame.go(frameUrl);
	} catch (err) {
		showError("Failed to open that page.", String(err));
	}
}

function warmupTransport() {
	ensureReady().catch((err) => {
		showError("Proxy transport failed to start.", String(err));
	});
}

function search(input, template) {
	try {
		return new URL(input).toString();
	} catch {
		/* ignore */
	}

	const bareHostPattern =
		/^(localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(?::\d+)?(?:\/[^\s]*)?$/;
	if (bareHostPattern.test(input)) {
		return new URL(`https://${input}`).toString();
	}

	return template.replace("%s", encodeURIComponent(input));
}

syncInputs(restoreHomeQueryValue(), homeSearchEngine.value);
warmupTransport();

const gotoValue = getGotoValue();
if (gotoValue) {
	navigate(gotoValue, searchEngine.value, {
		specialMode: true,
		persistGoto: true,
	});
}

form.addEventListener("submit", (event) => {
	event.preventDefault();
	navigate(address.value, searchEngine.value);
});

homeForm.addEventListener("submit", (event) => {
	event.preventDefault();
	navigate(homeAddress.value, homeSearchEngine.value);
});

address.addEventListener("input", () => {
	syncAddressAndQuery(address.value);
});

homeAddress.addEventListener("input", () => {
	syncAddressAndQuery(homeAddress.value);
});

searchEngine.addEventListener("change", () => {
	homeSearchEngine.value = searchEngine.value;
});

homeSearchEngine.addEventListener("change", () => {
	searchEngine.value = homeSearchEngine.value;
});

backButton.addEventListener("click", () => {
	if (browsingFrame) {
		browsingFrame.back();
	}
});

forwardButton.addEventListener("click", () => {
	if (browsingFrame) {
		browsingFrame.forward();
	}
});

reloadButton.addEventListener("click", () => {
	if (browsingFrame) {
		browsingFrame.reload();
	}
});

toggleButton.addEventListener("click", () => {
	appShell.classList.toggle("is-ui-collapsed");
});
