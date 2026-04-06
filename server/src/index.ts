import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.js";
import driveRoutes from "./routes/drive.js";
import apiKeyRoutes from "./routes/apiKeys.js";
import v1Routes from "./routes/v1.js";
import prisma from "./resources/prisma.js";

const app = express();
const PORT = Number(process.env.PORT) || 3700;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRoutes);
app.use("/drive", driveRoutes);
app.use("/api-keys", apiKeyRoutes);
app.use("/v1", v1Routes);

const server = app.listen(PORT, () => {
  console.log(`archers-drive server listening on http://localhost:${PORT}`);
});

async function shutdown() {
  await prisma.$disconnect();
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
