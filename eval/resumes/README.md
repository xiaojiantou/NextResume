# Resume corpus

`.json` files here are parsed `Resume` objects — exactly the `resume` field of
what `POST /api/parse-resume` returns. `scripts/eval-ats.mjs` scores every
resume in this folder against every posting in `../jds`, so N resumes x M
postings gives NxM data points from N+M files.

## Why real parses, not fixtures

Hand-written fixtures encode what we already believe a resume looks like, so
they cannot surface a parse or scoring bug we have not already imagined. Real
parses carry the things that actually break scoring: unicode bullets, skills
glued together by PDF extraction, missing headline titles, dates in odd
formats. `example-platform.json` is the one exception — it is synthetic, kept
only so the harness runs out of the box. Replace it as soon as you have real
ones.

## Capturing one

With the dev server running, upload a resume in the app and copy the parse out
of devtools:

    Network -> parse-resume -> Response -> right-click "resume" -> Copy value

Or straight from the API:

    curl -s -X POST http://localhost:3000/api/parse-resume \
      -F "file=@/path/to/resume.pdf" \
    | node -e 'process.stdin.once("data",d=>console.log(JSON.stringify(JSON.parse(d).resume,null,2)))' \
    > eval/resumes/some-name.json

Name files after the *shape* of the resume rather than the person, since the
point of the corpus is coverage: `career-changer.json`, `new-grad-projects.json`,
`no-headline-title.json`, `two-column-pdf.json`.

## Privacy

Real resumes carry real contact details, so this folder is gitignored apart
from the README and the synthetic example. Keep it that way — a corpus is only
worth having if people are willing to put real documents in it.
