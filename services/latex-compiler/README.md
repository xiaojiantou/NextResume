# LaTeX compile service

Compiles a resume `.tex` to PDF for NextResume. It runs as its own container
because a TeX distribution cannot fit in a serverless function — the app's
Vercel bundle already needs explicit file-tracing includes just to carry
Chromium — and because compiling user-supplied LaTeX is arbitrary code
execution that belongs behind a hard isolation boundary.

## What contains it

`\write18` is disabled (`-no-shell-escape`), `openin_any`/`openout_any=p`
stop `\input{/etc/passwd}` and writes outside the per-request scratch
directory, a wall-clock timeout kills macro loops, and compilation runs as an
unprivileged user. Set memory and CPU caps at deploy time for the rest.

Verified against each of those:

| Probe | Result |
| --- | --- |
| `\immediate\write18{id > /tmp/pwned.txt}` | compiles, no file created |
| `\input{/etc/passwd}` | refused, 422 |
| `\openout` to `/tmp/escape.txt` | refused, 422 |
| `\def\l{\l}\l` | killed on timeout, 504 |
| wrong `X-Compile-Token` | 401 |

## API

`POST /compile` with `{"source": "...", "engine": "pdflatex"}` and header
`X-Compile-Token`. Returns `application/pdf`, or JSON `{error, log}` with 422
when the document itself does not build, or 504 when compilation times out.
The default 40-second budget covers both TeX passes together; the app waits
up to 50 seconds, within the route’s 60-second limit. `GET /health` returns `ok`.

`engine` accepts `pdflatex` (default), `xelatex`, or `lualatex`.

## Run locally

```sh
docker build -t nextresume-latex .
docker run --rm -p 8099:8080 -e COMPILE_TOKEN=dev --memory=1g --cpus=1 nextresume-latex
```

## Deploy to Cloud Run

The app stays on Vercel; only this container runs on GCP. `deploy.sh` does the
whole thing and is safe to re-run:

```sh
PROJECT_ID=<gcp project> ./services/latex-compiler/deploy.sh
```

It enables the APIs, creates an Artifact Registry repo and a Secret Manager
secret for `COMPILE_TOKEN` (generated once, reused after), builds with Cloud
Build, deploys to Cloud Run in `us-east1` (the same side of the US as Vercel's
`iad1`) with 1 CPU / 1 GiB / concurrency 1, health-checks the service, and
prints the three Vercel variables. `REGION`, `SERVICE`, and `MIN_INSTANCES`
can be overridden in the environment.

The image is ~2 GB, which is mostly TeX Live, so a cold start takes 10-20s.
The script keeps one instance warm (`MIN_INSTANCES=1`, roughly $10-15/month);
set `MIN_INSTANCES=0` only if a slow first compile is acceptable.

The service is reachable without a Google identity because Vercel functions
have none to present; `COMPILE_TOKEN` (checked as `X-Compile-Token`, wrong
token is a 401) is what stands between it and anyone who finds the URL, so
treat it as a credential and rotate it by adding a new secret version.

## Wire it into the app

```
LATEX_COMPILER_URL=https://nextresume-latex-xxxx.run.app
LATEX_COMPILER_TOKEN=<the same COMPILE_TOKEN>
NEXT_PUBLIC_LATEX_COMPILER=1
```

The first two are read by `lib/latexCompiler.ts`. The third only reveals the
button; without the first, the route returns 501 and tells the user to build
the `.tex` in Overleaf.

## Packages

`texlive-latex-extra` (titlesec, enumitem, tabularx) and
`texlive-fonts-extra` (fontawesome) cover the templates resumes actually use.
A document needing something else fails with its TeX log, which the app shows.

`cm-super` supplies the outline fonts for T1-encoded Computer Modern. It is
installed explicitly because the image disables recommended packages. Without
it, templates using `\usepackage[T1]{fontenc}` can fall back to bitmap Type 3
fonts, with degraded rendering and broken ligature extraction. `lmodern` alone
does not replace these fonts unless the document explicitly selects it.

## Font and language build checks

The image explicitly installs `texlive-lang-chinese`, `fonts-noto-cjk`, and
`texlive-fonts-extra-links`. The app defaults ctex templates to XeLaTeX while
respecting explicit engine comments. Templates naming other system fonts still
need those exact fonts; installed fonts are not silently substituted.

Every image build runs `smoke-test.js` as the unprivileged runtime user, under
the runtime file-access restrictions. It compiles English T1 text, default
ctex Chinese, Noto Simplified/Traditional Chinese, and LuaLaTeX/fontspec text.
Poppler's `pdffonts` and `pdftotext` reject Type 3 fallback, unembedded fonts,
broken ligatures, and missing expected text. TeX logs are checked for missing
glyphs and font shapes. These checks must pass before the image can deploy.
