"use strict";
/**
 *
 * @param {string} input
 * @param {string} template Template for a search query.
 * @returns {string} Fully qualified URL
 */
function search(input, template) {
	try {
		// input is an explicit URL with a scheme:
		// eg: https://example.com, https://example.com/test?q=param
		return new URL(input).toString();
	} catch (err) {
		// input was not a valid explicit URL
	}

	const bareHostPattern =
		/^(localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(?::\d+)?(?:\/[^\s]*)?$/;
	if (bareHostPattern.test(input)) {
		return new URL(`https://${input}`).toString();
	}

	// Treat ambiguous inputs as search queries instead of guessing a URL.
	return template.replace("%s", encodeURIComponent(input));
}
