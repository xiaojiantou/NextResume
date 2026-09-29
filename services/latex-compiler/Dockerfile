# Copyright (c) 2026 HowBe LLC. All rights reserved.

# LaTeX compile service for NextResume.
#
# This exists as its own container because a TeX distribution cannot fit in a
# serverless function: the app's Vercel bundle is already tight enough that
# Chromium needs explicit file-tracing includes.
FROM debian:bookworm-slim

# texlive-latex-extra carries titlesec, enumitem, and the other packages
# resume templates lean on; fonts-extra carries fontawesome, which is common
# in contact headers. xetex/luatex are here because a template built around a
# system font (fontspec + \setmainfont) needs one of them — pdflatex cannot
# run fontspec at all — and the server picks whichever the template declares
# or requires (lib/texEngine.ts), so both must actually be installed.
# T1-encoded Computer Modern needs CM-Super outline fonts. Without it,
# TeX generates bitmap Type 3 fonts, changing rendering and breaking
# ligature text extraction. Keep the source font choice intact.
RUN apt-get update && apt-get install -y --no-install-recommends \
      nodejs \
      texlive-latex-base \
      texlive-latex-recommended \
      texlive-latex-extra \
      texlive-fonts-recommended \
      texlive-fonts-extra \
      texlive-xetex \
      texlive-luatex \
      lmodern \
      cm-super \
      texlive-lang-chinese \
      fonts-noto-cjk \
      texlive-fonts-extra-links \
      poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/share/doc /usr/share/man

# Compilation runs as an unprivileged user with no home it can write outside
# of the per-request scratch directory.
RUN useradd --system --create-home --shell /usr/sbin/nologin texc
WORKDIR /srv
COPY server.js smoke-test.js /srv/
RUN chown -R texc:texc /srv

USER texc
# Fail the image build if fonts, Chinese support, or text extraction regress.
RUN node /srv/smoke-test.js
ENV PORT=8080
EXPOSE 8080
CMD ["node", "/srv/server.js"]
