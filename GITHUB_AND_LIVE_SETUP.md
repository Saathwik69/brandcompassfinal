# BrandCompass: GitHub and live website setup

**You need two links:** a GitHub repository for source code and a hosted website for judges to use. The frontend, backend, schema, tests and sample files belong in one repository. The running server and database live on a hosting service.

BrandCompass needs Node.js 24 and a database. GitHub Pages serves static files and cannot run this project's Node backend. Uploading only `public/`, opening `index.html` directly, or uploading the ZIP as one file will not deploy the working application.

## 1. Run on your laptop

1. Install **Node.js 24 LTS** from https://nodejs.org/.
2. Extract the ZIP and open the **BrandCompass** folder in VS Code.
3. Open **Terminal → New Terminal**, in the folder containing `package.json`.
4. Run:

```bash
node --version
npm ci
npm start
```

The version should start with `v24.`. There are no third-party runtime npm dependencies. `npm ci` validates the included lockfile. If PowerShell blocks `npm.ps1`, use Command Prompt or type `npm.cmd` instead of `npm`.

Open **http://localhost:3000** and choose **Explore the live demo**. Keep the terminal open. The app automatically creates `data/brandcompass.sqlite`; no separate database installation is needed. Windows shortcut: double-click `START_WINDOWS.bat`.

`localhost` works on your laptop only. It is not the link to submit.

## 2. Create the GitHub repository

Open https://github.com/new while signed in.

| Field | Value |
|---|---|
| Repository name | `brandcompass` |
| Description | Brand content review with cited evidence, human approvals, audit history and report exports. Built by ByteRift. |
| Visibility | Follow the hackathon's rules; Public lets judges inspect source without an invitation |
| Add README | Off — already included |
| Add .gitignore | None — already included |
| Choose a license | None — the existing MIT licence is included |

Click **Create repository**, then **uploading an existing file** or **Add file → Upload files**. Upload the **contents inside BrandCompass**, keeping folder structure. `README.md`, `package.json`, `server.mjs` and `render.yaml` must appear at the repository root. Upload the actual files, not just the ZIP or an extra outer directory.

Include `.github`, `.openai`, `.gitignore`, `.gitattributes`, `.node-version`, `.nvmrc` and `.env.example`. Show hidden items if necessary. Commit with **Prepare BrandCompass hackathon application**.

If browser upload omits these folders, use Git from the extracted folder. Replace `YOUR_USERNAME` with your GitHub username:

```bash
git init -b main
git add .
git commit -m "Prepare BrandCompass hackathon application"
git remote add origin https://github.com/YOUR_USERNAME/brandcompass.git
git push -u origin main
```

Use GitHub's browser sign-in when prompted. If Git asks for a name/email, set your own Git identity; a GitHub noreply email is fine. If the folder already has Git initialized or a remote, reuse that setup instead of repeating initialization.

After a push to `main`, **Actions → BrandCompass checks** verifies the code and exercises a running server. This checks the project; it does not itself create a hosting account.

## 3. What belongs in the repository

Upload all prepared source files:

| File or folder | Purpose |
|---|---|
| `README.md` | Overview, real stack, features, setup and limitations |
| `GITHUB_AND_LIVE_SETUP.md` | This guide |
| `package.json`, `package-lock.json` | Commands and dependency metadata |
| `server.mjs` | Serves the website and backend API |
| `src/` | Review rules, evidence retrieval, accounts, approvals, database and exports |
| `public/` | Website HTML, CSS, JavaScript and PDF import library |
| `drizzle/` | Database schema and migrations |
| `samples/` | Fictional captions, images, documents and evaluation fixtures |
| `tests/`, `scripts/` | Tests, HTTP smoke checks, evaluation and Worker build |
| `docs/` | Architecture, pitch, testing evidence and limitations |
| `.github/workflows/ci.yml` | Automated GitHub checks |
| `render.yaml` | Optional GitHub-connected live deployment |
| `.node-version`, `.nvmrc` | Select Node.js 24 |
| `.env.example` | Safe configuration example, with no key |
| `.gitignore`, `.gitattributes`, `.dockerignore` | File handling and exclusions |
| `Dockerfile`, `compose.yaml` | Optional Docker startup |
| `.openai/hosting.json` | Existing Worker/D1 hosting reference; unused by Render |
| `START_HERE.html`, `START_WINDOWS.bat`, `start.sh` | Local launch guides |
| `LICENSE`, `THIRD_PARTY_NOTICES.md` | Project and third-party licences |

**Do not upload:** `.env`, real API keys, `data/`, SQLite files, `node_modules/`, `dist/`, private reports or real customer records. The prepared archive contains no runtime database. Git ignores these generated/local files; check them yourself when using a browser upload after running the app.

After verifying the live URL, add it to **About → Website** and the README. Suggested topics: `hackathon`, `brand-governance`, `nodejs`, `sqlite`, `content-review`.

## 4. Existing hosted website

The uploaded project references **https://brandcompass-byterift-lab.s4395011.chatgpt.site**.

On 8 November 2026 it was deployed but restricted to the owner. An anonymous health request returned HTTP 401. It is not yet a judge-accessible link. Access must be made public or granted to the required viewers, with the owner's explicit choice. Verify the resulting link in a signed-out/incognito window before submitting it.

Authorized HTTP verification passed all 9 checks on the deployed app, including save, approval, reports and audit. This verifies its backend flow, not anonymous visitor access.

Uploading this source to GitHub does not automatically update that existing Site. The current Site uses Worker/D1. A new Render deployment uses its own separate SQLite database. Use the following route if you want redeployment directly from GitHub.

## 5. Deploy from GitHub to Render

The frontend and backend run together at one URL, so no API URL or CORS changes are needed.

1. Sign in at https://dashboard.render.com/ and connect the GitHub repository.
2. Choose **New → Blueprint**, select the repository and use its root `render.yaml`.
3. Review and apply the configuration. It requests a **Free web service**, Node 24, Singapore region, tests before startup and `/api/health` checks. Automatic redeploys wait for GitHub checks to pass.
4. Wait until the service is **Live**. Copy the exact `https://...onrender.com` URL shown by Render; its name may have a suffix. Preparing files alone does not create this address.

Alternatively, choose **New → Web Service** with these settings:

| Setting | Value |
|---|---|
| Repository / Branch | Your `brandcompass` repository / `main` |
| Runtime | Node |
| Root Directory | Empty when `package.json` is at the root |
| Build Command | `npm ci --ignore-scripts && npm test` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Instance Type | Free for a disposable demo |
| `NODE_VERSION` | `24` |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `ALLOW_SIGNUP` | `true` |

Let Render supply `PORT`. Do not upload `.env`. The working rule-based demo needs no OpenAI key. `npm run build` creates the separate Worker target; it is not necessary for the Node web service.

Once connected, pushes to the linked GitHub branch can automatically redeploy the app. The build command also runs tests before startup.

### Choose storage deliberately

Render Free sleeps after 15 minutes without traffic and can take about a minute to wake. Its local SQLite data is lost on sleep, restart or redeployment. **Explore the live demo** still creates a fresh fictional workspace, but previous accounts and saved reviews can disappear. Export work you need to keep.

For durable SQLite records, choose a **paid Render service with a persistent disk** after reviewing current prices. Mount the disk at `/var/data`, set `DB_PATH=/var/data/brandcompass.sqlite`, and use one service instance. Only files under that mount persist. Adding a disk does not migrate old records automatically. If using a Blueprint, also update its plan and disk settings to match. The included Free configuration does not purchase a disk.

The existing Worker/D1 deployment is another persistence option, subject to its access policy and account limits. Do not describe the temporary Free Render database as durable storage.

## 6. Verify the exact link before submission

1. Open it in a signed-out/incognito window. It should show BrandCompass without an owner-only access wall.
2. Choose **Explore the live demo**, open the seeded review and expand a cited source.
3. Apply a suggestion and confirm a new revision appears.
4. Paste `samples/approved_caption.txt`. Set text colour to `#172B26` and background to `#FFFFFF`, then save and review.
5. Submit, change Demo role to Manager or Reviewer, and approve with a reason.
6. Verify the audit chain and export an HTML, JSON or CSV report.
7. Try the sample PDF/DOCX and graphic. Check the documented input limitations.
8. Refresh the page. For persistent hosting, also check that saved records survive a restart before relying on that claim.

To test the live backend from the project folder with Node 24, replace the example below with the actual URL:

```bash
npm run smoke -- https://YOUR_ACTUAL_DEPLOYED_HOST
```

Expected result: **9 HTTP checks passed**. It creates a separate fictional demo workspace, checks assets, sessions, saved claims, approval, exports, audit and logout. It does not test every browser interaction or paid AI. The demo record remains in the database after the check logs out.

For local verification, keep `npm start` open and run in a second terminal:

```bash
npm test
npm run smoke -- http://localhost:3000
```

## 7. Hackathon submission

- **Repository:** copy the real GitHub repository URL after creation.
- **Live website:** submit the verified judge-accessible deployment, not `localhost` or a GitHub source-file URL.
- **Demo steps:** “Open the website → Explore the live demo.” No app account or API key is needed once hosting access allows the visitor.
- **Documentation:** retain architecture, real features, limitations, evaluation and AI assistance disclosure.
- **Recording/slides:** include if the event requires them; use `docs/DEMO_AND_PITCH.md` for the pitch.

Describe the default review as **rules plus lexical evidence retrieval**. Optional OpenAI review requires a server-side key and separate live verification.

## Official references

Checked 8 November 2026:

- https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository
- https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
- https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- https://render.com/docs/deploy-node-express-app
- https://render.com/docs/node-version
- https://render.com/docs/blueprint-spec
- https://render.com/docs/free
- https://render.com/docs/disks
