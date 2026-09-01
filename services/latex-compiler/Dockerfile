# Copyright (c) 2026 HowBe LLC. All rights reserved.

# LaTeX compile service for NextResume.
#
# This exists as its own container because a TeX distribution cannot fit in a
# serverless function: the app's Vercel bundle is already tight enough that
# Chromium needs explicit file-tracing includes.
FROM debian:bookworm-slim

# texlive-latex-extra carries titlesec, enumitem, and the other packages
# resume templates lean on; fonts-extra carries fontawesome, which is common
# in contact headers. xetex is here because some templates select it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      nodejs \
      texlive-latex-base \
      texlive-latex-recommended \
      texlive-latex-extra \
      texlive-fonts-recommended \
      texlive-fonts-extra \
      texlive-xetex \
      lmodern \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/share/doc /usr/share/man

# Compilation runs as an unprivileged user with no home it can write outside
# of the per-request scratch directory.
RUN useradd --system --create-home --shell /usr/sbin/nologin texc
WORKDIR /srv
COPY server.js /srv/server.js
RUN chown -R texc:texc /srv

USER texc
ENV PORT=8080
EXPOSE 8080
CMD ["node", "/srv/server.js"]
