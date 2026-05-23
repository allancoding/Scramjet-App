importScripts("/adguard.js");
importScripts("/controller/controller.sw.js");

function isBlockedUrl(url) {
	try {
		const u = new URL(url);
		const host = (u.hostname || "").toLowerCase();
		if (!host) return false;
		for (const blocked of (self.ADGUARD_BLOCKLIST || [])) {
			if (!blocked) continue;
			// exact match or subdomain match
			if (host === blocked || host.endsWith(`.${blocked}`) || host.includes(blocked)) {
				return true;
			}
		}
	} catch (err) {
		return false;
	}
	return false;
}

addEventListener("fetch", (e) => {
	try {
		const reqUrl = e.request.url;
		if (isBlockedUrl(reqUrl)) {
			// return an empty response for blocked resources
			e.respondWith(new Response('', { status: 204, statusText: 'No Content' }));
			return;
		}
	} catch (err) {
		// fall through to normal routing
	}

	if ($scramjetController.shouldRoute(e)) {
		e.respondWith($scramjetController.route(e));
	}
});

// Allow the client to push updated blocklists into the SW at runtime.
addEventListener('message', (event) => {
	try {
		const data = event.data;
		if (!data || data.type !== 'update-adguard' || !Array.isArray(data.list)) return;
		self.ADGUARD_BLOCKLIST = data.list;
		self.ADGUARD_UPDATED_AT = Date.now();
		// acknowledge back if possible
		if (event.source && typeof event.source.postMessage === 'function') {
			try {
				event.source.postMessage({ type: 'adguard-updated', updatedAt: self.ADGUARD_UPDATED_AT });
			} catch (e) {}
		}
	} catch (err) {
		// ignore malformed messages
	}
});
