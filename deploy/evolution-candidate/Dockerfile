FROM evoapicloud/evolution-api@sha256:966625532d9076a2381e973a271307d107e6f070450de3abeeea8bd18be07252
WORKDIR /evolution
RUN npm install --ignore-scripts --no-audit --no-fund baileys@7.0.0-rc14
COPY dependency-audit.cjs /tmp/dependency-audit.cjs
RUN node /tmp/dependency-audit.cjs
COPY forward-errors.cjs /tmp/forward-errors.cjs
RUN node /tmp/forward-errors.cjs && node --check dist/main.js && node -e 'const b=require("baileys");if(typeof b.default!=="function")throw Error("Incompatible Baileys export")'
