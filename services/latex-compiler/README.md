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
| `\def\l{\l}\l` | killed on timeout, 422 |
| wrong `X-Compile-Token` | 401 |

## API

`POST /compile` with `{"source": "...", "engine": "pdflatex"}` and header
`X-Compile-Token`. Returns `application/pdf`, or JSON `{error, log}` with 422
when the document itself does not build. `GET /health` returns `ok`.

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
`iad1`) with 1 CPU / 1 GiB / concurrency 2, health-checks the service, and
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
