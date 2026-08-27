import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { prisma } from "@chronus/db";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const databaseUrl = process.env.DATABASE_URL;

// Enable CORS for port 80 (and default origin for local dev debugging if needed)
app.use(
  cors({
    origin: [
      "http://localhost",
      "http://localhost:80",
      "http://localhost:3000",
      "http://localhost:5173", // default vite port
    ],
    credentials: true,
  })
);

app.use(express.json());

app.get("/health", async (req, res) => {
  let dbStatus = "unknown";
  if (databaseUrl) {
    try {
      await prisma.user.count();
      dbStatus = "connected";
    } catch (e) {
      console.error("Database check failed:", e);
      dbStatus = "error";
    }
  } else {
    dbStatus = "not_configured";
  }

  res.status(dbStatus === "error" ? 500 : 200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    databaseConfigured: !!databaseUrl,
    databaseStatus: dbStatus,
  });
});

app.listen(port, () => {
  console.log(`[server]: API Server is running on port ${port}`);
});
