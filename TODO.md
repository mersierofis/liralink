# TODO before submission

> Delete this file before submission.

- [x] Live contract ID: deploy the invoice contract during the event, then replace "TBD" in `README.md` and `docs/00-PROJECT.md` §7
- [ ] Demo video link in `README.md`
- [x] Live URLs in `README.md` (merchant panel, payer page, API docs, API health)
- [x] Rotate the demo password, set it on the server, and remove the "rotate before publishing" TODO from `README.md`
- [x] Vendor the Stellar skills under `skills/<name>/` (with `SOURCE.md`: URL, commit, fetch date) and switch `README.md` to in-repo skill paths
- [x] Write `docs/acceptance-tests.md`
- [ ] Write the real "Try it in 3 minutes" steps in `README.md`
- [ ] Amplify: `/p/<code>` 301s to `/p/<code>/`, which is served as a 404 with `index.html` as the body (the page renders, but the console logs a 404). Make the catch-all a 200 rewrite to `/index.html` for any path without a file extension, with or without a trailing slash; same for the merchant panel. No router change needed.
