ARG NODE_IMAGE
FROM ${NODE_IMAGE}

WORKDIR /opt/jasim-baseline
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm cache clean --force
COPY . .

RUN mkdir -p /opt/core-lab \
    && cp services/core-evolution-lab/evaluator-image/runner.mjs /opt/core-lab/runner.mjs \
    && cp services/core-evolution-lab/evaluator-image/policy.json /opt/core-lab/policy.json \
    && chmod 0444 /opt/core-lab/runner.mjs /opt/core-lab/policy.json \
    && chmod -R a-w /opt/jasim-baseline

USER 65532:65532
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/core-lab/runner.mjs"]
