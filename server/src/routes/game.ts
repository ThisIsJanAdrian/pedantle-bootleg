import { Router } from "express";
import { createGame, submitGuess, NotFoundError, BadRequestError } from "../game.js";

export const gameRouter = Router();

gameRouter.post("/new", async (_req, res) => {
  try {
    const { gameId, view } = await createGame();
    res.json({ gameId, ...view });
  } catch (err) {
    console.error("Failed to create game", err);
    res.status(502).json({ error: "Could not start a new game right now" });
  }
});

gameRouter.post("/guess", (req, res) => {
  const { gameId, guess } = req.body ?? {};
  if (typeof gameId !== "string" || typeof guess !== "string") {
    res.status(400).json({ error: "gameId and guess are required strings" });
    return;
  }

  try {
    const { view, alreadyGuessed } = submitGuess(gameId, guess);
    res.json({ alreadyGuessed, ...view });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
    } else if (err instanceof BadRequestError) {
      res.status(400).json({ error: err.message });
    } else {
      console.error("Failed to process guess", err);
      res.status(500).json({ error: "Something went wrong processing that guess" });
    }
  }
});
