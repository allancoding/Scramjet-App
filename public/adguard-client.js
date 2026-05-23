(function () {
	const LIST_URL = '/adguard-lists.json';
	const CACHE_KEY = 'adguard.cached.list';
	const CACHE_TS_KEY = 'adguard.cached.at';
	const REFRESH_MS = 24 * 60 * 60 * 1000; // daily

	async function fetchList() {
		try {
			const res = await fetch(LIST_URL, { cache: 'no-store' });
			if (!res.ok) return null;
			const json = await res.json();
			if (!Array.isArray(json)) return null;
			return json;
		} catch (err) {
			return null;
		}
	}

	async function postToSW(list) {
		if (!list || !list.length) return;
		if (navigator.serviceWorker && navigator.serviceWorker.controller) {
			navigator.serviceWorker.controller.postMessage({ type: 'update-adguard', list });
			return true;
		}
		try {
			const reg = await navigator.serviceWorker.ready;
			if (reg && reg.active) {
				reg.active.postMessage({ type: 'update-adguard', list });
				return true;
			}
		} catch (err) {
			// ignore
		}
		return false;
	}

	async function loadAndUpdate() {
		const now = Date.now();
		const cached = localStorage.getItem(CACHE_KEY);
		const ts = Number(localStorage.getItem(CACHE_TS_KEY) || 0);
		if (cached && ts && now - ts < REFRESH_MS) {
			try {
				const parsed = JSON.parse(cached);
				await postToSW(parsed);
			} catch {}
		}

		const list = await fetchList();
		if (list && list.length) {
			localStorage.setItem(CACHE_KEY, JSON.stringify(list));
			localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
			await postToSW(list);
		}
	}

	// Run immediately and then periodically
	loadAndUpdate().catch(() => {});
	setInterval(() => loadAndUpdate().catch(() => {}), REFRESH_MS);
})();
