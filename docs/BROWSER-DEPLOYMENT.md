# GitHub Pages browser deployment

Public deployment of GMC-9000 was explicitly approved on 2026-11-04. The deployment workflow is committed to development; live deployment status must be checked in GitHub Actions.

This deployment is for GMC-9000-Sample-Pads, not the DS-9 Drum Machine.

The available Codex tools advertise remote desktop capability but do not expose a desktop-opening, preview-sharing or port-forwarding operation. A running Vite server is therefore not a verified user-accessible browser preview.

## Deployment

- Workflow: `.github/workflows/pages.yml`, on pushes to `development`, with a manual dispatch option when available. No main changes. The push trigger allows the initial deployment without putting the workflow on the default branch.
- Node 24, frozen dependency install (`npm ci`), existing tests, production build, official GitHub Pages artifact/deploy actions.
- Build base: `/GMC-9000-Sample-Pads/`. Local development still uses `/`.
- AudioWorklet resolves against Vite's base. Fonts, CSS and JavaScript are built under the same prefix. UI, DSP and playback behavior are unchanged.
- Expected URL after successful deployment: `https://grimiss.github.io/GMC-9000-Sample-Pads/`. This is a proposed address, not a verified live site.
- GitHub repository Settings → Pages must select GitHub Actions as the build source. Repository permissions, plan and environment deployment rules may affect availability. API inspection from this environment returned Forbidden, so current repository visibility and Pages settings were not verified. Do not change repository visibility to work around plan restrictions.

## Public visibility and approval

Assume a public Pages site: anyone can access and copy the interface, JavaScript, worklet, bundled fonts and other deployed assets. A private repository does not by itself make the Pages site private. No repository visibility change is proposed. Future pushes to development will rebuild and republish this site while the workflow is enabled.

Only `dist` is deployed; no user WAV files or credentials are bundled. Imported WAVs are decoded locally in the visitor's browser and are not uploaded by this application. All nine pads now include locally synthesized demonstration samples. LOAD replaces a pad with a user WAV; audio-input recording and MIDI access require separate browser permissions. Playback starts after a user gesture over HTTPS.

The user has approved public deployment. No additional deployment approval is required. The cloud environment must not be modified or republished.

## Validation

The production build with the repository prefix passes TypeScript/build and all three existing sequencing tests. A Chromium check served the built dist at the exact repository subpath and verified nine pads, bundled fonts, WAV decoding, worklet loading and nonzero output without asset/runtime failures. These checks do not establish that Pages is enabled or a deployment succeeded.

## If GitHub settings block deployment

1. Open https://github.com/Grimiss/GMC-9000-Sample-Pads/settings/pages . Under Build and deployment, set Source to GitHub Actions.
2. Open the repository Actions tab, select Deploy browser instrument to GitHub Pages, open the latest development run, and choose Re-run all jobs if it previously failed.
3. If the deploy job reports an environment branch restriction, open Settings → Environments → github-pages → Deployment branches and tags and allow development.
4. If the environment requires review, open the Actions run and use Review deployments → github-pages → Approve and deploy.
5. If Actions is disabled, enable it through the repository Actions tab or Settings → Actions → General, retaining organization policy.

After the deployment job succeeds, use its environment URL. No Windows installation is needed. Click LOAD to choose a local WAV, then click the pad to start playback.
