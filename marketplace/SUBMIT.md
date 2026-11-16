# Steps you must do yourself to submit the listing

These steps need your Atlassian account, vendor details or decisions, so they are listed for you to do. In order:

1. **Fill the blanks.** Put your name and support email in `marketplace/PRIVACY.md`, `marketplace/TERMS.md` and the support row of `marketplace/LISTING.md`. Have the terms and privacy text reviewed if you can. The repository is public at https://github.com/princejsps12-ux/recallradar, so the privacy, terms and README files already have public URLs (listed in `LISTING.md`). Commit and push after you edit them.
2. **Screenshots**: all 23 are already in `marketplace/screenshots/`: 19 generated from the app (`npm run shots` redoes them after any UI change) and four taken on the demo site (a Jira task, two Rovo chats, a Confluence page; `LISTING.md` lists them in order). Nothing to take; upload them.
3. **Icon**: `marketplace/icon-144.png` is ready (144 x 144); nothing to do.
4. **Scopes**: already trimmed to what the app uses; nothing to do.
5. **(Done: the install link is in the README.)** If you ever need a new one: **Developer console, Distribution** (`https://developer.atlassian.com/console/myapps/2e0464e9-8b4a-4388-b224-b4f05eae484f/manage/distribution`): complete the vendor details, set the app's distribution to **Sharing** and click **Generate link** (the install link for judges). Judges open the link, pick their site and install; the production app is version 2.0.0.
6. **Marketplace**: sign in at `https://marketplace.atlassian.com/manage`, create or join your vendor account (it asks for company or personal details and a contact), choose **Create new app**, pick the Forge app, and paste the texts from `LISTING.md`.
7. **Listing details**: upload the icon and screenshots, add the privacy and terms URLs, the support contact and the documentation URL.
8. **Security**: Marketplace asks you to join its security program (a short questionnaire; use the "Data and security notes" in `LISTING.md`). **Pricing: free listings are not possible.** The app is multi-app compatible (Jira required, Confluence optional), and Atlassian only allows PAID Marketplace listings for such apps. Either set a price, or skip the Marketplace: the Codegeist submission needs only the install link from step 5. Going back to a free listing means removing `app.compatibility` from `manifest.yml`, which Forge only allows when the app has no installations anywhere (uninstall it from every site first), and then Jira and Confluence become two separate installations again (two agents in the picker, and Rovo Home may reach the one without devices).
9. **Submit for review.** Atlassian reviews the listing and app. Fix anything they raise.

For the **Codegeist submission itself** (separate from the Marketplace listing), use the install link from step 5 above, the repository link, a short demo video, and the README.
