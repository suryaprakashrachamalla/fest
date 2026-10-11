FROM oven/bun:1.3.14

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src ./src

# Prisma config requires DATABASE_URL even though generation does not connect to the database.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build bunx prisma generate

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "src/index.ts"]
