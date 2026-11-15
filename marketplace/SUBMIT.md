# Steps you must do yourself to submit the listing

I (the assistant) can not click through your Atlassian account's forms, and some answers are yours to give. In order:

1. **Fill the blanks.** Put your name and support email in `marketplace/PRIVACY.md`, `marketplace/TERMS.md` and the support row of `marketplace/LISTING.md`. Have the terms and privacy text reviewed if you can. The repository is public at https://github.com/princejsps12-ux/recallradar, so the privacy, terms and README files already have public URLs (listed in `LISTING.md`). Commit and push after you edit them.
2. **Take the 8 screenshots** listed in `LISTING.md` (demo site, light theme).
3. **Check the icon.** Open `marketplace/icon.svg`. Marketplace wants a 144 x 144 PNG: export the SVG at 144 x 144 from any image tool (for example open it in Chrome, or use Figma or Preview).
4. **Scopes**: already trimmed to what the app uses; nothing to do.
5. **Developer console, Distribution** (`https://developer.atlassian.com/console/myapps/2e0464e9-8b4a-4388-b224-b4f05eae484f/manage/distribution`): complete the vendor details, set the app's distribution to **Sharing** and click **Generate link** (the install link for judges). Judges open the link, pick their site and install; the production app is version 2.0.0.
6. **Marketplace**: sign in at `https://marketplace.atlassian.com/manage`, create or join your vendor account (it asks for company or personal details and a contact), choose **Create new app**, pick the Forge app, and paste the texts from `LISTING.md`.
7. **Listing details**: upload the icon and screenshots, add the privacy and terms URLs, the support contact and the documentation URL.
8. **Security**: Marketplace asks you to join its security program (a short questionnaire; use the "Data and security notes" in `LISTING.md`). For a free app, choose **Free** pricing.
9. **Submit for review.** Atlassian reviews the listing and app. Fix anything they raise.

For the **Codegeist submission itself** (separate from the Marketplace listing), use the install link from step 5, the repository link, a short demo video, and the README.
