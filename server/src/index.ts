import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import { loadVectors } from "./wordVectors.js";
import { initGameModule } from "./game.js";
import { gameRouter } from "./routes/game.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const VECTORS_PATH =
  process.env.VECTORS_PATH ?? path.join(__dirname, "..", "data", "glove.6B.100d.txt");

async function main() {
  if (!fs.existsSync(VECTORS_PATH)) {
    console.error(
      `Word vectors file not found at ${VECTORS_PATH}.\n` +
        "Download glove.6B.zip from https://nlp.stanford.edu/projects/glove/, " +
        "extract glove.6B.100d.txt, and place it at server/data/glove.6B.100d.txt " +
        "(or set VECTORS_PATH)."
    );
    process.exit(1);
  }

  console.log(`Loading word vectors from ${VECTORS_PATH} ...`);
  const start = Date.now();
  const vectors = await loadVectors(VECTORS_PATH);
  console.log(`Loaded ${vectors.size} word vectors in ${Date.now() - start}ms`);
  initGameModule(vectors);

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api/game", gameRouter);

  const clientDist = path.join(__dirname, "..", "..", "client", "dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
}

main().catch((err) => {
  console.error("Fatal error during startup", err);
  process.exit(1);
});
